import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { summarize } from '../lib/summarize'
import EditButton from '../components/EditButton'

type Moment = {
  id: string
  occasion: string | null
  location: string | null
  when_text: string | null
  event_date: string | null
  raw_description: string
  created_at: string
}

function eventSortDate(moment: Pick<Moment, 'event_date' | 'created_at'>): Date {
  return moment.event_date ? new Date(`${moment.event_date}T00:00:00`) : new Date(moment.created_at)
}

export default function GroupDetail({
  groupId,
  groupName,
  onSelectEvent,
  onBack,
  backLabel,
  onRenamed,
}: {
  groupId: string
  groupName: string
  onSelectEvent: (event: { id: string; summary: string }) => void
  onBack: () => void
  backLabel: string
  onRenamed?: (newName: string) => void
}) {
  const [moments, setMoments] = useState<Moment[]>([])
  const [loading, setLoading] = useState(true)
  const [name, setName] = useState(groupName)
  const [editingName, setEditingName] = useState(false)
  const [nameInput, setNameInput] = useState(groupName)
  const [savingName, setSavingName] = useState(false)

  useEffect(() => {
    loadMoments()
    setName(groupName)
    setNameInput(groupName)
    setEditingName(false)
  }, [groupId])

  async function loadMoments() {
    setLoading(true)
    const { data } = await supabase
      .from('moments')
      .select('id, occasion, location, when_text, event_date, raw_description, created_at, moment_groups!inner(group_id)')
      .eq('moment_groups.group_id', groupId)

    const sorted = ((data as unknown as Moment[]) ?? []).sort(
      (a, b) => eventSortDate(b).getTime() - eventSortDate(a).getTime()
    )
    setMoments(sorted)
    setLoading(false)
  }

  async function handleSaveName(e: FormEvent) {
    e.preventDefault()
    const trimmed = nameInput.trim()
    if (!trimmed || trimmed === name) {
      setEditingName(false)
      setNameInput(name)
      return
    }
    setSavingName(true)
    const { error } = await supabase.from('groups').update({ name: trimmed }).eq('id', groupId)
    setSavingName(false)
    if (error) return

    setName(trimmed)
    setEditingName(false)
    onRenamed?.(trimmed)
  }

  if (loading) return <p style={{ textAlign: 'center', marginTop: '3rem' }}>Loading…</p>

  return (
    <div style={styles.page}>
      <button onClick={onBack} style={styles.backButton}>← Back to {backLabel}</button>

      {editingName ? (
        <form onSubmit={handleSaveName} style={styles.renameForm}>
          <input
            type="text"
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            style={styles.renameInput}
            autoFocus
          />
          <button type="submit" disabled={savingName || !nameInput.trim()} style={styles.saveButton}>
            {savingName ? '…' : 'Save'}
          </button>
          <button
            type="button"
            onClick={() => {
              setEditingName(false)
              setNameInput(name)
            }}
            style={styles.cancelButton}
          >
            Cancel
          </button>
        </form>
      ) : (
        <div style={styles.headingRow}>
          <h1 style={styles.heading}>{name}</h1>
          <EditButton label="Rename group" onClick={() => setEditingName(true)} />
        </div>
      )}

      {moments.length === 0 && (
        <p style={styles.empty}>No events tagged to this group yet — mention this affiliation on Home while telling a story and it'll show up here.</p>
      )}

      <div style={styles.list}>
        {moments.map((moment) => {
          const summary = summarize(moment.occasion, moment.raw_description)
          return (
            <div key={moment.id} style={styles.card}>
              <p style={styles.summary}>{summary}</p>
              <p style={styles.meta}>
                {[moment.when_text, moment.location].filter(Boolean).join(' · ') ||
                  new Date(moment.created_at).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}
              </p>
              <button onClick={() => onSelectEvent({ id: moment.id, summary })} style={styles.seeMore}>
                See more →
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}

const styles: { [key: string]: React.CSSProperties } = {
  page: { maxWidth: '600px', margin: '0 auto', padding: '1rem 1.5rem 2rem', fontFamily: 'Georgia, serif' },
  backButton: {
    background: 'none',
    border: 'none',
    color: '#2E4034',
    fontSize: '1rem',
    cursor: 'pointer',
    marginBottom: '1rem',
    padding: 0,
  },
  heading: { fontSize: '2rem', color: '#2E4034', margin: 0 },
  headingRow: { display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '1.5rem', flexWrap: 'wrap' },
  renameForm: { display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap' },
  renameInput: {
    fontSize: '1.5rem',
    fontFamily: 'Georgia, serif',
    color: '#2E4034',
    padding: '0.25rem 0.5rem',
    borderRadius: '8px',
    border: '1px solid #CCC',
    flex: '1 1 200px',
  },
  saveButton: {
    fontSize: '0.9rem',
    padding: '0.5rem 0.9rem',
    borderRadius: '8px',
    border: 'none',
    backgroundColor: '#2E4034',
    color: '#FFF',
    cursor: 'pointer',
  },
  cancelButton: {
    fontSize: '0.9rem',
    padding: '0.5rem 0.9rem',
    borderRadius: '8px',
    border: '1px solid #CCC',
    backgroundColor: '#FFF',
    color: '#555',
    cursor: 'pointer',
  },
  empty: { color: '#777' },
  list: { display: 'flex', flexDirection: 'column', gap: '1rem' },
  card: {
    backgroundColor: '#FFF',
    borderRadius: '10px',
    padding: '1.25rem',
    boxShadow: '0 1px 6px rgba(0,0,0,0.06)',
  },
  summary: { margin: '0 0 0.25rem 0', fontSize: '1.15rem', color: '#2E2E2E' },
  meta: { margin: '0 0 0.75rem 0', fontSize: '0.9rem', color: '#888' },
  seeMore: {
    background: 'none',
    border: 'none',
    color: '#2E4034',
    fontSize: '0.95rem',
    fontFamily: 'Georgia, serif',
    cursor: 'pointer',
    padding: 0,
  },
}
