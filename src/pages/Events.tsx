import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { summarize } from '../lib/summarize'
import { eventSortDate, formatEventWhen, formatFullDate } from '../lib/dates'
import { PersonChip, GroupChip } from '../components/Chips'
import SearchBox from '../components/SearchBox'
import { useGroupRoster, type GroupLabelFn } from '../lib/groupRoster'
import { border, colors, fontFamily, fontSize, maxWidth, neutral, radius, shadow, space } from '../lib/theme'

export type PersonRef = { id: string; name: string; last_name: string | null }

export type Moment = {
  id: string
  occasion: string | null
  location: string | null
  when_text: string | null
  event_date: string | null
  event_end_date: string | null
  raw_description: string
  created_at: string
  notes: { people: PersonRef | null }[]
  moment_groups: { groups: { id: string; name: string } | null }[]
  moment_tags: { tags: { id: string; name: string } | null }[]
}

export type ChildEventRef = {
  id: string
  occasion: string | null
  event_date: string | null
  event_end_date: string | null
  created_at: string
  parent_moment_id: string
  notes: { people: { id: string } | null }[]
}

export type DecoratedMoment = {
  moment: Moment
  attendees: Map<string, PersonRef>
  summary: string
  groups: { id: string; name: string }[]
  tags: { id: string; name: string }[]
}

export function decorateMoments(moments: Moment[]): DecoratedMoment[] {
  return moments.map((moment) => {
    // Attendees can repeat across multiple notes for the same moment — dedupe by person id
    const attendees = new Map<string, PersonRef>()
    for (const n of moment.notes ?? []) {
      if (n.people) attendees.set(n.people.id, n.people)
    }

    const summary = summarize(moment.occasion, moment.raw_description)
    const groups = (moment.moment_groups ?? [])
      .map((mg) => mg.groups)
      .filter((g): g is { id: string; name: string } => g !== null)
    const tags = (moment.moment_tags ?? [])
      .map((mt) => mt.tags)
      .filter((t): t is { id: string; name: string } => t !== null)

    return { moment, attendees, summary, groups, tags }
  })
}

export function filterMoments(
  decorated: DecoratedMoment[],
  search: string,
  tagFilter: string,
  // Searches the same qualified string the chips display, so typing a parent group's name also
  // finds events tagged to its subgroups. Defaults to the bare name (landing-page demo).
  groupLabel: GroupLabelFn = (_id, fallbackName) => fallbackName
): DecoratedMoment[] {
  const query = search.trim().toLowerCase()
  return decorated.filter(({ moment, attendees, summary, groups, tags }) => {
    if (tagFilter === 'untagged' && tags.length > 0) return false
    if (tagFilter !== 'all' && tagFilter !== 'untagged' && !tags.some((t) => t.name === tagFilter)) return false
    if (!query) return true
    const attendeeNames = Array.from(attendees.values()).map((p) => `${p.name} ${p.last_name ?? ''}`)
    const groupNames = groups.map((g) => groupLabel(g.id, g.name))
    const tagNames = tags.map((t) => t.name)
    const haystack = [moment.occasion, moment.location, summary, ...attendeeNames, ...groupNames, ...tagNames]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
    return haystack.includes(query)
  })
}

export function groupMomentsByYear(filteredMoments: DecoratedMoment[]): { year: number; items: DecoratedMoment[] }[] {
  const yearGroups: { year: number; items: DecoratedMoment[] }[] = []
  for (const entry of filteredMoments) {
    const year = eventSortDate(entry.moment).getFullYear()
    const lastGroup = yearGroups[yearGroups.length - 1]
    if (lastGroup && lastGroup.year === year) {
      lastGroup.items.push(entry)
    } else {
      yearGroups.push({ year, items: [entry] })
    }
  }
  return yearGroups
}

