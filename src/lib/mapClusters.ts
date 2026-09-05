// Pin clustering for the Events map (item 117), kept pure so it can be tested without Leaflet or a
// browser — same call as locationGroups.ts and every other rule in lib/.
//
// Clustering is not decoration here, it is the only thing that makes the map readable. Almost every
// event on the founder's account happened in metro Denver, so at world zoom ~95 of the ~99 pins
// land inside a few pixels of each other: without merging them you get one unreadable smear that
// reports "1 event" wherever you happen to click.
//
// Deliberately NOT leaflet.markercluster. That would be a second runtime dependency for forty lines
// of arithmetic, and it owns its own rendering, which would fight the divIcon pins the map already
// has to draw by hand (Leaflet's default marker images don't survive bundling).

/** Web Mercator world size in pixels at a given zoom — Leaflet's 256px tile convention. */
function worldSize(zoom: number): number {
  return 256 * Math.pow(2, zoom)
}

/**
 * Latitude/longitude to pixel coordinates at a given zoom, matching Leaflet's projection so a
 * cluster radius expressed in pixels means the same thing here as it does on screen.
 *
 * Latitude is clamped to ±85.05112878, the point where Mercator's tan() runs to infinity. A pin at
 * a real pole would otherwise project to ±Infinity and poison every distance it takes part in.
 */
export function projectToPixels(latitude: number, longitude: number, zoom: number): { x: number; y: number } {
  const size = worldSize(zoom)
  const lat = Math.max(-85.05112878, Math.min(85.05112878, latitude))
  const radians = (lat * Math.PI) / 180
  const x = ((longitude + 180) / 360) * size
  const y = ((1 - Math.log(Math.tan(radians) + 1 / Math.cos(radians)) / Math.PI) / 2) * size
  return { x, y }
}

export type MapPoint<T> = { latitude: number; longitude: number; item: T }
export type MapCluster<T> = { latitude: number; longitude: number; items: T[] }

/**
 * Groups points that would overlap on screen at this zoom into single pins.
 *
 * Grid-bucketed rather than distance-based: bucketing is O(n) and, more importantly, it is stable —
 * a point's bucket depends only on where it is, not on which points were processed before it, so
 * panning the map can't reshuffle the clusters under the cursor. The cost is that two points either
 * side of a cell boundary can stay separate despite being close; at `cellPx` 60 against a ~30px pin
 * that is invisible, and it is the right trade for not having pins twitch as you drag.
 *
 * The returned centroid is the plain average of member coordinates. Averaging longitude is wrong
 * across the antimeridian (New Zealand and Fiji would average to somewhere near Africa), and that
 * is knowingly left alone: it needs points on both sides of the 180th meridian inside one cell,
 * which cannot happen below a zoom where the whole Pacific is a few pixels wide.
 *
 * Ordering is deterministic — biggest cluster first, then north-to-south, then west-to-east — so
 * React keys stay stable and the tests can assert on it.
 */
export function clusterPoints<T>(points: MapPoint<T>[], zoom: number, cellPx = 60): MapCluster<T>[] {
  const buckets = new Map<string, MapPoint<T>[]>()

  for (const point of points) {
    const { x, y } = projectToPixels(point.latitude, point.longitude, zoom)
    const key = `${Math.floor(x / cellPx)}:${Math.floor(y / cellPx)}`
    const existing = buckets.get(key)
    if (existing) existing.push(point)
    else buckets.set(key, [point])
  }

  const clusters: MapCluster<T>[] = []
  for (const members of buckets.values()) {
    const latitude = members.reduce((sum, m) => sum + m.latitude, 0) / members.length
    const longitude = members.reduce((sum, m) => sum + m.longitude, 0) / members.length
    clusters.push({ latitude, longitude, items: members.map((m) => m.item) })
  }

  return clusters.sort(
    (a, b) => b.items.length - a.items.length || b.latitude - a.latitude || a.longitude - b.longitude
  )
}
