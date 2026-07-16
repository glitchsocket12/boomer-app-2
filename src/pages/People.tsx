import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'

type Reminder = {
  id: string
  label: string
  month: number
  day: number
}

type Person = {
  id: string
  name: string
  last_name: string | null
  reminders: Reminder[]
}

export default function People({ onSelectPerson }: { onSelectPerson: (person: { id: string; name: string }) => void }) {
  const [people, setPeople] = useState<Person[]>([])
  const [newName, setNewName] = useState('')
  const [newLastName, setNewLastName] = useState('')
  const [loading, setLoading] = useState(true)

  // Load the current user's people (and their reminders) when the page opens
  useEffect(() => {
    loadPeople()
  }, [])

  async function loadPeople() {
    setLoading(true)
    const { data, error } = await supabase
      .from('people')
      .select('id, name, last_name, reminders(id, label, month, day)')
      .order('name')

    if (!error && data) {
      setPeople(data as Person[])
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

  async function handleAddReminder(personId: string, label: string, month: number, day: number) {
    await supabase.from('reminders').insert({ person_id: personId, label, month, day })
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
          <PersonCard key={person.id} person={person} onAddReminder={handleAddReminder} onViewPerson={onSelectPerson} />
        ))}
      </div>
    </div>
  )
}

// One card per person: shows their name, their existing reminders,
// and a small form to add a new date for them.
function PersonCard({
  person,
  onAddReminder,
  onViewPerson,
}: {
  person: Person
  onAddReminder: (personId: string, label: string, month: number, day: number) => void
  onViewPerson: (person: { id: string; name: string }) => void
}) {
  const [label, setLabel] = useState('Birthday')
  const [month, setMonth] = useState('')
  const [day, setDay] = useState('')
  const [showForm, setShowForm] = useState(false)

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const m = parseInt(month, 10)
    const d = parseInt(day, 10)
    if (!m || !d) return
    onAddReminder(person.id, label, m, d)
    setMonth('')
    setDay('')
    setShowForm(false)
  }

  return (
    <div style={styles.card}>
      <h2 style={styles.personName} onClick={() => onViewPerson(person)}>
        {person.name}{person.last_name ? ` ${person.last_name}` : ''} <span style={{ fontSize: '0.9rem', color: '#888' }}>(view notes)</span>
      </h2>

      {person.reminders?.length > 0 && (
        <ul style={styles.reminderList}>
          {person.reminders.map((r) => (
            <li key={r.id}>
              {r.label}: {r.month}/{r.day}
            </li>
          ))}
        </ul>
      )}

      {!showForm ? (
        <button onClick={() => setShowForm(true)} style={styles.smallButton}>
          + Add important date
        </button>
      ) : (
        <form onSubmit={handleSubmit} style={styles.reminderForm}>
          <select value={label} onChange={(e) => setLabel(e.target.value)} style={styles.select}>
            <option>Birthday</option>
            <option>Anniversary</option>
            <option>Other</option>
          </select>
          <input
            type="number"
            placeholder="Month (1-12)"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            min={1}
            max={12}
            style={styles.smallInput}
          />
          <input
            type="number"
            placeholder="Day (1-31)"
            value={day}
            onChange={(e) => setDay(e.target.value)}
            min={1}
            max={31}
            style={styles.smallInput}
          />
          <button type="submit" style={styles.smallButton}>Save</button>
        </form>
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
  personName: { margin: '0 0 0.5rem 0', fontSize: '1.3rem', color: '#2E2E2E', cursor: 'pointer' },  reminderList: { margin: '0.5rem 0', paddingLeft: '1.25rem', fontSize: '1rem', color: '#444' },
  smallButton: {
    fontSize: '0.95rem',
    padding: '0.4rem 0.9rem',
    borderRadius: '6px',
    border: '1px solid #2E4034',
    backgroundColor: 'transparent',
    color: '#2E4034',
    cursor: 'pointer',
  },
  reminderForm: { display: 'flex', gap: '0.5rem', marginTop: '0.75rem', flexWrap: 'wrap' },
  select: { padding: '0.4rem', borderRadius: '6px', border: '1px solid #CCC' },
  smallInput: { width: '110px', padding: '0.4rem', borderRadius: '6px', border: '1px solid #CCC' },
}