export default function Events({
  onSelectPerson,
  onSelectGroup,
  onSelectEvent,
  onManageTags,
}: {
  onSelectPerson: (person: { id: string; name: string }) => void
  onSelectGroup: (group: { id: string; name: string }) => void
  onSelectEvent: (event: { id: string; summary: string }) => void
  onManageTags: () => void
}) {
  const [moments, setMoments] = useState<Moment[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [tagFilter, setTagFilter] = useState('all')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [childrenByParentId, setChildrenByParentId] = useState<Map<string, ChildEventRef[]>>(new Map())
  const groupRoster = useGroupRoster()

  useEffect(() => {
    loadMoments()
    loadChildEvents()
  }, [])

  // Isolated from loadMoments' shared select on purpose — that query has no error handling
  // today, so bolting an unmigrated column onto it would turn a missing-migration case into a
  // full outage instead of a degraded one. Fails open to "no sub-events" (same reasoning as
  // GroupDetail.tsx's loadSubgroups) so a not-yet-run migration doesn't break this list.
  async function loadChildEvents() {
    const { data, error } = await supabase
      .from('moments')
      .select('id, occasion, event_date, event_end_date, created_at, parent_moment_id, notes(people(id))')
      .not('parent_moment_id', 'is', null)
      .order('event_date', { ascending: true, nullsFirst: false })
    if (error || !data) {
      setChildrenByParentId(new Map())
      return
    }
    const map = new Map<string, ChildEventRef[]>()
    for (const row of data as unknown as ChildEventRef[]) {
      const list = map.get(row.parent_moment_id) ?? []
      list.push(row)
      map.set(row.parent_moment_id, list)
    }
    setChildrenByParentId(map)
  }

  async function loadMoments() {
    setLoading(true)
    const { data } = await supabase
      .from('moments')
      .select(
        'id, occasion, location, when_text, event_date, event_end_date, raw_description, created_at, notes(people(id, name, last_name)), moment_groups(groups(id, name)), moment_tags(tags(id, name))'
      )

    const sorted = ((data as unknown as Moment[]) ?? []).sort(
      (a, b) => eventSortDate(b).getTime() - eventSortDate(a).getTime()
    )
    setMoments(sorted)
    setLoading(false)
  }

  // No form up front — this just creates a blank shell (matches "add a person" being an instant
  // save, not a multi-step wizard) and drops the user straight onto the new event's own page,
  // where title/description/attendees/groups all get filled in with the tools already built
  // there. raw_description starts as '' rather than null (the column has never allowed null —
  // converse always populates it from the chat transcript) and the event page itself knows not
  // to waste an AI call summarizing an empty description (see EventDetail's gated generateSummary).
  async function handleAddEvent() {
    setCreating(true)
    setCreateError(null)
    const {
      data: { user },
    } = await supabase.auth.getUser()

    const { data, error } = await supabase
      .from('moments')
      .insert({
        user_id: user?.id,
        raw_description: '',
        occasion: null,
        location: null,
        when_text: null,
        event_date: null,
      })
      .select()
      .single()

    setCreating(false)
    if (error || !data) {
      setCreateError("Couldn't start a new event — please try again.")
      return
    }

    // Most logged moments are things the founder actually experienced, so tag them as an
    // attendee immediately instead of making them tap themselves into "Who was there" every
    // time — same notes-row shape EventDetail.tsx's own handleAddAttendee writes.
    const { data: self } = await supabase.from('people').select('id').eq('is_self', true).maybeSingle()
    if (self) {
      await supabase.from('notes').insert({ person_id: self.id, moment_id: data.id, content: 'Was there.' })
    }

    onSelectEvent({ id: data.id, summary: 'Untitled moment' })
  }

  // Growing picklist, not a hardcoded list like GROUP_TYPES — the founder wants categories
  // derived from tags actually applied, so this is just the distinct set in use. Memoized so it
  // doesn't recompute on every keystroke of the search box below (only when moments changes).
  const distinctTags = useMemo(() => {
    const names = new Set<string>()
    for (const m of moments) {
      for (const mt of m.moment_tags ?? []) {
        if (mt.tags) names.add(mt.tags.name)
      }
    }
    return [...names].sort()
  }, [moments])

  if (loading) return <p style={{ textAlign: 'center', marginTop: '3rem' }}>Loading…</p>

  return (
    <EventsView
      moments={moments}
      distinctTags={distinctTags}
      search={search}
      onSearchChange={setSearch}
      tagFilter={tagFilter}
      onTagFilterChange={setTagFilter}
      onAddEvent={handleAddEvent}
      creating={creating}
      createError={createError}
      onManageTags={onManageTags}
      onSelectPerson={onSelectPerson}
      onSelectGroup={onSelectGroup}
      onSelectEvent={onSelectEvent}
      childrenByParentId={childrenByParentId}
      groupLabel={groupRoster.label}
    />
  )
}

// Pure render — split out (2026-07-22) so the landing-page demo can render the exact same list UI
// fed by static data, with no Supabase calls. `readOnly` hides "+ Add Event" (a real insert) and
// "Manage tags →" (a separate real page not part of the demo).
export function EventsView({
  moments,
  distinctTags,
  search,
  onSearchChange,
  tagFilter,
  onTagFilterChange,
  onAddEvent,
  creating,
  createError,
  onManageTags,
  onSelectPerson,
  onSelectGroup,
  onSelectEvent,
  childrenByParentId = new Map(),
  groupLabel = (_id, fallbackName) => fallbackName,
  readOnly = false,
}: {
  moments: Moment[]
  distinctTags: string[]
  search: string
  onSearchChange: (value: string) => void
  tagFilter: string
  onTagFilterChange: (value: string) => void
  onAddEvent: () => void
  creating: boolean
  createError: string | null
  onManageTags: () => void
  onSelectPerson: (person: { id: string; name: string }) => void
  onSelectGroup: (group: { id: string; name: string }) => void
  onSelectEvent: (event: { id: string; summary: string }) => void
  childrenByParentId?: Map<string, ChildEventRef[]>
  // Qualifies a subgroup as "Parent / Child". Defaults to the bare name for the landing-page demo.
  groupLabel?: GroupLabelFn
  readOnly?: boolean
}) {
  const [expandedParents, setExpandedParents] = useState<Set<string>>(new Set())

  // Sub-events are visually bundled under their parent (see the card rendering below) rather
  // than shown as their own independent chronological entries, so they're excluded here before
  // decorating/filtering/grouping — otherwise a vacation's days would show up twice: once nested
  // under the trip, once again as flat standalone cards.
  const childIds = new Set(Array.from(childrenByParentId.values()).flat().map((c) => c.id))
  const rootMoments = moments.filter((m) => !childIds.has(m.id))
  const decorated = decorateMoments(rootMoments)
  const filteredMoments = filterMoments(decorated, search, tagFilter, groupLabel)
  const yearGroups = groupMomentsByYear(filteredMoments)
  const query = search.trim().toLowerCase()

  function toggleExpanded(momentId: string) {
    setExpandedParents((prev) => {
      const next = new Set(prev)
      if (next.has(momentId)) next.delete(momentId)
      else next.add(momentId)
      return next
    })
  }

  return (
    <div style={styles.page}>
      <div style={styles.headingRow}>
        <h1 style={styles.heading}>Events</h1>
        {!readOnly && (
          <button type="button" onClick={onAddEvent} style={styles.addButton} disabled={creating}>
            {creating ? '…' : '+ Add Event'}
          </button>
        )}
      </div>
      {!readOnly && (
        <button type="button" onClick={onManageTags} style={styles.manageTagsLink}>
          Manage tags →
        </button>
      )}
      {createError && <p style={styles.addErrorText}>{createError}</p>}

      {moments.length === 0 && (
        <p style={styles.empty}>
          No moments recorded yet — add one above, or head to Home and tell me about something that happened.
        </p>
      )}

      {moments.length > 0 && (
        <div style={styles.searchRow}>
          <SearchBox value={search} onChange={onSearchChange} placeholder="Search events…" />
          {distinctTags.length > 0 && (
            <select
              value={tagFilter}
              onChange={(e) => onTagFilterChange(e.target.value)}
              style={styles.tagFilterSelect}
              aria-label="Filter by tag"
            >
              <option value="all">All tags</option>
              <option value="untagged">No tags yet</option>
              {distinctTags.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          )}
        </div>
      )}

      {moments.length > 0 && filteredMoments.length === 0 && (
        <p style={styles.empty}>
          {query ? `No events match "${search}".` : 'No events have this tag yet.'}
        </p>
      )}

      <div style={styles.list}>
        {yearGroups.map(({ year, items }) => (
          <div key={year}>
            <h2 style={styles.yearHeading}>{year}</h2>
            <div style={styles.yearCards}>
              {items.map(({ moment, attendees, summary, groups }) => {
                const children = childrenByParentId.get(moment.id) ?? []
                const expanded = expandedParents.has(moment.id)
                return (
                  <div key={moment.id}>
                    <div style={styles.card}>
                      <div style={styles.cardHeaderRow}>
                        <div style={styles.cardHeaderMain}>
                          <button onClick={() => onSelectEvent({ id: moment.id, summary })} style={styles.titleButton}>
                            {moment.occasion || 'Untitled moment'}
                          </button>
                          <p style={styles.meta}>
                            {[formatEventWhen(moment), moment.location].filter(Boolean).join(' · ') || 'No date or location yet'}
                          </p>
                        </div>
                        {children.length > 0 && (
                          <button type="button" onClick={() => toggleExpanded(moment.id)} style={styles.subEventToggle}>
                            {children.length} sub-event{children.length === 1 ? '' : 's'} {expanded ? '▾' : '▸'}
                          </button>
                        )}
                      </div>

                      {attendees.size === 0 ? (
                        <p style={styles.empty}>No one tagged yet.</p>
                      ) : (
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
                            <GroupChip key={g.id} label={groupLabel(g.id, g.name)} onClick={() => onSelectGroup(g)} />
                          ))}
                        </div>
                      )}
                    </div>

                    {children.length > 0 && expanded && (
                      <div style={styles.childEventList}>
                        {children.map((ce) => {
                          const attendeeCount = new Set((ce.notes ?? []).filter((n) => n.people).map((n) => n.people!.id)).size
                          return (
                            <button
                              key={ce.id}
                              type="button"
                              onClick={() => onSelectEvent({ id: ce.id, summary: ce.occasion || 'Untitled moment' })}
                              style={styles.childEventCard}
                            >
                              <span style={styles.childEventName}>{ce.occasion || 'Untitled moment'}</span>
                              <span style={styles.childEventMeta}>
                                {formatFullDate(ce)}
                                {attendeeCount > 0 ? ` · ${attendeeCount} ${attendeeCount === 1 ? 'person' : 'people'}` : ''}
                              </span>
                            </button>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

const styles: { [key: string]: React.CSSProperties } = {
  page: { maxWidth: maxWidth.page, margin: '0 auto', padding: '2rem 1.5rem', fontFamily },
  headingRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: space.xl, marginBottom: space.xl, flexWrap: 'wrap' },
  heading: { fontSize: fontSize.h1, color: colors.ink, margin: 0 },
  addButton: {
    fontSize: fontSize.base,
    padding: '0.6rem 1.1rem',
    borderRadius: radius.md,
    border: 'none',
    backgroundColor: colors.ink,
    color: colors.onFill,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    fontFamily,
  },
  addErrorText: { color: colors.danger, fontSize: fontSize.body, marginBottom: space.xl },
  manageTagsLink: {
    display: 'inline-block',
    background: 'none',
    border: 'none',
    color: colors.ink,
    fontSize: fontSize.body,
    cursor: 'pointer',
    padding: 0,
    marginBottom: space.xl,
    fontFamily,
  },
  searchRow: { display: 'flex', gap: space.lg, alignItems: 'flex-start', marginBottom: space.xxxl },
  tagFilterSelect: {
    flexShrink: 0,
    fontSize: fontSize.base,
    padding: '0.65rem 0.75rem',
    borderRadius: radius.md,
    border: border.default,
    fontFamily,
    backgroundColor: colors.surface,
    color: colors.inkPlain,
  },
  empty: { color: colors.textSubtle },
  list: { display: 'flex', flexDirection: 'column', gap: space.xl },
  yearHeading: {
    position: 'sticky',
    top: 0,
    zIndex: 1,
    fontSize: fontSize.h3,
    color: colors.ink,
    margin: 0,
    padding: '0.6rem 0 0.4rem 0',
    backgroundColor: colors.appBg,
    borderBottom: `1px solid ${neutral.grey200}`,
  },
  yearCards: { display: 'flex', flexDirection: 'column', gap: space.xl, marginTop: space.lg },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: '1.25rem',
    boxShadow: shadow.card,
  },
  cardHeaderRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: space.lg },
  cardHeaderMain: { flex: 1, minWidth: 0 },
  titleButton: {
    display: 'block',
    margin: '0 0 0.25rem 0',
    padding: 0,
    fontSize: fontSize.h3,
    fontFamily,
    color: colors.inkPlain,
    background: 'none',
    border: 'none',
    textAlign: 'left',
    cursor: 'pointer',
  },
  meta: { margin: '0 0 0.75rem 0', fontSize: fontSize.bodyLg, color: colors.textMuted, fontStyle: 'italic' },
  chipRow: { display: 'flex', gap: space.md, marginTop: space.md, flexWrap: 'wrap' },
  subEventToggle: {
    flexShrink: 0,
    fontSize: fontSize.label,
    background: 'none',
    border: 'none',
    color: colors.suggest,
    cursor: 'pointer',
    padding: 0,
    fontFamily,
    whiteSpace: 'nowrap',
  },
  childEventList: {
    marginLeft: '1.4rem',
    borderLeft: '2px solid #E5DCC3',
    paddingLeft: space.xl,
    marginTop: space.md,
    display: 'flex',
    flexDirection: 'column',
    gap: space.md,
  },
  childEventCard: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: '0.15rem',
    textAlign: 'left',
    backgroundColor: colors.surface,
    border: '1px solid #ECE7DA',
    borderRadius: radius.lg,
    padding: '0.6rem 0.85rem',
    cursor: 'pointer',
    fontFamily,
    width: '100%',
  },
  childEventName: { fontSize: fontSize.bodyLg, color: colors.inkPlain },
  childEventMeta: { fontSize: fontSize.small, color: colors.textFaint },
}
