import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { summarize } from '../lib/summarize'
import { GroupChip, EventChip } from '../components/Chips'
import VoiceInputButton from '../components/VoiceInputButton'

type Note = {
  id: string
  content: string
  created_at: string
  moment_id: string | null
  moments: { id: string; occasion: string | null; raw_description: string } | null
}

type GroupRef = { id: string; name: string }

const AFFILIATION_LIMIT = 5

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
  const [loading, setLoading] = useState(true)
  const [newFact, setNewFact] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    loadData()
  }, [personId])

  async function loadData() {
    setLoading(true)

    const [notesRes, groupsRes] = await Promise.all([
      supabase
        .from('notes')
        .select('id, content, created_at, moment_id, moments(id, occasion, raw_description)')
        .eq('person_id', personId)
        .order('created_at', { ascending: false }),
      supabase.from('person_groups').select('groups(id, name)').eq('person_id', personId),
    ])

    setNotes((notesRes.data as unknown as Note[]) ?? [])

    const groupRows = (groupsRes.data as unknown as { groups: GroupRef | null }[]) ?? []
    setGroups(groupRows.map((r) => r.groups).filter((g): g is GroupRef => g !== null))

    setLoading(false)
  }

  async function handleAddFact(e: FormEvent) {
    e.preventDefault()
    if (!newFact.trim()) return
    setSaving(true)

    await supabase.functions.invoke('add-fact', {
      body: { personId, text: newFact.trim() },
    })

    setNewFact('')
    setSaving(false)
    loadData()
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

  return (
    <div style={styles.page}>
      <button onClick={onBack} style={styles.backButton}>← Back to {backLabel}</button>
      <h1 style={styles.heading}>{personName}</h1>

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
        <input
          type="text"
          value={newFact}
          onChange={(e) => setNewFact(e.target.value)}
          placeholder={`Add a fact about ${personName}, e.g. "Married to Manuel, they share a house"`}
          style={styles.addInput}
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
  affiliations: { display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1.5rem' },
  affiliationRow: { display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' },
  moreText: { fontSize: '0.85rem', color: '#999', fontStyle: 'italic' },
  addForm: { display: 'flex', gap: '0.5rem', marginBottom: '2rem' },
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
