import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { fetchAllRows } from '../lib/pagedSelect'
import { summarize } from '../lib/summarize'
import { daysUntilNextOccurrence } from '../lib/dates'
import { GroupChip, EventChip, PersonChip } from '../components/Chips'
import SearchBox from '../components/SearchBox'
import { useGroupRoster, type GroupLabelFn } from '../lib/groupRoster'
import { formatPetLine, loadAllPets, loadOwnersByPetId, isMemorial, petEmoji, type Pet, type PetOwner } from '../lib/pets'
import { border, colors, fontFamily, fontSize, maxWidth, radius, shadow, space } from '../lib/theme'
import { formerFullNames, parseFormerLastNames } from '../lib/formerNames'

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
  former_last_names: string | null
  how_you_know_them: string | null
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
      (person.goes_by_other ?? '').toLowerCase().includes(query) ||
      // Both forms, so a name change is findable either as the bare old surname or whole
      // ("Jenkins" and "Sarah Jenkins" both reach Sarah Mitchell).
      (person.former_last_names ?? '').toLowerCase().includes(query) ||
      (person.how_you_know_them ?? '').toLowerCase().includes(query) ||
      formerFullNames(person.name, parseFormerLastNames(person.former_last_names)).some((n) =>
        n.toLowerCase().includes(query)
      )
    )
  })
}

