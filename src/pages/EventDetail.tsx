import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { PersonChip, GroupChip } from '../components/Chips'
import UpdateMomentChat from '../components/UpdateMomentChat'

type PersonRef = { id: string; name: string; last_name: string | null }
type GroupRef = { id: string; name: string }
type NoteWithPerson = { id: string; content: string; created_at: string; people: PersonRef | null }

type MomentDetail = {
  id: string
  occasion: string | null
  location: string | null
  when_text: string | null
  raw_description: string
  details: Record<string, string> | null
  created_at: string
  notes: NoteWithPerson[]
  moment_groups: { groups: GroupRef | null }[]
}

export default function EventDetail({
  eventId,
  onSelectPerson,
  onSelectGroup,
  onBack,
  backLabel,
}: {
  eventId: string
  onSelectPerson: (person: { id: string; name: string }) => void
  onSelectGroup: (group: { id: string; name: string }) => void
  onBack: () => void
  backLabel: string
}) {
  const [moment, setMoment] = useState<MomentDetail | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadMoment()
  }, [eventId])

  async function loadMoment() {
    setLoading(true)
    const { data } = await supabase
      .from('moments')
      .select(
        'id, occasion, location, when_text, raw_description, details, created_at, notes(id, content, created_at, people(id, name, last_name)), moment_groups(groups(id, name))'
      )
      .eq('id', eventId)
      .single()

    setMoment((data as unknown as MomentDetail) ?? null)
    setLoading(false)
  }

  if (loading) return <p style={{ textAlign: 'center', marginTop: '3rem' }}>Loading…</p>
  if (!moment) return <p style={{ textAlign: 'center', marginTop: '3rem' }}>Couldn't find that event.</p>

  const attendees = new Map<string, PersonRef>()
  for (const n of moment.notes ?? []) {
    if (n.people) attendees.set(n.people.id, n.people)
  }

  const groups = (moment.moment_groups ?? [])
    .map((mg) => mg.groups)
    .filter((g): g is GroupRef => g !== null)

  const details = moment.details && typeof moment.details === 'object' ? Object.entries(moment.details) : []

  return (
    <div style={styles.page}>
      <button onClick={onBack} style={styles.backButton}>← Back to {backLabel}</button>

      <h1 style={styles.heading}>{moment.occasion || 'Untitled moment'}</h1>
      <p style={styles.meta}>
        {[moment.when_text, moment.location].filter(Boolean).join(' · ') ||
          new Date(moment.created_at).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}
      </p>

      {groups.length > 0 && (
        <div style={styles.chipRow}>
          {groups.map((g) => (
            <GroupChip key={g.id} label={g.name} onClick={() => onSelectGroup(g)} />
          ))}
        </div>
      )}

      <p style={styles.description}>{moment.raw_description}</p>

      {details.length > 0 && (
        <div style={styles.detailsBox}>
          {details.map(([key, value]) => (
            <p key={key} style={styles.detailRow}>
              <span style={styles.detailKey}>{key}: </span>
              {String(value)}
            </p>
          ))}
        </div>
      )}

      {attendees.size > 0 && (
        <>
          <h2 style={styles.subheading}>Who was there</h2>
          <div style={styles.chipRow}>
            {Array.from(attendees.values()).map((p) => (
              <PersonChip
                key={p.id}
                label={`${p.name}${p.last_name ? ` ${p.last_name}` : ''}`}
                onClick={() => onSelectPerson(p)}
              />
            ))}
          </div>
        </>
      )}

      {moment.notes.length > 0 && (
        <>
          <h2 style={styles.subheading}>Notes</h2>
          <div style={styles.notesList}>
            {moment.notes.map((note) => (
              <div key={note.id} style={styles.noteCard}>
                <p style={styles.noteContent}>{note.content}</p>
                <p style={styles.noteMeta}>
                  {note.people ? `${note.people.name}${note.people.last_name ? ` ${note.people.last_name}` : ''} · ` : ''}
                  {new Date(note.created_at).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}
                </p>
              </div>
            ))}
          </div>
        </>
      )}

      <h2 style={styles.subheading}>Remember something else?</h2>
      <p style={styles.chatHint}>Tell me anything more about this — who else was there, how it went, anything you'd want to look back on.</p>
      <UpdateMomentChat momentId={moment.id} onSaved={loadMoment} />
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
  heading: { fontSize: '2rem', color: '#2E4034', marginBottom: '0.25rem' },
  meta: { margin: '0 0 0.75rem 0', fontSize: '0.95rem', color: '#888' },
  description: { fontSize: '1.05rem', color: '#2E2E2E', lineHeight: 1.6, marginBottom: '1.5rem' },
  detailsBox: {
    backgroundColor: '#FBF3E0',
    border: '1px solid #E6D6AC',
    borderRadius: '10px',
    padding: '1rem 1.25rem',
    marginBottom: '1.5rem',
  },
  detailRow: { margin: '0.25rem 0', fontSize: '0.95rem', color: '#5A4A20' },
  detailKey: { fontWeight: 'bold', textTransform: 'capitalize' },
  subheading: { fontSize: '1.2rem', color: '#2E4034', margin: '1.5rem 0 0.5rem 0' },
  chatHint: { margin: '0 0 0.25rem 0', fontSize: '0.9rem', color: '#888' },
  chipRow: { display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1rem' },
  notesList: { display: 'flex', flexDirection: 'column', gap: '1rem' },
  noteCard: {
    backgroundColor: '#FFF',
    borderRadius: '10px',
    padding: '1.25rem',
    boxShadow: '0 1px 6px rgba(0,0,0,0.06)',
  },
  noteContent: { margin: '0 0 0.5rem 0', fontSize: '1.05rem', color: '#2E2E2E', lineHeight: 1.5 },
  noteMeta: { margin: 0, fontSize: '0.85rem', color: '#999' },
}
