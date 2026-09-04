import { useState } from 'react'
import { EventsView, DEFAULT_EVENT_FILTERS, type EventFilters, type Moment } from '../Events'
import { DEMO_MOMENTS, DEMO_PEOPLE, DEMO_GROUPS, DEMO_TAGS } from '../../lib/demoData'
import { compareEventsNewestFirst } from '../../lib/dates'

// groupMomentsByYear (Events.tsx) only merges CONSECUTIVE same-year entries — safe for the real
// container, which always sorts by event_date before rendering (see Events.tsx's own fetch sort),
// but DEMO_MOMENTS is just CORE_MOMENTS followed by the generated roster in category order. Left
// unsorted, the same year resurfaces in separate non-adjacent groups, so React sees two `key={year}`
// siblings. Sort here the same way (newest first) so the demo matches production's grouping.
const SORTED_DEMO_MOMENTS = [...DEMO_MOMENTS].sort(compareEventsNewestFirst)

const ALL_MOMENTS: Moment[] = SORTED_DEMO_MOMENTS.map((m) => ({
  id: m.id,
  occasion: m.occasion,
  location: m.location,
  when_text: m.when_text,
  event_date: m.event_date,
  event_end_date: null,
  raw_description: m.raw_description,
  created_at: m.created_at,
  notes: m.attendeeIds.map((id) => {
    const p = DEMO_PEOPLE.find((pp) => pp.id === id)!
    return { people: { id: p.id, name: p.name, last_name: p.last_name } }
  }),
  moment_groups: m.groupIds.map((gid) => {
    const g = DEMO_GROUPS.find((gg) => gg.id === gid)!
    return { groups: { id: g.id, name: g.name } }
  }),
  moment_tags: m.tagIds.map((tid) => {
    const t = DEMO_TAGS.find((tt) => tt.id === tid)!
    return { tags: { id: t.id, name: t.name } }
  }),
}))

// Matches how the real Events.tsx container derives it: the distinct set of tag names actually
// in use, sorted — not a hardcoded list.
const DISTINCT_TAGS: string[] = [...new Set(DEMO_TAGS.map((t) => t.name))].sort()

export default function DemoEvents({
  onSelectPerson,
  onSelectGroup,
  onSelectEvent,
}: {
  onSelectPerson: (person: { id: string; name: string }) => void
  onSelectGroup: (group: { id: string; name: string }) => void
  onSelectEvent: (event: { id: string; summary: string }) => void
}) {
  const [filters, setFilters] = useState<EventFilters>(DEFAULT_EVENT_FILTERS)

  return (
    <EventsView
      moments={ALL_MOMENTS}
      distinctTags={DISTINCT_TAGS}
      filters={filters}
      onFiltersChange={setFilters}
      onAddEvent={() => {}}
      creating={false}
      createError={null}
      onManageTags={() => {}}
      onSelectPerson={onSelectPerson}
      onSelectGroup={onSelectGroup}
      onSelectEvent={onSelectEvent}
      readOnly
    />
  )
}
