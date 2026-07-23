import { useState } from 'react'
import { GroupsView, type Group } from '../Groups'
import { DEMO_GROUPS, DEMO_PEOPLE, DEMO_MOMENTS } from '../../lib/demoData'

const ALL_GROUPS: Group[] = DEMO_GROUPS.map((g) => ({
  id: g.id,
  name: g.name,
  summary: g.summary,
  group_type: g.group_type,
  person_groups: g.memberIds.map((id) => {
    const p = DEMO_PEOPLE.find((pp) => pp.id === id)!
    return { people: { id: p.id, name: p.name, last_name: p.last_name } }
  }),
  moment_groups: DEMO_MOMENTS.filter((m) => m.groupIds.includes(g.id)).map((m) => ({
    moments: { id: m.id, occasion: m.occasion, raw_description: m.raw_description },
  })),
}))

export default function DemoGroups({
  onSelectPerson,
  onSelectGroup,
  onSelectEvent,
}: {
  onSelectPerson: (person: { id: string; name: string }) => void
  onSelectGroup: (group: { id: string; name: string }) => void
  onSelectEvent: (event: { id: string; summary: string }) => void
}) {
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')

  return (
    <GroupsView
      groups={ALL_GROUPS}
      search={search}
      onSearchChange={setSearch}
      typeFilter={typeFilter}
      onTypeFilterChange={setTypeFilter}
      onAddGroup={() => {}}
      addingGroup={false}
      addError={null}
      onSelectPerson={onSelectPerson}
      onSelectGroup={onSelectGroup}
      onSelectEvent={onSelectEvent}
      readOnly
    />
  )
}
