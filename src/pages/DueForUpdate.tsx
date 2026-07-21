import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

type PersonRef = { id: string; name: string }
type Row = { id: string; name: string; lastUpdate: string | null }

const LIST_LIMIT = 20

function formatAgo(iso: string | null): string {
  if (!iso) return 'No updates yet'
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24))
  if (days <= 0) return 'Updated today'
  if (days === 1) return 'Updated 1 day ago'
  if (days < 30) return `Updated ${days} days ago`
  const months = Math.floor(days / 30)
  if (months < 12) return `Updated ${months} month${months === 1 ? '' : 's'} ago`
  const years = Math.floor(months / 12)
  return `Updated ${years} year${years === 1 ? '' : 's'} ago`
}

export default function DueForUpdate({
  onBack,
  backLabel,
  onSelectPerson,
}: {
  onBack: () => void
  backLabel: string
  onSelectPerson: (person: PersonRef) => void
}) {
  const [rows, setRows] = useState<Row[] | null>(null)

  useEffect(() => {
    Promise.all([
      supabase.from('people').select('id, name, last_name').eq('is_self', false),
      supabase.from('notes').select('person_id, created_at').not('person_id', 'is', null),
    ]).then(([{ data: people }, { data: notes }]) => {
      const lastByPerson = new Map<string, string>()
      for (const n of notes ?? []) {
        if (!n.person_id) continue
        const existing = lastByPerson.get(n.person_id)
        if (!existing || n.created_at > existing) lastByPerson.set(n.person_id, n.created_at)
      }

      const built: Row[] = (people ?? []).map((p) => ({
        id: p.id,
        name: p.last_name ? `${p.name} ${p.last_name}` : p.name,
        lastUpdate: lastByPerson.get(p.id) ?? null,
      }))

      built.sort((a, b) => {
        if (!a.lastUpdate && !b.lastUpdate) return a.name.localeCompare(b.name)
        if (!a.lastUpdate) return -1
        if (!b.lastUpdate) return 1
        return a.lastUpdate.localeCompare(b.lastUpdate)
      })

      setRows(built.slice(0, LIST_LIMIT))
    })
  }, [])

  return (
    <div style={styles.page}>
      <button onClick={onBack} style={styles.backButton}>← Back to {backLabel}</button>

      <h1 style={styles.heading}>Due for an update</h1>
      <p style={styles.body}>
        People you haven't added anything about in a while — a quick nudge, not a ranking.
      </p>

      {rows === null ? (
        <p style={styles.loading}>Loading…</p>
      ) : rows.length === 0 ? (
        <p style={styles.loading}>Add a person to start seeing them here.</p>
      ) : (
        <div style={styles.list}>
          {rows.map((row) => (
            <button
              key={row.id}
              onClick={() => onSelectPerson({ id: row.id, name: row.name })}
              style={styles.row}
            >
              <span style={styles.rowName}>{row.name}</span>
              <span style={styles.rowAgo}>{formatAgo(row.lastUpdate)}</span>
            </button>
          ))}
        </div>
      )}
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
  heading: { fontSize: '2rem', color: '#2E4034', margin: '0 0 0.5rem' },
  body: { fontSize: '0.95rem', color: '#666', lineHeight: 1.5, margin: '0 0 1.25rem' },
  loading: { color: '#777' },
  list: {
    backgroundColor: '#FFF',
    border: '1px solid #CFE0D6',
    borderRadius: '10px',
    padding: '0.25rem 1.1rem',
  },
  row: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '100%',
    padding: '0.75rem 0',
    background: 'none',
    border: 'none',
    borderTop: '1px solid #F0EEE8',
    cursor: 'pointer',
    fontFamily: 'Georgia, serif',
    textAlign: 'left',
  },
  rowName: { fontSize: '1rem', color: '#222' },
  rowAgo: { fontSize: '0.85rem', color: '#888' },
}
