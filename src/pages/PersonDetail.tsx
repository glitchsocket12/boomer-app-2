import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { summarize } from '../lib/summarize'
import { GroupChip, EventChip, PersonChip } from '../components/Chips'
import VoiceInputButton from '../components/VoiceInputButton'
import AutoGrowTextarea from '../components/AutoGrowTextarea'
import PhotoGallery from '../components/PhotoGallery'
import RefreshButton from '../components/RefreshButton'

type Note = {
  id: string
  content: string
  created_at: string
  moment_id: string | null
  moments: { id: string; occasion: string | null; raw_description: string } | null
}

type GroupRef = { id: string; name: string }

type PersonRow = { name: string; last_name: string | null }

type LinkedPerson = { name: string; personId?: string }

type KeyFact = {
  category: 'spouse' | 'siblings' | 'parents' | 'kids' | 'location' | 'education' | 'other'
  text?: string
  relationshipLabel?: string
  people?: LinkedPerson[]
}

type RelationshipSuggestion = { parentId: string; parentName: string; childId: string; childName: string }

const AFFILIATION_LIMIT = 5

const NUDGE_CATEGORIES: { category: 'spouse' | 'kids' | 'location' | 'education'; question: (name: string) => string }[] = [
  { category: 'spouse', question: (name) => `Is ${name} married? If so, what's their spouse's name?` },
  { category: 'kids', question: (name) => `Does ${name} have kids? What are their names?` },
  { category: 'location', question: (name) => `Where does ${name} live?` },
  { category: 'education', question: (name) => `Where did ${name} go to school?` },
]

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
  const [familyTagMessage, setFamilyTagMessage] = useState<string | null>(null)
  const [relationshipSuggestions, setRelationshipSuggestions] = useState<RelationshipSuggestion[]>([])
  const [keyFacts, setKeyFacts] = useState<KeyFact[]>([])
  const [factsLoading, setFactsLoading] = useState(true)
  const [notesOpen, setNotesOpen] = useState(true)

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
    // Plain visits serve the DB-cached facts (no AI call); regeneration only happens via
    // the explicit refresh icon or after the notes actually change.
    loadFacts(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [personId, loading])

  async function loadFacts(refresh: boolean) {
    setFactsLoading(true)
    const { data } = await supabase.functions.invoke('person-facts', { body: { personId, refresh } })
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
      supabase.from('people').select('name, last_name').eq('id', personId).single(),
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
    setGroupTagMessage(null)
    setSuggestedGroup(null)
    setFamilyTagMessage(null)

    const { data } = await supabase.functions.invoke('add-fact', {
      body: { personId, text: newFact.trim() },
    })

    if (data?.groupTag) setGroupTagMessage(data.groupTag.name)
    if (data?.suggestedGroup) setSuggestedGroup(data.suggestedGroup)
    if (data?.familyTags?.length > 0) {
      const names: string[] = data.familyTags.map((t: { name: string }) => t.name)
      const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0]
      setFamilyTagMessage(`${list}'s profile${names.length > 1 ? 's have' : ' has'} been updated to reflect this relationship.`)
    }
    if (data?.relationshipSuggestions?.length > 0) {
      setRelationshipSuggestions(data.relationshipSuggestions)
    }

    setNewFact('')
    setSaving(false)
    loadData()
    loadFacts(true)
  }

  function handleAddFact(e: FormEvent) {
    e.preventDefault()
    submitFact()
  }

  // Editing a note directly improves the data everywhere it's used (not just this one card),
  // and Key Facts — which are re-extracted from notes fresh every visit — pick up the
  // correction automatically rather than drifting back on the next reload.
  async function handleEditNote(noteId: string, newContent: string) {
    await supabase.from('notes').update({ content: newContent }).eq('id', noteId)
    await loadData()
    loadFacts(true)
  }

  async function handleDeleteNote(noteId: string) {
    await supabase.from('notes').delete().eq('id', noteId)
    await loadData()
    loadFacts(true)
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

  // Confirming a relationship suggestion writes exactly what add-fact would have written had
  // the founder typed it directly — same deterministic reciprocal-note phrasing, just two notes
  // this time (parent and child sides) since neither profile has the original fact in their own
  // words yet. This is the ONLY place an inferred relationship ever gets saved; declining just
  // clears the banner and writes nothing.
  async function confirmRelationshipSuggestion(s: RelationshipSuggestion) {
    setRelationshipSuggestions((prev) => prev.filter((x) => x !== s))
    await supabase.from('notes').insert([
      { person_id: s.parentId, moment_id: null, content: `Their child is ${s.childName}.` },
      { person_id: s.childId, moment_id: null, content: `Their parent is ${s.parentName}.` },
    ])
    if (s.parentId === personId || s.childId === personId) {
      await loadData()
      loadFacts(true)
    }
  }

  function dismissRelationshipSuggestion(s: RelationshipSuggestion) {
    setRelationshipSuggestions((prev) => prev.filter((x) => x !== s))
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
  const missingFactCategories = NUDGE_CATEGORIES.filter((c) => !keyFacts.some((f) => f.category === c.category))
  const showNudge = notes.length === 0 || missingFactCategories.length > 0

  return (
    <div style={styles.page}>
      <button onClick={onBack} style={styles.backButton}>← Back to {backLabel}</button>
      <h1 style={styles.heading}>{fullName}</h1>

      {!loading && (factsLoading || keyFacts.length > 0) && (
        <div style={styles.keyFacts}>
          <span style={styles.keyFactsHeadingRow}>
            <span style={styles.keyFactsHeading}>Key facts</span>
            <RefreshButton label="Refresh key facts" refreshing={factsLoading} onClick={() => loadFacts(true)} />
          </span>
          {factsLoading ? (
            <p style={styles.keyFactsLoading}>Gathering what we know…</p>
          ) : (
            <ul style={styles.keyFactsList}>
              {keyFacts.map((f, i) => (
                <KeyFactItem key={i} fact={f} onSelectPerson={onSelectPerson} />
              ))}
            </ul>
          )}
        </div>
      )}

      {!loading && shownGroups.length > 0 && (
        <>
          <h2 style={styles.subheading}>Associated Groups</h2>
          <div style={styles.chipRow}>
            {shownGroups.map((g) => (
              <GroupChip key={g.id} label={g.name} onClick={() => onSelectGroup(g)} />
            ))}
            {groups.length > AFFILIATION_LIMIT && (
              <span style={styles.moreText}>+{groups.length - AFFILIATION_LIMIT} more</span>
            )}
          </div>
        </>
      )}

      {!loading && shownEvents.length > 0 && (
        <>
          <h2 style={styles.subheading}>Associated Events</h2>
          <div style={styles.chipRow}>
            {shownEvents.map((e) => (
              <EventChip key={e.id} label={e.summary} onClick={() => onSelectEvent(e)} />
            ))}
            {allEvents.length > AFFILIATION_LIMIT && (
              <span style={styles.moreText}>+{allEvents.length - AFFILIATION_LIMIT} more</span>
            )}
          </div>
        </>
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

      {familyTagMessage && (
        <p style={styles.groupTagBanner}>✓ {familyTagMessage}</p>
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

      {relationshipSuggestions.map((s) => (
        <div key={`${s.parentId}:${s.childId}`} style={styles.suggestBanner}>
          <span>It looks like {s.parentName} might also be {s.childName}'s parent. Add this?</span>
          <div style={styles.suggestButtonRow}>
            <button type="button" onClick={() => confirmRelationshipSuggestion(s)} style={styles.suggestYesButton}>
              Yes, add
            </button>
            <button type="button" onClick={() => dismissRelationshipSuggestion(s)} style={styles.suggestNoButton}>
              No thanks
            </button>
          </div>
        </div>
      ))}

      {loading && <p>Loading…</p>}

      {!loading && notes.length === 0 && (
        <p style={styles.empty}>Nothing recorded yet — add a moment or a fact about {personName} to see it here.</p>
      )}

      {notes.length > 0 && (
        <>
          <div style={styles.notesHeaderRow}>
            <h2 style={styles.subheading}>Notes</h2>
            <button type="button" onClick={() => setNotesOpen((o) => !o)} style={styles.notesToggle}>
              {notesOpen ? '▾ Hide notes' : '▸ Show notes'}
            </button>
          </div>
          {notesOpen && (
            <div style={styles.notesList}>
              {notes.map((note) => (
                <NoteCard
                  key={note.id}
                  note={note}
                  onSelectEvent={onSelectEvent}
                  onEdit={handleEditNote}
                  onDelete={handleDeleteNote}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

// One Key Fact bullet — purely presentational. Editing/deleting the underlying text, and seeing
// where it came from, now happens on the note itself in the Notes section below (see NoteCard),
// since a fact can be derived from more than one note and "edit this bullet" was ambiguous there.
function KeyFactItem({
  fact,
  onSelectPerson,
}: {
  fact: KeyFact
  onSelectPerson: (person: { id: string; name: string }) => void
}) {
  return (
    <li style={styles.keyFactsItem}>
      {fact.people && fact.people.length > 0 ? (
        <>
          <span>{fact.relationshipLabel}</span>
          {fact.people.map((p, i) =>
            p.personId ? (
              <PersonChip key={i} label={p.name} onClick={() => onSelectPerson({ id: p.personId!, name: p.name })} />
            ) : (
              <span key={i}>{p.name}</span>
            )
          )}
        </>
      ) : (
        <span>{fact.text}</span>
      )}
    </li>
  )
}

// One note card. Hovering reveals a pencil + trash badge in the corner (same
// wrapper-plus-corner-badge pattern used for member/suggestion chips elsewhere in the app,
// chosen specifically because it doesn't resize the card on hover and so can't flicker).
// Shows the date it was added plus, if it came from a tagged event, a clickable link to it.
function NoteCard({
  note,
  onSelectEvent,
  onEdit,
  onDelete,
}: {
  note: Note
  onSelectEvent: (event: { id: string; summary: string }) => void
  onEdit: (noteId: string, newContent: string) => void
  onDelete: (noteId: string) => void
}) {
  const [hovered, setHovered] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  function startEditing() {
    setDraft(note.content)
    setEditing(true)
  }

  function commitEdit() {
    if (draft.trim()) onEdit(note.id, draft.trim())
    setEditing(false)
  }

  if (editing) {
    return (
      <div style={styles.noteCard}>
        <form onSubmit={(e) => { e.preventDefault(); commitEdit() }} style={styles.noteEditForm}>
          <AutoGrowTextarea value={draft} onChange={setDraft} onEnter={commitEdit} style={styles.noteEditInput} />
          <div style={styles.noteEditButtonRow}>
            <button type="submit" style={styles.noteSaveButton}>Save</button>
            <button type="button" onClick={() => setEditing(false)} style={styles.noteCancelButton}>Cancel</button>
          </div>
        </form>
      </div>
    )
  }

  return (
    <div
      style={styles.noteCardWrapper}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div style={styles.noteCard}>
        <p style={styles.noteContent}>{note.content}</p>
        <div style={styles.noteMetaRow}>
          <span style={styles.noteDate}>
            {new Date(note.created_at).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}
          </span>
          {note.moments && (
            <button
              type="button"
              style={styles.noteSourceButton}
              onClick={() => onSelectEvent({ id: note.moments!.id, summary: summarize(note.moments!.occasion, note.moments!.raw_description) })}
            >
              Added through: {summarize(note.moments.occasion, note.moments.raw_description)}
            </button>
          )}
        </div>
      </div>

      {hovered && (
        <div style={styles.noteBadgeRow}>
          <button onClick={startEditing} aria-label="Edit this note" style={styles.noteBadge}>
            <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" />
            </svg>
          </button>
          <button onClick={() => onDelete(note.id)} aria-label="Delete this note" style={{ ...styles.noteBadge, ...styles.noteDeleteBadge }}>
            <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 6h18" />
              <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
              <path d="M10 11v6" />
              <path d="M14 11v6" />
            </svg>
          </button>
        </div>
      )}
    </div>
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
  keyFactsHeadingRow: { display: 'flex', alignItems: 'center', gap: '0.5rem' },
  keyFactsHeading: { fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.04em', color: '#6B7A6E', fontWeight: 700 },
  keyFactsLoading: { margin: 0, fontSize: '0.9rem', color: '#999', fontStyle: 'italic' },
  keyFactsList: { margin: 0, paddingLeft: '1.2rem', display: 'flex', flexDirection: 'column', gap: '0.3rem' },
  keyFactsItem: { fontSize: '0.98rem', color: '#2E2E2E', lineHeight: 1.4, display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' },
  subheading: { fontSize: '1.2rem', color: '#2E4034', margin: '1.5rem 0 0.5rem 0' },
  chipRow: { display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '0.5rem' },
  moreText: { fontSize: '0.85rem', color: '#999', fontStyle: 'italic' },
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
  notesHeaderRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem' },
  notesToggle: {
    fontSize: '0.85rem',
    background: 'none',
    border: 'none',
    color: '#2E4034',
    cursor: 'pointer',
    padding: 0,
    fontFamily: 'Georgia, serif',
    whiteSpace: 'nowrap',
  },
  notesList: { display: 'flex', flexDirection: 'column', gap: '1rem' },
  noteCardWrapper: { position: 'relative' },
  noteCard: {
    backgroundColor: '#FFF',
    borderRadius: '10px',
    padding: '1.25rem',
    boxShadow: '0 1px 6px rgba(0,0,0,0.06)',
  },
  noteContent: { margin: '0 0 0.5rem 0', fontSize: '1.05rem', color: '#2E2E2E', lineHeight: 1.5 },
  noteMetaRow: { display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' },
  noteDate: { fontSize: '0.85rem', color: '#999' },
  noteSourceButton: {
    fontSize: '0.75rem',
    padding: '0.2rem 0.55rem',
    borderRadius: '5px',
    border: '1px solid #3B6EA5',
    backgroundColor: '#EAF1FA',
    color: '#2C5079',
    cursor: 'pointer',
    fontFamily: 'Georgia, serif',
  },
  noteBadgeRow: { position: 'absolute', top: '-6px', right: '-6px', display: 'flex', gap: '0.3rem' },
  noteBadge: {
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
  noteDeleteBadge: { borderColor: '#B04A3B', color: '#B04A3B' },
  noteEditForm: { display: 'flex', flexDirection: 'column', gap: '0.4rem' },
  noteEditInput: { fontSize: '0.95rem', padding: '0.5rem', borderRadius: '6px', border: '1px solid #CCC' },
  noteEditButtonRow: { display: 'flex', gap: '0.5rem' },
  noteSaveButton: {
    fontSize: '0.85rem',
    padding: '0.3rem 0.7rem',
    borderRadius: '6px',
    border: '1px solid #2E4034',
    backgroundColor: 'transparent',
    color: '#2E4034',
    cursor: 'pointer',
  },
  noteCancelButton: {
    fontSize: '0.85rem',
    padding: '0.3rem 0.7rem',
    borderRadius: '6px',
    border: '1px solid #999',
    backgroundColor: 'transparent',
    color: '#666',
    cursor: 'pointer',
  },
}
