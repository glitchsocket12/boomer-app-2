import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { summarize } from '../lib/summarize'
import { GroupChip, EventChip } from '../components/Chips'
import SearchBox from '../components/SearchBox'

type GroupRef = { id: string; name: string }
type EventRef = { id: string; summary: string }
type ReminderRef = { month: number; day: number }

type Person = {
  id: string
  name: string
  last_name: string | null
  nicknames: string | null
  created_at: string
  person_groups: { groups: GroupRef | null }[]
  notes: { moment_id: string | null; moments: { id: string; occasion: string | null; raw_description: string } | null }[]
  reminders: ReminderRef[]
}

const AFFILIATION_LIMIT = 4

type SortMode = 'name-asc' | 'name-desc' | 'date-added' | 'relevance' | 'timely'

const SORT_LABELS: { value: SortMode; label: string }[] = [
  { value: 'name-asc', label: 'Name (A–Z)' },
  { value: 'name-desc', label: 'Name (Z–A)' },
  { value: 'date-added', label: 'Recently added' },
  { value: 'relevance', label: 'Most notes' },
  { value: 'timely', label: 'Upcoming dates' },
]

// Next occurrence of a month/day reminder (birthday, anniversary) from today, wrapping
// into next year once this year's date has already passed — used to surface people with
// a birthday/anniversary coming up soonest under the "Upcoming dates" sort.
function daysUntilNextOccurrence(month: number, day: number): number {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  let next = new Date(today.getFullYear(), month - 1, day)
  if (next < today) next = new Date(today.getFullYear() + 1, month - 1, day)
  return Math.round((next.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
}

function nearestUpcomingDays(person: Person): number {
  const days = (person.reminders ?? []).map((r) => daysUntilNextOccurrence(r.month, r.day))
  return days.length > 0 ? Math.min(...days) : Infinity
}

function sortPeople(people: Person[], mode: SortMode): Person[] {
  const sorted = [...people]
  switch (mode) {
    case 'name-desc':
      return sorted.sort((a, b) => b.name.localeCompare(a.name))
    case 'date-added':
      return sorted.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    case 'relevance':
      return sorted.sort((a, b) => (b.notes?.length ?? 0) - (a.notes?.length ?? 0))
    case 'timely':
      return sorted.sort((a, b) => nearestUpcomingDays(a) - nearestUpcomingDays(b))
    case 'name-asc':
    default:
      return sorted.sort((a, b) => a.name.localeCompare(b.name))
  }
}

export default function People({
  onSelectPerson,
  onSelectGroup,
  onSelectEvent,
}: {
  onSelectPerson: (person: { id: string; name: string }) => void
  onSelectGroup: (group: { id: string; name: string }) => void
  onSelectEvent: (event: { id: string; summary: string }) => void
}) {
  const [people, setPeople] = useState<Person[]>([])
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [sortMode, setSortMode] = useState<SortMode>('name-asc')

  // Load the current user's people, along with which groups and events
  // they're tied to, when the page opens
  useEffect(() => {
    loadPeople()
  }, [])

  async function loadPeople() {
    setLoading(true)
    const { data, error } = await supabase
      .from('people')
      .select(
        'id, name, last_name, nicknames, created_at, person_groups(groups(id, name)), notes(moment_id, moments(id, occasion, raw_description)), reminders(month, day)'
      )
      .order('name')

    if (!error && data) {
      setPeople(data as unknown as Person[])
    }
    setLoading(false)
  }

  // No form up front — matches "add an event": creates a blank shell immediately and drops
  // the founder straight onto the new profile. There's no direct name-edit control on
  // PersonDetail by design (names are set conversationally via the fact bar, same path used to
  // rename AI-created placeholders like "Clare's mom"), so this placeholder name leans on that
  // same rename mechanism rather than adding a new one.
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

  const filteredPeople = sortPeople(
    people.filter((person) => {
      const fullName = `${person.name}${person.last_name ? ` ${person.last_name}` : ''}`
      const query = search.trim().toLowerCase()
      return fullName.toLowerCase().includes(query) || (person.nicknames ?? '').toLowerCase().includes(query)
    }),
    sortMode
  )

  return (
    <div style={styles.page}>
      <div style={styles.headingRow}>
        <h1 style={styles.heading}>
          People{people.length > 0 && <span style={styles.count}> ({people.length})</span>}
        </h1>
        <button type="button" onClick={handleAddPerson} style={styles.addButton} disabled={adding}>
          {adding ? '…' : '+ Add Person'}
        </button>
      </div>
      {addError && <p style={styles.addErrorText}>{addError}</p>}

      {people.length > 0 && (
        <div style={styles.searchRow}>
          <SearchBox value={search} onChange={setSearch} placeholder="Search people…" />
          <select
            value={sortMode}
            onChange={(e) => setSortMode(e.target.value as SortMode)}
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
        {people.length === 0 && <p style={styles.empty}>No one added yet — add someone above.</p>}
        {people.length > 0 && filteredPeople.length === 0 && (
          <p style={styles.empty}>No one matches "{search}".</p>
        )}
        {filteredPeople.map((person) => (
          <PersonCard
            key={person.id}
            person={person}
            onViewPerson={onSelectPerson}
            onSelectGroup={onSelectGroup}
            onSelectEvent={onSelectEvent}
          />
        ))}
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
}: {
  person: Person
  onViewPerson: (person: { id: string; name: string }) => void
  onSelectGroup: (group: { id: string; name: string }) => void
  onSelectEvent: (event: { id: string; summary: string }) => void
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
                <GroupChip key={g.id} label={g.name} onClick={() => onSelectGroup(g)} />
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

const styles: { [key: string]: React.CSSProperties } = {
  page: { maxWidth: '600px', margin: '0 auto', padding: '2rem 1.5rem', fontFamily: 'Georgia, serif' },
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
  affiliations: { display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.75rem' },
  chipRow: { display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' },
  moreText: { fontSize: '0.85rem', color: '#999', fontStyle: 'italic' },
}
