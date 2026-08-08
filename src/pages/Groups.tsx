import { useEffect, useRef, useState } from 'react'
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
} from '@dnd-kit/core'
import { supabase } from '../lib/supabase'
import { summarize } from '../lib/summarize'
import { PersonChip, EventChip } from '../components/Chips'
import SearchBox from '../components/SearchBox'
import { DEFAULT_GROUP_TYPES, loadGroupTypeNames } from '../lib/groupTypes'
import { useGroupRoster, type GroupLabelFn } from '../lib/groupRoster'
import { isSelfOrDescendant } from '../lib/groupDisplayName'
import { border, colors, fontFamily, fontSize, maxWidth, radius, shadow, space } from '../lib/theme'

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
// Past this depth rows stop indenting further — on a 375px phone an uncapped indent would starve
// a deeply nested card of width. Nesting past it still reads from the rows above.
const INDENT_MAX_DEPTH = 4

export type GroupRow = {
  group: Group
  explicitMembers: PersonRef[]
  events: { id: string; summary: string }[]
}
export type FlatGroupRow = GroupRow & { depth: number; hasChildren: boolean }

// Nests the filtered rows into a parent/child forest and flattens it back out with a `depth` on
// each row. A flat list (rather than nested JSX) is what the rest of the page wants: every row
// needs its own drag/drop hooks, and hooks can't be called from a recursive render without the
// call count shifting as branches collapse.
export function flattenGroupTree(rows: GroupRow[], collapsedIds: Set<string> = new Set()): FlatGroupRow[] {
  const byId = new Map(rows.map((r) => [r.group.id, r]))
  const childrenByParent = new Map<string | null, GroupRow[]>()
  for (const row of rows) {
    // A row whose parent isn't in `rows` — filtered out by a type filter, or not loaded yet — is
    // treated as a root. Otherwise it would be unreachable from any root and vanish off the page
    // entirely, which is how a group silently "disappears" from the only list that shows it.
    const rawParent = row.group.parent_group_id ?? null
    const parentId = rawParent && byId.has(rawParent) ? rawParent : null
    const siblings = childrenByParent.get(parentId)
    if (siblings) siblings.push(row)
    else childrenByParent.set(parentId, [row])
  }

  const out: FlatGroupRow[] = []
  // Guards a cycle in the data (the DB CHECK only rejects a group being its OWN direct parent, so
  // A -> B -> A is still representable) — without it this recursion would never bottom out.
  const visited = new Set<string>()
  function walk(parentId: string | null, depth: number) {
    for (const row of childrenByParent.get(parentId) ?? []) {
      if (visited.has(row.group.id)) continue
      visited.add(row.group.id)
      const children = childrenByParent.get(row.group.id) ?? []
      out.push({ ...row, depth, hasChildren: children.length > 0 })
      if (!collapsedIds.has(row.group.id)) walk(row.group.id, depth + 1)
    }
  }
  walk(null, 0)
  return out
}

