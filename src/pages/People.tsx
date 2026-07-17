import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { summarize } from '../lib/summarize'
import { GroupChip, EventChip } from '../components/Chips'

type GroupRef = { id: string; name: string }
type EventRef = { id: string; summary: string }

type Person = {
  id: string
  name: string
  last_name: string | null
  person_groups: { groups: GroupRef | null }[]
  notes: { moment_id: string | null; moments: { id: string; occasion: string | null; raw_description: string } | null }[]
}

const AFFILIATION_LIMIT = 4

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
  const [newName, setNewName] = useState('')
  const [newLastName, setNewLastName] = useState('')
  const [loading, setLoading] = useState(true)

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
        'id, name, last_name, person_groups(groups(id, name)), notes(moment_id, moments(id, occasion, raw_description))'
      )
      .order('name')

    if (!error && data) {
      setPeople(data as unknown as Person[])
    }
    setLoading(false)
  }

  async function handleAddPerson(e: FormEvent) {
    e.preventDefault()
    if (!newName.trim()) return

    const {
      data: { user },
    } = await supabase.auth.getUser()

    await supabase
      .from('people')
      .insert({ name: newName.trim(), last_name: newLastName.trim() || null, user_id: user?.id })
    setNewName('')
    setNewLastName('')
    loadPeople()
  }

  if (loading) return <p style={{ textAlign: 'center', marginTop: '3rem' }}>Loading…</p>

  return (
    <div style={styles.page}>
      <h1 style={styles.heading}>People</h1>

      <form onSubmit={handleAddPerson} style={styles.addForm}>
        <input
          type="text"
          placeholder="First name"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          style={styles.input}
        />
        <input
          type="text"
          placeholder="Last name (optional)"
          value={newLastName}
          onChange={(e) => setNewLastName(e.target.value)}
          style={styles.input}
        />
        <button type="submit" style={styles.button}>Add</button>
      </form>

      <div style={styles.list}>
        {people.length === 0 && <p style={styles.empty}>No one added yet — add someone above.</p>}
        {people.map((person) => (
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
  heading: { fontSize: '2rem', color: '#2E4034', marginBottom: '1.5rem' },
  addForm: { display: 'flex', gap: '0.75rem', marginBottom: '2rem' },
  input: { flex: 1, fontSize: '1.1rem', padding: '0.65rem', borderRadius: '8px', border: '1px solid #CCC' },
  button: {
    fontSize: '1.1rem',
    padding: '0.65rem 1.25rem',
    borderRadius: '8px',
    border: 'none',
    backgroundColor: '#2E4034',
    color: '#FFF',
    cursor: 'pointer',
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
