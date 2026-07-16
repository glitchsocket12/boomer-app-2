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

const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]

function formatDate(month: number, day: number) {
  return `${MONTH_NAMES[month - 1] ?? month} ${day}`
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
          <PersonCard key={person.id} person={person} onViewPerson={onSelectPerson} />
        ))}
      </div>
    </div>
  )
}

// One standardized tile per person: full name, then the same three
// labeled fields for everyone (last name, birthday, anniversary) so it's
// obvious at a glance what info is on file and what's still missing.
// Adding or correcting info happens through the chat, not on this page.
function PersonCard({
  person,
  onViewPerson,
}: {
  person: Person
  onViewPerson: (person: { id: string; name: string }) => void
}) {
  const birthday = person.reminders?.find((r) => r.label === 'Birthday') ?? null
  const anniversary = person.reminders?.find((r) => r.label === 'Anniversary') ?? null
  const otherDates = person.reminders?.filter((r) => r.label !== 'Birthday' && r.label !== 'Anniversary') ?? []

  const fullName = `${person.name}${person.last_name ? ` ${person.last_name}` : ''}`

  return (
    <div style={styles.card} onClick={() => onViewPerson(person)}>
      <h2 style={styles.personName}>
        {fullName} <span style={{ fontSize: '0.9rem', color: '#888' }}>(view notes)</span>
      </h2>

      <div style={styles.fieldsGrid}>
        <FieldCell label="Last name" value={person.last_name ?? undefined} />
        <FieldCell label="Birthday" value={birthday ? formatDate(birthday.month, birthday.day) : undefined} />
        <FieldCell label="Anniversary" value={anniversary ? formatDate(anniversary.month, anniversary.day) : undefined} />
        {otherDates.map((r) => (
          <FieldCell key={r.id} label={r.label} value={formatDate(r.month, r.day)} />
        ))}
      </div>
    </div>
  )
}

// A single read-only labeled cell. Shows the value when we have it, or a
// subtle placeholder when it's missing, so every tile has the same shape.
function FieldCell({ label, value }: { label: string; value?: string }) {
  return (
    <div style={styles.cell}>
      <span style={styles.cellLabel}>{label}</span>
      <span style={value ? styles.cellValue : styles.cellValueEmpty}>{value || 'not on file'}</span>
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
    cursor: 'pointer',
  },
  personName: { margin: '0 0 0.75rem 0', fontSize: '1.3rem', color: '#2E2E2E' },
  fieldsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
    gap: '0.6rem',
  },
  cell: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.25rem',
    padding: '0.5rem 0.65rem',
    borderRadius: '8px',
    border: '1px solid #E3E3E3',
    backgroundColor: '#FAFAF8',
  },
  cellLabel: {
    fontSize: '0.7rem',
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
    color: '#999',
  },
  cellValue: { fontSize: '1rem', color: '#2E2E2E' },
  cellValueEmpty: { fontSize: '0.95rem', color: '#B8B8B0', fontStyle: 'italic' },
}
