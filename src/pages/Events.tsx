import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { fetchAllRows } from '../lib/pagedSelect'
import { summarize } from '../lib/summarize'
import { compareEventsNewestFirst, eventSortDate, eventSortEndDate, formatEventWhen, formatFullDate } from '../lib/dates'
import { createEventShell } from '../lib/moments'
import { centerInWindow } from '../lib/centerInScroller'
import { PersonChip, GroupChip } from '../components/Chips'
import SearchBox from '../components/SearchBox'
import FilterPanel from '../components/FilterPanel'
import { useGroupRoster, type GroupLabelFn } from '../lib/groupRoster'
import { border, colors, fontFamily, fontSize, maxWidth, neutral, radius, shadow, space } from '../lib/theme'

// Lazy on its own, not just as part of this page's chunk: EventsMap pulls in Leaflet, and the whole
// case for adding that dependency is that it only ever loads for someone who opens the map.
const EventsMap = lazy(() => import('../components/EventsMap'))

export type PersonRef = { id: string; name: string; last_name: string | null }

export type Moment = {
  id: string
  occasion: string | null
  location: string | null
  when_text: string | null
  event_date: string | null
  event_end_date: string | null
  raw_description: string
  created_at: string
  notes: { people: PersonRef | null }[]
  moment_groups: { groups: { id: string; name: string } | null }[]
  moment_tags: { tags: { id: string; name: string } | null }[]
}

export type ChildEventRef = {
  id: string
  occasion: string | null
  event_date: string | null
  event_end_date: string | null
  created_at: string
  parent_moment_id: string
  notes: { people: PersonRef | null }[]
}

export type DecoratedMoment = {
  moment: Moment
  attendees: Map<string, PersonRef>
  summary: string
  groups: { id: string; name: string }[]
  tags: { id: string; name: string }[]
}

// Moved to lib/eventFilters.ts so App.tsx can hold this page's filter state without eagerly
// importing the page itself (Events is lazy-loaded — see App.tsx). Re-exported from here so the
// demo pages and eventsFilter.test.ts can go on importing them from this module.
import type { DateFilterPreset, DateFilter, EventFilters } from '../lib/eventFilters'
import { DEFAULT_DATE_FILTER } from '../lib/eventFilters'
export type { DateFilterPreset, DateFilter, EventFilters } from '../lib/eventFilters'
export { DEFAULT_DATE_FILTER, DEFAULT_EVENT_FILTERS } from '../lib/eventFilters'

// How many of the (non-search) filter dimensions are currently narrowing the list — drives the
// "Filters · N" badge and whether "Clear all" is enabled.
export function countActiveFilters(filters: EventFilters): number {
  let count = 0
  if (filters.tagFilter !== 'all') count++
  if (filters.personFilter !== 'all') count++
  if (filters.groupFilter !== 'all') count++
  if (filters.subgroupFilter !== 'all') count++
  if (filters.locationFilter !== 'all') count++
  if (filters.dateFilter.preset !== 'all') count++
  return count
}

function resolveDateRange(filter: DateFilter): { start: Date | null; end: Date | null } {
  const now = new Date()
  const startOfYear = (y: number) => new Date(y, 0, 1)
  const endOfYear = (y: number) => new Date(y, 11, 31, 23, 59, 59, 999)
  switch (filter.preset) {
    case 'thisYear':
      return { start: startOfYear(now.getFullYear()), end: endOfYear(now.getFullYear()) }
    case 'lastYear':
      return { start: startOfYear(now.getFullYear() - 1), end: endOfYear(now.getFullYear() - 1) }
    case 'last30': {
      const start = new Date(now)
      start.setDate(start.getDate() - 30)
      start.setHours(0, 0, 0, 0)
      return { start, end: now }
    }
    case 'custom':
      return {
        start: filter.customStart ? new Date(`${filter.customStart}T00:00:00`) : null,
        end: filter.customEnd ? new Date(`${filter.customEnd}T23:59:59`) : null,
      }
    default:
      return { start: null, end: null }
  }
}

export function decorateMoments(
  moments: Moment[],
  // Parent id -> its sub-events, so their attendees roll up into the parent's list below.
  // Optional/defaulted for the landing-page demo, which has no sub-events.
  childrenByParentId: Map<string, ChildEventRef[]> = new Map()
): DecoratedMoment[] {
  return moments.map((moment) => {
    // Attendees can repeat across multiple notes for the same moment — dedupe by person id
    const attendees = new Map<string, PersonRef>()
    for (const n of moment.notes ?? []) {
      if (n.people) attendees.set(n.people.id, n.people)
    }
    // Anyone at a sub-event was at the parent event by definition (founder, 2026-08-07), so they
    // roll up here rather than being visible only after expanding the sub-event list. Derived at
    // render time, never written back: the note stays on the sub-event, so there's no duplicate
    // row to keep in sync and untagging them there removes them here too. Same rollup runs on the
    // event's own page — see EventDetail.tsx's Who Was There.
    for (const child of childrenByParentId.get(moment.id) ?? []) {
      for (const n of child.notes ?? []) {
        if (n.people) attendees.set(n.people.id, n.people)
      }
    }

    const summary = summarize(moment.occasion, moment.raw_description)
    const groups = (moment.moment_groups ?? [])
      .map((mg) => mg.groups)
      .filter((g): g is { id: string; name: string } => g !== null)
    const tags = (moment.moment_tags ?? [])
      .map((mt) => mt.tags)
      .filter((t): t is { id: string; name: string } => t !== null)

    return { moment, attendees, summary, groups, tags }
  })
}

