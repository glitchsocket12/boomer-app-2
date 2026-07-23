import { useState } from 'react'
import { PeopleView, sortPeople, filterPeople, type Person, type SortMode } from '../People'
import { DEMO_PEOPLE, DEMO_GROUPS, DEMO_NOTES, DEMO_MOMENTS, DEMO_REMINDERS } from '../../lib/demoData'

function toPerson(id: string): Person {
  const p = DEMO_PEOPLE.find((pp) => pp.id === id)!
  const groups = DEMO_GROUPS.filter((g) => g.memberIds.includes(id)).map((g) => ({ groups: { id: g.id, name: g.name } }))
  const notes = DEMO_NOTES.filter((n) => n.personId === id).map((n) => {
    const moment = n.momentId ? DEMO_MOMENTS.find((m) => m.id === n.momentId) ?? null : null
    return {
      moment_id: n.momentId,
      moments: moment ? { id: moment.id, occasion: moment.occasion, raw_description: moment.raw_description } : null,
    }
  })
  const reminders = DEMO_REMINDERS.filter((r) => r.personId === id).map((r) => ({ month: r.month, day: r.day }))
  return {
    id: p.id,
    name: p.name,
    last_name: p.last_name,
    nicknames: p.nicknames,
    middle_name: p.middle_name,
    goes_by_other: p.goes_by_other,
    created_at: p.created_at,
    person_groups: groups,
    notes,
    reminders,
  }
}

const ALL_PEOPLE: Person[] = DEMO_PEOPLE.filter((p) => !p.is_self).map((p) => toPerson(p.id))

export default function DemoPeople({
  onSelectPerson,
  onSelectGroup,
  onSelectEvent,
}: {
  onSelectPerson: (person: { id: string; name: string }) => void
  onSelectGroup: (group: { id: string; name: string }) => void
  onSelectEvent: (event: { id: string; summary: string }) => void
}) {
  const [search, setSearch] = useState('')
  const [sortMode, setSortMode] = useState<SortMode>('name-asc')

  const filteredPeople = sortPeople(filterPeople(ALL_PEOPLE, search), sortMode)

  return (
    <PeopleView
      peopleCount={ALL_PEOPLE.length}
      filteredPeople={filteredPeople}
      search={search}
      onSearchChange={setSearch}
      sortMode={sortMode}
      onSortModeChange={setSortMode}
      onAddPerson={() => {}}
      adding={false}
      addError={null}
      onSelectPerson={onSelectPerson}
      onSelectGroup={onSelectGroup}
      onSelectEvent={onSelectEvent}
      readOnly
    />
  )
}
