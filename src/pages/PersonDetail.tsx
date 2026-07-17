import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { summarize } from '../lib/summarize'
import { GroupChip, EventChip, PersonChip } from '../components/Chips'
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

type PersonRow = { name: string; last_name: string | null; nicknames: string | null; reminders: Reminder[] }

type KeyFact = {
  category: 'spouse' | 'kids' | 'location' | 'education' | 'other'
  text?: string
  relationshipLabel?: string
  personId?: string
  personName?: string
  noteIds: string[]
}

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
  onSelectPerson,
  onSelectGroup,
  onSelectEvent,
}: {
  personId: string
  personName: string
  onBack: () => void
  backLabel: string
  onSelectPerson: (person: { id: string; name: string }) => void
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
  const [spouseTagMessage, setSpouseTagMessage] = useState<string | null>(null)
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
    refreshFacts()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [personId, loading, notes.length])

  async function refreshFacts() {
    setFactsLoading(true)
    const { data } = await supabase.functions.invoke('person-facts', { body: { personId } })
    setKeyFacts((data?.facts as KeyFact[]) ?? [])
    setFactsLoading(false)
  }

  async function loadData() {
    setLoading(true)

    const [notesRes, groupsRes, personRes] = await Promise.all([
      supabase
        .from('notes')
        .select('id, content, created_at, moment_id, moments(id, occasion, raw_description)')
        .eq('person_id', personId)
        .order('created_at', { ascending: false }),
      supabase.from('person_groups').select('groups(id, name)').eq('person_id', personId),
      supabase.from('people').select('name, last_name, nicknames, reminders(id, label, month, day)').eq('id', personId).single(),
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

  async function handleSaveNicknames(nicknames: string) {
    await supabase.from('people').update({ nicknames: nicknames.trim() || null }).eq('id', personId)
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
    setSpouseTagMessage(null)

    const { data } = await supabase.functions.invoke('add-fact', {
      body: { personId, text: newFact.trim() },
    })

    if (data?.groupTag) setGroupTagMessage(data.groupTag.name)
    if (data?.suggestedGroup) setSuggestedGroup(data.suggestedGroup)
    if (data?.spouseTag) setSpouseTagMessage(data.spouseTag.name)

    setNewFact('')
    setSaving(false)
    loadData()
  }

  function handleAddFact(e: FormEvent) {
    e.preventDefault()
    submitFact()
  }

  // Editing a Key Fact tile edits the underlying note it was drawn from directly, so the
  // correction improves the data everywhere (not just how this one bullet displays) and
  // won't drift back on the next reload, since Key Facts are re-extracted from notes fresh
  // every visit.
  async function handleEditFact(noteId: string, newContent: string) {
    await supabase.from('notes').update({ content: newContent }).eq('id', noteId)
    await loadData()
    refreshFacts()
  }

  // Deleting a Key Fact permanently removes the note(s) it came from — confirmed with the
  // founder this should actually delete the source text (not just hide the bullet), so a bad
  // duplicate/mismatched fact can't resurface on the next reload.
  async function handleDeleteFact(noteIds: string[]) {
    await supabase.from('notes').delete().in('id', noteIds)
    await loadData()
    refreshFacts()
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

  const notesById = new Map<string, Note>()
  for (const n of notes) notesById.set(n.id, n)

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
          <TextFieldCell
            label="Goes by"
            value={person?.nicknames ?? ''}
            placeholder="e.g. Bob, Grandpa Joe"
            onSave={handleSaveNicknames}
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
                <KeyFactItem
                  key={i}
                  fact={f}
                  notesById={notesById}
                  onSelectPerson={onSelectPerson}
                  onSelectEvent={onSelectEvent}
                  onEdit={handleEditFact}
                  onDelete={handleDeleteFact}
                />
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

      <div style={styles.stickyBarWrapper}>
        <div style={styles.stickyBarInner}>
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
        </div>
      </div>

      {groupTagMessage && (
        <p style={styles.groupTagBanner}>✓ Also added {personName} to "{groupTagMessage}".</p>
      )}

      {spouseTagMessage && (
        <p style={styles.groupTagBanner}>✓ Also updated {spouseTagMessage}'s profile to show they're married to {personName}.</p>
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

// One Key Fact bullet. Hovering reveals a pencil + trash badge in the corner (same
// wrapper-plus-corner-badge pattern used for member/suggestion chips elsewhere in the app,
// chosen specifically because it doesn't resize the row on hover and so can't flicker).
// Below the bullet, shows the date it was added plus where it came from: a clickable event
// button if it was tied to a moment, or plain text if it was added directly on this profile.
function KeyFactItem({
  fact,
  notesById,
  onSelectPerson,
  onSelectEvent,
  onEdit,
  onDelete,
}: {
  fact: KeyFact
  notesById: Map<string, Note>
  onSelectPerson: (person: { id: string; name: string }) => void
  onSelectEvent: (event: { id: string; summary: string }) => void
  onEdit: (noteId: string, newContent: string) => void
  onDelete: (noteIds: string[]) => void
}) {
  const [hovered, setHovered] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  const sourceNotes = fact.noteIds.map((id) => notesById.get(id)).filter((n): n is Note => !!n)
  const primaryNote = sourceNotes[0]
  const canEdit = sourceNotes.length === 1
  const canDelete = sourceNotes.length > 0 && sourceNotes.length === fact.noteIds.length

  function startEditing() {
    setDraft(primaryNote?.content ?? '')
    setEditing(true)
  }

  function commitEdit() {
    if (primaryNote && draft.trim()) onEdit(primaryNote.id, draft.trim())
    setEditing(false)
  }

  if (editing) {
    return (
      <li style={styles.keyFactsItemEditing}>
        <form onSubmit={(e) => { e.preventDefault(); commitEdit() }} style={styles.keyFactEditForm}>
          <AutoGrowTextarea value={draft} onChange={setDraft} onEnter={commitEdit} style={styles.keyFactEditInput} />
          <div style={styles.keyFactEditButtonRow}>
            <button type="submit" style={styles.cellSaveButton}>Save</button>
            <button type="button" onClick={() => setEditing(false)} style={styles.keyFactCancelButton}>Cancel</button>
          </div>
        </form>
      </li>
    )
  }

  return (
    <li
      style={styles.keyFactsWrapper}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div style={styles.keyFactsItem}>
        {fact.category === 'spouse' ? (
          <>
            <span>{fact.relationshipLabel}</span>
            {fact.personName && (
              fact.personId ? (
                <PersonChip label={fact.personName} onClick={() => onSelectPerson({ id: fact.personId!, name: fact.personName! })} />
              ) : (
                <span>{fact.personName}.</span>
              )
            )}
          </>
        ) : (
          <span>{fact.text}</span>
        )}
      </div>

      {primaryNote && (
        <div style={styles.keyFactSource}>
          <span style={styles.keyFactSourceDate}>
            {new Date(primaryNote.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
          </span>
          {primaryNote.moments ? (
            <button
              type="button"
              style={styles.keyFactSourceButton}
              onClick={() => onSelectEvent({ id: primaryNote.moments!.id, summary: summarize(primaryNote.moments!.occasion, primaryNote.moments!.raw_description) })}
            >
              Added through: {summarize(primaryNote.moments.occasion, primaryNote.moments.raw_description)}
            </button>
          ) : (
            <span style={styles.keyFactSourceText}>Added through this person's profile</span>
          )}
        </div>
      )}

      {hovered && (canEdit || canDelete) && (
        <div style={styles.keyFactBadgeRow}>
          {canEdit && (
            <button
              onClick={startEditing}
              aria-label="Edit this fact"
              style={styles.keyFactBadge}
            >
              <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" />
              </svg>
            </button>
          )}
          {canDelete && (
            <button
              onClick={() => onDelete(fact.noteIds)}
              aria-label="Delete this fact"
              style={{ ...styles.keyFactBadge, ...styles.keyFactDeleteBadge }}
            >
              <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 6h18" />
                <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                <path d="M10 11v6" />
                <path d="M14 11v6" />
              </svg>
            </button>
          )}
        </div>
      )}
    </li>
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
  placeholder,
  onSave,
}: {
  label: string
  value: string
  placeholder?: string
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
          placeholder={placeholder}
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
  page: { maxWidth: '600px', margin: '0 auto', padding: '2rem 1.5rem 6rem', fontFamily: 'Georgia, serif' },
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
  keyFactsItem: { fontSize: '0.98rem', color: '#2E2E2E', lineHeight: 1.4, display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' },
  keyFactsWrapper: { position: 'relative', display: 'flex', flexDirection: 'column', gap: '0.3rem', paddingRight: '2.6rem' },
  keyFactBadgeRow: { position: 'absolute', top: '-6px', right: '-6px', display: 'flex', gap: '0.3rem' },
  keyFactBadge: {
    width: '20px',
    height: '20px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '50%',
    border: '1px solid #999',
    backgroundColor: '#FFF',
    color: '#555',
    padding: 0,
    cursor: 'pointer',
    boxShadow: '0 1px 3px rgba(0,0,0,0.15)',
  },
  keyFactDeleteBadge: { borderColor: '#B04A3B', color: '#B04A3B' },
  keyFactSource: { display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' },
  keyFactSourceDate: { fontSize: '0.75rem', color: '#999' },
  keyFactSourceText: { fontSize: '0.75rem', color: '#999', fontStyle: 'italic' },
  keyFactSourceButton: {
    fontSize: '0.75rem',
    padding: '0.2rem 0.55rem',
    borderRadius: '5px',
    border: '1px solid #3B6EA5',
    backgroundColor: '#EAF1FA',
    color: '#2C5079',
    cursor: 'pointer',
    fontFamily: 'Georgia, serif',
  },
  keyFactsItemEditing: { display: 'block' },
  keyFactEditForm: { display: 'flex', flexDirection: 'column', gap: '0.4rem' },
  keyFactEditInput: { fontSize: '0.95rem', padding: '0.5rem', borderRadius: '6px', border: '1px solid #CCC' },
  keyFactEditButtonRow: { display: 'flex', gap: '0.5rem' },
  keyFactCancelButton: {
    fontSize: '0.85rem',
    padding: '0.3rem 0.7rem',
    borderRadius: '6px',
    border: '1px solid #999',
    backgroundColor: 'transparent',
    color: '#666',
    cursor: 'pointer',
  },
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
  stickyBarWrapper: {
    position: 'fixed',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#F7F5F2',
    borderTop: '1px solid #E2DFD6',
    boxShadow: '0 -2px 8px rgba(0,0,0,0.06)',
    padding: '0.6rem 0',
    zIndex: 20,
  },
  stickyBarInner: { maxWidth: '600px', margin: '0 auto', padding: '0 1.5rem' },
  addForm: { display: 'flex', alignItems: 'flex-end', gap: '0.5rem' },
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
  groupTagBanner: { fontSize: '0.9rem', color: '#2E4034', marginBottom: '1.5rem' },
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