export function filterMoments(
  decorated: DecoratedMoment[],
  filters: EventFilters,
  // Searches the same qualified string the chips display, so typing a parent group's name also
  // finds events tagged to its subgroups. Defaults to the bare name (landing-page demo).
  groupLabel: GroupLabelFn = (_id, fallbackName) => fallbackName
): DecoratedMoment[] {
  const { search, tagFilter, personFilter, groupFilter, subgroupFilter, locationFilter, dateFilter } = filters
  const query = search.trim().toLowerCase()
  const { start, end } = resolveDateRange(dateFilter)
  return decorated.filter(({ moment, attendees, summary, groups, tags }) => {
    if (tagFilter === 'untagged' && tags.length > 0) return false
    if (tagFilter !== 'all' && tagFilter !== 'untagged' && !tags.some((t) => t.name === tagFilter)) return false

    if (personFilter !== 'all' && !attendees.has(personFilter)) return false

    // "No group yet" is the manual counterpart to Home's event-tagging suggestion card, which only
    // offers events where EVERY attendee shares a group. Everything it can't reach — one-attendee
    // events, mixed crowds, the old moments that predate group tagging existing at all — is only
    // findable by listing the untagged ones, which is what this does.
    if (groupFilter === 'none' && groups.length > 0) return false
    if (groupFilter !== 'all' && groupFilter !== 'none' && !groups.some((g) => g.id === groupFilter)) return false

    if (subgroupFilter !== 'all' && !groups.some((g) => g.id === subgroupFilter)) return false

    if (locationFilter === 'none' && moment.location) return false
    if (locationFilter !== 'all' && locationFilter !== 'none' && moment.location !== locationFilter) return false

    if (start || end) {
      const eventDate = eventSortDate(moment)
      if (start && eventDate < start) return false
      if (end && eventDate > end) return false
    }

    if (!query) return true
    const attendeeNames = Array.from(attendees.values()).map((p) => `${p.name} ${p.last_name ?? ''}`)
    const groupNames = groups.map((g) => groupLabel(g.id, g.name))
    const tagNames = tags.map((t) => t.name)
    const haystack = [moment.occasion, moment.location, summary, ...attendeeNames, ...groupNames, ...tagNames]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
    return haystack.includes(query)
  })
}

// Only merges CONSECUTIVE same-year entries, so the year it buckets on has to be the same year
// the list was sorted by — hence eventSortEndDate, matching compareEventsNewestFirst. Bucketing
// on the START year instead would split a single year into two non-adjacent groups (duplicate
// React keys, headings running 2026 / 2027 / 2026) the moment one event spans a year boundary:
// a trip running December 28 – January 3 sorts above a January 1 event but starts a year earlier.
// Such a trip therefore files under the year it finished; its card still shows the full range.
export function groupMomentsByYear(filteredMoments: DecoratedMoment[]): { year: number; items: DecoratedMoment[] }[] {
  const yearGroups: { year: number; items: DecoratedMoment[] }[] = []
  for (const entry of filteredMoments) {
    const year = eventSortEndDate(entry.moment).getFullYear()
    const lastGroup = yearGroups[yearGroups.length - 1]
    if (lastGroup && lastGroup.year === year) {
      lastGroup.items.push(entry)
    } else {
      yearGroups.push({ year, items: [entry] })
    }
  }
  return yearGroups
}

// Which card the Today line goes above. The list runs newest-first, so every event that hasn't
// finished yet sits at the top and the past follows — one clean split, no interleaving. Returns the
// id of the first PAST event, or null when everything on screen is still upcoming (the caller then
// parks the line at the very bottom).
//
// Deliberately measured with eventSortEndDate, the same function the sort and the year bucketing
// use. Anything else and the line drifts away from the order it is supposed to be marking.
export function firstPastMomentId(filteredMoments: DecoratedMoment[], now = new Date()): string | null {
  const todayStart = new Date(now)
  todayStart.setHours(0, 0, 0, 0)
  // An event that ends today still counts as today, not past — matches the Calendar timeline's split.
  const found = filteredMoments.find((entry) => eventSortEndDate(entry.moment) < todayStart)
  return found ? found.moment.id : null
}

