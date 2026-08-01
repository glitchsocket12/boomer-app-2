import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { summarize } from '../lib/summarize'
import { PersonChip, EventChip } from '../components/Chips'
import SearchBox from '../components/SearchBox'
import { GROUP_TYPES } from '../lib/groupTypes'
import { useGroupRoster, type GroupLabelFn } from '../lib/groupRoster'

type PersonRef = { id: string; name: string; last_name: string | null; is_self?: boolean }
type MomentRef = { id: string; occasion: string | null; raw_description: string }

export type Group = {
  id: string
  name: string
  summary: string | null
  group_type: string | null
  parent_group_id?: string | null
  person_groups: { people: PersonRef | null }[]
  moment_groups: { moments: MomentRef | null }[]
}

const AFFILIATION_LIMIT = 4
// Caps how many member chips a single group tile can show before collapsing the rest into a
// "+N more" — a group with a large explicit roster (e.g. an extended family) shouldn't be able
// to dominate the whole page. Full roster is still visible by clicking into the group.
const MEMBER_LIMIT = 5

export function filterGroups(
  groups: Group[],
  search: string,
  typeFilter: string,
  // Matches on the qualified "Parent / Child" label, so searching a parent's name turns up its
  // subgroups. Defaults to the bare name (landing-page demo, which has no subgroups).
  groupLabel: GroupLabelFn = (_id, fallbackName) => fallbackName
): { group: Group; explicitMembers: PersonRef[]; events: { id: string; summary: string }[] }[] {
  const decorated = groups.map((group) => {
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
  return decorated.filter(({ group, explicitMembers }) => {
    if (typeFilter === 'untyped' && group.group_type) return false
    if (typeFilter !== 'all' && typeFilter !== 'untyped' && group.group_type !== typeFilter) return false
    // Subgroups stay OUT of the resting list — that's the deliberate item-19 decision (they live
    // under their parent's own page, same list-pollution lesson as the self-membership revert).
    // But a search is the founder looking for something specific, and hiding a real group behind
    // a filter they can't see just reads as "it's not in here" (2026-08-01). So they surface as
    // soon as there's a query, labelled "Parent / Child" so it's obvious which one it is.
    if (!query) return !group.parent_group_id
    // Excludes the founder's own name from the match — searching your own name should surface
    // groups that mention someone ELSE by that name, or that are literally named for it, not
    // every group you happen to personally belong to.
    const memberNames = explicitMembers.filter((p) => !p.is_self).map((p) => `${p.name} ${p.last_name ?? ''}`)
    const haystack = [groupLabel(group.id, group.name), group.summary, ...memberNames].filter(Boolean).join(' ').toLowerCase()
    return haystack.includes(query)
  })
}

export default function Groups({
  search,
  onSearchChange,
  typeFilter,
  onTypeFilterChange,
  onSelectPerson,
  onSelectGroup,
  onSelectEvent,
  restoreScrollRef,
}: {
  search: string
  onSearchChange: (value: string) => void
  typeFilter: string
  onTypeFilterChange: (value: string) => void
  onSelectPerson: (person: { id: string; name: string }) => void
  onSelectGroup: (group: { id: string; name: string }) => void
  onSelectEvent: (event: { id: string; summary: string }) => void
  // Set by App.tsx to the scroll position this page was at right before navigating into a
  // group, so the in-page back arrow can restore it once the list reloads instead of landing
  // back at the top. search/typeFilter are lifted the same way (owned by App.tsx, not here) —
  // Groups unmounts every time a crumb is pushed, so any state that lived only in here reset on
  // every trip back from a group's own page.
  restoreScrollRef?: { current: number | null }
}) {
  const [groups, setGroups] = useState<Group[]>([])
  const [loading, setLoading] = useState(true)
  const [addingGroup, setAddingGroup] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)
  const requestedSummaries = useRef(new Set<string>())
  const groupRoster = useGroupRoster()

  useEffect(() => {
    loadGroups()
  }, [])

  // Restore only after the list has actually loaded and rendered at full height — doing this
  // while the "Loading…" placeholder is still showing would scroll to a position the real
  // content hasn't grown tall enough to reach yet.
  useEffect(() => {
    if (!loading && restoreScrollRef && restoreScrollRef.current != null) {
      window.scrollTo(0, restoreScrollRef.current)
      restoreScrollRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading])

  async function loadGroups() {
    setLoading(true)
    const baseSelect =
      'id, name, summary, group_type, person_groups(people(id, name, last_name, is_self)), moment_groups(moments(id, occasion, raw_description))'
    // Loads subgroups too, but filterGroups keeps them out of the resting list — they only appear
    // once there's a search query (see the comment there). Falls open to the narrower select if
    // parent_group_id doesn't exist yet (migration not run, see PROJECT_CONTEXT.md §10) rather
    // than erroring out to an empty page; without the column nothing has a parent anyway.
    let { data, error } = await supabase.from('groups').select(`${baseSelect}, parent_group_id`).order('name')
    if (error) {
      const fallback = await supabase.from('groups').select(baseSelect).order('name')
      data = fallback.data as typeof data
    }

    const loaded = (data as unknown as Group[]) ?? []
    setGroups(loaded)
    setLoading(false)

    // Only for groups this list actually shows at rest. Subgroups get their summary generated on
    // demand by GroupDetail's own loadSummary when opened — auto-generating one here for every
    // subgroup would be a real `summarize-group` call each, for cards nobody asked to see
    // (CLAUDE.md rule 3).
    for (const g of loaded) {
      if (g.parent_group_id) continue
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

  return (
    <GroupsView
      groups={groups}
      search={search}
      onSearchChange={onSearchChange}
      typeFilter={typeFilter}
      onTypeFilterChange={onTypeFilterChange}
      onAddGroup={handleAddGroup}
      addingGroup={addingGroup}
      addError={addError}
      onSelectPerson={onSelectPerson}
      onSelectGroup={onSelectGroup}
      onSelectEvent={onSelectEvent}
      groupLabel={groupRoster.label}
    />
  )
}

// Pure render — split out (2026-07-22) so the landing-page demo can render the exact same list UI
// fed by static data, with no Supabase calls. `readOnly` hides "+ Add Group" (a real insert).
export function GroupsView({
  groups,
  search,
  onSearchChange,
  typeFilter,
  onTypeFilterChange,
  onAddGroup,
  addingGroup,
  addError,
  onSelectPerson,
  onSelectGroup,
  onSelectEvent,
  groupLabel = (_id, fallbackName) => fallbackName,
  readOnly = false,
}: {
  groups: Group[]
  search: string
  onSearchChange: (value: string) => void
  typeFilter: string
  onTypeFilterChange: (value: string) => void
  onAddGroup: () => void
  addingGroup: boolean
  addError: string | null
  onSelectPerson: (person: { id: string; name: string }) => void
  onSelectGroup: (group: { id: string; name: string }) => void
  onSelectEvent: (event: { id: string; summary: string }) => void
  // Qualifies a subgroup as "Parent / Child". Defaults to the bare name for the landing-page demo.
  groupLabel?: GroupLabelFn
  readOnly?: boolean
}) {
  const filteredGroups = filterGroups(groups, search, typeFilter, groupLabel)

  return (
    <div style={styles.page}>
      <div style={styles.headingRow}>
        <h1 style={styles.heading}>Groups</h1>
        {!readOnly && (
          <button type="button" onClick={onAddGroup} style={styles.addButton} disabled={addingGroup}>
            {addingGroup ? '…' : '+ Add Group'}
          </button>
        )}
      </div>
      {addError && <p style={styles.addErrorText}>{addError}</p>}

      {groups.length === 0 && (
        <p style={styles.empty}>
          No groups yet — add one above, or mention it on Home (e.g. "Mike is one of my Academy friends") and it'll show up here.
        </p>
      )}

      {groups.length > 0 && (
        <div style={styles.searchRow}>
          <SearchBox value={search} onChange={onSearchChange} placeholder="Search groups…" />
          <select
            value={typeFilter}
            onChange={(e) => onTypeFilterChange(e.target.value)}
            style={styles.typeFilterSelect}
            aria-label="Filter by group type"
          >
            <option value="all">All types</option>
            <option value="untyped">No type set</option>
            {GROUP_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
      )}

      {groups.length > 0 && filteredGroups.length === 0 && (
        <p style={styles.empty}>
          {search.trim() ? `No groups match "${search}".` : 'No groups have this type yet.'}
        </p>
      )}

      <div style={styles.list}>
        {filteredGroups.map(({ group, explicitMembers, events }) => {
          const shownMembers = explicitMembers.slice(0, MEMBER_LIMIT)
          const shownEvents = events.slice(0, AFFILIATION_LIMIT)

          return (
            <div key={group.id} style={styles.card}>
              <div style={styles.titleRow}>
                <button onClick={() => onSelectGroup(group)} style={styles.titleButton}>
                  {groupLabel(group.id, group.name)}
                </button>
                {group.group_type && <span style={styles.typeBadge}>{group.group_type}</span>}
              </div>

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
  page: { maxWidth: '840px', margin: '0 auto', padding: '2rem 1.5rem', fontFamily: 'Georgia, serif' },
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
  searchRow: { display: 'flex', gap: '0.75rem', alignItems: 'flex-start', marginBottom: '1.5rem' },
  typeFilterSelect: {
    flexShrink: 0,
    fontSize: '1rem',
    padding: '0.65rem 0.75rem',
    borderRadius: '8px',
    border: '1px solid #CCC',
    fontFamily: 'Georgia, serif',
    backgroundColor: '#FFF',
    color: '#2E2E2E',
  },
  empty: { color: '#777' },
  list: { display: 'flex', flexDirection: 'column', gap: '1rem' },
  card: {
    backgroundColor: '#FFF',
    borderRadius: '10px',
    padding: '1.25rem',
    boxShadow: '0 1px 6px rgba(0,0,0,0.06)',
  },
  titleRow: { display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem', flexWrap: 'wrap' },
  titleButton: {
    display: 'block',
    margin: 0,
    padding: 0,
    fontSize: '1.3rem',
    fontFamily: 'Georgia, serif',
    color: '#2E2E2E',
    background: 'none',
    border: 'none',
    textAlign: 'left',
    cursor: 'pointer',
  },
  typeBadge: {
    fontSize: '0.7rem',
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
    color: '#8A6A1F',
    backgroundColor: '#FBF3E0',
    border: '1px solid #E6D6AC',
    borderRadius: '999px',
    padding: '0.15rem 0.55rem',
  },
  summary: { margin: '0 0 0.75rem 0', fontSize: '0.95rem', color: '#666', fontStyle: 'italic' },
  chipRow: { display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' },
  moreText: { fontSize: '0.85rem', color: '#999', fontStyle: 'italic' },
}