export function filterGroups(
  groups: Group[],
  search: string,
  typeFilter: string,
  // Matches on the qualified "Parent / Child" label, so searching a parent's name turns up its
  // subgroups. Defaults to the bare name (landing-page demo, which has no subgroups).
  groupLabel: GroupLabelFn = (_id, fallbackName) => fallbackName
): GroupRow[] {
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
    // Subgroups are IN the resting list as of 2026-08-03 (founder ask), nested and indented under
    // their parent by flattenGroupTree rather than listed flat — the indentation is what makes a
    // drag-to-reparent legible, and it reverses the original item-19 "keep them out of the list"
    // call, which predated there being any way to see the hierarchy here at all.
    if (!query) return true
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
  const [groupTypes, setGroupTypes] = useState<string[]>([...DEFAULT_GROUP_TYPES])
  const [loading, setLoading] = useState(true)
  const [addingGroup, setAddingGroup] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)
  const requestedSummaries = useRef(new Set<string>())
  const groupRoster = useGroupRoster()

  useEffect(() => {
    loadGroups()
    loadGroupTypeNames().then(setGroupTypes)
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

  // `silent` skips the loading flip: after a drag-drop the list is already showing the group in
  // its new spot, and flashing "Loading…" over the whole page would read as the drop bouncing.
  async function loadGroups(silent = false) {
    if (!silent) setLoading(true)
    const baseSelect =
      'id, name, summary, group_type, person_groups(people(id, name, last_name, is_self)), moment_groups(moments(id, occasion, raw_description))'
    // Falls open to the narrower select if parent_group_id doesn't exist yet (migration not run,
    // see PROJECT_CONTEXT.md §10) rather than erroring out to an empty page; without the column
    // nothing has a parent, so the tree below degrades to the flat list this page used to be.
    let { data, error } = await supabase.from('groups').select(`${baseSelect}, parent_group_id`).order('name')
    if (error) {
      const fallback = await supabase.from('groups').select(baseSelect).order('name')
      data = fallback.data as typeof data
    }

    const loaded = (data as unknown as Group[]) ?? []
    setGroups(loaded)
    setLoading(false)

    // Covers subgroups too as of 2026-08-03, because they're now shown at rest. The old skip was
    // "don't pay for cards nobody asked to see" (CLAUDE.md rule 3) — that reasoning lapsed the
    // moment subgroups became visible here, and without this every subgroup row would sit on
    // "Figuring out what this group is about…" forever. Still one call per group EVER, not per
    // view: the result is cached in groups.summary, and it's the same call GroupDetail would have
    // made lazily on first open anyway — so this pulls that spend forward rather than adding to it.
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

  // Reparents an EXISTING group by dragging its card onto another's (parentId = null drops it
  // back to top level). Replaces the workaround the founder had been using — create a blank
  // subgroup in the target, open the real group, merge it away into the blank — which destroyed
  // and recreated a group to express what is really a one-column change. Nothing moves here: the
  // dragged group keeps its own members, notes, events and associations, it just gains a parent.
  //
  // No summary invalidation on either side — a group's cached summary describes its own members
  // and notes, neither of which this touches (CLAUDE.md rule 3).
  async function handleNestGroup(childId: string, parentId: string | null) {
    // Optimistic. The drag preview already drew the group in its new spot, so snapping it back to
    // the old position for the length of the round trip would read as the drop having failed.
    setGroups((prev) => prev.map((g) => (g.id === childId ? { ...g, parent_group_id: parentId } : g)))
    const { error } = await supabase.from('groups').update({ parent_group_id: parentId }).eq('id', childId)
    if (error) {
      setAddError("Couldn't move that group — please try again.")
      loadGroups(true) // puts it back wherever it actually still is
      return
    }
    setAddError(null)
    // Silent so the list doesn't flash "Loading…" under a drop that already visually landed.
    loadGroups(true)
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
      onNestGroup={handleNestGroup}
      typeOptions={groupTypes}
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
  onNestGroup = () => {},
  readOnly = false,
  typeOptions = [...DEFAULT_GROUP_TYPES],
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
  // Qualifies a subgroup as "Parent / Child". Used only in the flat search/filter view — in the
  // resting tree the indentation already says who the parent is, so rows there show a bare name.
  groupLabel?: GroupLabelFn
  onNestGroup?: (childId: string, parentId: string | null) => void
  readOnly?: boolean
  // The user's own editable list (Settings → Manage group types). Defaults to the built-ins for
  // the landing-page demo, which has no account to load them from.
  typeOptions?: string[]
}) {
  // Drag a group's card onto another's to make it a subgroup of that one, or onto the "top level"
  // strip to pull it back out. `activeId` is the card being dragged; `hoverParentId` is where it
  // would land right now — `undefined` means "not over any target", distinct from `null`, which
  // means "over the top-level strip".
  const [activeId, setActiveId] = useState<string | null>(null)
  const [hoverParentId, setHoverParentId] = useState<string | null | undefined>(undefined)
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set())

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    // Longer delay + movement tolerance than the mouse sensor so an ordinary finger swipe to
    // scroll this list isn't captured as a drag — only a real press-and-hold-then-move is. Same
    // values as the member-chip drag on GroupDetail, for one consistent gesture across the app.
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } })
  )

  // Where each group's parent really is, straight off the current data rather than the roster
  // hook — the roster is fetched once on mount, so after a drop it still describes the old tree.
  const parentById = new Map(groups.map((g) => [g.id, g.parent_group_id ?? null]))

  // The tree the page is actually rendering. While a drag is in flight over a valid target this
  // is the PREVIEW tree, with the dragged group already reparented — so it visibly indents under
  // the group you're hovering, and releasing simply keeps what you're already looking at. That's
  // what replaced the old drop-then-confirm banner (founder feedback: the confirm step made you
  // approve something you couldn't see yet).
  const previewGroups =
    activeId && hoverParentId !== undefined
      ? groups.map((g) => (g.id === activeId ? { ...g, parent_group_id: hoverParentId } : g))
      : groups

  const filteredGroups = filterGroups(previewGroups, search, typeFilter, groupLabel)

  // Any type a group is actually carrying gets an entry too, even if it's not on the editable list
  // any more (deleted in another tab, or an old value from before the list was editable) — without
  // that, those groups would be filterable only by "All types" and the filter would look broken.
  const filterTypeOptions = Array.from(
    new Set([...typeOptions, ...groups.map((g) => g.group_type).filter((t): t is string => !!t)])
  ).sort((a, b) => a.localeCompare(b))

  // A search or type filter falls back to the FLAT list this page has always shown for those:
  // filtering can drop a parent while keeping its child, and an indented tree with holes in it
  // is harder to read than a plain list of matches. The tree is for browsing; this is for lookup.
  const isFiltered = search.trim() !== '' || typeFilter !== 'all'
  // Hovering a collapsed group opens it for the duration of the drag — otherwise the row would
  // indent into a branch that isn't on screen and the drop would look like it did nothing.
  const effectiveCollapsed = new Set(collapsedIds)
  if (hoverParentId) effectiveCollapsed.delete(hoverParentId)
  const treeRows = flattenGroupTree(filteredGroups, effectiveCollapsed)
  const flatRows: FlatGroupRow[] = filteredGroups.map((r) => ({ ...r, depth: 0, hasChildren: false }))
  const rows = isFiltered ? flatRows : treeRows

  function handleDragEnd(event: DragEndEvent) {
    const childId = String(event.active.id).replace(/^drag:/, '')
    const landedOn = hoverParentId
    setActiveId(null)
    setHoverParentId(undefined)
    // Released outside any target, or dropped back where it already was: no write at all.
    if (landedOn === undefined) return
    if ((parentById.get(childId) ?? null) === landedOn) return
    onNestGroup(childId, landedOn)
  }

  function handleDragOver(event: DragOverEvent) {
    const childId = String(event.active.id).replace(/^drag:/, '')
    if (!event.over) {
      setHoverParentId(undefined)
      return
    }
    const rawOver = String(event.over.id)
    if (rawOver === ROOT_DROP_ID) {
      setHoverParentId(null)
      return
    }
    const overId = rawOver.replace(/^drop:/, '')
    // Can't nest a group under itself or under something already beneath it — that would cut the
    // whole branch loose from every root, leaving it unreachable from the only page that lists it.
    if (isSelfOrDescendant(overId, childId, parentById)) {
      setHoverParentId(undefined)
      return
    }
    setHoverParentId(overId)
  }

  function toggleCollapsed(id: string) {
    setCollapsedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const list = (
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
            {filterTypeOptions.map((t) => (
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

      {/* Only while a drag is in flight, and only for a group that currently HAS a parent —
          "drag it back out from the list" needs somewhere to drop, and a strip that's always
          there would be permanent furniture for an action most groups can't take. */}
      {activeId && (parentById.get(activeId) ?? null) !== null && (
        <TopLevelDropStrip isActive={hoverParentId === null} />
      )}

      <div style={styles.list}>
        {rows.map(({ group, explicitMembers, events, depth, hasChildren }) => (
          <GroupCard
            key={group.id}
            group={group}
            explicitMembers={explicitMembers}
            events={events}
            // Bare name in the tree — the indentation already shows the parent, so a qualified
            // "A / B / C" on an indented row is both redundant and much wider on a phone.
            label={isFiltered ? groupLabel(group.id, group.name) : group.name}
            depth={depth}
            hasChildren={hasChildren}
            collapsed={collapsedIds.has(group.id)}
            onToggleCollapsed={() => toggleCollapsed(group.id)}
            draggable={!readOnly}
            isDragActive={activeId !== null}
            isBeingDragged={activeId === group.id}
            isDropTarget={hoverParentId === group.id}
            onSelectPerson={onSelectPerson}
            onSelectGroup={onSelectGroup}
            onSelectEvent={onSelectEvent}
          />
        ))}
      </div>
    </div>
  )

  // The landing-page demo renders this same list with readOnly — no drag sensors, no DndContext,
  // so the demo stays a pure static render with nothing that could fire a write.
  if (readOnly) return list

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragStart={(event) => {
        setActiveId(String(event.active.id).replace(/^drag:/, ''))
        setHoverParentId(undefined)
      }}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={() => {
        setActiveId(null)
        setHoverParentId(undefined)
      }}
    >
      {list}
      <DragOverlay>
        {activeId ? (
          <div style={styles.dragOverlayPill}>{groups.find((g) => g.id === activeId)?.name ?? 'Group'}</div>
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}

// The id is a fixed sentinel rather than a group id so handleDragOver can tell "drop me at the
// top level" apart from "drop me onto a group" without a second lookup.
const ROOT_DROP_ID = 'drop:__root__'

function TopLevelDropStrip({ isActive }: { isActive: boolean }) {
  const { setNodeRef } = useDroppable({ id: ROOT_DROP_ID })
  return (
    <div ref={setNodeRef} style={{ ...styles.rootDropStrip, ...(isActive ? styles.rootDropStripActive : {}) }}>
      Drop here to make it a top-level group
    </div>
  )
}

// One group card. Split into its own component because each card needs its own useDraggable and
// useDroppable call — hooks can't be called inside a bare .map() callback, since the number of
// hook calls per render has to stay stable and filteredGroups changes length as you search.
//
// The card is a drop target as a whole, but only the grip handle is a drag source: making the
// whole card draggable would swallow clicks on the member/event chips inside it, which are the
// card's primary interaction.
function GroupCard({
  group,
  explicitMembers,
  events,
  label,
  depth,
  hasChildren,
  collapsed,
  onToggleCollapsed,
  draggable,
  isDragActive,
  isBeingDragged,
  isDropTarget,
  onSelectPerson,
  onSelectGroup,
  onSelectEvent,
}: {
  group: Group
  explicitMembers: PersonRef[]
  events: { id: string; summary: string }[]
  label: string
  depth: number
  hasChildren: boolean
  collapsed: boolean
  onToggleCollapsed: () => void
  draggable: boolean
  isDragActive: boolean
  isBeingDragged: boolean
  isDropTarget: boolean
  onSelectPerson: (person: { id: string; name: string }) => void
  onSelectGroup: (group: { id: string; name: string }) => void
  onSelectEvent: (event: { id: string; summary: string }) => void
}) {
  const shownMembers = explicitMembers.slice(0, MEMBER_LIMIT)
  const shownEvents = events.slice(0, AFFILIATION_LIMIT)

  // Prefixed ids: a card is BOTH a draggable and a droppable, and dnd-kit keeps those in separate
  // registries but reports them through the same `active`/`over` ids — sharing a raw group id
  // between the two makes the drag-over handler ambiguous about which role it's reading.
  const { attributes, listeners, setNodeRef: setDragRef } = useDraggable({ id: `drag:${group.id}`, disabled: !draggable })
  const { setNodeRef: setDropRef } = useDroppable({ id: `drop:${group.id}`, disabled: !draggable })

  return (
    <div
      ref={setDropRef}
      style={{
        // Indent caps out at INDENT_MAX_DEPTH so a deep branch can't squeeze the card down to a
        // sliver on a phone — past that, depth still reads from the nesting of the rows above.
        marginLeft: `${Math.min(depth, INDENT_MAX_DEPTH) * 1.25}rem`,
        // A left rule on anything nested, so a child still reads as "inside" its parent once the
        // indent stops growing.
        borderLeft: depth > 0 ? `2px solid ${colors.inkPale}` : undefined,
        ...styles.card,
        ...(isDragActive && !isBeingDragged ? styles.cardDroppable : {}),
        ...(isDropTarget ? styles.cardDropActive : {}),
        ...(isBeingDragged ? styles.cardBeingDragged : {}),
      }}
    >
      <div style={styles.titleRow}>
        {draggable && (
          <span
            ref={setDragRef}
            {...listeners}
            {...attributes}
            style={styles.dragHandle}
            // touch-action has to be in place before a finger lands (the browser compositor reads
            // it at touch-start, not mid-gesture), so it's set here rather than while dragging.
            title="Drag onto another group to make this a subgroup of it"
            aria-label={`Drag ${label} onto another group to make it a subgroup`}
          >
            ⠿
          </span>
        )}
        {hasChildren && (
          <button
            type="button"
            onClick={onToggleCollapsed}
            style={styles.collapseButton}
            aria-expanded={!collapsed}
            aria-label={collapsed ? `Show subgroups of ${label}` : `Hide subgroups of ${label}`}
          >
            {collapsed ? '▸' : '▾'}
          </button>
        )}
        <button onClick={() => onSelectGroup(group)} style={styles.titleButton}>
          {label}
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
    backgroundColor: colors.primary,
    color: colors.onFill,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    fontFamily,
  },
  addErrorText: { color: colors.danger, fontSize: fontSize.body, marginBottom: space.xl },
  searchRow: { display: 'flex', gap: space.lg, alignItems: 'flex-start', marginBottom: space.xxxl },
  typeFilterSelect: {
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
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: '1.25rem',
    boxShadow: shadow.card,
  },
  // Deliberately the green "ink" family rather than the gold "suggestion" family used for AI
  // suggestions elsewhere, so "I dragged this myself" never reads as "the AI proposed this".
  cardDroppable: { outline: `1px dashed ${colors.primary}`, outlineOffset: '2px' },
  cardDropActive: { outline: `2px solid ${colors.primary}`, outlineOffset: '2px', backgroundColor: colors.inkWash },
  cardBeingDragged: { opacity: 0.4 },
  dragHandle: {
    cursor: 'grab',
    color: colors.textFaintest,
    fontSize: fontSize.base,
    lineHeight: 1,
    padding: '0.15rem 0.1rem',
    touchAction: 'none',
    userSelect: 'none',
  },
  dragOverlayPill: {
    fontSize: fontSize.base,
    padding: '0.5rem 1rem',
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
    color: colors.onFill,
    boxShadow: shadow.card,
    fontFamily,
    cursor: 'grabbing',
  },
  rootDropStrip: {
    border: `1px dashed ${colors.primary}`,
    borderRadius: radius.md,
    padding: '0.75rem 1rem',
    marginBottom: space.lg,
    fontSize: fontSize.body,
    color: colors.textMuted,
    textAlign: 'center',
    backgroundColor: colors.inkWash,
  },
  rootDropStripActive: { border: `2px solid ${colors.primary}`, backgroundColor: colors.inkPale, color: colors.inkPlain },
  collapseButton: {
    background: 'none',
    border: 'none',
    padding: '0 0.15rem',
    fontSize: fontSize.base,
    lineHeight: 1,
    color: colors.textSubtle,
    cursor: 'pointer',
    fontFamily,
  },
  titleRow: { display: 'flex', alignItems: 'center', gap: space.md, marginBottom: '0.25rem', flexWrap: 'wrap' },
  titleButton: {
    display: 'block',
    margin: 0,
    padding: 0,
    fontSize: fontSize.h3,
    fontFamily,
    color: colors.inkPlain,
    background: 'none',
    border: 'none',
    textAlign: 'left',
    cursor: 'pointer',
  },
  typeBadge: {
    fontSize: fontSize.micro,
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
    color: colors.suggest,
    backgroundColor: colors.suggestBg,
    border: border.suggest,
    borderRadius: radius.pill,
    padding: '0.15rem 0.55rem',
  },
  summary: { margin: '0 0 0.75rem 0', fontSize: fontSize.bodyLg, color: colors.textMuted, fontStyle: 'italic' },
  chipRow: { display: 'flex', gap: space.md, flexWrap: 'wrap', alignItems: 'center' },
  moreText: { fontSize: fontSize.label, color: colors.textFaintest, fontStyle: 'italic' },
}
