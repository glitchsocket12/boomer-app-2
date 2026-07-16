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

  async function handleSaveLastName(personId: string, lastName: string) {
    await supabase.from('people').update({ last_name: lastName.trim() || null }).eq('id', personId)
    loadPeople()
  }

  // Saves the single Birthday/Anniversary date for a person: updates the
  // existing reminder if one exists, otherwise inserts a new one.
  async function handleSaveDateField(personId: string, reminderId: string | null, label: string, month: number, day: number) {
    if (reminderId) {
      await supabase.from('reminders').update({ month, day }).eq('id', reminderId)
    } else {
      await supabase.from('reminders').insert({ person_id: personId, label, month, day })
    }
    loadPeople()
  }

  async function handleAddOtherDate(personId: string, label: string, month: number, day: number) {
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
          <PersonCard
            key={person.id}
            person={person}
            onSaveLastName={handleSaveLastName}
            onSaveDateField={handleSaveDateField}
            onAddOtherDate={handleAddOtherDate}
            onViewPerson={onSelectPerson}
          />
        ))}
      </div>
    </div>
  )
}

// One card per person: shows their full name, a set of labeled fields
// (last name, birthday, anniversary) that make it obvious what's still
// missing, any other important dates, and a way to add more.
function PersonCard({
  person,
  onSaveLastName,
  onSaveDateField,
  onAddOtherDate,
  onViewPerson,
}: {
  person: Person
  onSaveLastName: (personId: string, lastName: string) => void
  onSaveDateField: (personId: string, reminderId: string | null, label: string, month: number, day: number) => void
  onAddOtherDate: (personId: string, label: string, month: number, day: number) => void
  onViewPerson: (person: { id: string; name: string }) => void
}) {
  const birthday = person.reminders?.find((r) => r.label === 'Birthday') ?? null
  const anniversary = person.reminders?.find((r) => r.label === 'Anniversary') ?? null
  const otherDates = person.reminders?.filter((r) => r.label !== 'Birthday' && r.label !== 'Anniversary') ?? []

  const fullName = `${person.name}${person.last_name ? ` ${person.last_name}` : ''}`

  return (
    <div style={styles.card}>
      <h2 style={styles.personName} onClick={() => onViewPerson(person)}>
        {fullName} <span style={{ fontSize: '0.9rem', color: '#888' }}>(view notes)</span>
      </h2>

      <div style={styles.fieldsGrid}>
        <TextFieldCell
          label="Last name"
          value={person.last_name ?? ''}
          onSave={(value) => onSaveLastName(person.id, value)}
        />
        <DateFieldCell
          label="Birthday"
          reminder={birthday}
          onSave={(month, day) => onSaveDateField(person.id, birthday?.id ?? null, 'Birthday', month, day)}
        />
        <DateFieldCell
          label="Anniversary"
          reminder={anniversary}
          onSave={(month, day) => onSaveDateField(person.id, anniversary?.id ?? null, 'Anniversary', month, day)}
        />
      </div>

      {otherDates.length > 0 && (
        <ul style={styles.reminderList}>
          {otherDates.map((r) => (
            <li key={r.id}>
              {r.label}: {formatDate(r.month, r.day)}
            </li>
          ))}
        </ul>
      )}

      <AddOtherDateForm personId={person.id} onAdd={onAddOtherDate} />
    </div>
  )
}

