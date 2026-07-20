import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { summarize } from '../lib/summarize'
import { PersonChip, EventChip } from '../components/Chips'
import SearchBox from '../components/SearchBox'

type PersonRef = { id: string; name: string; last_name: string | null }
type MomentRef = { id: string; occasion: string | null; raw_description: string }

type Group = {
  id: string
  name: string
  summary: string | null
  person_groups: { people: PersonRef | null }[]
  moment_groups: { moments: MomentRef | null }[]
}

const AFFILIATION_LIMIT = 4
// Caps how many member chips a single group tile can show before collapsing the rest into a
// "+N more" — a group with a large explicit roster (e.g. an extended family) shouldn't be able
// to dominate the whole page. Full roster is still visible by clicking into the group.
const MEMBER_LIMIT = 5

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
  const [search, setSearch] = useState('')
  const [addingGroup, setAddingGroup] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)
  const requestedSummaries = useRef(new Set<string>())

  useEffect(() => {
    loadGroups()
  }, [])

  async function loadGroups() {
    setLoading(true)
    const { data } = await supabase
      .from('groups')
      .select(
        'id, name, summary, person_groups(people(id, name, last_name)), moment_groups(moments(id, occasion, raw_description))'
      )
      .order('name')

    const loaded = (data as unknown as Group[]) ?? []
    setGroups(loaded)
    setLoading(false)

    for (const g of loaded) {
      if (!g.summary && !requestedSummaries.current.has(g.id)) {
        requestedSummaries.current.add(g.id)
        generateSummary(g.id)
      }
    }
  }

  async function generateSummary(groupId: string) {
    const { data } = await supabase.functions.invoke('summarize-group', { body: { groupId } })
    if (data?.summary) {
      setGroups((prev) => prev.map((g) => (g.id === groupId ? { ...g, summary: data.summary } : g)))
    }
  }

  // No form up front — matches "add an event": creates a blank shell immediately and drops
  // the founder straight onto the new group's own page, which already has a rename pencil to
  // fix the placeholder name, plus the member/notes/associations tools to build it up from there.
  async function handleAddGroup() {
    setAddingGroup(true)
    setAddError(null)
    const {
      data: { user },
    } = await supabase.auth.getUser()

    const { data, error } = await supabase
      .from('groups')
      .insert({ name: 'New group', user_id: user?.id })
      .select()
      .single()

    setAddingGroup(false)
    if (error || !data) {
      setAddError("Couldn't start a new group — please try again.")
      return
    }

    onSelectGroup({ id: data.id, name: data.name })
  }

  if (loading) return <p style={{ textAlign: 'center', marginTop: '3rem' }}>Loading…</p>

  // "Members" is the explicit roster (person_groups) ONLY — this list page intentionally
  // does NOT show event-only attendees or any add/remove affordance; that management
  // (including the "also seen at this group's events" suggestions) only lives on a
  // group's own detail page, not here, so a tile can't accidentally change membership
  // with a stray click.
  const decoratedGroups = groups.map((group) => {
    const explicitMembers = (group.person_groups ?? [])
      .map((pg) => pg.people)
      .filter((p): p is PersonRef => p !== null)

    const eventMap = new Map<string, { id: string; summary: string }>()
    for (const mg of group.moment_groups ?? []) {
      if (mg.moments) {
        eventMap.set(mg.moments.id, { id: mg.moments.id, summary: summarize(mg.moments.occasion, mg.moments.raw_description) })
      }
    }
    const events = [...eventMap.values()]

    return { group, explicitMembers, events }
  })

  const query = search.trim().toLowerCase()
  const filteredGroups = decoratedGroups.filter(({ group, explicitMembers }) => {
    if (!query) return true
    const memberNames = explicitMembers.map((p) => `${p.name} ${p.last_name ?? ''}`)
    const haystack = [group.name, group.summary, ...memberNames].filter(Boolean).join(' ').toLowerCase()
    return haystack.includes(query)
  })

  return (
    <div style={styles.page}>
      <div style={styles.headingRow}>
        <h1 style={styles.heading}>Groups</h1>
        <button type="button" onClick={handleAddGroup} style={styles.addButton} disabled={addingGroup}>
          {addingGroup ? '…' : '+ Add Group'}
        </button>
      </div>
      {addError && <p style={styles.addErrorText}>{addError}</p>}

      {groups.length === 0 && (
        <p style={styles.empty}>
          No groups yet — add one above, or mention it on Home (e.g. "Mike is one of my Academy friends") and it'll show up here.
        </p>
      )}

      {groups.length > 0 && (
        <SearchBox value={search} onChange={setSearch} placeholder="Search groups…" />
      )}

      {groups.length > 0 && filteredGroups.length === 0 && (
        <p style={styles.empty}>No groups match "{search}".</p>
      )}

      <div style={styles.list}>
        {filteredGroups.map(({ group, explicitMembers, events }) => {
          const shownMembers = explicitMembers.slice(0, MEMBER_LIMIT)
          const shownEvents = events.slice(0, AFFILIATION_LIMIT)

          return (
            <div key={group.id} style={styles.card}>
              <button onClick={() => onSelectGroup(group)} style={styles.titleButton}>
                {group.name}
              </button>

              <p style={styles.summary}>{group.summary || 'Figuring out what this group is about…'}</p>

              {explicitMembers.length === 0 ? (
                <p style={styles.empty}>No members yet.</p>
              ) : (
                <div style={styles.chipRow}>
                  {shownMembers.map((p) => (
                    <PersonChip key={p.id} label={`${p.name}${p.last_name ? ` ${p.last_name}` : ''}`} onClick={() => onSelectPerson(p)} />
                  ))}
                  {explicitMembers.length > MEMBER_LIMIT && (
                    <span style={styles.moreText}>+{explicitMembers.length - MEMBER_LIMIT} more</span>
                  )}
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
  headingRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', marginBottom: '1rem', flexWrap: 'wrap' },
  heading: { fontSize: '2rem', color: '#2E4034', margin: 0 },
  addButton: {
    fontSize: '1rem',
    padding: '0.6rem 1.1rem',
    borderRadius: '8px',
    border: 'none',
    backgroundColor: '#2E4034',
    color: '#FFF',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    fontFamily: 'Georgia, serif',
  },
  addErrorText: { color: '#B04A3B', fontSize: '0.9rem', marginBottom: '1rem' },
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
  summary: { margin: '0 0 0.75rem 0', fontSize: '0.95rem', color: '#666', fontStyle: 'italic' },
  chipRow: { display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' },
  moreText: { fontSize: '0.85rem', color: '#999', fontStyle: 'italic' },
}
