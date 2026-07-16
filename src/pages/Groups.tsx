import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

type PersonRef = { id: string; name: string; last_name: string | null }

type Group = {
  id: string
  name: string
  person_groups: { people: PersonRef | null }[]
}

export default function Groups({ onSelectPerson }: { onSelectPerson: (person: { id: string; name: string }) => void }) {
  const [groups, setGroups] = useState<Group[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadGroups()
  }, [])

  async function loadGroups() {
    setLoading(true)
    const { data } = await supabase
      .from('groups')
      .select('id, name, person_groups(people(id, name, last_name))')
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
          const members = (group.person_groups ?? [])
            .map((pg) => pg.people)
            .filter((p): p is PersonRef => p !== null)

          return (
            <div key={group.id} style={styles.card}>
              <h2 style={styles.title}>{group.name}</h2>

              {members.length === 0 ? (
                <p style={styles.empty}>No members yet.</p>
              ) : (
                <div style={styles.chipRow}>
                  {members.map((p) => (
                    <button key={p.id} onClick={() => onSelectPerson(p)} style={styles.personChip}>
                      {p.name}{p.last_name ? ` ${p.last_name}` : ''}
                    </button>
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
  title: { margin: '0 0 0.5rem 0', fontSize: '1.3rem', color: '#2E2E2E' },
  chipRow: { display: 'flex', gap: '0.5rem', flexWrap: 'wrap' },
  personChip: {
    fontSize: '0.9rem',
    padding: '0.35rem 0.8rem',
    borderRadius: '999px',
    border: '1px solid #2E4034',
    backgroundColor: 'transparent',
    color: '#2E4034',
    cursor: 'pointer',
  },
}