export default function Events({
  filters,
  onFiltersChange,
  onSelectPerson,
  onSelectGroup,
  onSelectEvent,
  onManageTags,
  onManageLocations,
  onImportEvents,
}: {
  // Lifted up into App.tsx (alongside groupsSearch/groupsTypeFilter) so filters survive
  // navigating into an event and back, instead of resetting the way page-local state would.
  filters: EventFilters
  onFiltersChange: (filters: EventFilters) => void
  onSelectPerson: (person: { id: string; name: string }) => void
  onSelectGroup: (group: { id: string; name: string }) => void
  onSelectEvent: (event: { id: string; summary: string }) => void
  onManageTags: () => void
  onManageLocations: () => void
  onImportEvents: () => void
}) {
  const [moments, setMoments] = useState<Moment[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [childrenByParentId, setChildrenByParentId] = useState<Map<string, ChildEventRef[]>>(new Map())
  const groupRoster = useGroupRoster()

  useEffect(() => {
    loadMoments()
    loadChildEvents()
  }, [])

  // Isolated from loadMoments' shared select on purpose — that query has no error handling
  // today, so bolting an unmigrated column onto it would turn a missing-migration case into a
  // full outage instead of a degraded one. Fails open to "no sub-events" (same reasoning as
  // GroupDetail.tsx's loadSubgroups) so a not-yet-run migration doesn't break this list.
  async function loadChildEvents() {
    const { data, error } = await fetchAllRows((from, to) =>
      supabase
        .from('moments')
        .select('id, occasion, event_date, event_end_date, created_at, parent_moment_id, notes(people(id, name, last_name))')
        .not('parent_moment_id', 'is', null)
        .order('event_date', { ascending: true, nullsFirst: false })
        .order('id')
        .range(from, to)
    )
    if (error || !data) {
      setChildrenByParentId(new Map())
      return
    }
    const map = new Map<string, ChildEventRef[]>()
    for (const row of data as unknown as ChildEventRef[]) {
      const list = map.get(row.parent_moment_id) ?? []
      list.push(row)
      map.set(row.parent_moment_id, list)
    }
    setChildrenByParentId(map)
  }

  async function loadMoments() {
    setLoading(true)
    const { data } = await fetchAllRows((from, to) =>
      supabase
        .from('moments')
        .select(
          'id, occasion, location, when_text, event_date, event_end_date, raw_description, created_at, notes(people(id, name, last_name)), moment_groups(groups(id, name)), moment_tags(tags(id, name))'
        )
        .order('id')
        .range(from, to)
    )

    const sorted = ((data as unknown as Moment[]) ?? []).sort(compareEventsNewestFirst)
    setMoments(sorted)
    setLoading(false)
  }

  // No form up front — a blank shell, then straight onto the new event's own page. The insert
  // itself (and the self-attendee note that goes with it) lives in lib/moments.ts, shared with the
  // Calendar page's "a countdown and a real event" option.
  async function handleAddEvent() {
    setCreating(true)
    setCreateError(null)
    const created = await createEventShell()
    setCreating(false)
    if (!created) {
      setCreateError("Couldn't start a new event — please try again.")
      return
    }
    onSelectEvent({ id: created.id, summary: 'Untitled moment' })
  }

  // Growing picklist, not a hardcoded list like GROUP_TYPES — the founder wants categories
  // derived from tags actually applied, so this is just the distinct set in use. Memoized so it
  // doesn't recompute on every keystroke of the search box below (only when moments changes).
  const distinctTags = useMemo(() => {
    const names = new Set<string>()
    for (const m of moments) {
      for (const mt of m.moment_tags ?? []) {
        if (mt.tags) names.add(mt.tags.name)
      }
    }
    return [...names].sort()
  }, [moments])

  if (loading) return <p style={{ textAlign: 'center', marginTop: '3rem' }}>Loading…</p>

  return (
    <EventsView
      moments={moments}
      distinctTags={distinctTags}
      filters={filters}
      onFiltersChange={onFiltersChange}
      onAddEvent={handleAddEvent}
      creating={creating}
      createError={createError}
      onManageTags={onManageTags}
      onManageLocations={onManageLocations}
      onImportEvents={onImportEvents}
      renderMap={({ moments: visible, showList }) => (
        // No fallback UI: the chunk is small, and a spinner flashing in the panel reads worse than
        // the map arriving a frame late.
        <Suspense fallback={null}>
          <EventsMap
            moments={visible}
            onSelectEvent={onSelectEvent}
            // Clicking through from a pin narrows the list to that place and shows it, using the
            // filter the page already has rather than a second filtering path.
            onFilterLocation={(location) => {
              onFiltersChange({ ...filters, locationFilter: location })
              showList()
            }}
          />
        </Suspense>
      )}
      onSelectPerson={onSelectPerson}
      onSelectGroup={onSelectGroup}
      onSelectEvent={onSelectEvent}
      childrenByParentId={childrenByParentId}
      groupLabel={groupRoster.label}
      groupParentById={groupRoster.parentById}
    />
  )
}

// Empty, module-level so it's a stable reference across renders — used as the default for
// groupParentById below. A fresh `new Map()` in the destructuring default would be a new object
// every render, defeating useFilterOptions' memoization every time EventsView re-renders (e.g. on
// every keystroke in search).
const EMPTY_GROUP_PARENT_MAP = new Map<string, string | null>()

// Distinct-in-use option lists for the attendee/group/location filters — same "growing picklist,
// not a hardcoded enum" reasoning as distinctTags above. Computed here (off the `moments` prop
// EventsView already receives) rather than in each container, so the landing-page demo gets
// working filters for free instead of needing its own copy of this derivation.
//
// Groups actually in use are split into top-level groups vs subgroups via groupParentById (from
// useGroupRoster's full roster, not derivable from moment_groups alone since that join only has
// {id, name}). Defaults to "everything is top-level" when no roster is available (landing-page
// demo, which has no subgroups) — the Subgroup dropdown then naturally stays hidden since its
// option list is empty, same as any other empty-options filter here.
function useFilterOptions(moments: Moment[], groupParentById: Map<string, string | null> = EMPTY_GROUP_PARENT_MAP) {
  return useMemo(() => {
    const attendeeMap = new Map<string, PersonRef>()
    const groupMap = new Map<string, { id: string; name: string }>()
    const subgroupMap = new Map<string, { id: string; name: string }>()
    const locationSet = new Set<string>()
    for (const m of moments) {
      for (const n of m.notes ?? []) {
        if (n.people) attendeeMap.set(n.people.id, n.people)
      }
      for (const mg of m.moment_groups ?? []) {
        if (mg.groups) {
          if (groupParentById.get(mg.groups.id)) subgroupMap.set(mg.groups.id, mg.groups)
          else groupMap.set(mg.groups.id, mg.groups)
        }
      }
      if (m.location && m.location.trim()) locationSet.add(m.location.trim())
    }
    const sortByName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name)
    return {
      attendees: [...attendeeMap.values()].sort(sortByName),
      groups: [...groupMap.values()].sort(sortByName),
      subgroups: [...subgroupMap.values()].sort(sortByName),
      locations: [...locationSet].sort(),
    }
  }, [moments, groupParentById])
}

