import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { summarize } from '../lib/summarize'
import { daysUntilNextOccurrence } from '../lib/dates'
import { GroupChip, EventChip, PersonChip } from '../components/Chips'
import SearchBox from '../components/SearchBox'
import { useGroupRoster, type GroupLabelFn } from '../lib/groupRoster'
import { formatPetLine, loadAllPets, loadOwnersByPetId, isMemorial, petEmoji, type Pet, type PetOwner } from '../lib/pets'

type GroupRef = { id: string; name: string }
type EventRef = { id: string; summary: string }
type ReminderRef = { month: number; day: number }

export type Person = {
  id: string
  name: string
  last_name: string | null
  nicknames: string | null
  middle_name: string | null
  goes_by_other: string | null
  created_at: string
  person_groups: { groups: GroupRef | null }[]
  notes: { moment_id: string | null; moments: { id: string; occasion: string | null; raw_description: string } | null }[]
  reminders: ReminderRef[]
}

const AFFILIATION_LIMIT = 4

export type SortMode = 'name-asc' | 'name-desc' | 'date-added' | 'relevance' | 'timely'

const SORT_LABELS: { value: SortMode; label: string }[] = [
  { value: 'name-asc', label: 'Name (A–Z)' },
  { value: 'name-desc', label: 'Name (Z–A)' },
  { value: 'date-added', label: 'Recently added' },
  { value: 'relevance', label: 'Most notes' },
  { value: 'timely', label: 'Upcoming dates' },
]

function nearestUpcomingDays(person: Person): number {
  const days = (person.reminders ?? []).map((r) => daysUntilNextOccurrence(r.month, r.day))
  return days.length > 0 ? Math.min(...days) : Infinity
}

// Pets share this list with people (founder's call, 2026-08-01: "having a pet in the People list
// would be funny... a paw icon to let people see it's not a person"). They are NOT people and never
// become them — separate tables, and the heading count below still counts people only, so the
// Dunbar math and the "560 People" tile are untouched. This is purely a display merge.
export type PetRow = { pet: Pet; owners: PetOwner[] }
export type ListRow = { kind: 'person'; person: Person } | { kind: 'pet'; pet: Pet; owners: PetOwner[] }

function rowSortName(row: ListRow): string {
  return row.kind === 'person' ? row.person.name : row.pet.name
}

function rowCreatedAt(row: ListRow): number {
  return new Date(row.kind === 'person' ? row.person.created_at : row.pet.created_at).getTime()
}

// A pet has no notes, so "Most notes" always sorts them last rather than salting the top of the
// list with zero-note rows.
function rowNoteCount(row: ListRow): number {
  return row.kind === 'person' ? row.person.notes?.length ?? 0 : -1
}

// A pet's birthday counts as an upcoming date, so "Upcoming dates" surfaces it alongside people's.
function rowUpcomingDays(row: ListRow): number {
  if (row.kind === 'person') return nearestUpcomingDays(row.person)
  const birth = row.pet.birth_date
  if (!birth) return Infinity
  const [, month, day] = birth.split('-').map(Number)
  return daysUntilNextOccurrence(month, day)
}

export function sortRows(rows: ListRow[], mode: SortMode): ListRow[] {
  const sorted = [...rows]
  switch (mode) {
    case 'name-desc':
      return sorted.sort((a, b) => rowSortName(b).localeCompare(rowSortName(a)))
    case 'date-added':
      return sorted.sort((a, b) => rowCreatedAt(b) - rowCreatedAt(a))
    case 'relevance':
      return sorted.sort((a, b) => rowNoteCount(b) - rowNoteCount(a))
    case 'timely':
      return sorted.sort((a, b) => rowUpcomingDays(a) - rowUpcomingDays(b))
    case 'name-asc':
    default:
      return sorted.sort((a, b) => rowSortName(a).localeCompare(rowSortName(b)))
  }
}

