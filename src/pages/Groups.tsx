import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { summarize } from '../lib/summarize'
import { PersonChip, EventChip } from '../components/Chips'

type PersonRef = { id: string; name: string; last_name: string | null }
type MomentRef = { id: string; occasion: string | null; raw_description: string }

type Group = {
  id: string
  name: string
  person_groups: { people: PersonRef | null }[]
  moment_groups: { moments: (MomentRef & { notes: { people: PersonRef | null }[] }) | null }[]
}

const AFFILIATION_LIMIT = 4

export default function Groups({
  onSelectPerson,
  onSelectGroup,
  onSelectEvent,
}: {
  onSelectPerson: (person: { id: string; name: string }) => void
  onSelectGroup: (group: { id: string; name: string }) => void
  onSelectEvent: (event: { id: string; summary: string }) => void
}) {
  const [groups, setGroups] = useState<Group[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadGroups()
  }, [])

  async function loadGroups() {
    setLoading(true)
    const { data } = await supabase
      .from('groups')
      .select(
        'id, name, person_groups(people(id, name, last_name)), moment_groups(moments(id, occasion, raw_description, notes(people(id, name, last_name))))'
      )
      .order('name')

    setGroups((data as unknown as Group[]) ?? [])
    setLoading(false)
  }

  if (loading) return <p style={{ textAlign: 'center', marginTop: '3rem' }}>Loading…</p>

  return (
    <div style={styles.page}>
      <h1 style={styles.heading}>Groups</h1>

      {groups.length === 0 && (
        <p style={styles.empty}>No groups yet — mention one on Home (e.g. "Mike is one of my Academy friends") and it'll show up here.</p>
      )}

      <div style={styles.list}>
        {groups.map((group) => {
          const explicitMembers = (group.person_groups ?? [])
            .map((pg) => pg.people)
            .filter((p): p is PersonRef => p !== null)

          const storyMembers = (group.moment_groups ?? [])
            .flatMap((mg) => mg.moments?.notes ?? [])
            .map((n) => n.people)
            .filter((p): p is PersonRef => p !== null)

          const membersById = new Map<string, PersonRef>()
          for (const p of [...explicitMembers, ...storyMembers]) membersById.set(p.id, p)
          const members = [...membersById.values()]

          const eventMap = new Map<string, { id: string; summary: string }>()
          for (const mg of group.moment_groups ?? []) {
            if (mg.moments) {
              eventMap.set(mg.moments.id, { id: mg.moments.id, summary: summarize(mg.moments.occasion, mg.moments.raw_description) })
            }
          }
          const events = [...eventMap.values()]
          const shownEvents = events.slice(0, AFFILIATION_LIMIT)

          return (
            <div key={group.id} style={styles.card}>
              <button onClick={() => onSelectGroup(group)} style={styles.titleButton}>
                {group.name}
              </button>

              {members.length === 0 ? (
                <p style={styles.empty}>No members yet.</p>
              ) : (
                <div style={styles.chipRow}>
                  {members.map((p) => (
                    <PersonChip key={p.id} label={`${p.name}${p.last_name ? ` ${p.last_name}` : ''}`} onClick={() => onSelectPerson(p)} />
                  ))}
                </div>
              )}

              {shownEvents.length > 0 && (
                <div style={{ ...styles.chipRow, marginTop: '0.5rem' }}>
                  {shownEvents.map((e) => (
                    <EventChip key={e.id} label={e.summary} onClick={() => onSelectEvent(e)} />
                  ))}
                  {events.length > AFFILIATION_LIMIT && (
                    <span style={styles.moreText}>+{events.length - AFFILIATION_LIMIT} more</span>
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
  titleButton: {
    display: 'block',
    margin: '0 0 0.75rem 0',
    padding: 0,
    fontSize: '1.3rem',
    fontFamily: 'Georgia, serif',
    color: '#2E2E2E',
    background: 'none',
    border: 'none',
    textAlign: 'left',
    cursor: 'pointer',
  },
  chipRow: { display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' },
  moreText: { fontSize: '0.85rem', color: '#999', fontStyle: 'italic' },
}
