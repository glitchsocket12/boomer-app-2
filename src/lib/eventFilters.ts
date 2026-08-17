// The Events list's filter shape and its defaults, split out of pages/Events.tsx so App.tsx can
// hold the filter state (it lifts it up, so Events can unmount without losing it — see App.tsx)
// WITHOUT importing the Events page itself. Events is lazy-loaded, and a single eager
// `import { DEFAULT_EVENT_FILTERS } from './pages/Events'` would drag the whole page — and
// everything it imports — straight back into the initial bundle, defeating the split.
//
// Types and plain data only. Nothing here may import a component.

export type DateFilterPreset = 'all' | 'thisYear' | 'lastYear' | 'last30' | 'custom'
export type DateFilter = { preset: DateFilterPreset; customStart: string | null; customEnd: string | null }
export const DEFAULT_DATE_FILTER: DateFilter = { preset: 'all', customStart: null, customEnd: null }

export type EventFilters = {
  search: string
  tagFilter: string
  personFilter: string
  groupFilter: string
  subgroupFilter: string
  locationFilter: string
  dateFilter: DateFilter
}

export const DEFAULT_EVENT_FILTERS: EventFilters = {
  search: '',
  tagFilter: 'all',
  personFilter: 'all',
  groupFilter: 'all',
  subgroupFilter: 'all',
  locationFilter: 'all',
  dateFilter: DEFAULT_DATE_FILTER,
}