export function filterRows(rows: ListRow[], search: string): ListRow[] {
  const query = search.trim().toLowerCase()
  return rows.filter((row) => {
    if (row.kind === 'pet') {
      // Searching an owner's name should surface their pets too — "Chen" finding Biscuit is the
      // point of putting pets in this list at all.
      const ownerNames = row.owners.map((o) => o.name).join(' ')
      return `${row.pet.name} ${row.pet.species ?? ''} ${row.pet.breed ?? ''} ${ownerNames}`
        .toLowerCase()
        .includes(query)
    }
    const person = row.person
    const fullName = `${person.name}${person.last_name ? ` ${person.last_name}` : ''}`
    return (
      fullName.toLowerCase().includes(query) ||
      (person.nicknames ?? '').toLowerCase().includes(query) ||
      (person.middle_name ?? '').toLowerCase().includes(query) ||
      (person.goes_by_other ?? '').toLowerCase().includes(query)
    )
  })
}

export default function People({
  onSelectPerson,
  onSelectGroup,
  onSelectEvent,
  onSelectPet,
}: {
  onSelectPerson: (person: { id: string; name: string }) => void
  onSelectGroup: (group: { id: string; name: string }) => void
  onSelectEvent: (event: { id: string; summary: string }) => void
  onSelectPet: (pet: { id: string; name: string }) => void
}) {
  const [people, setPeople] = useState<Person[]>([])
  const [petRows, setPetRows] = useState<PetRow[]>([])
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [sortMode, setSortMode] = useState<SortMode>('name-asc')
  const groupRoster = useGroupRoster()

  // Load the current user's people, along with which groups and events
  // they're tied to, when the page opens
  useEffect(() => {
    loadPeople()
    loadPets()
  }, [])

  async function loadPeople() {
    setLoading(true)
    const { data, error } = await supabase
      .from('people')
      .select(
        'id, name, last_name, nicknames, middle_name, goes_by_other, created_at, person_groups(groups(id, name)), notes(moment_id, moments(id, occasion, raw_description)), reminders(month, day)'
      )
      .eq('is_self', false)
      .order('name')

    if (!error && data) {
      setPeople(data as unknown as Person[])
    }
    setLoading(false)
  }

  // Separate from loadPeople on purpose, and never embedded into the select above: pets depend on
  // a migration the founder runs by hand, and a `.select()` naming a table that doesn't exist yet
  // fails the WHOLE query — which would blank the People list, not just hide the pets.
  async function loadPets() {
    const [pets, ownersByPetId] = await Promise.all([loadAllPets(), loadOwnersByPetId()])
    setPetRows(pets.map((pet) => ({ pet, owners: ownersByPetId[pet.id] ?? [] })))
  }

  // No form up front — matches "add an event": creates a blank shell immediately and drops
  // the founder straight onto the new profile, where the name pencil and group picker are
  // right there to fill in.
  async function handleAddPerson() {
    setAdding(true)
    setAddError(null)
    const {
      data: { user },
    } = await supabase.auth.getUser()

    const { data, error } = await supabase
      .from('people')
      .insert({ name: 'New person', last_name: null, user_id: user?.id })
      .select()
      .single()

    setAdding(false)
    if (error || !data) {
      setAddError("Couldn't start a new profile — please try again.")
      return
    }

    onSelectPerson({ id: data.id, name: data.name })
  }

  if (loading) return <p style={{ textAlign: 'center', marginTop: '3rem' }}>Loading…</p>

  const allRows: ListRow[] = [
    ...people.map((person) => ({ kind: 'person' as const, person })),
    ...petRows.map((r) => ({ kind: 'pet' as const, pet: r.pet, owners: r.owners })),
  ]
  const filteredRows = sortRows(filterRows(allRows, search), sortMode)

  return (
    <PeopleView
      peopleCount={people.length}
      filteredRows={filteredRows}
      search={search}
      onSearchChange={setSearch}
      sortMode={sortMode}
      onSortModeChange={setSortMode}
      onAddPerson={handleAddPerson}
      adding={adding}
      addError={addError}
      onSelectPerson={onSelectPerson}
      onSelectGroup={onSelectGroup}
      onSelectEvent={onSelectEvent}
      onSelectPet={onSelectPet}
      groupLabel={groupRoster.label}
    />
  )
}