// Pure render — split out (2026-07-22) so the landing-page demo can render the exact same list UI
// fed by static data, with no Supabase calls. `readOnly` hides "+ Add Event" (a real insert) and
// "Manage tags →" (a separate real page not part of the demo).
export function EventsView({
  moments,
  distinctTags,
  filters,
  onFiltersChange,
  onAddEvent,
  creating,
  createError,
  onManageTags,
  onManageLocations,
  onImportEvents,
  renderMap,
  onSelectPerson,
  onSelectGroup,
  onSelectEvent,
  childrenByParentId = new Map(),
  groupLabel = (_id, fallbackName) => fallbackName,
  groupParentById = EMPTY_GROUP_PARENT_MAP,
  readOnly = false,
}: {
  moments: Moment[]
  distinctTags: string[]
  filters: EventFilters
  onFiltersChange: (filters: EventFilters) => void
  onAddEvent: () => void
  creating: boolean
  createError: string | null
  onManageTags: () => void
  // Optional so the read-only landing-page demo (DemoEvents.tsx) doesn't have to pass a no-op for
  // a link it never renders.
  onManageLocations?: () => void
  onImportEvents?: () => void
  /**
   * Supplies the Map view's contents. A render prop rather than a plain node so this component
   * stays a pure render while the map still gets the FILTERED events — the filtering happens in
   * here, the Supabase reads happen in the container, and neither has to know about the other.
   * Absent (like the other optional props) for the read-only landing-page demo, which is also what
   * hides the List/Map toggle there.
   */
  renderMap?: (args: { moments: Moment[]; showList: () => void }) => React.ReactNode
  onSelectPerson: (person: { id: string; name: string }) => void
  onSelectGroup: (group: { id: string; name: string }) => void
  onSelectEvent: (event: { id: string; summary: string }) => void
  childrenByParentId?: Map<string, ChildEventRef[]>
  // Qualifies a subgroup as "Parent / Child". Defaults to the bare name for the landing-page demo.
  groupLabel?: GroupLabelFn
  // group id -> parent_group_id (null for a top-level group). Defaults to empty (landing-page
  // demo has no subgroups), which naturally hides the Subgroup filter — see useFilterOptions.
  groupParentById?: Map<string, string | null>
  readOnly?: boolean
}) {
  const [expandedParents, setExpandedParents] = useState<Set<string>>(new Set())
  const [filterPanelOpen, setFilterPanelOpen] = useState(false)
  const [viewMode, setViewMode] = useState<'list' | 'map'>('list')

  // The sticky bar's height, measured rather than guessed, because it changes: filter chips appear
  // and disappear, and the whole thing wraps to more rows on a phone. Two things need the number —
  // the year headings, which stick BELOW the bar rather than under it, and the map, which fills
  // whatever viewport is left beneath it.
  const headerRef = useRef<HTMLDivElement>(null)
  const [headerHeight, setHeaderHeight] = useState(0)
  useEffect(() => {
    const el = headerRef.current
    if (!el) return
    const measure = () => setHeaderHeight(el.getBoundingClientRect().height)
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // How far down the document the map starts — header height is NOT enough on its own, because the
  // nav bar and the page's own top padding sit above it. Kept as a document offset (rect + scrollY)
  // rather than a viewport position so it doesn't change as you scroll.
  const mapSlotRef = useRef<HTMLDivElement>(null)
  const [mapSlotTop, setMapSlotTop] = useState(0)
  useEffect(() => {
    if (viewMode !== 'map') return
    // Switching views changes the page's height under the browser, so start from a known scroll
    // position and measure from there.
    window.scrollTo(0, 0)
    const measure = () => {
      const el = mapSlotRef.current
      if (el) setMapSlotTop(el.getBoundingClientRect().top + window.scrollY)
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [viewMode, headerHeight])
  const filterOptions = useFilterOptions(moments, groupParentById)

  // Sub-events are visually bundled under their parent (see the card rendering below) rather
  // than shown as their own independent chronological entries, so they're excluded here before
  // decorating/filtering/grouping — otherwise a vacation's days would show up twice: once nested
  // under the trip, once again as flat standalone cards.
  const childIds = new Set(Array.from(childrenByParentId.values()).flat().map((c) => c.id))
  const rootMoments = moments.filter((m) => !childIds.has(m.id))
  const decorated = decorateMoments(rootMoments, childrenByParentId)
  const filteredMoments = filterMoments(decorated, filters, groupLabel)
  const yearGroups = groupMomentsByYear(filteredMoments)

  // The Today line, and the jump back to it. Imported calendar events are real events with real
  // future dates, so on a newest-first list they stack up above everything that has actually
  // happened — opening at the top of the page meant opening on a pile of things nobody has done
  // yet. So the page opens on the boundary instead, with the most recent real event just below it.
  const todayMarkerRef = useRef<HTMLDivElement>(null)
  const todayLabel = useMemo(
    () => new Date().toLocaleDateString(undefined, { month: 'long', day: 'numeric' }),
    [],
  )
  const boundaryId = firstPastMomentId(filteredMoments)
  const hasEvents = filteredMoments.length > 0

  function scrollToToday(smooth = true) {
    centerInWindow(todayMarkerRef.current, smooth)
  }

  // Once per mount, and never in the landing-page demo — that one is embedded partway down a
  // marketing page, and scrolling the window on load would yank the reader out of the pitch.
  const didInitialScroll = useRef(false)
  useEffect(() => {
    if (readOnly || didInitialScroll.current || !todayMarkerRef.current) return
    didInitialScroll.current = true
    scrollToToday(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasEvents, readOnly])
  const query = filters.search.trim().toLowerCase()
  const activeCount = countActiveFilters(filters)

  function toggleExpanded(momentId: string) {
    setExpandedParents((prev) => {
      const next = new Set(prev)
      if (next.has(momentId)) next.delete(momentId)
      else next.add(momentId)
      return next
    })
  }

  function patchFilters(patch: Partial<EventFilters>) {
    onFiltersChange({ ...filters, ...patch })
  }

  const dateFilterLabel: Record<DateFilterPreset, string> = {
    all: 'All time',
    thisYear: 'This year',
    lastYear: 'Last year',
    last30: 'Last 30 days',
    custom: 'Custom range',
  }

  // One summary chip per active dimension, each removable on its own — lets the founder see the
  // current filter state at a glance without opening the panel.
  const activeFilterChips: { key: string; label: string; onRemove: () => void }[] = []
  if (filters.tagFilter !== 'all') {
    activeFilterChips.push({
      key: 'tag',
      label: filters.tagFilter === 'untagged' ? 'No tags' : `Tag: ${filters.tagFilter}`,
      onRemove: () => patchFilters({ tagFilter: 'all' }),
    })
  }
  if (filters.personFilter !== 'all') {
    const person = filterOptions.attendees.find((p) => p.id === filters.personFilter)
    activeFilterChips.push({
      key: 'person',
      label: person ? `With: ${person.name}` : 'With: (removed)',
      onRemove: () => patchFilters({ personFilter: 'all' }),
    })
  }
  if (filters.groupFilter !== 'all') {
    const group = filterOptions.groups.find((g) => g.id === filters.groupFilter)
    const label =
      filters.groupFilter === 'none'
        ? 'Group: none yet'
        : group
          ? `Group: ${groupLabel(group.id, group.name)}`
          : 'Group: (removed)'
    activeFilterChips.push({
      key: 'group',
      label,
      onRemove: () => patchFilters({ groupFilter: 'all' }),
    })
  }
  if (filters.subgroupFilter !== 'all') {
    const subgroup = filterOptions.subgroups.find((g) => g.id === filters.subgroupFilter)
    activeFilterChips.push({
      key: 'subgroup',
      label: subgroup ? `Subgroup: ${groupLabel(subgroup.id, subgroup.name)}` : 'Subgroup: (removed)',
      onRemove: () => patchFilters({ subgroupFilter: 'all' }),
    })
  }
  if (filters.locationFilter !== 'all') {
    activeFilterChips.push({
      key: 'location',
      label: filters.locationFilter === 'none' ? 'No location' : `Location: ${filters.locationFilter}`,
      onRemove: () => patchFilters({ locationFilter: 'all' }),
    })
  }
  if (filters.dateFilter.preset !== 'all') {
    activeFilterChips.push({
      key: 'date',
      label: dateFilterLabel[filters.dateFilter.preset],
      onRemove: () => patchFilters({ dateFilter: DEFAULT_DATE_FILTER }),
    })
  }

  return (
    <div style={styles.page}>
      {/* Everything down to the filter chips travels with the scroll (founder ask, 2026-09-05):
          on a list this long, scrolling back to the top to reach search, Filters or the view
          toggle was most of the navigating. The negative margins bleed the background out over
          the page's own horizontal padding, so cards pass UNDER this bar rather than beside it. */}
      <div ref={headerRef} style={styles.stickyHeader}>
      <div style={styles.headingRow}>
        <h1 style={styles.heading}>Events</h1>
        {!readOnly && (
          <div style={styles.headingActions}>
            {/* Not its own import flow — calendar events already come in through the calendar
                sources / review-queue pipeline, so this is just a shortcut to where you add one. */}
            <button type="button" onClick={onImportEvents} style={styles.importButton}>
              Import Events
            </button>
            {hasEvents && (
              <button type="button" onClick={() => scrollToToday()} style={styles.todayButton}>
                Today
              </button>
            )}
            <button type="button" onClick={onAddEvent} style={styles.addButton} disabled={creating}>
              {creating ? '…' : '+ Add Event'}
            </button>
          </div>
        )}
      </div>
      {!readOnly && (
        <div style={styles.manageLinkRow}>
          <button type="button" onClick={onManageTags} style={styles.manageTagsLink}>
            Manage tags →
          </button>
          <button type="button" onClick={onManageLocations} style={styles.manageTagsLink}>
            Manage locations →
          </button>
        </div>
      )}
      {createError && <p style={styles.addErrorText}>{createError}</p>}

      {moments.length === 0 && (
        <p style={styles.empty}>
          No moments recorded yet — add one above, or head to Home and tell me about something that happened.
        </p>
      )}

      {moments.length > 0 && (
        <div style={styles.searchRow}>
          <SearchBox value={filters.search} onChange={(value) => patchFilters({ search: value })} placeholder="Search events…" />
          <button type="button" onClick={() => setFilterPanelOpen(true)} style={styles.filtersButton}>
            Filters{activeCount > 0 ? ` · ${activeCount}` : ''}
          </button>
          {/* Two views of the same filtered set, not two places to be — so the toggle sits with
              search and Filters rather than with the Manage links, and the map inherits whatever
              is filtered here. Absent for the read-only demo, which has no map. */}
          {renderMap && (
            <div style={styles.viewToggle} role="group" aria-label="View events as">
              {(['list', 'map'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setViewMode(mode)}
                  aria-pressed={viewMode === mode}
                  style={viewMode === mode ? styles.viewToggleOn : styles.viewToggleOff}
                >
                  {mode === 'list' ? 'List' : 'Map'}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {activeFilterChips.length > 0 && (
        <div style={styles.activeFilterRow}>
          {activeFilterChips.map((chip) => (
            <button key={chip.key} type="button" onClick={chip.onRemove} style={styles.filterChip}>
              {chip.label} <span style={styles.filterChipRemove}>×</span>
            </button>
          ))}
        </div>
      )}
      </div>

      <FilterPanel
        open={filterPanelOpen}
        onClose={() => setFilterPanelOpen(false)}
        title="Filter events"
        activeCount={activeCount}
        onClearAll={() =>
          patchFilters({
            tagFilter: 'all',
            personFilter: 'all',
            groupFilter: 'all',
            subgroupFilter: 'all',
            locationFilter: 'all',
            dateFilter: DEFAULT_DATE_FILTER,
          })
        }
      >
        {distinctTags.length > 0 && (
          <div>
            <label style={styles.filterLabel}>Tag</label>
            <select
              value={filters.tagFilter}
              onChange={(e) => patchFilters({ tagFilter: e.target.value })}
              style={styles.filterSelect}
              aria-label="Filter by tag"
            >
              <option value="all">All tags</option>
              <option value="untagged">No tags yet</option>
              {distinctTags.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
        )}

        <div>
          <label style={styles.filterLabel}>Date</label>
          <div style={styles.dateChipRow}>
            {(['all', 'thisYear', 'lastYear', 'last30', 'custom'] as DateFilterPreset[]).map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => patchFilters({ dateFilter: { ...filters.dateFilter, preset } })}
                style={filters.dateFilter.preset === preset ? styles.dateChipActive : styles.dateChip}
              >
                {dateFilterLabel[preset]}
              </button>
            ))}
          </div>
          {filters.dateFilter.preset === 'custom' && (
            <div style={styles.customDateRow}>
              <input
                type="date"
                value={filters.dateFilter.customStart ?? ''}
                onChange={(e) => patchFilters({ dateFilter: { ...filters.dateFilter, customStart: e.target.value || null } })}
                style={styles.filterSelect}
                aria-label="Start date"
              />
              <span style={styles.filterLabel}>to</span>
              <input
                type="date"
                value={filters.dateFilter.customEnd ?? ''}
                onChange={(e) => patchFilters({ dateFilter: { ...filters.dateFilter, customEnd: e.target.value || null } })}
                style={styles.filterSelect}
                aria-label="End date"
              />
            </div>
          )}
        </div>

        {filterOptions.attendees.length > 0 && (
          <div>
            <label style={styles.filterLabel}>Attendee</label>
            <select
              value={filters.personFilter}
              onChange={(e) => patchFilters({ personFilter: e.target.value })}
              style={styles.filterSelect}
              aria-label="Filter by attendee"
            >
              <option value="all">Everyone</option>
              {filterOptions.attendees.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.last_name ? ` ${p.last_name}` : ''}
                </option>
              ))}
            </select>
          </div>
        )}

        {filterOptions.groups.length > 0 && (
          <div>
            <label style={styles.filterLabel}>Group</label>
            <select
              value={filters.groupFilter}
              onChange={(e) => patchFilters({ groupFilter: e.target.value })}
              style={styles.filterSelect}
              aria-label="Filter by group"
            >
              <option value="all">All groups</option>
              <option value="none">No group yet</option>
              {filterOptions.groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {groupLabel(g.id, g.name)}
                </option>
              ))}
            </select>
          </div>
        )}

        {filterOptions.subgroups.length > 0 && (
          <div>
            <label style={styles.filterLabel}>Subgroup</label>
            <select
              value={filters.subgroupFilter}
              onChange={(e) => patchFilters({ subgroupFilter: e.target.value })}
              style={styles.filterSelect}
              aria-label="Filter by subgroup"
            >
              <option value="all">All subgroups</option>
              {filterOptions.subgroups.map((g) => (
                <option key={g.id} value={g.id}>
                  {groupLabel(g.id, g.name)}
                </option>
              ))}
            </select>
          </div>
        )}

        {filterOptions.locations.length > 0 && (
          <div>
            <label style={styles.filterLabel}>Location</label>
            <select
              value={filters.locationFilter}
              onChange={(e) => patchFilters({ locationFilter: e.target.value })}
              style={styles.filterSelect}
              aria-label="Filter by location"
            >
              <option value="all">All locations</option>
              <option value="none">No location set</option>
              {filterOptions.locations.map((loc) => (
                <option key={loc} value={loc}>
                  {loc}
                </option>
              ))}
            </select>
          </div>
        )}
      </FilterPanel>

      {viewMode === 'map' && renderMap ? (
        // Sized from this slot's OWN distance down the page, not from the header's height: the nav
        // bar and the page's top padding sit above the header too, and sizing off the header alone
        // ran the map ~70px past the bottom of the window. Measured this way the map ends exactly
        // at the bottom edge, so the page doesn't scroll at all in this view.
        <div
          ref={mapSlotRef}
          style={{ ...styles.mapSlot, height: `calc(100vh - ${mapSlotTop}px - 1rem)` }}
        >
          {renderMap({
            moments: filteredMoments.map((entry) => entry.moment),
            showList: () => setViewMode('list'),
          })}
        </div>
      ) : (
        <>
      {moments.length > 0 && filteredMoments.length === 0 && (
        <p style={styles.empty}>
          {query
            ? `No events match "${filters.search}".`
            : activeCount > 0
              ? 'No events match these filters.'
              : 'No events yet.'}
        </p>
      )}

      <div style={styles.list}>
        {yearGroups.map(({ year, items }) => (
          <div key={year}>
            {/* Parks just under the sticky bar rather than at the top of the window, which is
                where it used to land — behind it. */}
            <h2 style={{ ...styles.yearHeading, top: headerHeight }}>{year}</h2>
            <div style={styles.yearCards}>
              {items.map(({ moment, attendees, summary, groups }) => {
                const children = childrenByParentId.get(moment.id) ?? []
                const expanded = expandedParents.has(moment.id)
                return (
                  <div key={moment.id}>
                    {moment.id === boundaryId && (
                      <div ref={todayMarkerRef} style={styles.todayDivider}>
                        <span style={styles.todayDividerLine} />
                        <span>Today · {todayLabel}</span>
                        <span style={styles.todayDividerLine} />
                      </div>
                    )}
                    <div style={styles.card}>
                      <div style={styles.cardHeaderRow}>
                        <div style={styles.cardHeaderMain}>
                          <button onClick={() => onSelectEvent({ id: moment.id, summary })} style={styles.titleButton}>
                            {moment.occasion || 'Untitled moment'}
                          </button>
                          <p style={styles.meta}>
                            {[formatEventWhen(moment), moment.location].filter(Boolean).join(' · ') || 'No date or location yet'}
                          </p>
                        </div>
                        {children.length > 0 && (
                          <button type="button" onClick={() => toggleExpanded(moment.id)} style={styles.subEventToggle}>
                            {children.length} sub-event{children.length === 1 ? '' : 's'} {expanded ? '▾' : '▸'}
                          </button>
                        )}
                      </div>

                      {attendees.size === 0 ? (
                        <p style={styles.empty}>No one tagged yet.</p>
                      ) : (
                        <div style={styles.chipRow}>
                          {Array.from(attendees.values()).map((p) => (
                            <PersonChip
                              key={p.id}
                              label={`${p.name}${p.last_name ? ` ${p.last_name}` : ''}`}
                              onClick={() => onSelectPerson(p)}
                            />
                          ))}
                        </div>
                      )}

                      {groups.length > 0 && (
                        <div style={styles.chipRow}>
                          {groups.map((g) => (
                            <GroupChip key={g.id} label={groupLabel(g.id, g.name)} onClick={() => onSelectGroup(g)} />
                          ))}
                        </div>
                      )}
                    </div>

                    {children.length > 0 && expanded && (
                      <div style={styles.childEventList}>
                        {children.map((ce) => {
                          const attendeeCount = new Set((ce.notes ?? []).filter((n) => n.people).map((n) => n.people!.id)).size
                          return (
                            <button
                              key={ce.id}
                              type="button"
                              onClick={() => onSelectEvent({ id: ce.id, summary: ce.occasion || 'Untitled moment' })}
                              style={styles.childEventCard}
                            >
                              <span style={styles.childEventName}>{ce.occasion || 'Untitled moment'}</span>
                              <span style={styles.childEventMeta}>
                                {formatFullDate(ce)}
                                {attendeeCount > 0 ? ` · ${attendeeCount} ${attendeeCount === 1 ? 'person' : 'people'}` : ''}
                              </span>
                            </button>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        ))}
        {hasEvents && boundaryId === null && (
          <div ref={todayMarkerRef} style={styles.todayDivider}>
            <span style={styles.todayDividerLine} />
            <span>Today · {todayLabel}</span>
            <span style={styles.todayDividerLine} />
          </div>
        )}
      </div>
        </>
      )}
    </div>
  )
}

const styles: { [key: string]: React.CSSProperties } = {
  page: { maxWidth: maxWidth.page, margin: '0 auto', padding: '2rem 1.5rem', fontFamily },
  // zIndex 2 clears the year headings (1), which have to pass beneath this rather than over it.
  // The negative margin + matching padding widen the opaque background to cover `page`'s own
  // 1.5rem padding, so cards scrolling past don't show along the edges of the bar.
  stickyHeader: {
    position: 'sticky',
    top: 0,
    zIndex: 2,
    backgroundColor: colors.appBg,
    margin: '0 -1.5rem',
    padding: '0.75rem 1.5rem 0',
  },
  // Segmented control: one border around the pair, so it reads as two states of one thing rather
  // than two separate buttons. Height matches the Filters button beside it.
  viewToggle: {
    flexShrink: 0,
    display: 'flex',
    border: border.default,
    borderRadius: radius.md,
    overflow: 'hidden',
    backgroundColor: neutral.white,
  },
  viewToggleOn: {
    fontSize: fontSize.base,
    padding: '0.65rem 0.9rem',
    border: 'none',
    backgroundColor: colors.primary,
    color: colors.onFill,
    cursor: 'pointer',
    fontFamily,
  },
  viewToggleOff: {
    fontSize: fontSize.base,
    padding: '0.65rem 0.9rem',
    border: 'none',
    backgroundColor: 'transparent',
    color: colors.ink,
    cursor: 'pointer',
    fontFamily,
  },
  // minHeight keeps the map usable when the sticky bar has wrapped to several rows on a phone and
  // the calc() would otherwise leave it a sliver.
  mapSlot: { minHeight: '320px' },
  headingRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: space.xl, marginBottom: space.xl, flexWrap: 'wrap' },
  heading: { fontSize: fontSize.h1, color: colors.ink, margin: 0 },
  // Wraps so the two buttons stack instead of squeezing the heading on a phone (§10).
  headingActions: { display: 'flex', alignItems: 'center', gap: space.md, flexWrap: 'wrap' },
  addButton: {
    fontSize: fontSize.base,
    padding: '0.6rem 1.1rem',
    borderRadius: radius.md,
    border: 'none',
    backgroundColor: colors.primary,
    color: colors.onFill,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    fontFamily,
  },
  // Outlined, not filled — importing is the secondary path next to "+ Add Event".
  importButton: {
    fontSize: fontSize.base,
    padding: '0.6rem 1.1rem',
    borderRadius: radius.md,
    border: border.default,
    backgroundColor: 'transparent',
    color: colors.ink,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    fontFamily,
  },
  addErrorText: { color: colors.danger, fontSize: fontSize.body, marginBottom: space.xl },
  // Wraps rather than pushing the page sideways on a phone — the nav-overflow lesson (§10).
  manageLinkRow: { display: 'flex', gap: space.xl, flexWrap: 'wrap' },
  manageTagsLink: {
    display: 'inline-block',
    background: 'none',
    border: 'none',
    color: colors.ink,
    fontSize: fontSize.body,
    cursor: 'pointer',
    padding: 0,
    marginBottom: space.xl,
    fontFamily,
  },
  searchRow: { display: 'flex', gap: space.lg, alignItems: 'flex-start', marginBottom: space.xl },
  filtersButton: {
    flexShrink: 0,
    fontSize: fontSize.base,
    padding: '0.65rem 0.9rem',
    borderRadius: radius.md,
    border: border.default,
    fontFamily,
    backgroundColor: colors.surface,
    color: colors.inkPlain,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  },
  filterSelect: {
    width: '100%',
    boxSizing: 'border-box',
    fontSize: fontSize.base,
    padding: '0.65rem 0.75rem',
    borderRadius: radius.md,
    border: border.default,
    fontFamily,
    backgroundColor: colors.surface,
    color: colors.inkPlain,
  },
  filterLabel: {
    display: 'block',
    fontSize: fontSize.label,
    color: colors.textMuted,
    marginBottom: space.xs,
  },
  activeFilterRow: { display: 'flex', gap: space.md, flexWrap: 'wrap', marginBottom: space.xxxl },
  filterChip: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: space.xs,
    fontSize: fontSize.label,
    padding: '0.35rem 0.7rem',
    borderRadius: radius.pill,
    border: border.primary,
    backgroundColor: colors.inkWash,
    color: colors.ink,
    cursor: 'pointer',
    fontFamily,
  },
  filterChipRemove: { fontWeight: 'bold' },
  dateChipRow: { display: 'flex', gap: space.sm, flexWrap: 'wrap' },
  dateChip: {
    fontSize: fontSize.label,
    padding: '0.4rem 0.75rem',
    borderRadius: radius.pill,
    border: border.default,
    backgroundColor: colors.surface,
    color: colors.inkPlain,
    cursor: 'pointer',
    fontFamily,
  },
  dateChipActive: {
    fontSize: fontSize.label,
    padding: '0.4rem 0.75rem',
    borderRadius: radius.pill,
    border: border.primary,
    backgroundColor: colors.primary,
    color: colors.onFill,
    cursor: 'pointer',
    fontFamily,
  },
  customDateRow: { display: 'flex', alignItems: 'center', gap: space.sm, marginTop: space.md },
  empty: { color: colors.textSubtle },
  list: { display: 'flex', flexDirection: 'column', gap: space.xl },
  yearHeading: {
    position: 'sticky',
    top: 0,
    zIndex: 1,
    fontSize: fontSize.h3,
    color: colors.ink,
    margin: 0,
    padding: '0.6rem 0 0.4rem 0',
    backgroundColor: colors.appBg,
    borderBottom: `1px solid ${neutral.grey200}`,
  },
  // The Today line. A real rule across the page, unlike the Calendar timeline's bare label — this
  // list is long and the boundary has to survive being scrolled past at speed.
  todayDivider: {
    display: 'flex',
    alignItems: 'center',
    gap: space.md,
    margin: '0.2rem 0',
    fontSize: '0.68rem',
    fontWeight: 700,
    letterSpacing: '0.05em',
    textTransform: 'uppercase',
    color: colors.primary,
    // The year heading is sticky at the top of the window, so a line parked flush with the top of
    // the viewport would sit underneath it. Only matters if this is ever top-aligned rather than
    // centred, but it costs nothing to be right.
    scrollMarginTop: '3rem',
  },
  todayDividerLine: { flex: 1, height: '1px', backgroundColor: colors.primary, opacity: 0.35 },
  todayButton: {
    fontSize: fontSize.small,
    padding: '0.3rem 0.7rem',
    borderRadius: radius.sm,
    border: border.inkPale,
    backgroundColor: colors.surface,
    color: colors.ink,
    cursor: 'pointer',
    fontFamily,
  },
  yearCards: { display: 'flex', flexDirection: 'column', gap: space.xl, marginTop: space.lg },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: '1.25rem',
    boxShadow: shadow.card,
  },
  cardHeaderRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: space.lg },
  cardHeaderMain: { flex: 1, minWidth: 0 },
  titleButton: {
    display: 'block',
    margin: '0 0 0.25rem 0',
    padding: 0,
    fontSize: fontSize.h3,
    fontFamily,
    color: colors.inkPlain,
    background: 'none',
    border: 'none',
    textAlign: 'left',
    cursor: 'pointer',
  },
  meta: { margin: '0 0 0.75rem 0', fontSize: fontSize.bodyLg, color: colors.textMuted, fontStyle: 'italic' },
  chipRow: { display: 'flex', gap: space.md, marginTop: space.md, flexWrap: 'wrap' },
  subEventToggle: {
    flexShrink: 0,
    fontSize: fontSize.label,
    background: 'none',
    border: 'none',
    color: colors.suggest,
    cursor: 'pointer',
    padding: 0,
    fontFamily,
    whiteSpace: 'nowrap',
  },
  childEventList: {
    marginLeft: '1.4rem',
    borderLeft: '2px solid #E5DCC3',
    paddingLeft: space.xl,
    marginTop: space.md,
    display: 'flex',
    flexDirection: 'column',
    gap: space.md,
  },
  childEventCard: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: '0.15rem',
    textAlign: 'left',
    backgroundColor: colors.surface,
    border: '1px solid #ECE7DA',
    borderRadius: radius.lg,
    padding: '0.6rem 0.85rem',
    cursor: 'pointer',
    fontFamily,
    width: '100%',
  },
  childEventName: { fontSize: fontSize.bodyLg, color: colors.inkPlain },
  childEventMeta: { fontSize: fontSize.small, color: colors.textFaint },
}
