import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { summarize } from '../lib/summarize'
import { GroupChip, EventChip } from '../components/Chips'
import VoiceInputButton from '../components/VoiceInputButton'
import AutoGrowTextarea from '../components/AutoGrowTextarea'

type Note = {
  id: string
  content: string
  created_at: string
  moment_id: string | null
  moments: { id: string; occasion: string | null; raw_description: string } | null
}

type GroupRef = { id: string; name: string }

type Reminder = { id: string; label: string; month: number; day: number }

type PersonRow = { name: string; last_name: string | null; reminders: Reminder[] }

const AFFILIATION_LIMIT = 5

const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]

function formatDate(month: number, day: number) {
  return `${MONTH_NAMES[month - 1] ?? month} ${day}`
}

export default function PersonDetail({
  personId,
  personName,
  onBack,
  backLabel,
  onSelectGroup,
  onSelectEvent,
}: {
  personId: string
  personName: string
  onBack: () => void
  backLabel: string
  onSelectGroup: (group: { id: string; name: string }) => void
  onSelectEvent: (event: { id: string; summary: string }) => void
}) {
  const [notes, setNotes] = useState<Note[]>([])
  const [groups, setGroups] = useState<GroupRef[]>([])
  const [person, setPerson] = useState<PersonRow | null>(null)
  const [loading, setLoading] = useState(true)
  const [newFact, setNewFact] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    loadData()
  }, [personId])

  async function loadData() {
    setLoading(true)

    const [notesRes, groupsRes, personRes] = await Promise.all([
      supabase
        .from('notes')
        .select('id, content, created_at, moment_id, moments(id, occasion, raw_description)')
        .eq('person_id', personId)
        .order('created_at', { ascending: false }),
      supabase.from('person_groups').select('groups(id, name)').eq('person_id', personId),
      supabase.from('people').select('name, last_name, reminders(id, label, month, day)').eq('id', personId).single(),
    ])

    setNotes((notesRes.data as unknown as Note[]) ?? [])

    const groupRows = (groupsRes.data as unknown as { groups: GroupRef | null }[]) ?? []
    setGroups(groupRows.map((r) => r.groups).filter((g): g is GroupRef => g !== null))

    setPerson((personRes.data as unknown as PersonRow) ?? null)

    setLoading(false)
  }

  async function submitFact() {
    if (!newFact.trim()) return
    setSaving(true)

    await supabase.functions.invoke('add-fact', {
      body: { personId, text: newFact.trim() },
    })

    setNewFact('')
    setSaving(false)
    loadData()
  }

  function handleAddFact(e: FormEvent) {
    e.preventDefault()
    submitFact()
  }

  const affiliatedEvents = new Map<string, { id: string; summary: string }>()
  for (const n of notes) {
    if (n.moments) {
      affiliatedEvents.set(n.moments.id, { id: n.moments.id, summary: summarize(n.moments.occasion, n.moments.raw_description) })
    }
  }
  const allEvents = Array.from(affiliatedEvents.values())
  const shownEvents = allEvents.slice(0, AFFILIATION_LIMIT)
  const shownGroups = groups.slice(0, AFFILIATION_LIMIT)

  const fullName = person ? `${person.name}${person.last_name ? ` ${person.last_name}` : ''}` : personName
  const birthday = person?.reminders?.find((r) => r.label === 'Birthday') ?? null
  const anniversary = person?.reminders?.find((r) => r.label === 'Anniversary') ?? null
  const otherDates = person?.reminders?.filter((r) => r.label !== 'Birthday' && r.label !== 'Anniversary') ?? []

  return (
    <div style={styles.page}>
      <button onClick={onBack} style={styles.backButton}>← Back to {backLabel}</button>
      <h1 style={styles.heading}>{fullName}</h1>

      {!loading && (
        <div style={styles.fieldsGrid}>
          <FieldCell label="Last name" value={person?.last_name ?? undefined} />
          <FieldCell label="Birthday" value={birthday ? formatDate(birthday.month, birthday.day) : undefined} />
          <FieldCell label="Anniversary" value={anniversary ? formatDate(anniversary.month, anniversary.day) : undefined} />
          {otherDates.map((r) => (
            <FieldCell key={r.id} label={r.label} value={formatDate(r.month, r.day)} />
          ))}
        </div>
      )}

      {!loading && (groups.length > 0 || allEvents.length > 0) && (
        <div style={styles.affiliations}>
          {shownGroups.length > 0 && (
            <div style={styles.affiliationRow}>
              {shownGroups.map((g) => (
                <GroupChip key={g.id} label={g.name} onClick={() => onSelectGroup(g)} />
              ))}
              {groups.length > AFFILIATION_LIMIT && (
                <span style={styles.moreText}>+{groups.length - AFFILIATION_LIMIT} more</span>
              )}
            </div>
          )}
          {shownEvents.length > 0 && (
            <div style={styles.affiliationRow}>
              {shownEvents.map((e) => (
                <EventChip key={e.id} label={e.summary} onClick={() => onSelectEvent(e)} />
              ))}
              {allEvents.length > AFFILIATION_LIMIT && (
                <span style={styles.moreText}>+{allEvents.length - AFFILIATION_LIMIT} more</span>
              )}
            </div>
          )}
        </div>
      )}

      <form onSubmit={handleAddFact} style={styles.addForm}>
        <AutoGrowTextarea
          value={newFact}
          onChange={setNewFact}
          onEnter={submitFact}
          placeholder={`Add a fact about ${personName}, e.g. "Married to Manuel, they share a house"`}
          style={styles.addInput}
          disabled={saving}
        />
        <VoiceInputButton
          disabled={saving}
          onTranscribed={(text) => setNewFact((prev) => (prev ? `${prev} ${text}` : text))}
        />
        <button type="submit" disabled={saving} style={styles.addButton}>
          {saving ? '…' : 'Add'}
        </button>
      </form>

      {loading && <p>Loading…</p>}

      {!loading && notes.length === 0 && (
        <p style={styles.empty}>Nothing recorded yet — add a moment or a fact about {personName} to see it here.</p>
      )}

      <div style={styles.notesList}>
        {notes.map((note) => (
          <div key={note.id} style={styles.noteCard}>
            <p style={styles.noteContent}>{note.content}</p>
            <p style={styles.noteDate}>
              {new Date(note.created_at).toLocaleDateString(undefined, {
                month: 'long',
                day: 'numeric',
                year: 'numeric',
              })}
            </p>
          </div>
        ))}
      </div>
    </div>
  )
}