// Pure render — split out (2026-07-22) so the landing-page demo can render the exact same list UI
// fed by static data, with no Supabase calls. `readOnly` hides "+ Add Person" (a real insert).
export function PeopleView({
  peopleCount,
  filteredRows,
  search,
  onSearchChange,
  sortMode,
  onSortModeChange,
  onAddPerson,
  adding,
  addError,
  onSelectPerson,
  onSelectGroup,
  onSelectEvent,
  onSelectPet = () => {},
  groupLabel = (_id, fallbackName) => fallbackName,
  readOnly = false,
}: {
  peopleCount: number
  filteredRows: ListRow[]
  search: string
  onSearchChange: (value: string) => void
  sortMode: SortMode
  onSortModeChange: (value: SortMode) => void
  onAddPerson: () => void
  adding: boolean
  addError: string | null
  onSelectPerson: (person: { id: string; name: string }) => void
  onSelectGroup: (group: { id: string; name: string }) => void
  onSelectEvent: (event: { id: string; summary: string }) => void
  onSelectPet?: (pet: { id: string; name: string }) => void
  // Qualifies a subgroup as "Parent / Child". Defaults to the bare name for the landing-page demo.
  groupLabel?: GroupLabelFn
  readOnly?: boolean
}) {
  return (
    <div style={styles.page}>
      <div style={styles.headingRow}>
        <h1 style={styles.heading}>
          People{peopleCount > 0 && <span style={styles.count}> ({peopleCount})</span>}
        </h1>
        {!readOnly && (
          <button type="button" onClick={onAddPerson} style={styles.addButton} disabled={adding}>
            {adding ? '…' : '+ Add Person'}
          </button>
        )}
      </div>
      {addError && <p style={styles.addErrorText}>{addError}</p>}

      {peopleCount > 0 && (
        <div style={styles.searchRow}>
          <SearchBox value={search} onChange={onSearchChange} placeholder="Search people…" />
          <select
            value={sortMode}
            onChange={(e) => onSortModeChange(e.target.value as SortMode)}
            style={styles.sortSelect}
            aria-label="Sort people"
          >
            {SORT_LABELS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                Sort: {opt.label}
              </option>
            ))}
          </select>
        </div>
      )}

      <div style={styles.list}>
        {peopleCount === 0 && <p style={styles.empty}>No one added yet — add someone above.</p>}
        {peopleCount > 0 && filteredRows.length === 0 && (
          <p style={styles.empty}>No one matches "{search}".</p>
        )}
        {filteredRows.map((row) =>
          row.kind === 'pet' ? (
            <PetCard
              key={`pet-${row.pet.id}`}
              pet={row.pet}
              owners={row.owners}
              onViewPet={onSelectPet}
              onSelectPerson={onSelectPerson}
            />
          ) : (
            <PersonCard
              key={row.person.id}
              person={row.person}
              onViewPerson={onSelectPerson}
              onSelectGroup={onSelectGroup}
              onSelectEvent={onSelectEvent}
              groupLabel={groupLabel}
            />
          )
        )}
      </div>
    </div>
  )
}

