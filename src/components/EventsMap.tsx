// The Events map (backlog item 117, founder ask 2026-09-04): "pin points events to geographic
// regions around the world, so you can click and see events based on where they occurred", modelled
// on the iPhone Photos map.
//
// Lazy-loaded by Events.tsx and nothing else, which is the entire justification for Leaflet being
// this repo's ninth runtime dependency: it lands in this chunk and only this chunk, so the entry
// bundle is untouched for everyone who never opens the map — the same argument that let TipTap in.
//
// Three things here are load-bearing and easy to undo by accident:
//
// 1. Pins are `L.divIcon`, never `L.marker`'s default. Leaflet's default icon is three PNGs
//    referenced by relative URL, which do not survive bundling — you get invisible markers and no
//    error at all. divIcon is plain HTML, and it also gets to show the event count.
// 2. Coordinates come out of `location_coords`, never out of a geocode-per-render. A place is
//    looked up ONCE, ever, and a place that can't be found is stored as a `source = 'none'`
//    sentinel so it is never asked about again (CLAUDE.md rule 3 — the cache IS the feature).
// 3. §12 guarantees some pins land in the wrong state ("Oracle Park" is in Arizona as far as a
//    geocoder is concerned), so every place carries a correction the founder can apply by hand.
import { useEffect, useMemo, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { supabase } from '../lib/supabase'
import { fetchAllRows } from '../lib/pagedSelect'
import { clusterPoints, type MapCluster, type MapPoint } from '../lib/mapClusters'
import { clusterKey, tallyLocations } from '../lib/locationGroups'
import { geocodeLocation, hasGeoapifyKey } from '../lib/geoapify'
import { summarize } from '../lib/summarize'
import { formatEventWhen } from '../lib/dates'
import AddressSuggestInput from './AddressSuggestInput'
import { border, colors, fontFamily, fontSize, maxWidth, neutral, radius, shadow, space } from '../lib/theme'
import type { Moment } from '../pages/Events'

// One tile source, named once. OpenStreetMap's own tiles are free and keyless and fine while this
// app has one user, but their Tile Usage Policy is not a licence for a growing product. If Grove
// ever opens up, swapping to a free-tier provider (Stadia / MapTiler / Carto) is this line plus its
// attribution — the same "confine the unofficial dependency to one place" call made for ESPN.
const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
const TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
const TILE_MAX_ZOOM = 19

// Geoapify's free tier allows roughly five requests a second. The first open of the map on a real
// account geocodes ~138 places, so they go out one at a time with a gap rather than as a burst — a
// 429 here would be cached as a permanent "not found" for every place it hit.
//
// The gap is deliberately smaller than it looks like it should be: measured against the real
// account the round trip is already ~350ms, so the achieved rate is under 3/sec even at zero gap.
// This is a floor against a fast connection, not the actual pacing.
const GEOCODE_GAP_MS = 120

type CoordSource = 'geoapify' | 'manual' | 'none'

type CoordRow = {
  location_key: string
  sample_value: string
  latitude: number | null
  longitude: number | null
  resolved_label: string | null
  source: CoordSource
}

/** One real place, with the events that happened there. A pin is a place, not an event. */
type PlacePin = {
  locationKey: string
  /** The spelling shown to the founder — one of their own, never the geocoder's. */
  location: string
  resolvedLabel: string | null
  source: CoordSource
  latitude: number
  longitude: number
  moments: Moment[]
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export default function EventsMap({
  moments,
  onSelectEvent,
  onFilterLocation,
}: {
  /** Already filtered by the Events page — the map shows whatever the list would have shown. */
  moments: Moment[]
  onSelectEvent: (event: { id: string; summary: string }) => void
  /** Hands a place back to the Events list's own location filter, rather than filtering in here. */
  onFilterLocation: (location: string) => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const layerRef = useRef<L.LayerGroup | null>(null)
  const didFitRef = useRef<'none' | 'early' | 'final'>('none')

  const [coords, setCoords] = useState<Map<string, CoordRow>>(new Map())
  const [phase, setPhase] = useState<'loading' | 'geocoding' | 'ready'>('loading')
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [tableMissing, setTableMissing] = useState(false)
  const [zoom, setZoom] = useState(2)
  const [selected, setSelected] = useState<MapCluster<PlacePin> | null>(null)
  const [correcting, setCorrecting] = useState<string | null>(null)
  const [correctionText, setCorrectionText] = useState('')
  const [correctionBusy, setCorrectionBusy] = useState(false)

  // Distinct real places in the account, keyed the same way ManageLocations keys them so the map
  // and that screen always agree about what counts as "the same place".
  const places = useMemo(() => {
    const byKey = new Map<string, { key: string; sample: string }>()
    for (const row of tallyLocations(moments.map((m) => m.location))) {
      const key = clusterKey(row.value)
      if (!key) continue
      const existing = byKey.get(key)
      // Geocode the LONGEST spelling of a place, not the most common one. "12208 Bandon Dr, Parker,
      // CO 80134" places precisely; the bare "12208 Bandon Dr" the founder usually types does not.
      if (!existing || row.value.length > existing.sample.length) byKey.set(key, { key, sample: row.value })
    }
    return byKey
  }, [moments])

  const eventsWithoutLocation = useMemo(
    () => moments.filter((m) => !m.location?.trim()).length,
    [moments]
  )

  // ---- load the cache, then fill the gaps in it ------------------------------------------------

  useEffect(() => {
    let cancelled = false

    async function run() {
      const { data, error } = await fetchAllRows<CoordRow>((from, to) =>
        supabase
          .from('location_coords')
          .select('location_key, sample_value, latitude, longitude, resolved_label, source')
          .order('location_key')
          .range(from, to)
      )
      if (cancelled) return

      // Isolated on purpose, the way Events.tsx isolates its child-event query: if the migration
      // hasn't been run yet this fails, and the honest outcome is a map that says so rather than a
      // page that breaks.
      if (error) {
        setTableMissing(true)
        setPhase('ready')
        return
      }

      const loaded = new Map(data.map((row) => [row.location_key, row]))
      setCoords(loaded)

      const missing = [...places.values()].filter((p) => !loaded.has(p.key))
      // With no key configured every geocode returns null, and writing that answer would poison the
      // cache with ~99 permanent "not found" rows that no later fix would clear. Better to plot what
      // is already cached and look nothing up.
      if (missing.length === 0 || !hasGeoapifyKey()) {
        setPhase('ready')
        return
      }

      const { data: auth } = await supabase.auth.getUser()
      const userId = auth.user?.id
      if (!userId) {
        setPhase('ready')
        return
      }

      setPhase('geocoding')
      setProgress({ done: 0, total: missing.length })

      for (let i = 0; i < missing.length; i++) {
        if (cancelled) return
        const place = missing[i]
        const found = await geocodeLocation(place.sample)
        if (cancelled) return

        const row: CoordRow = {
          location_key: place.key,
          sample_value: place.sample,
          latitude: found?.latitude ?? null,
          longitude: found?.longitude ?? null,
          resolved_label: found?.label ?? null,
          source: found ? 'geoapify' : 'none',
        }
        // Written one at a time rather than batched at the end, so a map closed halfway through
        // keeps every lookup it already paid for.
        await supabase
          .from('location_coords')
          .upsert({ ...row, user_id: userId }, { onConflict: 'user_id,location_key' })
        if (cancelled) return
        setCoords((prev) => new Map(prev).set(row.location_key, row))
        setProgress({ done: i + 1, total: missing.length })
        if (i < missing.length - 1) await sleep(GEOCODE_GAP_MS)
      }

      if (!cancelled) setPhase('ready')
    }

    run()
    return () => {
      cancelled = true
    }
  }, [places])

  // ---- what to draw -----------------------------------------------------------------------------

  const pins = useMemo(() => {
    const byKey = new Map<string, PlacePin>()
    for (const moment of moments) {
      const value = moment.location?.trim()
      if (!value) continue
      const key = clusterKey(value)
      if (!key) continue
      const row = coords.get(key)
      if (!row || row.latitude === null || row.longitude === null) continue

      const existing = byKey.get(key)
      if (existing) {
        existing.moments.push(moment)
        continue
      }
      byKey.set(key, {
        locationKey: key,
        location: places.get(key)?.sample ?? value,
        resolvedLabel: row.resolved_label,
        source: row.source,
        latitude: row.latitude,
        longitude: row.longitude,
        moments: [moment],
      })
    }
    return [...byKey.values()]
  }, [moments, coords, places])

  const clusters = useMemo(() => {
    const points: MapPoint<PlacePin>[] = pins.map((pin) => ({
      latitude: pin.latitude,
      longitude: pin.longitude,
      item: pin,
    }))
    return clusterPoints(points, zoom)
  }, [pins, zoom])

  const plottedEvents = useMemo(() => pins.reduce((n, p) => n + p.moments.length, 0), [pins])
  const unplaced = places.size - pins.length

  // ---- the Leaflet instance ---------------------------------------------------------------------

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    const map = L.map(containerRef.current, { worldCopyJump: true })
    L.tileLayer(TILE_URL, { maxZoom: TILE_MAX_ZOOM, attribution: TILE_ATTRIBUTION }).addTo(map)
    map.setView([25, 0], 2)
    layerRef.current = L.layerGroup().addTo(map)
    const syncZoom = () => setZoom(map.getZoom())
    map.on('zoomend', syncZoom)
    mapRef.current = map

    // Leaflet measures its container once and does not watch it. Rotate a phone — or open this at
    // one size and resize — and the tile grid keeps the old dimensions: grey bands down the sides
    // and tiles that never load for the newly exposed area. `invalidateSize` is the remedy, and it
    // has to be driven from an observer because there is no resize event for an element.
    // (Same pattern as PanZoomSvg's re-clamp observer.)
    const ro =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => map.invalidateSize())
    if (ro && containerRef.current) ro.observe(containerRef.current)

    return () => {
      ro?.disconnect()
      map.off('zoomend', syncZoom)
      map.remove()
      mapRef.current = null
      layerRef.current = null
    }
  }, [])

  // Frame the map on the founder's own world instead of the mid-Atlantic.
  //
  // Twice, not once, and the second time is the one that matters. Pins arrive over the couple of
  // minutes the first sweep takes, so fitting only on the first batch leaves the map zoomed onto
  // whichever three places happened to resolve first — measured on the real account, that was
  // Colorado Springs while 130 other places quietly appeared off-screen. So: an early fit so the
  // map isn't sitting on the Atlantic while it works, then a final fit once the sweep is done.
  // `didFitRef` tracks which of the two has happened so ordinary re-renders never yank the view
  // away from wherever the founder has panned to.
  useEffect(() => {
    const map = mapRef.current
    if (!map || pins.length === 0) return
    const stage = phase === 'ready' ? 'final' : 'early'
    if (didFitRef.current === stage || didFitRef.current === 'final') return
    didFitRef.current = stage
    const bounds = L.latLngBounds(pins.map((p) => [p.latitude, p.longitude] as [number, number]))
    // maxZoom keeps a single-pin account (or one very tight cluster) from opening at street level,
    // which reads as "the map is broken" rather than "you have one place".
    map.fitBounds(bounds, { padding: [48, 48], maxZoom: 11 })
  }, [pins, phase])

  // Redraw pins whenever the clustering changes. Cheap — this is tens of markers, not thousands —
  // and much easier to reason about than diffing Leaflet layers by hand.
  useEffect(() => {
    const layer = layerRef.current
    if (!layer) return
    layer.clearLayers()

    for (const cluster of clusters) {
      const events = cluster.items.reduce((n, pin) => n + pin.moments.length, 0)
      const size = events > 99 ? 46 : events > 9 ? 40 : 34
      const marker = L.marker([cluster.latitude, cluster.longitude], {
        icon: L.divIcon({
          className: '',
          // Only a number is interpolated, so there is nothing here to escape.
          html:
            `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${colors.primary};` +
            `color:${colors.onFill};display:flex;align-items:center;justify-content:center;` +
            `font-family:${fontFamily};font-size:13px;font-weight:600;border:2px solid ${neutral.white};` +
            `box-shadow:0 1px 4px rgba(0,0,0,0.4)">${events}</div>`,
          iconSize: [size, size],
          iconAnchor: [size / 2, size / 2],
        }),
        keyboard: false,
      })
      marker.on('click', () => {
        setSelected(cluster)
        setCorrecting(null)
      })
      marker.addTo(layer)
    }
  }, [clusters])

  // ---- correcting a wrong pin -------------------------------------------------------------------

  async function saveCorrection(pin: PlacePin) {
    const text = correctionText.trim()
    if (!text) return
    setCorrectionBusy(true)
    const found = await geocodeLocation(text)
    const { data: auth } = await supabase.auth.getUser()
    if (!found || !auth.user) {
      setCorrectionBusy(false)
      return
    }
    const corrected: CoordRow = {
      location_key: pin.locationKey,
      sample_value: pin.location,
      latitude: found.latitude,
      longitude: found.longitude,
      resolved_label: found.label,
      // 'manual' is what stops a later automatic pass from undoing this correction.
      source: 'manual',
    }
    await supabase
      .from('location_coords')
      .upsert({ ...corrected, user_id: auth.user.id }, { onConflict: 'user_id,location_key' })
    setCoords((prev) => new Map(prev).set(pin.locationKey, corrected))
    setCorrectionBusy(false)
    setCorrecting(null)
    setCorrectionText('')
    setSelected(null)
  }

  // ---- chrome -----------------------------------------------------------------------------------

  const knownLocations = useMemo(() => [...places.values()].map((p) => p.sample), [places])

  return (
    <div style={styles.wrap}>
      <p style={styles.status}>
        {phase === 'loading' && 'Loading places…'}
        {phase === 'geocoding' && `Finding place ${progress.done} of ${progress.total}…`}
        {phase === 'ready' &&
          `${pins.length} ${pins.length === 1 ? 'place' : 'places'} · ${plottedEvents} ${plottedEvents === 1 ? 'event' : 'events'} on the map`}
      </p>

      {tableMissing && (
        <p style={styles.notice}>
          The map's place list hasn't been set up yet — run{' '}
          <code>migrations_manual/2026-09-05-location-coords.sql</code> in Supabase, then reopen this.
        </p>
      )}

      {!tableMissing && phase === 'ready' && pins.length === 0 && (
        <p style={styles.notice}>
          Nothing to plot yet. Events need a location on them before they can appear here.
        </p>
      )}

      <div ref={containerRef} style={styles.map} />

      <div style={styles.footer}>
        {/* Only once the sweep has finished. Mid-geocode, `unplaced` is mostly places that simply
            haven't been looked up yet, and calling those "couldn't be found" reads as 112 failures
            when nothing has failed at all. */}
        {phase === 'ready' && unplaced > 0 && (
          <span style={styles.footerNote}>
            {unplaced} {unplaced === 1 ? 'place' : 'places'} couldn't be found on the map.
          </span>
        )}
        {eventsWithoutLocation > 0 && (
          <button type="button" onClick={() => onFilterLocation('none')} style={styles.footerLink}>
            {eventsWithoutLocation} events have no location →
          </button>
        )}
      </div>

      {selected && (
        <div style={styles.panel}>
          <div style={styles.panelHeader}>
            <strong style={styles.panelTitle}>
              {selected.items.length === 1 ? selected.items[0].location : `${selected.items.length} places here`}
            </strong>
            <button
              type="button"
              onClick={() => setSelected(null)}
              style={styles.panelClose}
              aria-label="Close this place"
            >
              ✕
            </button>
          </div>

          <div style={styles.panelScroll}>
            {selected.items.map((pin) => (
              <div key={pin.locationKey} style={styles.placeBlock}>
                {selected.items.length > 1 && <p style={styles.placeName}>{pin.location}</p>}
                {pin.resolvedLabel && pin.resolvedLabel !== pin.location && (
                  <p style={styles.resolvedLabel}>
                    Placed at {pin.resolvedLabel}
                    {pin.source === 'manual' && ' (you set this)'}
                  </p>
                )}

                {pin.moments.map((moment) => (
                  <button
                    key={moment.id}
                    type="button"
                    onClick={() => {
                      // Navigates away to the event's own page, so there is nothing to close.
                      onSelectEvent({
                        id: moment.id,
                        summary: summarize(moment.occasion, moment.raw_description),
                      })
                    }}
                    style={styles.eventRow}
                  >
                    <span style={styles.eventName}>{summarize(moment.occasion, moment.raw_description)}</span>
                    <span style={styles.eventWhen}>{formatEventWhen(moment)}</span>
                  </button>
                ))}

                {correcting === pin.locationKey ? (
                  <div style={styles.correctBox}>
                    <p style={styles.correctHint}>Where is this really?</p>
                    <AddressSuggestInput
                      value={correctionText}
                      onChange={setCorrectionText}
                      recentValues={knownLocations}
                      placeholder="Type the right address…"
                      disabled={correctionBusy}
                    />
                    <div style={styles.correctActions}>
                      <button
                        type="button"
                        onClick={() => saveCorrection(pin)}
                        disabled={correctionBusy || !correctionText.trim()}
                        style={styles.correctSave}
                      >
                        {correctionBusy ? 'Placing…' : 'Move the pin'}
                      </button>
                      <button type="button" onClick={() => setCorrecting(null)} style={styles.correctCancel}>
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div style={styles.placeActions}>
                    <button
                      type="button"
                      // onFilterLocation both sets the filter and switches back to the list.
                      onClick={() => onFilterLocation(pin.location)}
                      style={styles.placeAction}
                    >
                      Show these in the list →
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setCorrecting(pin.locationKey)
                        setCorrectionText(pin.location)
                      }}
                      style={styles.placeAction}
                    >
                      Not this place
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

const styles: { [key: string]: React.CSSProperties } = {
  // An inline panel, not an overlay: the map is one of two views of the Events page (founder ask,
  // 2026-09-05), so the page's own sticky header stays put above it and this fills what's left.
  // `relative` anchors the place panel, which is absolutely positioned inside it.
  wrap: {
    position: 'relative',
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    backgroundColor: colors.surface,
    border: border.light,
    borderRadius: radius.lg,
    overflow: 'hidden',
    fontFamily,
  },
  status: {
    flexShrink: 0,
    fontSize: fontSize.tiny,
    color: colors.textFaintest,
    margin: 0,
    padding: `${space.md} ${space.lg}`,
    borderBottom: border.light,
  },
  notice: { fontSize: fontSize.body, color: colors.ink, margin: 0, padding: `${space.md} ${space.lg}` },
  // flex:1 with minHeight:0 so the map takes the leftover height instead of overflowing the
  // viewport — Leaflet needs a real height on its container or it renders a zero-pixel map.
  map: { flex: 1, minHeight: 0, width: '100%' },
  // Right-aligned so the floating Feedback widget, which is fixed to the bottom-LEFT above
  // everything, never sits on top of this text. Left-aligned it covered "N places couldn't be
  // found" at every screen width.
  footer: {
    display: 'flex',
    gap: space.lg,
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'flex-end',
    padding: `${space.md} ${space.xl}`,
    borderTop: border.light,
  },
  footerNote: { fontSize: fontSize.tiny, color: colors.textFaintest },
  footerLink: {
    background: 'none',
    border: 'none',
    padding: 0,
    color: colors.ink,
    fontSize: fontSize.tiny,
    cursor: 'pointer',
    fontFamily,
  },
  // Bottom sheet on a phone, floating card on a desktop — one rule, because it is anchored to a
  // bottom corner and simply stops growing once there is room.
  //
  // Anchored bottom-RIGHT specifically to clear the floating Feedback widget, which is fixed to the
  // bottom-left above everything and otherwise sits directly on top of this panel's own buttons.
  // The phone case can still overlap (the panel is nearly full width there), which is what the
  // padding on panelScroll is for.
  panel: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    width: `calc(100% - 2 * ${space.md})`,
    maxWidth: maxWidth.dialog,
    maxHeight: '55%',
    display: 'flex',
    flexDirection: 'column',
    margin: space.md,
    backgroundColor: neutral.white,
    border: border.default,
    borderRadius: radius.lg,
    boxShadow: shadow.modal,
    // Above Leaflet's own panes (which top out at 800) and the zoom control.
    zIndex: 1001,
  },
  panelHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
    padding: `${space.md} ${space.lg}`,
    borderBottom: border.light,
  },
  panelTitle: { fontSize: fontSize.body, color: colors.ink },
  panelClose: {
    flexShrink: 0,
    width: '32px',
    height: '32px',
    background: 'none',
    border: 'none',
    color: colors.textFaintest,
    cursor: 'pointer',
    fontFamily,
  },
  // The generous bottom padding is not decoration: on a phone this panel is nearly full width, so
  // the Feedback widget floats over its bottom-left corner. The padding keeps the last place's
  // "Show these in the list →" / "Not this place" out from under it.
  panelScroll: { overflowY: 'auto', padding: `${space.sm} ${space.lg} 2.75rem` },
  placeBlock: { marginTop: space.md },
  placeName: { fontSize: fontSize.body, color: colors.ink, margin: `0 0 ${space.xs}`, fontWeight: 600 },
  resolvedLabel: { fontSize: fontSize.tiny, color: colors.textFaintest, margin: `0 0 ${space.sm}` },
  eventRow: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: '2px',
    width: '100%',
    textAlign: 'left',
    padding: `${space.sm} 0`,
    background: 'none',
    border: 'none',
    borderBottom: border.light,
    cursor: 'pointer',
    fontFamily,
  },
  eventName: { fontSize: fontSize.body, color: colors.ink },
  eventWhen: { fontSize: fontSize.tiny, color: colors.textFaintest },
  placeActions: { display: 'flex', gap: space.lg, flexWrap: 'wrap', marginTop: space.sm },
  placeAction: {
    background: 'none',
    border: 'none',
    padding: 0,
    color: colors.ink,
    fontSize: fontSize.tiny,
    cursor: 'pointer',
    fontFamily,
  },
  correctBox: { marginTop: space.sm },
  correctHint: { fontSize: fontSize.tiny, color: colors.textFaintest, margin: `0 0 ${space.xs}` },
  correctActions: { display: 'flex', gap: space.md, marginTop: space.sm },
  correctSave: {
    fontSize: fontSize.tiny,
    padding: '0.45rem 0.8rem',
    borderRadius: radius.md,
    border: 'none',
    backgroundColor: colors.primary,
    color: colors.onFill,
    cursor: 'pointer',
    fontFamily,
  },
  correctCancel: {
    fontSize: fontSize.tiny,
    padding: '0.45rem 0.8rem',
    borderRadius: radius.md,
    border: border.default,
    backgroundColor: 'transparent',
    color: colors.ink,
    cursor: 'pointer',
    fontFamily,
  },
}
