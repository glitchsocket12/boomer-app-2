import { useEffect, useState, FormEvent } from 'react'
import { supabase } from '../lib/supabase'

type Note = {
  id: string
  content: string
  created_at: string
}

export default function PersonDetail({
  personId,
  personName,
  onBack,
}: {
  personId: string
  personName: string
  onBack: () => void
}) {
  const [notes, setNotes] = useState<Note[]>([])
  const [loading, setLoading] = useState(true)
  const [newFact, setNewFact] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    loadNotes()
  }, [personId])

  async function loadNotes() {
    setLoading(true)
    const { data } = await supabase
      .from('notes')
      .select('id, content, created_at')
      .eq('person_id', personId)
      .order('created_at', { ascending: false })

    setNotes(data ?? [])
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
    loadNotes()
  }

  return (
    <div style={styles.page}>
      <button onClick={onBack} style={styles.backButton}>← Back to People</button>
      <h1 style={styles.heading}>{personName}</h1>

      <form onSubmit={handleAddFact} style={styles.addForm}>
        <input
          type="text"
          value={newFact}
          onChange={(e) => setNewFact(e.target.value)}
          placeholder={`Add a fact about ${personName}, e.g. "Married to Manuel, they share a house"`}
          style={styles.addInput}
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