// A labeled text field (e.g. last name). Shows the value when set, or a
// subtle placeholder prompting the user to add it. Click to edit.
function TextFieldCell({
  label,
  value,
  onSave,
}: {
  label: string
  value: string
  onSave: (value: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)

  function startEditing() {
    setDraft(value)
    setEditing(true)
  }

  function save(e: FormEvent) {
    e.preventDefault()
    onSave(draft.trim())
    setEditing(false)
  }

  if (editing) {
    return (
      <form onSubmit={save} style={styles.cell}>
        <span style={styles.cellLabel}>{label}</span>
        <input
          autoFocus
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={save}
          style={styles.cellInput}
        />
      </form>
    )
  }

  return (
    <button type="button" onClick={startEditing} style={styles.cellButton}>
      <span style={styles.cellLabel}>{label}</span>
      <span style={value ? styles.cellValue : styles.cellValueEmpty}>{value || 'not added'}</span>
    </button>
  )
}

// A labeled date field (birthday/anniversary). Shows the date when set, or
// a subtle "not added" placeholder. Click to add or edit the date.
function DateFieldCell({
  label,
  reminder,
  onSave,
}: {
  label: string
  reminder: Reminder | null
  onSave: (month: number, day: number) => void
}) {
  const [editing, setEditing] = useState(false)
  const [month, setMonth] = useState(reminder ? String(reminder.month) : '')
  const [day, setDay] = useState(reminder ? String(reminder.day) : '')

  function startEditing() {
    setMonth(reminder ? String(reminder.month) : '')
    setDay(reminder ? String(reminder.day) : '')
    setEditing(true)
  }

  function save(e: FormEvent) {
    e.preventDefault()
    const m = parseInt(month, 10)
    const d = parseInt(day, 10)
    if (!m || !d) return
    onSave(m, d)
    setEditing(false)
  }

  if (editing) {
    return (
      <form onSubmit={save} style={styles.cell}>
        <span style={styles.cellLabel}>{label}</span>
        <div style={{ display: 'flex', gap: '0.35rem' }}>
          <input
            autoFocus
            type="number"
            placeholder="Mo"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            min={1}
            max={12}
            style={styles.cellDateInput}
          />
          <input
            type="number"
            placeholder="Day"
            value={day}
            onChange={(e) => setDay(e.target.value)}
            min={1}
            max={31}
            style={styles.cellDateInput}
          />
          <button type="submit" style={styles.smallButton}>Save</button>
        </div>
      </form>
    )
  }

  return (
    <button type="button" onClick={startEditing} style={styles.cellButton}>
      <span style={styles.cellLabel}>{label}</span>
      <span style={reminder ? styles.cellValue : styles.cellValueEmpty}>
        {reminder ? formatDate(reminder.month, reminder.day) : 'not added'}
      </span>
    </button>
  )
}

// Form for adding any other important date beyond birthday/anniversary
// (e.g. "Graduation", "Move-in day").
function AddOtherDateForm({
  personId,
  onAdd,
}: {
  personId: string
  onAdd: (personId: string, label: string, month: number, day: number) => void
}) {
  const [showForm, setShowForm] = useState(false)
  const [label, setLabel] = useState('')
  const [month, setMonth] = useState('')
  const [day, setDay] = useState('')

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const m = parseInt(month, 10)
    const d = parseInt(day, 10)
    if (!label.trim() || !m || !d) return
    onAdd(personId, label.trim(), m, d)
    setLabel('')
    setMonth('')
    setDay('')
    setShowForm(false)
  }

  if (!showForm) {
    return (
      <button onClick={() => setShowForm(true)} style={styles.smallButton}>
        + Add another important date
      </button>
    )
  }

  return (
    <form onSubmit={handleSubmit} style={styles.reminderForm}>
      <input
        type="text"
        placeholder="What's the date? (e.g. Graduation)"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        style={styles.labelInput}
      />
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
  personName: { margin: '0 0 0.75rem 0', fontSize: '1.3rem', color: '#2E2E2E', cursor: 'pointer' },
  fieldsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
    gap: '0.6rem',
    marginBottom: '0.75rem',
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
  cellButton: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.25rem',
    padding: '0.5rem 0.65rem',
    borderRadius: '8px',
    border: '1px solid #E3E3E3',
    backgroundColor: '#FAFAF8',
    textAlign: 'left',
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  cellLabel: {
    fontSize: '0.7rem',
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
    color: '#999',
  },
  cellValue: { fontSize: '1rem', color: '#2E2E2E' },
  cellValueEmpty: { fontSize: '0.95rem', color: '#B8B8B0', fontStyle: 'italic' },
  cellInput: { fontSize: '1rem', padding: '0.2rem', borderRadius: '4px', border: '1px solid #CCC' },
  cellDateInput: { width: '55px', fontSize: '0.95rem', padding: '0.2rem', borderRadius: '4px', border: '1px solid #CCC' },
  reminderList: { margin: '0 0 0.75rem 0', paddingLeft: '1.25rem', fontSize: '1rem', color: '#444' },
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
  labelInput: { flex: '1 1 160px', padding: '0.4rem', borderRadius: '6px', border: '1px solid #CCC', fontSize: '0.95rem' },
  smallInput: { width: '110px', padding: '0.4rem', borderRadius: '6px', border: '1px solid #CCC' },
}
