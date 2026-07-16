import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

type PersonRef = { id: string; name: string; last_name: string | null }

type Moment = {
  id: string
  occasion: string | null
  location: string | null
  when_text: string | null
  created_at: string
  notes: { people: PersonRef | null }[]
  moment_groups: { groups: { id: string; name: string } | null }[]
}

export default function Events({ onSelectPerson }: { onSelectPerson: (person: { id: string; name: string }) => void }) {
  const [moments, setMoments] = useState<Moment[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadMoments()
  }, [])

  async function loadMoments() {
    setLoading(true)
    const { data } = await supabase
      .from('moments')
      .select('id, occasion, location, when_text, created_at, notes(people(id, name, last_name)), moment_groups(groups(id, name))')
      .order('created_at', { ascending: false })

    setMoments((data as unknown as Moment[]) ?? [])
    setLoading(false)
  }

  if (loading) return <p style={{ textAlign: 'center', marginTop: '3rem' }}>Loading…</p>

  return (
    <div style={styles.page}>
      <h1 style={styles.heading}>Events</h1>

      {moments.length === 0 && (
        <p style={styles.empty}>No moments recorded yet — head to Home and tell me about something that happened.</p>
      )}

      <div style={styles.list}>
        {moments.map((moment) => {
          // Attendees can repeat across multiple notes for the same moment — dedupe by person id
          const attendees = new Map<string, PersonRef>()
          for (const n of moment.notes ?? []) {
            if (n.people) attendees.set(n.people.id, n.people)
          }

          return (
            <div key={moment.id} style={styles.card}>
              <h2 style={styles.title}>{moment.occasion || 'Untitled moment'}</h2>
              <p style={styles.meta}>
                {[moment.when_text, moment.location].filter(Boolean).join(' · ') ||
                  new Date(moment.created_at).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}
              </p>

              {attendees.size > 0 && (
                <div style={styles.chipRow}>
                  {Array.from(attendees.values()).map((p) => (
                    <button key={p.id} onClick={() => onSelectPerson(p)} style={styles.personChip}>
                      {p.name}{p.last_name ? ` ${p.last_name}` : ''}
                    </button>
                  ))}
                </div>
              )}

              {moment.moment_groups?.some((mg) => mg.groups) && (
                <div style={styles.chipRow}>
                  {moment.moment_groups.map((mg) =>
                    mg.groups ? (
                      <span key={mg.groups.id} style={styles.groupChip}>
                        {mg.groups.name}
                      </span>
                    ) : null
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

const styles: { [key: string]: React.CSSProperties } = {
  page: { maxWidth: '600px', margin: '0 auto', padding: '2rem 1.5rem', fontFamily: 'Georgia, serif' },
  heading: { fontSize: '2rem', color: '#2E4034', marginBottom: '1.5rem' },
  empty: { color: '#777' },
  list: { display: 'flex', flexDirection: 'column', gap: '1rem' },
  card: {
    backgroundColor: '#FFF',
    borderRadius: '10px',
    padding: '1.25rem',
    boxShadow: '0 1px 6px rgba(0,0,0,0.06)',
  },
  title: { margin: '0 0 0.25rem 0', fontSize: '1.3rem', color: '#2E2E2E' },
  meta: { margin: '0 0 0.75rem 0', fontSize: '0.95rem', color: '#888' },
  chipRow: { display: 'flex', gap: '0.5rem', marginTop: '0.5rem', flexWrap: 'wrap' },
  personChip: {
    fontSize: '0.9rem',
    padding: '0.35rem 0.8rem',
    borderRadius: '999px',
    border: '1px solid #2E4034',
    backgroundColor: 'transparent',
    color: '#2E4034',
    cursor: 'pointer',
  },
  groupChip: {
    fontSize: '0.9rem',
    padding: '0.35rem 0.8rem',
    borderRadius: '999px',
    border: '1px solid #B08B2E',
    backgroundColor: '#FBF3E0',
    color: '#8A6A1F',
  },
}
