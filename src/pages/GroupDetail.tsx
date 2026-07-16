import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { summarize } from '../lib/summarize'

type Moment = {
  id: string
  occasion: string | null
  location: string | null
  when_text: string | null
  raw_description: string
  created_at: string
}

export default function GroupDetail({
  groupId,
  groupName,
  onSelectEvent,
  onBack,
  backLabel,
}: {
  groupId: string
  groupName: string
  onSelectEvent: (event: { id: string; summary: string }) => void
  onBack: () => void
  backLabel: string
}) {
  const [moments, setMoments] = useState<Moment[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadMoments()
  }, [groupId])

  async function loadMoments() {
    setLoading(true)
    const { data } = await supabase
      .from('moments')
      .select('id, occasion, location, when_text, raw_description, created_at, moment_groups!inner(group_id)')
      .eq('moment_groups.group_id', groupId)
      .order('created_at', { ascending: false })

    setMoments((data as unknown as Moment[]) ?? [])
    setLoading(false)
  }

  if (loading) return <p style={{ textAlign: 'center', marginTop: '3rem' }}>Loading…</p>

  return (
    <div style={styles.page}>
      <button onClick={onBack} style={styles.backButton}>← Back to {backLabel}</button>
      <h1 style={styles.heading}>{groupName}</h1>

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
  heading: { fontSize: '2rem', color: '#2E4034', marginBottom: '1.5rem' },
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