export default function People({
  onSelectPerson,
  onSelectGroup,
  onSelectEvent,
  onSelectPet,
  onFillGender,
  onImportContacts,
}: {
  onSelectPerson: (person: { id: string; name: string }) => void
  onSelectGroup: (group: { id: string; name: string }) => void
  onSelectEvent: (event: { id: string; summary: string }) => void
  onSelectPet: (pet: { id: string; name: string }) => void
  onFillGender: () => void
  onImportContacts: () => void
}) {
  const [people, setPeople] = useState<Person[]>([])
  const [petRows, setPetRows] = useState<PetRow[]>([])
  const [genderGaps, setGenderGaps] = useState(0)
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
    loadGenderGaps()
  }, [])

  // Head-only count, so a 700-person account costs one tiny request and never trips PostgREST's
  // 1000-row cap. Its own query for the same reason loadPets has one: `gender` came in through a
  // hand-run migration, and naming it in the main select would fail that whole query — blanking the
  // People list — on any account where it hasn't been applied. A failure here just hides the link.
  async function loadGenderGaps() {
    const { count, error } = await supabase
      .from('people')
      .select('id', { count: 'exact', head: true })
      .is('gender', null)
    setGenderGaps(error ? 0 : count ?? 0)
  }

  async function loadPeople() {
    setLoading(true)
    // Paged: this is THE roster page, and the account was at 724 people on 2026-08-11 — close
    // enough to PostgREST's silent 1000-row cap that the list would have started losing its tail
    // with no error and no gap to notice. Secondary .order('id') because names are not unique, and
    // a non-unique sort key lets rows shuffle between pages.
    const { data, error } = await fetchAllRows((from, to) =>
      supabase
        .from('people')
        .select(
          'id, name, last_name, nicknames, middle_name, goes_by_other, former_last_names, how_you_know_them, created_at, person_groups(groups(id, name)), notes(moment_id, moments(id, occasion, raw_description)), reminders(month, day)'
        )
        .eq('is_self', false)
        .order('name')
        .order('id')
        .range(from, to)
    )

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
      genderGaps={genderGaps}
      onFillGender={onFillGender}
      onImportContacts={onImportContacts}
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
  genderGaps = 0,
  onFillGender = () => {},
  onImportContacts,
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
  // How many people have no gender recorded. Drives the "Fill in gender" link, which disappears
  // once there's nothing left to fill — 0 for the demo, which has no such page.
  genderGaps?: number
  onFillGender?: () => void
  // Optional so the read-only landing-page demo doesn't have to pass a no-op for a button it
  // never renders.
  onImportContacts?: () => void
  readOnly?: boolean
}) {
  return (
    <div style={styles.page}>
      <div style={styles.headingRow}>
        <h1 style={styles.heading}>
          People{peopleCount > 0 && <span style={styles.count}> ({peopleCount})</span>}
        </h1>
        {!readOnly && (
          <div style={styles.headingActions}>
            {/* Matches Events' "Import Events" — not its own flow, just a shortcut to the
                vCard upload page, which is where contact importing already lives. */}
            <button type="button" onClick={onImportContacts} style={styles.importButton}>
              Import Contacts
            </button>
            <button type="button" onClick={onAddPerson} style={styles.addButton} disabled={adding}>
              {adding ? '…' : '+ Add Person'}
            </button>
          </div>
        )}
      </div>
      {!readOnly && genderGaps > 0 && (
        <button type="button" onClick={onFillGender} style={styles.fillGenderLink}>
          Fill in gender for {genderGaps} {genderGaps === 1 ? 'person' : 'people'} →
        </button>
      )}
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
      {person.how_you_know_them && <p style={styles.howYouKnowLine}>{person.how_you_know_them}</p>}

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
  page: { maxWidth: maxWidth.page, margin: '0 auto', padding: '2rem 1.5rem', fontFamily },
  headingRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: space.xl, marginBottom: space.xl, flexWrap: 'wrap' },
  heading: { fontSize: fontSize.h1, color: colors.ink, margin: 0 },
  count: { fontSize: '1.2rem', color: colors.textFaint, fontWeight: 'normal' },
  // Wraps so the two buttons stack instead of squeezing the heading on a phone (§10).
  headingActions: { display: 'flex', alignItems: 'center', gap: space.md, flexWrap: 'wrap' },
  addButton: {
    fontSize: fontSize.base,
    padding: '0.6rem 1.1rem',
    borderRadius: radius.md,
    border: 'none',
    backgroundColor: colors.primary,
    color: colors.surface,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    fontFamily,
  },
  // Outlined, not filled — importing is the secondary path next to "+ Add Person".
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
  addErrorText: { color: colors.danger, fontSize: fontSize.body, marginBottom: space.xxl },
  fillGenderLink: {
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
  searchRow: { display: 'flex', gap: space.lg, alignItems: 'flex-start' },
  sortSelect: {
    flexShrink: 0,
    fontSize: fontSize.base,
    padding: '0.65rem 0.75rem',
    borderRadius: radius.md,
    border: border.default,
    fontFamily,
    backgroundColor: colors.surface,
    color: colors.inkPlain,
    marginBottom: space.xxxl,
  },
  list: { display: 'flex', flexDirection: 'column', gap: space.xl },
  empty: { color: colors.textSubtle },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: '1.25rem',
    boxShadow: shadow.card,
  },
  titleButton: {
    display: 'block',
    margin: 0,
    padding: 0,
    fontSize: fontSize.h3,
    fontFamily,
    color: colors.inkPlain,
    background: 'none',
    border: 'none',
    textAlign: 'left',
    cursor: 'pointer',
  },
  // Sits directly under the name, tighter than the affiliation chips below it — it reads as part
  // of the name, which is the whole job: telling this Sarah from the other eight.
  howYouKnowLine: { fontSize: fontSize.label, color: colors.textFaint, margin: `${space.xs} 0 0 0` },
  petEmoji: { fontStyle: 'normal' },
  memorialTitle: { color: colors.textMuted },
  memorialTag: { fontSize: fontSize.label, color: colors.textFaint, fontStyle: 'italic' },
  affiliations: { display: 'flex', flexDirection: 'column', gap: space.md, marginTop: space.lg },
  chipRow: { display: 'flex', gap: space.md, flexWrap: 'wrap', alignItems: 'center' },
  moreText: { fontSize: fontSize.label, color: colors.textFaintest, fontStyle: 'italic' },
}
