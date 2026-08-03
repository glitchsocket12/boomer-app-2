import { useState } from 'react'
import { EventsView, type Moment } from '../Events'
import { eventSortDate } from '../../lib/dates'
import { DEMO_MOMENTS, DEMO_PEOPLE, DEMO_GROUPS, DEMO_TAGS } from '../../lib/demoData'

// Sorted newest-first, same as the real container's loadMoments() — groupMomentsByYear() below
// only merges a moment into the *previous* group when the year matches, so unsorted input (the
// CORE_MOMENTS/GENERATED_ROSTER concatenation order) fragmented into one group per moment instead
// of one per year, with the same year number reused non-consecutively (React duplicate-key
// warnings; found via a demo QA pass, 2026-08-03).
const ALL_MOMENTS: Moment[] = DEMO_MOMENTS.map((m) => ({
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
})).sort((a, b) => eventSortDate(b).getTime() - eventSortDate(a).getTime())

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
  const [search, setSearch] = useState('')
  const [tagFilter, setTagFilter] = useState('all')

  return (
    <EventsView
      moments={ALL_MOMENTS}
      distinctTags={DISTINCT_TAGS}
      search={search}
      onSearchChange={setSearch}
      tagFilter={tagFilter}
      onTagFilterChange={setTagFilter}
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