// A single read-only labeled field. Shows the value when we have it, or a
// subtle placeholder when it's missing, to prompt adding it via the chat.
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
  backButton: {
    background: 'none',
    border: 'none',
    color: '#2E4034',
    fontSize: '1rem',
    cursor: 'pointer',
    marginBottom: '1rem',
    padding: 0,
  },
  heading: { fontSize: '2rem', color: '#2E4034', marginBottom: '1rem' },
  fieldsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
    gap: '0.6rem',
    marginBottom: '1.5rem',
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
  affiliations: { display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1.5rem' },
  affiliationRow: { display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' },
  moreText: { fontSize: '0.85rem', color: '#999', fontStyle: 'italic' },
  addForm: { display: 'flex', alignItems: 'flex-end', gap: '0.5rem', marginBottom: '2rem' },
  addInput: { flex: 1, fontSize: '1rem', padding: '0.6rem', borderRadius: '8px', border: '1px solid #CCC' },
  addButton: {
    fontSize: '1rem',
    padding: '0.6rem 1.1rem',
    borderRadius: '8px',
    border: 'none',
    backgroundColor: '#2E4034',
    color: '#FFF',
    cursor: 'pointer',
  },
  empty: { color: '#777' },
  notesList: { display: 'flex', flexDirection: 'column', gap: '1rem' },
  noteCard: {
    backgroundColor: '#FFF',
    borderRadius: '10px',
    padding: '1.25rem',
    boxShadow: '0 1px 6px rgba(0,0,0,0.06)',
  },
  noteContent: { margin: '0 0 0.5rem 0', fontSize: '1.05rem', color: '#2E2E2E', lineHeight: 1.5 },
  noteDate: { margin: 0, fontSize: '0.85rem', color: '#999' },
}
