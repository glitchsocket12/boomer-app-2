import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { summarize } from '../lib/summarize'
import { eventSortDate, formatMonthYear } from '../lib/dates'
import { PersonChip, GroupChip } from '../components/Chips'

type PersonRef = { id: string; name: string; last_name: string | null }

type Moment = {
  id: string
  occasion: string | null
  location: string | null
  when_text: string | null
  event_date: string | null
  raw_description: string
  created_at: string
  notes: { people: PersonRef | null }[]
  moment_groups: { groups: { id: string; name: string } | null }[]
}

export default function Events({
  onSelectPerson,
  onSelectGroup,
  onSelectEvent,
}: {
  onSelectPerson: (person: { id: string; name: string }) => void
  onSelectGroup: (group: { id: string; name: string }) => void
  onSelectEvent: (event: { id: string; summary: string }) => void
}) {
  const [moments, setMoments] = useState<Moment[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadMoments()
  }, [])

  async function loadMoments() {
    setLoading(true)
    const { data } = await supabase
      .from('moments')
      .select(
        'id, occasion, location, when_text, event_date, raw_description, created_at, notes(people(id, name, last_name)), moment_groups(groups(id, name))'
      )

    const sorted = ((data as unknown as Moment[]) ?? []).sort(
      (a, b) => eventSortDate(b).getTime() - eventSortDate(a).getTime()
    )
    setMoments(sorted)
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

          const summary = summarize(moment.occasion, moment.raw_description)
          const groups = (moment.moment_groups ?? [])
            .map((mg) => mg.groups)
            .filter((g): g is { id: string; name: string } => g !== null)

          return (
            <div key={moment.id} style={styles.card}>
              <button onClick={() => onSelectEvent({ id: moment.id, summary })} style={styles.titleButton}>
                {moment.occasion || 'Untitled moment'}
              </button>
              <p style={styles.meta}>
                {[formatMonthYear(moment), moment.location].filter(Boolean).join(' · ')}
              </p>

              {attendees.size > 0 && (
                <div style={styles.chipRow}>
                  {Array.from(attendees.values()).map((p) => (
                    <PersonChip
                      key={p.id}
                      label={`${p.name}${p.last_name ? ` ${p.last_name}` : ''}`}
                      onClick={() => onSelectPerson(p)}
                    />
                  ))}
                </div>
              )}

              {groups.length > 0 && (
                <div style={styles.chipRow}>
                  {groups.map((g) => (
                    <GroupChip key={g.id} label={g.name} onClick={() => onSelectGroup(g)} />
                  ))}
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
  titleButton: {
    display: 'block',
    margin: '0 0 0.25rem 0',
    padding: 0,
    fontSize: '1.3rem',
    fontFamily: 'Georgia, serif',
    color: '#2E2E2E',
    background: 'none',
    border: 'none',
    textAlign: 'left',
    cursor: 'pointer',
  },
  meta: { margin: '0 0 0.75rem 0', fontSize: '0.95rem', color: '#888' },
  chipRow: { display: 'flex', gap: '0.5rem', marginTop: '0.5rem', flexWrap: 'wrap' },
}
