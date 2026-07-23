import { useState } from 'react'
import { EventsView, type Moment } from '../Events'
import { DEMO_MOMENTS, DEMO_PEOPLE, DEMO_GROUPS } from '../../lib/demoData'

const ALL_MOMENTS: Moment[] = DEMO_MOMENTS.map((m) => ({
  id: m.id,
  occasion: m.occasion,
  location: m.location,
  when_text: m.when_text,
  event_date: m.event_date,
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
  moment_tags: [],
}))

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
      distinctTags={[]}
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
