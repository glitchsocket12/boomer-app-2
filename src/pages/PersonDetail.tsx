import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { summarize } from '../lib/summarize'
import { GroupChip, EventChip } from '../components/Chips'
import VoiceInputButton from '../components/VoiceInputButton'
import AutoGrowTextarea from '../components/AutoGrowTextarea'
import PhotoGallery from '../components/PhotoGallery'

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

type KeyFact = { category: 'spouse' | 'kids' | 'location' | 'education' | 'other'; text: string }

const AFFILIATION_LIMIT = 5

const NUDGE_CATEGORIES: { category: 'spouse' | 'kids' | 'location' | 'education'; question: (name: string) => string }[] = [
  { category: 'spouse', question: (name) => `Is ${name} married? If so, what's their spouse's name?` },
  { category: 'kids', question: (name) => `Does ${name} have kids? What are their names?` },
  { category: 'location', question: (name) => `Where does ${name} live?` },
  { category: 'education', question: (name) => `Where did ${name} go to school?` },
]

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
  const [groupTagMessage, setGroupTagMessage] = useState<string | null>(null)
  const [suggestedGroup, setSuggestedGroup] = useState<string | null>(null)
  const [keyFacts, setKeyFacts] = useState<KeyFact[]>([])
  const [factsLoading, setFactsLoading] = useState(true)

  useEffect(() => {
    loadData()
  }, [personId])

  useEffect(() => {
    if (loading) return
    if (notes.length === 0) {
      setKeyFacts([])
      setFactsLoading(false)
      return
    }
    setFactsLoading(true)
    supabase.functions
      .invoke('person-facts', { body: { personId } })
      .then(({ data }) => setKeyFacts((data?.facts as KeyFact[]) ?? []))
      .finally(() => setFactsLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [personId, loading, notes.length])

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

  async function handleSaveLastName(lastName: string) {
    await supabase.from('people').update({ last_name: lastName.trim() || null }).eq('id', personId)
    loadData()
  }

  async function handleSaveDateField(reminderId: string | null, label: string, month: number, day: number) {
    if (reminderId) {
      await supabase.from('reminders').update({ month, day }).eq('id', reminderId)
    } else {
      await supabase.from('reminders').insert({ person_id: personId, label, month, day })
    }
    loadData()
  }

  async function submitFact() {
    if (!newFact.trim()) return
    setSaving(true)
    setGroupTagMessage(null)
    setSuggestedGroup(null)

    const { data } = await supabase.functions.invoke('add-fact', {
      body: { personId, text: newFact.trim() },
    })

    if (data?.groupTag) setGroupTagMessage(data.groupTag.name)
    if (data?.suggestedGroup) setSuggestedGroup(data.suggestedGroup)

    setNewFact('')
    setSaving(false)
    loadData()
  }

  function handleAddFact(e: FormEvent) {
    e.preventDefault()
    submitFact()
  }

  async function confirmSuggestedGroup() {
    if (!suggestedGroup) return
    const groupName = suggestedGroup
    setSuggestedGroup(null)

    const {
      data: { user },
    } = await supabase.auth.getUser()
    const { data: existingGroups } = await supabase.from('groups').select('id, name')
    const match = (existingGroups ?? []).find((g) => g.name.toLowerCase() === groupName.toLowerCase())

    let groupId = match?.id ?? null
    if (!groupId) {
      const { data: newGroup } = await supabase
        .from('groups')
        .insert({ user_id: user?.id, name: groupName })
        .select()
        .single()
      groupId = newGroup?.id ?? null
    }
    if (groupId) {
      await supabase
        .from('person_groups')
        .upsert({ person_id: personId, group_id: groupId }, { onConflict: 'person_id,group_id', ignoreDuplicates: true })
      setGroupTagMessage(match?.name ?? groupName)
      loadData()
    }
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
  const missingFactCategories = NUDGE_CATEGORIES.filter((c) => !keyFacts.some((f) => f.category === c.category))
  const showNudge = notes.length === 0 || missingFactCategories.length > 0
  const otherDates = person?.reminders?.filter((r) => r.label !== 'Birthday' && r.label !== 'Anniversary') ?? []

  return (
    <div style={styles.page}>
      <button onClick={onBack} style={styles.backButton}>← Back to {backLabel}</button>
      <h1 style={styles.heading}>{fullName}</h1>

      {!loading && (
        <div style={styles.fieldsGrid}>
          <TextFieldCell
            label="Last name"
            value={person?.last_name ?? ''}
            onSave={handleSaveLastName}
          />
          <DateFieldCell
            label="Birthday"
            reminder={birthday}
            onSave={(month, day) => handleSaveDateField(birthday?.id ?? null, 'Birthday', month, day)}
          />
          <DateFieldCell
            label="Anniversary"
            reminder={anniversary}
            onSave={(month, day) => handleSaveDateField(anniversary?.id ?? null, 'Anniversary', month, day)}
          />
          {otherDates.map((r) => (
            <FieldCell key={r.id} label={r.label} value={formatDate(r.month, r.day)} />
          ))}
        </div>
      )}

      {!loading && (factsLoading || keyFacts.length > 0) && (
        <div style={styles.keyFacts}>
          <span style={styles.keyFactsHeading}>Key facts</span>
          {factsLoading ? (
            <p style={styles.keyFactsLoading}>Gathering what we know…</p>
          ) : (
            <ul style={styles.keyFactsList}>
              {keyFacts.map((f, i) => (
                <li key={i} style={styles.keyFactsItem}>{f.text}</li>
              ))}
            </ul>
          )}
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

      <PhotoGallery />

      {!loading && !factsLoading && showNudge && (
        <div style={styles.nudgeBox}>
          <span style={styles.nudgeHeading}>Help us get to know {personName} better</span>
          <ul style={styles.nudgeList}>
            {notes.length === 0 ? (
              <li style={styles.nudgeItem}>Tell us a memory about {personName} to get started.</li>
            ) : (
              missingFactCategories.map((c) => (
                <li key={c.category} style={styles.nudgeItem}>{c.question(personName)}</li>
              ))
            )}
          </ul>
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

      {groupTagMessage && (
        <p style={styles.groupTagBanner}>✓ Also added {personName} to "{groupTagMessage}".</p>
      )}

      {suggestedGroup && (
        <div style={styles.suggestBanner}>
          <span>It sounds like {personName} might belong to a group called "{suggestedGroup}". Add them?</span>
          <div style={styles.suggestButtonRow}>
            <button type="button" onClick={confirmSuggestedGroup} style={styles.suggestYesButton}>
              Yes, add
            </button>
            <button type="button" onClick={() => setSuggestedGroup(null)} style={styles.suggestNoButton}>
              No thanks
            </button>
          </div>
        </div>
      )}

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

// A single read-only labeled field, for dates that aren't Birthday/Anniversary.
// Shows the value we have; these come from the chat, not a click-to-edit form.
function FieldCell({ label, value }: { label: string; value?: string }) {
  return (
    <div style={styles.cell}>
      <span style={styles.cellLabel}>{label}</span>
      <span style={value ? styles.cellValue : styles.cellValueEmpty}>{value || 'not on file'}</span>
    </div>
  )
}

// A labeled text field (last name). Click the value — including the
// "not on file" placeholder — to type in the correct info directly.
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
      <span style={value ? styles.cellValue : styles.cellValueEmpty}>{value || 'not on file'}</span>
    </button>
  )
}

// A labeled date field (birthday/anniversary). Click to add or edit the
// month/day directly, without needing the chat.
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
          <button type="submit" style={styles.cellSaveButton}>Save</button>
        </div>
      </form>
    )
  }

  return (
    <button type="button" onClick={startEditing} style={styles.cellButton}>
      <span style={styles.cellLabel}>{label}</span>
      <span style={reminder ? styles.cellValue : styles.cellValueEmpty}>
        {reminder ? formatDate(reminder.month, reminder.day) : 'not on file'}
      </span>
    </button>
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
  cellInput: { fontSize: '1rem', padding: '0.2rem', borderRadius: '4px', border: '1px solid #CCC' },
  cellDateInput: { width: '55px', fontSize: '0.95rem', padding: '0.2rem', borderRadius: '4px', border: '1px solid #CCC' },
  cellSaveButton: {
    fontSize: '0.85rem',
    padding: '0.3rem 0.7rem',
    borderRadius: '6px',
    border: '1px solid #2E4034',
    backgroundColor: 'transparent',
    color: '#2E4034',
    cursor: 'pointer',
  },
  keyFacts: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.4rem',
    backgroundColor: '#F4F6F3',
    border: '1px solid #DDE3D8',
    borderRadius: '10px',
    padding: '0.85rem 1rem',
    marginBottom: '1.5rem',
  },
  keyFactsHeading: { fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.04em', color: '#6B7A6E', fontWeight: 700 },
  keyFactsLoading: { margin: 0, fontSize: '0.9rem', color: '#999', fontStyle: 'italic' },
  keyFactsList: { margin: 0, paddingLeft: '1.2rem', display: 'flex', flexDirection: 'column', gap: '0.3rem' },
  keyFactsItem: { fontSize: '0.98rem', color: '#2E2E2E', lineHeight: 1.4 },
  nudgeBox: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem',
    backgroundColor: '#FAFAF8',
    border: '1px dashed #C7C7BE',
    borderRadius: '10px',
    padding: '0.85rem 1rem',
    marginBottom: '1rem',
  },
  nudgeHeading: { fontSize: '0.9rem', color: '#5A5A52', fontStyle: 'italic' },
  nudgeList: { margin: 0, paddingLeft: '1.2rem', display: 'flex', flexDirection: 'column', gap: '0.25rem' },
  nudgeItem: { fontSize: '0.9rem', color: '#7A7A70' },
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
  groupTagBanner: { fontSize: '0.9rem', color: '#2E4034', marginTop: '-1rem', marginBottom: '1.5rem' },
  suggestBanner: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.6rem',
    fontSize: '0.9rem',
    color: '#5A4A20',
    backgroundColor: '#FBF3E0',
    border: '1px solid #E6D6AC',
    borderRadius: '10px',
    padding: '0.85rem 1rem',
    marginTop: '-1rem',
    marginBottom: '1.5rem',
  },
  suggestButtonRow: { display: 'flex', gap: '0.5rem' },
  suggestYesButton: {
    fontSize: '0.85rem',
    padding: '0.4rem 0.85rem',
    borderRadius: '6px',
    border: 'none',
    backgroundColor: '#2E4034',
    color: '#FFF',
    cursor: 'pointer',
  },
  suggestNoButton: {
    fontSize: '0.85rem',
    padding: '0.4rem 0.85rem',
    borderRadius: '6px',
    border: '1px solid #B08B2E',
    backgroundColor: 'transparent',
    color: '#8A6A1F',
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