// One tile per person, matching the Groups/Events tile convention: the
// name is the clickable title, and a row of color-coded chips underneath
// shows which groups and events they're tied to, for quick navigation.
function PersonCard({
  person,
  onViewPerson,
  onSelectGroup,
  onSelectEvent,
  groupLabel,
}: {
  person: Person
  onViewPerson: (person: { id: string; name: string }) => void
  onSelectGroup: (group: { id: string; name: string }) => void
  onSelectEvent: (event: { id: string; summary: string }) => void
  groupLabel: GroupLabelFn
}) {
  const fullName = `${person.name}${person.last_name ? ` ${person.last_name}` : ''}`

  const groups = (person.person_groups ?? [])
    .map((pg) => pg.groups)
    .filter((g): g is GroupRef => g !== null)

  const eventMap = new Map<string, EventRef>()
  for (const n of person.notes ?? []) {
    if (n.moments) {
      eventMap.set(n.moments.id, { id: n.moments.id, summary: summarize(n.moments.occasion, n.moments.raw_description) })
    }
  }
  const events = Array.from(eventMap.values())

  const shownGroups = groups.slice(0, AFFILIATION_LIMIT)
  const shownEvents = events.slice(0, AFFILIATION_LIMIT)

  return (
    <div style={styles.card}>
      <button onClick={() => onViewPerson(person)} style={styles.titleButton}>
        {fullName}
      </button>

      {(groups.length > 0 || events.length > 0) && (
        <div style={styles.affiliations}>
          {shownGroups.length > 0 && (
            <div style={styles.chipRow}>
              {shownGroups.map((g) => (
                <GroupChip key={g.id} label={groupLabel(g.id, g.name)} onClick={() => onSelectGroup(g)} />
              ))}
              {groups.length > AFFILIATION_LIMIT && (
                <span style={styles.moreText}>+{groups.length - AFFILIATION_LIMIT} more</span>
              )}
            </div>
          )}
          {shownEvents.length > 0 && (
            <div style={styles.chipRow}>
              {shownEvents.map((e) => (
                <EventChip key={e.id} label={e.summary} onClick={() => onSelectEvent(e)} />
              ))}
              {events.length > AFFILIATION_LIMIT && (
                <span style={styles.moreText}>+{events.length - AFFILIATION_LIMIT} more</span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// A pet's tile in the People list. Same shape as PersonCard so the list reads as one list, but the
// species emoji in front of the name is the whole point — it's what tells you at a glance that this
// row isn't a person. Owner chips underneath do the job the group/event chips do on a person.
function PetCard({
  pet,
  owners,
  onViewPet,
  onSelectPerson,
}: {
  pet: Pet
  owners: PetOwner[]
  onViewPet: (pet: { id: string; name: string }) => void
  onSelectPerson: (person: { id: string; name: string }) => void
}) {
  return (
    <div style={styles.card}>
      <button
        onClick={() => onViewPet({ id: pet.id, name: pet.name })}
        style={isMemorial(pet) ? { ...styles.titleButton, ...styles.memorialTitle } : styles.titleButton}
      >
        <span style={styles.petEmoji}>{petEmoji(pet)}</span> {formatPetLine(pet)}
        {isMemorial(pet) && <span style={styles.memorialTag}> · In memory</span>}
      </button>

      {owners.length > 0 && (
        <div style={styles.affiliations}>
          <div style={styles.chipRow}>
            {owners.slice(0, AFFILIATION_LIMIT).map((o) => (
              <PersonChip key={o.id} label={o.name} onClick={() => onSelectPerson({ id: o.id, name: o.name })} />
            ))}
            {owners.length > AFFILIATION_LIMIT && (
              <span style={styles.moreText}>+{owners.length - AFFILIATION_LIMIT} more</span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

const styles: { [key: string]: React.CSSProperties } = {
  page: { maxWidth: '840px', margin: '0 auto', padding: '2rem 1.5rem', fontFamily: 'Georgia, serif' },
  headingRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', marginBottom: '1rem', flexWrap: 'wrap' },
  heading: { fontSize: '2rem', color: '#2E4034', margin: 0 },
  count: { fontSize: '1.2rem', color: '#888', fontWeight: 'normal' },
  addButton: {
    fontSize: '1rem',
    padding: '0.6rem 1.1rem',
    borderRadius: '8px',
    border: 'none',
    backgroundColor: '#2E4034',
    color: '#FFF',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    fontFamily: 'Georgia, serif',
  },
  addErrorText: { color: '#B04A3B', fontSize: '0.9rem', marginBottom: '1.25rem' },
  searchRow: { display: 'flex', gap: '0.75rem', alignItems: 'flex-start' },
  sortSelect: {
    flexShrink: 0,
    fontSize: '1rem',
    padding: '0.65rem 0.75rem',
    borderRadius: '8px',
    border: '1px solid #CCC',
    fontFamily: 'Georgia, serif',
    backgroundColor: '#FFF',
    color: '#2E2E2E',
    marginBottom: '1.5rem',
  },
  list: { display: 'flex', flexDirection: 'column', gap: '1rem' },
  empty: { color: '#777' },
  card: {
    backgroundColor: '#FFF',
    borderRadius: '10px',
    padding: '1.25rem',
    boxShadow: '0 1px 6px rgba(0,0,0,0.06)',
  },
  titleButton: {
    display: 'block',
    margin: 0,
    padding: 0,
    fontSize: '1.3rem',
    fontFamily: 'Georgia, serif',
    color: '#2E2E2E',
    background: 'none',
    border: 'none',
    textAlign: 'left',
    cursor: 'pointer',
  },
  petEmoji: { fontStyle: 'normal' },
  memorialTitle: { color: '#666' },
  memorialTag: { fontSize: '0.85rem', color: '#888', fontStyle: 'italic' },
  affiliations: { display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.75rem' },
  chipRow: { display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' },
  moreText: { fontSize: '0.85rem', color: '#999', fontStyle: 'italic' },
}
