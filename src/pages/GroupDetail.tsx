import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import { summarize } from '../lib/summarize'
import { eventSortDate } from '../lib/dates'
import { sortByLastName } from '../lib/people'
import { GROUP_TYPES } from '../lib/groupTypes'
import { getRelationshipsMap, type PersonRelationships } from '../lib/relationshipsTable'
import { suggestFamilyMembers } from '../lib/relationshipSuggestions'
import EditButton from '../components/EditButton'
import RefreshButton from '../components/RefreshButton'
import { PersonChip, GroupChip } from '../components/Chips'
import UpdateGroupChat from '../components/UpdateGroupChat'
import PhotoGallery from '../components/PhotoGallery'
import VoiceInputButton from '../components/VoiceInputButton'
import AutoGrowTextarea from '../components/AutoGrowTextarea'
import SearchBox from '../components/SearchBox'

export type PersonRef = { id: string; name: string; last_name: string | null }
export type GroupRef = { id: string; name: string }
export type SubgroupRef = GroupRef & { group_type: string | null; person_groups: { people: PersonRef | null }[] }
export type GroupNote = { id: string; content: string; created_at: string }

export type Moment = {
  id: string
  occasion: string | null
  location: string | null
  when_text: string | null
  event_date: string | null
  raw_description: string
  summary: string | null
  created_at: string
  notes: { people: PersonRef | null }[]
  moment_groups: { groups: GroupRef | null }[]
}

// Explicit member chips collapse behind a "Show all" toggle past this count — roughly 3 lines
// at this page's width, same reasoning as Groups.tsx's MEMBER_LIMIT but expandable in place
// instead of linking out, since this already IS the group's own page.
const MEMBER_LIST_LIMIT = 12
// Suggested-member chips are capped to a batch at a time — a group associated with several large
// groups can otherwise surface hundreds of candidates at once. Adding or dismissing one shrinks
// the underlying suggestion pool, so the next candidate fills the batch in automatically.
const MEMBER_SUGGESTION_LIMIT = 20

export default function GroupDetail({
  groupId,
  groupName,
  onSelectPerson,
  onSelectGroup,
  onSelectEvent,
  onBack,
  backLabel,
  onRenamed,
  onMerged,
  onOpenFamilyTree,
}: {
  groupId: string
  groupName: string
  onSelectPerson: (person: { id: string; name: string }) => void
  onSelectGroup: (group: { id: string; name: string }) => void
  onSelectEvent: (event: { id: string; summary: string }) => void
  onBack: () => void
  backLabel: string
  onRenamed?: (newName: string) => void
  onMerged: (group: { id: string; name: string }) => void
  // memberIds, when present, scopes the tree to that group's own lineage (buildDescendantTree)
  // instead of the single centered person's full ego graph.
  onOpenFamilyTree: (personId: string, label: string, memberIds?: string[]) => void
}) {
  const [moments, setMoments] = useState<Moment[]>([])
  const [explicitMembers, setExplicitMembers] = useState<PersonRef[]>([])
  const [dismissedPersonIds, setDismissedPersonIds] = useState<string[]>([])
  const [confirmedAssociatedGroups, setConfirmedAssociatedGroups] = useState<GroupRef[]>([])
  const [dismissedGroupIds, setDismissedGroupIds] = useState<string[]>([])
  const [memberSharedGroups, setMemberSharedGroups] = useState<GroupRef[]>([])
  const [associatedGroupMembers, setAssociatedGroupMembers] = useState<PersonRef[]>([])
  const [loading, setLoading] = useState(true)
  const [name, setName] = useState(groupName)
  const [editingName, setEditingName] = useState(false)
  const [groupType, setGroupType] = useState<string | null>(null)
  const [savingType, setSavingType] = useState(false)
  const [nameInput, setNameInput] = useState(groupName)
  const [savingName, setSavingName] = useState(false)
  const [summary, setSummary] = useState<string | null>(null)
  const [refreshingSummary, setRefreshingSummary] = useState(false)
  const requestedMomentSummaries = useRef(new Set<string>())
  const [groupNotes, setGroupNotes] = useState<GroupNote[]>([])
  const [notesOpen, setNotesOpen] = useState(true)
  const [newNote, setNewNote] = useState('')
  const [savingNote, setSavingNote] = useState(false)
  const [showGroupPicker, setShowGroupPicker] = useState(false)
  const [pickableGroups, setPickableGroups] = useState<GroupRef[]>([])
  const [loadingPickableGroups, setLoadingPickableGroups] = useState(false)
  const [groupPickerSearch, setGroupPickerSearch] = useState('')
  const [membersExpanded, setMembersExpanded] = useState(false)
  const [suggestionsEnabled, setSuggestionsEnabled] = useState(false)
  const [deleteConfirming, setDeleteConfirming] = useState(false)
  const [actionBusy, setActionBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [mergeOpen, setMergeOpen] = useState(false)
  const [mergeSearch, setMergeSearch] = useState('')
  const [otherGroups, setOtherGroups] = useState<GroupRef[]>([])
  const [mergeCandidate, setMergeCandidate] = useState<GroupRef | null>(null)
  const [allPeople, setAllPeople] = useState<PersonRef[]>([])
  const [relationshipsById, setRelationshipsById] = useState<Map<string, PersonRelationships>>(new Map())
  const [selfId, setSelfId] = useState<string | null>(null)
  const [parentGroup, setParentGroup] = useState<GroupRef | null>(null)
  const [parentMembers, setParentMembers] = useState<PersonRef[]>([])
  const [subgroups, setSubgroups] = useState<SubgroupRef[]>([])
  const [addingSubgroup, setAddingSubgroup] = useState(false)
  const [subgroupError, setSubgroupError] = useState<string | null>(null)

  // Account-wide, fetched once — lets member chips show "You" instead of the founder's own name
  // (same pattern as EventDetail.tsx's selfId for attendee chips).
  useEffect(() => {
    supabase
      .from('people')
      .select('id')
      .eq('is_self', true)
      .maybeSingle()
      .then(({ data }) => setSelfId(data?.id ?? null))
  }, [])

  useEffect(() => {
    loadMoments()
    loadMembers()
    loadSummary()
    loadGroupNotes()
    loadAssociatedGroups()
    loadSuggestionsEnabled()
    loadSubgroups()
    setName(groupName)
    setNameInput(groupName)
    setEditingName(false)
    setDeleteConfirming(false)
    setMergeOpen(false)
    setMergeCandidate(null)
  }, [groupId])

  // Account-wide, not scoped to groupId — fetched once since it doesn't change as you navigate
  // between groups. Only needed to attach a name to a family-suggestion candidate below (see
  // memberIdsKey), same "small, one account's own data" reasoning as EventDetail.tsx's allPeople.
  useEffect(() => {
    supabase
      .from('people')
      .select('id, name, last_name')
      .order('name')
      .then(({ data }) => setAllPeople((data as PersonRef[]) ?? []))
  }, [])

  // Same idea as EventDetail.tsx's attendeeIdsKey: only this group's own explicit members' family
  // ties matter for the suggestion box below, so this stays scoped to a small id list rather than
  // pulling the whole relationships table on every group page view. Keyed off a sorted/joined
  // string so it only refetches when membership actually changes.
  const memberIdsKey = useMemo(() => explicitMembers.map((p) => p.id).sort().join(','), [explicitMembers])

  useEffect(() => {
    getRelationshipsMap(memberIdsKey ? memberIdsKey.split(',') : []).then(setRelationshipsById)
  }, [memberIdsKey])

  // Parent's own roster, fetched only once this group's parent is known — used purely as a
  // convenience suggestion source below (item 19, 2026-07-26), never to block adding someone
  // who isn't in the parent group.
  useEffect(() => {
    if (!parentGroup) {
      setParentMembers([])
      return
    }
    supabase
      .from('person_groups')
      .select('people(id, name, last_name)')
      .eq('group_id', parentGroup.id)
      .then(({ data }) => {
        const people = ((data as unknown as { people: PersonRef | null }[]) ?? [])
          .map((r) => r.people)
          .filter((p): p is PersonRef => p !== null)
        setParentMembers(people)
      })
  }, [parentGroup])

  async function loadGroupNotes() {
    const { data } = await supabase
      .from('notes')
      .select('id, content, created_at')
      .eq('group_id', groupId)
      .order('created_at', { ascending: false })
    setGroupNotes((data as unknown as GroupNote[]) ?? [])
  }

  async function submitGroupNote() {
    if (!newNote.trim()) return
    setSavingNote(true)
    await supabase.from('notes').insert({ group_id: groupId, person_id: null, content: newNote.trim() })
    setNewNote('')
    setSavingNote(false)
    loadGroupNotes()
  }

  async function handleEditGroupNote(noteId: string, newContent: string) {
    await supabase.from('notes').update({ content: newContent }).eq('id', noteId)
    loadGroupNotes()
  }

  async function handleDeleteGroupNote(noteId: string) {
    await supabase.from('notes').delete().eq('id', noteId)
    loadGroupNotes()
  }

  async function loadSummary() {
    setSummary(null)
    const { data } = await supabase.from('groups').select('summary').eq('id', groupId).single()
    if (data?.summary) {
      setSummary(data.summary)
    } else {
      const { data: generated } = await supabase.functions.invoke('summarize-group', { body: { groupId } })
      if (generated?.summary) setSummary(generated.summary)
    }
  }

  async function refreshSummary() {
    setRefreshingSummary(true)
    const { data } = await supabase.functions.invoke('summarize-group', { body: { groupId } })
    if (data?.summary) setSummary(data.summary)
    setRefreshingSummary(false)
  }

  // The explicit roster (person_groups) — "who I've said is in this group," independent of
  // whether they've attended any tagged event. Refetched fresh each time, not merged with
  // stale state, so a removal actually takes effect.
  async function loadMembers() {
    const { data } = await supabase
      .from('groups')
      .select('person_groups(people(id, name, last_name)), dismissed_person_ids, dismissed_group_ids, group_type')
      .eq('id', groupId)
      .single()

    const loaded = data as unknown as {
      person_groups: { people: PersonRef | null }[]
      dismissed_person_ids: string[] | null
      dismissed_group_ids: string[] | null
      group_type: string | null
    } | null

    const explicit = (loaded?.person_groups ?? [])
      .map((pg) => pg.people)
      .filter((p): p is PersonRef => p !== null)

    setExplicitMembers(explicit)
    setDismissedPersonIds(loaded?.dismissed_person_ids ?? [])
    setDismissedGroupIds(loaded?.dismissed_group_ids ?? [])
    setGroupType(loaded?.group_type ?? null)
    loadMemberSharedGroups(explicit.map((p) => p.id))
  }

  // Isolated from loadMembers' shared select on purpose — same reasoning as
  // loadSuggestionsEnabled: if parent_group_id doesn't exist yet (migration not run, see
  // PROJECT_CONTEXT.md §10), fail open to "no parent" instead of breaking the member list above.
  async function loadParent() {
    const { data, error } = await supabase.from('groups').select('parent_group_id').eq('id', groupId).single()
    const parentId = error ? null : (data as { parent_group_id: string | null } | null)?.parent_group_id ?? null
    if (!parentId) {
      setParentGroup(null)
      return
    }
    const { data: parent } = await supabase.from('groups').select('id, name').eq('id', parentId).single()
    setParentGroup((parent as GroupRef) ?? null)
  }

  // Item 19 (2026-07-26): child groups nested one level under this one — e.g. a specific mission
  // under a squadron, or a class year under a larger org. Only ever rendered when this group is
  // itself a root group (no parentGroup) — a subgroup doesn't get its own child subgroups in the
  // UI, even though the schema would technically allow it. Same fail-open-on-missing-column
  // reasoning as loadParent.
  async function loadSubgroups() {
    const { data, error } = await supabase
      .from('groups')
      .select('id, name, group_type, person_groups(people(id, name, last_name))')
      .eq('parent_group_id', groupId)
      .order('name')
    setSubgroups(error ? [] : (data as unknown as SubgroupRef[]) ?? [])
    loadParent()
  }

  // No form up front, same reasoning as Groups.tsx's handleAddGroup and EventDetail.tsx's "add an
  // event" — creates a blank shell and drops straight onto its own page. Deliberately does NOT
  // pre-populate membership from the parent roster (2026-07-26 lesson: no auto-added membership).
  async function handleAddSubgroup() {
    setAddingSubgroup(true)
    setSubgroupError(null)
    const {
      data: { user },
    } = await supabase.auth.getUser()

    const { data, error } = await supabase
      .from('groups')
      .insert({ name: 'New subgroup', user_id: user?.id, parent_group_id: groupId })
      .select()
      .single()

    setAddingSubgroup(false)
    if (error || !data) {
      setSubgroupError("Couldn't create a subgroup — please try again.")
      return
    }

    onSelectGroup({ id: data.id, name: data.name })
  }

  async function handleChangeType(value: string) {
    const newType = value || null
    setSavingType(true)
    const { error } = await supabase.from('groups').update({ group_type: newType }).eq('id', groupId)
    setSavingType(false)
    if (!error) setGroupType(newType)
  }

  // Isolated on purpose (not folded into loadMembers' shared select): if this column doesn't
  // exist yet (migration not run — see PROJECT_CONTEXT.md §10), fail open to "off" — matches the
  // default-off behavior everywhere else (founder feedback 2026-07-26) and doesn't blank out the
  // member list on every group's page.
  async function loadSuggestionsEnabled() {
    const { data, error } = await supabase.from('groups').select('suggestions_enabled').eq('id', groupId).single()
    setSuggestionsEnabled(error ? false : data?.suggestions_enabled ?? false)
  }

  // Item 57: per-group opt-out for the member-suggestion signal, read by both this page's own
  // suggestion card and Home's "Connections to make" card (lib/suggestConnections.ts). Optimistic
  // with a revert on failure, same pattern as other single-flag writes on this page.
  async function handleToggleSuggestions(enabled: boolean) {
    setSuggestionsEnabled(enabled)
    const { error } = await supabase.from('groups').update({ suggestions_enabled: enabled }).eq('id', groupId)
    if (error) setSuggestionsEnabled(!enabled)
  }

  // Scopes the tree to this group's own lineage (buildDescendantTree, via memberIds) rather than
  // any one member's full ego graph, so opening it from a Family-typed group shows the whole
  // family's downward fan from its eldest known generation instead of an arbitrary person's view.
  function handleGenerateFamilyTree() {
    const memberIds = explicitMembers.map((p) => p.id)
    onOpenFamilyTree(memberIds[0] ?? '', `${name} family tree`, memberIds)
  }

  // Candidate associated groups sourced from members: any OTHER group this group's own explicit
  // members explicitly belong to. Combined at render time with the event-co-tagging candidates
  // already derived from `moments` below, then filtered against confirmed/dismissed.
  async function loadMemberSharedGroups(memberIds: string[]) {
    if (memberIds.length === 0) {
      setMemberSharedGroups([])
      return
    }
    const { data } = await supabase
      .from('person_groups')
      .select('group_id, groups(id, name)')
      .in('person_id', memberIds)
      .neq('group_id', groupId)

    const byId = new Map<string, GroupRef>()
    for (const row of (data as unknown as { group_id: string; groups: GroupRef | null }[]) ?? []) {
      if (row.groups) byId.set(row.groups.id, row.groups)
    }
    setMemberSharedGroups([...byId.values()])
  }

  // Confirmed associated groups live in `group_associations`, a symmetric join table keyed by an
  // ordered pair (group_id_a < group_id_b, enforced client-side) so the same two groups can't be
  // linked twice regardless of which group's page the link was approved from.
  async function loadAssociatedGroups() {
    const { data } = await supabase
      .from('group_associations')
      .select('group_id_a, group_id_b')
      .or(`group_id_a.eq.${groupId},group_id_b.eq.${groupId}`)

    const otherIds = ((data as { group_id_a: string; group_id_b: string }[]) ?? []).map((r) =>
      r.group_id_a === groupId ? r.group_id_b : r.group_id_a
    )

    if (otherIds.length === 0) {
      setConfirmedAssociatedGroups([])
      setAssociatedGroupMembers([])
      return
    }

    const { data: groupsData } = await supabase.from('groups').select('id, name').in('id', otherIds)
    setConfirmedAssociatedGroups((groupsData as GroupRef[]) ?? [])
    loadAssociatedGroupMembers(otherIds)
  }

  // Candidate members sourced from associated groups: anyone explicitly in a CONFIRMED associated
  // group's own roster is worth suggesting here too — e.g. confirming "Air Force Academy" as
  // associated with "Air Force" surfaces the Academy's members as suggested Air Force members.
  // Symmetric, same as the association itself: it runs whichever group's page you're viewing.
  async function loadAssociatedGroupMembers(associatedGroupIds: string[]) {
    const { data } = await supabase
      .from('person_groups')
      .select('people(id, name, last_name)')
      .in('group_id', associatedGroupIds)

    const byId = new Map<string, PersonRef>()
    for (const row of (data as unknown as { people: PersonRef | null }[]) ?? []) {
      if (row.people) byId.set(row.people.id, row.people)
    }
    setAssociatedGroupMembers([...byId.values()])
  }

  async function handleApproveGroupSuggestion(group: GroupRef) {
    const [a, b] = [groupId, group.id].sort()
    await supabase
      .from('group_associations')
      .upsert({ group_id_a: a, group_id_b: b }, { onConflict: 'group_id_a,group_id_b', ignoreDuplicates: true })
    loadAssociatedGroups()
  }

  async function handleRemoveAssociatedGroup(group: GroupRef) {
    const [a, b] = [groupId, group.id].sort()
    await supabase.from('group_associations').delete().eq('group_id_a', a).eq('group_id_b', b)
    loadAssociatedGroups()
  }

  // Manual "Associate a New Group" picker — lists every other group so the user can link one
  // directly, independent of the event/member-based suggestion signals above. Reuses
  // handleApproveGroupSuggestion for the actual write, so a manually-added group behaves
  // identically to an approved suggestion (and disappears from this list once confirmed).
  async function openGroupPicker() {
    if (showGroupPicker) {
      setShowGroupPicker(false)
      return
    }
    setShowGroupPicker(true)
    setGroupPickerSearch('')
    setLoadingPickableGroups(true)
    const { data } = await supabase.from('groups').select('id, name').neq('id', groupId).order('name')
    setPickableGroups((data as GroupRef[]) ?? [])
    setLoadingPickableGroups(false)
  }

  // Same "stop suggesting this, but don't touch anything already confirmed" reasoning as
  // handleDenySuggestion above, just for groups instead of people.
  async function handleDenyGroupSuggestion(group: GroupRef) {
    const updated = [...dismissedGroupIds, group.id]
    setDismissedGroupIds(updated)
    await supabase.from('groups').update({ dismissed_group_ids: updated }).eq('id', groupId)
  }

  async function handleDenyAllGroupSuggestions(groups: GroupRef[]) {
    const updated = [...new Set([...dismissedGroupIds, ...groups.map((g) => g.id)])]
    setDismissedGroupIds(updated)
    await supabase.from('groups').update({ dismissed_group_ids: updated }).eq('id', groupId)
  }

  // Membership changed — the cached AI summary is now stale (same reasoning `update-group`
  // uses server-side), so clear it and let loadSummary() regenerate on next render.
  async function invalidateSummary() {
    await supabase.from('groups').update({ summary: null }).eq('id', groupId)
    loadSummary()
  }

  async function handleAddMember(person: PersonRef) {
    await supabase
      .from('person_groups')
      .upsert({ person_id: person.id, group_id: groupId }, { onConflict: 'person_id,group_id', ignoreDuplicates: true })
    loadMembers()
    invalidateSummary()
  }

  // Same idea as handleDenyAllSuggestions but confirming instead of dismissing — one upsert for
  // every currently-visible suggestion chip rather than one round trip per person.
  async function handleApproveAllSuggestions(people: PersonRef[]) {
    if (people.length === 0) return
    await supabase
      .from('person_groups')
      .upsert(
        people.map((p) => ({ person_id: p.id, group_id: groupId })),
        { onConflict: 'person_id,group_id', ignoreDuplicates: true }
      )
    loadMembers()
    invalidateSummary()
  }

  async function handleRemoveMember(person: PersonRef) {
    await supabase.from('person_groups').delete().eq('person_id', person.id).eq('group_id', groupId)
    loadMembers()
    invalidateSummary()
  }

  // "Denying" a suggested person just means "stop suggesting them for this group" — it's
  // remembered on the group itself (not undoable from the UI), separate from actual membership,
  // since this person was never a person_groups row to begin with.
  async function handleDenySuggestion(person: PersonRef) {
    const updated = [...dismissedPersonIds, person.id]
    setDismissedPersonIds(updated)
    await supabase.from('groups').update({ dismissed_person_ids: updated }).eq('id', groupId)
  }

  // Same as handleDenySuggestion, but for every currently-shown suggestion at once — clicking
  // through each one individually gets tedious once a group has more than a couple of shared
  // events. Denying still doesn't block adding someone through the "Edit this group" chat later
  // (that writes directly to person_groups, independent of dismissed_person_ids) — this list
  // only ever suppresses the suggestion chip itself.
  async function handleDenyAllSuggestions(people: PersonRef[]) {
    const updated = [...new Set([...dismissedPersonIds, ...people.map((p) => p.id)])]
    setDismissedPersonIds(updated)
    await supabase.from('groups').update({ dismissed_person_ids: updated }).eq('id', groupId)
  }

  async function loadMoments(silent = false) {
    if (!silent) setLoading(true)

    // Two steps on purpose: filtering the top-level query with `.eq('moment_groups.group_id', ...)`
    // also filters the EMBEDDED moment_groups array down to just this one group's row (a
    // PostgREST quirk), which would silently break the Associated Groups derivation below —
    // it needs every group each moment is tagged to, not just this one.
    const { data: taggedRows } = await supabase.from('moment_groups').select('moment_id').eq('group_id', groupId)
    const momentIds = (taggedRows ?? []).map((r) => r.moment_id)

    if (momentIds.length === 0) {
      setMoments([])
      if (!silent) setLoading(false)
      return
    }

    const { data } = await supabase
      .from('moments')
      .select(
        'id, occasion, location, when_text, event_date, raw_description, summary, created_at, notes(people(id, name, last_name)), moment_groups(group_id, groups(id, name))'
      )
      .in('id', momentIds)

    const sorted = ((data as unknown as Moment[]) ?? []).sort(
      (a, b) => eventSortDate(b).getTime() - eventSortDate(a).getTime()
    )
    setMoments(sorted)
    if (!silent) setLoading(false)

    for (const m of sorted) {
      if (!m.summary && !requestedMomentSummaries.current.has(m.id)) {
        requestedMomentSummaries.current.add(m.id)
        generateMomentSummary(m.id)
      }
    }
  }

  async function generateMomentSummary(momentId: string) {
    const { data } = await supabase.functions.invoke('summarize-moment', { body: { momentId } })
    if (data?.summary) {
      setMoments((prev) => prev.map((m) => (m.id === momentId ? { ...m, summary: data.summary } : m)))
    }
  }

  async function handleSaveName(e: FormEvent) {
    e.preventDefault()
    const trimmed = nameInput.trim()
    if (!trimmed || trimmed === name) {
      setEditingName(false)
      setNameInput(name)
      return
    }
    setSavingName(true)
    const { error } = await supabase.from('groups').update({ name: trimmed }).eq('id', groupId)
    setSavingName(false)
    if (error) return

    setName(trimmed)
    setEditingName(false)
    onRenamed?.(trimmed)
    // A manually-created group's cached summary can be generated against the placeholder name
    // ("New group") before it's ever renamed — invalidate on every rename so it regenerates
    // against the current name, same as any other underlying-data change.
    invalidateSummary()
  }

  async function openMerge() {
    setMergeOpen(true)
    setMergeCandidate(null)
    setMergeSearch('')
    if (otherGroups.length === 0) {
      const { data } = await supabase.from('groups').select('id, name').neq('id', groupId)
      setOtherGroups((data as GroupRef[]) ?? [])
    }
  }

  // Folds THIS group into `mergeCandidate` (the one picked from search) — same UX shape as
  // EventDetail.tsx's handleMergeEvent: the group standing on is the duplicate, the one searched
  // for and picked is the survivor. Membership (person_groups) and event tags (moment_groups) both
  // go through fetch-then-upsert-then-delete rather than a bulk UPDATE, since both have a
  // (x_id, group_id) unique constraint a duplicate's rows could collide with the survivor's own —
  // same reasoning as PersonDetail.tsx's handleMerge moving person_groups. group_associations gets
  // the same treatment, skipping/dropping any pair that would become a self-link (duplicate and
  // survivor already associated with each other) since that violates the table's own no-self-link
  // check. Free-standing group notes and source_group_id attribution just move by plain UPDATE —
  // neither column is part of a uniqueness constraint. The survivor's cached summary is cleared
  // to regenerate incorporating the newly-merged membership.
  async function handleMergeGroup() {
    if (!mergeCandidate) return
    setActionBusy(true)
    setActionError(null)
    const survivorId = mergeCandidate.id
    const duplicateId = groupId

    const [dupMembersRes, dupMomentsRes, dupAssociationsRes] = await Promise.all([
      supabase.from('person_groups').select('person_id').eq('group_id', duplicateId),
      supabase.from('moment_groups').select('moment_id').eq('group_id', duplicateId),
      supabase
        .from('group_associations')
        .select('group_id_a, group_id_b')
        .or(`group_id_a.eq.${duplicateId},group_id_b.eq.${duplicateId}`),
    ])

    for (const m of dupMembersRes.data ?? []) {
      await supabase
        .from('person_groups')
        .upsert({ person_id: m.person_id, group_id: survivorId }, { onConflict: 'person_id,group_id', ignoreDuplicates: true })
    }
    await supabase.from('person_groups').delete().eq('group_id', duplicateId)

    for (const m of dupMomentsRes.data ?? []) {
      await supabase
        .from('moment_groups')
        .upsert({ moment_id: m.moment_id, group_id: survivorId }, { onConflict: 'moment_id,group_id', ignoreDuplicates: true })
    }
    await supabase.from('moment_groups').delete().eq('group_id', duplicateId)

    for (const a of dupAssociationsRes.data ?? []) {
      const otherId = a.group_id_a === duplicateId ? a.group_id_b : a.group_id_a
      if (otherId !== survivorId) {
        const [x, y] = [survivorId, otherId].sort()
        await supabase
          .from('group_associations')
          .upsert({ group_id_a: x, group_id_b: y }, { onConflict: 'group_id_a,group_id_b', ignoreDuplicates: true })
      }
    }
    await supabase.from('group_associations').delete().or(`group_id_a.eq.${duplicateId},group_id_b.eq.${duplicateId}`)

    await supabase.from('notes').update({ group_id: survivorId }).eq('group_id', duplicateId)
    await supabase.from('notes').update({ source_group_id: survivorId }).eq('source_group_id', duplicateId)

    // Reparent the duplicate's own subgroups onto the survivor, so mission/class-year subgroups
    // of a merged-away group aren't silently orphaned to root. The `.neq('id', survivorId)` guard
    // covers the rare case of merging a group into its own subgroup (survivor's parent_group_id
    // already points at the duplicate) — without it this would try to make the survivor its own
    // parent, violating the self-parent CHECK constraint. Fails open if parent_group_id doesn't
    // exist yet (migration not run) — nothing to reparent in that case anyway.
    await supabase.from('groups').update({ parent_group_id: survivorId }).eq('parent_group_id', duplicateId).neq('id', survivorId)

    const { error } = await supabase.from('groups').delete().eq('id', duplicateId)
    if (error) {
      setActionError('Something went wrong merging these groups — please try again.')
      setActionBusy(false)
      return
    }
    await supabase.from('groups').update({ summary: null }).eq('id', survivorId)

    setMergeOpen(false)
    setMergeCandidate(null)
    setActionBusy(false)
    onMerged({ id: survivorId, name: mergeCandidate.name })
  }

  // Permanently removes this group and everything that ONLY makes sense tied to it — its
  // explicit membership, its own free-standing notes, its event tags, its associations with
  // other groups. Facts captured via this group's chat (notes.source_group_id) live on PEOPLE,
  // not the group, so those are kept — just detached from an attribution that would otherwise
  // point at a deleted row. Same reasoning/shape as EventDetail.tsx's handleDeleteEvent: a
  // deliberate whole-record delete, the safety net a manually-created group needs since there's
  // no automatic dedupe check on a typed-in name the way converse's findOrCreateGroupId has.
  async function handleDeleteGroup() {
    setActionBusy(true)
    setActionError(null)
    const results = await Promise.all([
      supabase.from('notes').update({ source_group_id: null }).eq('source_group_id', groupId),
      supabase.from('notes').delete().eq('group_id', groupId),
      supabase.from('person_groups').delete().eq('group_id', groupId),
      supabase.from('moment_groups').delete().eq('group_id', groupId),
      supabase.from('group_associations').delete().or(`group_id_a.eq.${groupId},group_id_b.eq.${groupId}`),
    ])
    const dependentsError = results.find((r) => r.error)?.error
    if (dependentsError) {
      setActionError('Something went wrong deleting this group — please try again.')
      setActionBusy(false)
      return
    }

    const { error } = await supabase.from('groups').delete().eq('id', groupId)
    if (error) {
      setActionError('Something went wrong deleting this group — please try again.')
      setActionBusy(false)
      return
    }
    onBack()
  }

  if (loading) return <p style={{ textAlign: 'center', marginTop: '3rem' }}>Loading…</p>

  // "Who's in this group" is the explicit roster (person_groups) ONLY — someone attending an
  // event tagged to this group doesn't make them a member (a shared event can be tagged to
  // multiple groups, e.g. a wedding tagged to both "Wings of Blue" and the couple's family
  // group; attendees of that event aren't members of every group it's tagged to). Attendees
  // who aren't explicit members are shown separately below, clearly labeled, not folded in.
  //
  // Suggested members combine two signals — anyone who attended an event tagged to this group
  // (event-based) and anyone who's an explicit member of a CONFIRMED associated group
  // (association-based, from loadAssociatedGroupMembers). Same "either signal is enough to
  // suggest" reasoning as the Associated Groups suggestions above.
  const explicitIds = new Set(explicitMembers.map((p) => p.id))
  const dismissedIds = new Set(dismissedPersonIds)
  const suggestedMembersById = new Map<string, PersonRef>()
  for (const m of moments) {
    for (const n of m.notes ?? []) {
      if (n.people && !explicitIds.has(n.people.id) && !dismissedIds.has(n.people.id)) {
        suggestedMembersById.set(n.people.id, n.people)
      }
    }
  }
  for (const p of associatedGroupMembers) {
    if (!explicitIds.has(p.id) && !dismissedIds.has(p.id)) suggestedMembersById.set(p.id, p)
  }
  const suggestedMembers = suggestionsEnabled ? sortByLastName([...suggestedMembersById.values()]) : []

  // Spouse of a current member, then that couple's kids once the spouse is ALSO a member — same
  // suggestFamilyMembers chaining as EventDetail.tsx's "Was their family there too?" box, applied
  // here to group membership instead of event attendance (founder feedback 2026-07-26: family
  // suggestions should chain everywhere a person gets suggested, not just on events). Excludes
  // anyone the event/associated-group box above already offers, so nobody is suggested twice.
  const familyExcludeIds = new Set([...dismissedIds, ...suggestedMembersById.keys()])
  const suggestedFamilyById = new Map<string, PersonRef>()
  for (const id of suggestFamilyMembers(explicitIds, relationshipsById, familyExcludeIds)) {
    const person = allPeople.find((p) => p.id === id)
    if (person) suggestedFamilyById.set(id, person)
  }
  const suggestedFamilyMembers = suggestionsEnabled ? sortByLastName([...suggestedFamilyById.values()]) : []

  // Convenience nudge shown only when viewing a subgroup: anyone already in the parent group's
  // roster, filtered against members/dismissed/already-suggested-elsewhere so nobody appears
  // twice. Purely a suggestion — adding someone NOT in the parent's roster is never blocked.
  const parentExcludeIds = new Set([...dismissedIds, ...suggestedMembersById.keys(), ...suggestedFamilyById.keys()])
  const suggestedParentMembers =
    suggestionsEnabled && parentGroup
      ? sortByLastName(parentMembers.filter((p) => !explicitIds.has(p.id) && !parentExcludeIds.has(p.id)))
      : []

  // Suggested associated groups combine two signals — any other group tagged to the same events
  // as this one (event-based, reusing the moments already loaded above, same one-hop reasoning as
  // EventDetail.tsx's "Affiliated Groups"), and any other group this group's own explicit members
  // explicitly belong to (member-based, loaded in loadMemberSharedGroups). Either signal is enough
  // to suggest — confirmed/dismissed groups are filtered out either way.
  const confirmedGroupIds = new Set(confirmedAssociatedGroups.map((g) => g.id))
  const dismissedGroupIdSet = new Set(dismissedGroupIds)
  const suggestedGroupsById = new Map<string, GroupRef>()
  for (const m of moments) {
    for (const mg of m.moment_groups ?? []) {
      if (mg.groups && mg.groups.id !== groupId && !confirmedGroupIds.has(mg.groups.id) && !dismissedGroupIdSet.has(mg.groups.id)) {
        suggestedGroupsById.set(mg.groups.id, mg.groups)
      }
    }
  }
  for (const g of memberSharedGroups) {
    if (!confirmedGroupIds.has(g.id) && !dismissedGroupIdSet.has(g.id)) suggestedGroupsById.set(g.id, g)
  }
  const suggestedAssociatedGroups = [...suggestedGroupsById.values()].sort((a, b) => a.name.localeCompare(b.name))

  return (
    <GroupDetailView
      groupId={groupId}
      name={name}
      groupType={groupType}
      summary={summary}
      moments={moments}
      explicitMembers={explicitMembers}
      selfId={selfId}
      suggestedMembers={suggestedMembers}
      suggestedFamilyMembers={suggestedFamilyMembers}
      parentGroup={parentGroup}
      subgroups={subgroups}
      addingSubgroup={addingSubgroup}
      subgroupError={subgroupError}
      onAddSubgroup={handleAddSubgroup}
      suggestedParentMembers={suggestedParentMembers}
      confirmedAssociatedGroups={confirmedAssociatedGroups}
      suggestedAssociatedGroups={suggestedAssociatedGroups}
      groupNotes={groupNotes}
      onSelectPerson={onSelectPerson}
      onSelectGroup={onSelectGroup}
      onSelectEvent={onSelectEvent}
      onBack={onBack}
      backLabel={backLabel}
      onOpenFamilyTree={handleGenerateFamilyTree}
      editingName={editingName}
      nameInput={nameInput}
      savingName={savingName}
      onStartEditName={() => setEditingName(true)}
      onNameInputChange={setNameInput}
      onSaveName={handleSaveName}
      onCancelEditName={() => {
        setEditingName(false)
        setNameInput(name)
      }}
      savingType={savingType}
      onChangeType={handleChangeType}
      refreshingSummary={refreshingSummary}
      onRefreshSummary={refreshSummary}
      membersExpanded={membersExpanded}
      onToggleMembersExpanded={() => setMembersExpanded((e) => !e)}
      onAddMember={handleAddMember}
      onRemoveMember={handleRemoveMember}
      suggestionsEnabled={suggestionsEnabled}
      onToggleSuggestions={handleToggleSuggestions}
      onApproveAllSuggestions={handleApproveAllSuggestions}
      onDenySuggestion={handleDenySuggestion}
      onDenyAllSuggestions={handleDenyAllSuggestions}
      showGroupPicker={showGroupPicker}
      onToggleGroupPicker={openGroupPicker}
      groupPickerSearch={groupPickerSearch}
      onGroupPickerSearchChange={setGroupPickerSearch}
      pickableGroups={pickableGroups}
      loadingPickableGroups={loadingPickableGroups}
      onApproveGroupSuggestion={handleApproveGroupSuggestion}
      onRemoveAssociatedGroup={handleRemoveAssociatedGroup}
      onDenyGroupSuggestion={handleDenyGroupSuggestion}
      onDenyAllGroupSuggestions={handleDenyAllGroupSuggestions}
      notesOpen={notesOpen}
      onToggleNotesOpen={() => setNotesOpen((o) => !o)}
      newNote={newNote}
      onNewNoteChange={setNewNote}
      savingNote={savingNote}
      onSubmitGroupNote={submitGroupNote}
      onEditGroupNote={handleEditGroupNote}
      onDeleteGroupNote={handleDeleteGroupNote}
      deleteConfirming={deleteConfirming}
      onStartDelete={() => setDeleteConfirming(true)}
      onCancelDelete={() => setDeleteConfirming(false)}
      onConfirmDelete={handleDeleteGroup}
      mergeOpen={mergeOpen}
      onOpenMerge={openMerge}
      mergeSearch={mergeSearch}
      onMergeSearchChange={setMergeSearch}
      otherGroups={otherGroups}
      mergeCandidate={mergeCandidate}
      onSelectMergeCandidate={setMergeCandidate}
      onCancelMerge={() => setMergeOpen(false)}
      onBackFromMergeCandidate={() => setMergeCandidate(null)}
      onConfirmMerge={handleMergeGroup}
      actionBusy={actionBusy}
      actionError={actionError}
      editChat={
        <UpdateGroupChat
          groupId={groupId}
          onSaved={({ rename }) => {
            if (rename) {
              setName(rename)
              onRenamed?.(rename)
            }
            // Silent: this fires after every chat turn now (not just the final "done" turn), so a
            // full loading-state flip here would unmount the in-progress chat mid-conversation.
            loadMoments(true)
            loadMembers()
            loadSummary()
            loadGroupNotes()
          }}
        />
      }
    />
  )
}

// Pure render — split out (2026-07-22) so the landing-page demo can render the exact same group
// UI fed by static data, with no Supabase/Edge Function calls. `readOnly` hides every write-only
// control (rename pencil, type picker → static badge, member add/remove, associated-group
// picker, suggestion banners, notes add/edit/delete, the "Edit this group" chat, delete) —
// everything else (summary, membership, moments, associated groups, navigation, the family-tree
// button) renders and behaves identically either way. `editChat` is a slot the real container
// fills with `UpdateGroupChat` — the demo simply doesn't pass it.
export function GroupDetailView({
  name,
  groupType,
  summary,
  moments,
  explicitMembers,
  selfId = null,
  suggestedMembers,
  suggestedFamilyMembers = [],
  parentGroup = null,
  subgroups = [],
  addingSubgroup = false,
  subgroupError = null,
  onAddSubgroup = () => {},
  suggestedParentMembers = [],
  confirmedAssociatedGroups,
  suggestedAssociatedGroups,
  groupNotes,
  onSelectPerson,
  onSelectGroup,
  onSelectEvent,
  onBack,
  backLabel,
  onOpenFamilyTree,
  readOnly = false,
  editingName = false,
  nameInput = '',
  savingName = false,
  onStartEditName = () => {},
  onNameInputChange = () => {},
  onSaveName = () => {},
  onCancelEditName = () => {},
  savingType = false,
  onChangeType = () => {},
  refreshingSummary = false,
  onRefreshSummary = () => {},
  membersExpanded = false,
  onToggleMembersExpanded = () => {},
  onAddMember = () => {},
  onRemoveMember = () => {},
  suggestionsEnabled = false,
  onToggleSuggestions = () => {},
  onApproveAllSuggestions = () => {},
  onDenySuggestion = () => {},
  onDenyAllSuggestions = () => {},
  showGroupPicker = false,
  onToggleGroupPicker = () => {},
  groupPickerSearch = '',
  onGroupPickerSearchChange = () => {},
  pickableGroups = [],
  loadingPickableGroups = false,
  onApproveGroupSuggestion = () => {},
  onRemoveAssociatedGroup = () => {},
  onDenyGroupSuggestion = () => {},
  onDenyAllGroupSuggestions = () => {},
  notesOpen = true,
  onToggleNotesOpen = () => {},
  newNote = '',
  onNewNoteChange = () => {},
  savingNote = false,
  onSubmitGroupNote = () => {},
  onEditGroupNote = () => {},
  onDeleteGroupNote = () => {},
  deleteConfirming = false,
  onStartDelete = () => {},
  onCancelDelete = () => {},
  onConfirmDelete = () => {},
  mergeOpen = false,
  onOpenMerge = () => {},
  mergeSearch = '',
  onMergeSearchChange = () => {},
  otherGroups = [],
  mergeCandidate = null,
  onSelectMergeCandidate = () => {},
  onCancelMerge = () => {},
  onBackFromMergeCandidate = () => {},
  onConfirmMerge = () => {},
  actionBusy = false,
  actionError = null,
  editChat,
}: {
  groupId: string
  name: string
  groupType: string | null
  summary: string | null
  moments: Moment[]
  explicitMembers: PersonRef[]
  selfId?: string | null
  suggestedMembers: PersonRef[]
  suggestedFamilyMembers?: PersonRef[]
  parentGroup?: GroupRef | null
  subgroups?: SubgroupRef[]
  addingSubgroup?: boolean
  subgroupError?: string | null
  onAddSubgroup?: () => void
  suggestedParentMembers?: PersonRef[]
  suggestionsEnabled?: boolean
  onToggleSuggestions?: (enabled: boolean) => void
  confirmedAssociatedGroups: GroupRef[]
  suggestedAssociatedGroups: GroupRef[]
  groupNotes: GroupNote[]
  onSelectPerson: (person: { id: string; name: string }) => void
  onSelectGroup: (group: { id: string; name: string }) => void
  onSelectEvent: (event: { id: string; summary: string }) => void
  onBack: () => void
  backLabel: string
  onOpenFamilyTree: () => void
  readOnly?: boolean
  editingName?: boolean
  nameInput?: string
  savingName?: boolean
  onStartEditName?: () => void
  onNameInputChange?: (v: string) => void
  onSaveName?: (e: FormEvent) => void
  onCancelEditName?: () => void
  savingType?: boolean
  onChangeType?: (value: string) => void
  refreshingSummary?: boolean
  onRefreshSummary?: () => void
  membersExpanded?: boolean
  onToggleMembersExpanded?: () => void
  onAddMember?: (person: PersonRef) => void
  onRemoveMember?: (person: PersonRef) => void
  onApproveAllSuggestions?: (people: PersonRef[]) => void
  onDenySuggestion?: (person: PersonRef) => void
  onDenyAllSuggestions?: (people: PersonRef[]) => void
  showGroupPicker?: boolean
  onToggleGroupPicker?: () => void
  groupPickerSearch?: string
  onGroupPickerSearchChange?: (v: string) => void
  pickableGroups?: GroupRef[]
  loadingPickableGroups?: boolean
  onApproveGroupSuggestion?: (group: GroupRef) => void
  onRemoveAssociatedGroup?: (group: GroupRef) => void
  onDenyGroupSuggestion?: (group: GroupRef) => void
  onDenyAllGroupSuggestions?: (groups: GroupRef[]) => void
  notesOpen?: boolean
  onToggleNotesOpen?: () => void
  newNote?: string
  onNewNoteChange?: (v: string) => void
  savingNote?: boolean
  onSubmitGroupNote?: () => void
  onEditGroupNote?: (noteId: string, newContent: string) => void
  onDeleteGroupNote?: (noteId: string) => void
  deleteConfirming?: boolean
  onStartDelete?: () => void
  onCancelDelete?: () => void
  onConfirmDelete?: () => void
  mergeOpen?: boolean
  onOpenMerge?: () => void
  mergeSearch?: string
  onMergeSearchChange?: (v: string) => void
  otherGroups?: GroupRef[]
  mergeCandidate?: GroupRef | null
  onSelectMergeCandidate?: (g: GroupRef) => void
  onCancelMerge?: () => void
  onBackFromMergeCandidate?: () => void
  onConfirmMerge?: () => void
  actionBusy?: boolean
  actionError?: string | null
  editChat?: ReactNode
}) {
  const [memberSearch, setMemberSearch] = useState('')
  const memberQuery = memberSearch.trim().toLowerCase()
  const sortedExplicitMembers = sortByLastName(explicitMembers).filter(
    (p) => !memberQuery || `${p.name} ${p.last_name ?? ''}`.toLowerCase().includes(memberQuery)
  )
  const visibleExplicitMembers =
    membersExpanded || memberQuery ? sortedExplicitMembers : sortedExplicitMembers.slice(0, MEMBER_LIST_LIMIT)
  const visibleSuggestedMembers = suggestedMembers.slice(0, MEMBER_SUGGESTION_LIMIT)
  const sortedConfirmedAssociatedGroups = [...confirmedAssociatedGroups].sort((a, b) => a.name.localeCompare(b.name))

  const groupPickerQuery = groupPickerSearch.trim().toLowerCase()
  const confirmedGroupIds = new Set(confirmedAssociatedGroups.map((g) => g.id))
  const filteredPickableGroups = pickableGroups.filter(
    (g) => !confirmedGroupIds.has(g.id) && (!groupPickerQuery || g.name.toLowerCase().includes(groupPickerQuery))
  )

  return (
    <div style={styles.page}>
      <button onClick={onBack} style={styles.backButton}>← Back to {backLabel}</button>

      {editingName ? (
        <form onSubmit={onSaveName} style={styles.renameForm}>
          <input
            type="text"
            value={nameInput}
            onChange={(e) => onNameInputChange(e.target.value)}
            style={styles.renameInput}
            autoFocus
          />
          <button type="submit" disabled={savingName || !nameInput.trim()} style={styles.saveButton}>
            {savingName ? '…' : 'Save'}
          </button>
          <button type="button" onClick={onCancelEditName} style={styles.cancelButton}>
            Cancel
          </button>
        </form>
      ) : (
        <div style={styles.headingRow}>
          <h1 style={styles.heading}>{name}</h1>
          {!readOnly && <EditButton label="Rename group" onClick={onStartEditName} />}
        </div>
      )}

      {parentGroup && (
        <button type="button" onClick={() => onSelectGroup(parentGroup)} style={styles.parentLink}>
          ↑ Part of {parentGroup.name}
        </button>
      )}

      {readOnly ? (
        groupType && <span style={styles.typeBadgeStatic}>{groupType}</span>
      ) : (
        <select
          value={groupType ?? ''}
          onChange={(e) => onChangeType(e.target.value)}
          disabled={savingType}
          style={styles.typeSelect}
          aria-label="Group type"
        >
          <option value="">No type set</option>
          {GROUP_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      )}

      {groupType === 'Family' && (
        <button
          type="button"
          onClick={onOpenFamilyTree}
          disabled={explicitMembers.length === 0}
          style={styles.familyTreeButton}
        >
          {explicitMembers.length === 0 ? 'Add members to generate a family tree' : 'Generate this family’s tree →'}
        </button>
      )}

      <div style={styles.summaryRow}>
        <p style={styles.summary}>{summary || 'Figuring out what this group is about…'}</p>
        {!readOnly && <RefreshButton label="Refresh description" onClick={onRefreshSummary} refreshing={refreshingSummary} />}
      </div>

      <PhotoGallery />

      <h2 style={styles.membersHeading}>Who's in this group ({explicitMembers.length})</h2>
      {explicitMembers.length === 0 ? (
        <p style={styles.empty}>No members yet — add someone using the chat box below.</p>
      ) : (
        <>
          {explicitMembers.length > MEMBER_LIST_LIMIT && (
            <SearchBox value={memberSearch} onChange={setMemberSearch} placeholder="Search members…" />
          )}
          {sortedExplicitMembers.length === 0 ? (
            <p style={styles.empty}>No one matches "{memberSearch}".</p>
          ) : (
            <div style={styles.chipRow}>
              {visibleExplicitMembers.map((p) => (
                <MemberChip
                  key={p.id}
                  person={p}
                  isSelf={p.id === selfId}
                  onSelect={() => onSelectPerson(p)}
                  onRemove={readOnly ? undefined : () => onRemoveMember(p)}
                />
              ))}
            </div>
          )}
          {!memberQuery && sortedExplicitMembers.length > MEMBER_LIST_LIMIT && (
            <button onClick={onToggleMembersExpanded} style={styles.showMoreButton}>
              {membersExpanded ? '▾ Show fewer members' : `▸ Show all ${sortedExplicitMembers.length} members`}
            </button>
          )}
        </>
      )}

      {!readOnly && (
        <div style={styles.suggestionToggleRow}>
          <label style={styles.suggestionToggleLabel}>
            <input
              type="checkbox"
              checked={suggestionsEnabled}
              onChange={(e) => onToggleSuggestions(e.target.checked)}
            />
            Suggest new members for this group
          </label>
          {!suggestionsEnabled && (
            <span style={styles.suggestionToggleHint}>Off — won't suggest here or on Home</span>
          )}
        </div>
      )}

      {!readOnly && suggestionsEnabled && suggestedMembers.length > 0 && (
        <>
          <div style={styles.suggestionHeaderRow}>
            <p style={styles.eventOnlyLabel}>
              Seen at this group's events, or in an associated group — tap to add, or hover to dismiss
              {suggestedMembers.length > MEMBER_SUGGESTION_LIMIT && ` (${MEMBER_SUGGESTION_LIMIT} of ${suggestedMembers.length} shown)`}
            </p>
            {visibleSuggestedMembers.length > 1 && (
              <div style={styles.suggestionActionRow}>
                <button onClick={() => onApproveAllSuggestions(visibleSuggestedMembers)} style={styles.addAllButton}>
                  ✓ Add all suggestions
                </button>
                <button onClick={() => onDenyAllSuggestions(visibleSuggestedMembers)} style={styles.removeAllButton}>
                  × Remove all suggestions
                </button>
              </div>
            )}
          </div>
          <div style={{ ...styles.chipRow, marginBottom: '1.5rem' }}>
            {visibleSuggestedMembers.map((p) => (
              <SuggestionChip
                key={p.id}
                person={p}
                onApprove={() => onAddMember(p)}
                onDeny={() => onDenySuggestion(p)}
              />
            ))}
          </div>
        </>
      )}

      {!readOnly && suggestionsEnabled && suggestedFamilyMembers.length > 0 && (
        <>
          <div style={styles.suggestionHeaderRow}>
            <p style={styles.eventOnlyLabel}>Family of a current member — tap to add, or hover to dismiss</p>
            {suggestedFamilyMembers.length > 1 && (
              <div style={styles.suggestionActionRow}>
                <button onClick={() => onApproveAllSuggestions(suggestedFamilyMembers)} style={styles.addAllButton}>
                  ✓ Add all suggestions
                </button>
                <button onClick={() => onDenyAllSuggestions(suggestedFamilyMembers)} style={styles.removeAllButton}>
                  × Remove all suggestions
                </button>
              </div>
            )}
          </div>
          <div style={{ ...styles.chipRow, marginBottom: '1.5rem' }}>
            {suggestedFamilyMembers.map((p) => (
              <SuggestionChip
                key={p.id}
                person={p}
                onApprove={() => onAddMember(p)}
                onDeny={() => onDenySuggestion(p)}
              />
            ))}
          </div>
        </>
      )}

      {!readOnly && parentGroup && suggestionsEnabled && suggestedParentMembers.length > 0 && (
        <>
          <div style={styles.suggestionHeaderRow}>
            <p style={styles.eventOnlyLabel}>Member of {parentGroup.name} — tap to add, or hover to dismiss</p>
            {suggestedParentMembers.length > 1 && (
              <div style={styles.suggestionActionRow}>
                <button onClick={() => onApproveAllSuggestions(suggestedParentMembers)} style={styles.addAllButton}>
                  ✓ Add all suggestions
                </button>
                <button onClick={() => onDenyAllSuggestions(suggestedParentMembers)} style={styles.removeAllButton}>
                  × Remove all suggestions
                </button>
              </div>
            )}
          </div>
          <div style={{ ...styles.chipRow, marginBottom: '1.5rem' }}>
            {suggestedParentMembers.map((p) => (
              <SuggestionChip key={p.id} person={p} onApprove={() => onAddMember(p)} onDeny={() => onDenySuggestion(p)} />
            ))}
          </div>
        </>
      )}

      {!parentGroup && (
        <>
          <div style={styles.suggestionHeaderRow}>
            <h2 style={styles.membersHeading}>Subgroups</h2>
            {!readOnly && (
              <button type="button" onClick={onAddSubgroup} style={styles.addGroupButton} disabled={addingSubgroup}>
                {addingSubgroup ? '…' : '+ New Subgroup'}
              </button>
            )}
          </div>
          {subgroupError && <p style={styles.actionErrorBanner}>{subgroupError}</p>}
          {subgroups.length === 0 ? (
            <p style={styles.empty}>No subgroups yet.</p>
          ) : (
            <div style={styles.subgroupGrid}>
              {subgroups.map((sg) => {
                const memberCount = (sg.person_groups ?? []).filter((pg) => pg.people).length
                return (
                  <button key={sg.id} type="button" onClick={() => onSelectGroup(sg)} style={styles.subgroupTile}>
                    <span style={styles.subgroupTileName}>{sg.name}</span>
                    <span style={styles.subgroupTileMeta}>
                      {memberCount} member{memberCount === 1 ? '' : 's'}
                      {sg.group_type ? ` · ${sg.group_type}` : ''}
                    </span>
                  </button>
                )
              })}
            </div>
          )}
        </>
      )}

      <div style={styles.suggestionHeaderRow}>
        <h2 style={styles.membersHeading}>Associated Groups</h2>
        {!readOnly && (
          <button onClick={onToggleGroupPicker} style={styles.addGroupButton}>
            + Associate a New Group
          </button>
        )}
      </div>

      {showGroupPicker && (
        <div style={styles.groupPickerPanel}>
          <SearchBox value={groupPickerSearch} onChange={onGroupPickerSearchChange} placeholder="Search groups…" />
          {loadingPickableGroups ? (
            <p style={styles.empty}>Loading…</p>
          ) : filteredPickableGroups.length === 0 ? (
            <p style={styles.empty}>
              {groupPickerQuery ? `No groups match "${groupPickerSearch}".` : 'No other groups to associate yet.'}
            </p>
          ) : (
            <div style={{ ...styles.chipRow, marginBottom: '0.5rem' }}>
              {filteredPickableGroups.map((g) => (
                <GroupChip key={g.id} label={g.name} onClick={() => onApproveGroupSuggestion(g)} />
              ))}
            </div>
          )}
        </div>
      )}

      {sortedConfirmedAssociatedGroups.length === 0 ? (
        <p style={styles.empty}>No groups at this time.</p>
      ) : (
        <div style={styles.chipRow}>
          {sortedConfirmedAssociatedGroups.map((g) => (
            <AssociatedGroupChip
              key={g.id}
              group={g}
              onSelect={() => onSelectGroup(g)}
              onRemove={readOnly ? undefined : () => onRemoveAssociatedGroup(g)}
            />
          ))}
        </div>
      )}

      {!readOnly && suggestedAssociatedGroups.length > 0 && (
        <>
          <div style={styles.suggestionHeaderRow}>
            <p style={styles.eventOnlyLabel}>Possible associated groups — tap to add, or hover to dismiss</p>
            {suggestedAssociatedGroups.length > 1 && (
              <button onClick={() => onDenyAllGroupSuggestions(suggestedAssociatedGroups)} style={styles.removeAllButton}>
                × Remove all suggestions
              </button>
            )}
          </div>
          <div style={{ ...styles.chipRow, marginBottom: '1.5rem' }}>
            {suggestedAssociatedGroups.map((g) => (
              <GroupSuggestionChip
                key={g.id}
                group={g}
                onApprove={() => onApproveGroupSuggestion(g)}
                onDeny={() => onDenyGroupSuggestion(g)}
              />
            ))}
          </div>
        </>
      )}

      {moments.length === 0 && (
        <p style={styles.empty}>No events tagged to this group yet — mention this affiliation on Home while telling a story and it'll show up here.</p>
      )}

      <div style={styles.list}>
        {moments.map((moment) => {
          const momentSummary = summarize(moment.occasion, moment.raw_description)

          const attendees = new Map<string, PersonRef>()
          for (const n of moment.notes ?? []) {
            if (n.people) attendees.set(n.people.id, n.people)
          }

          const groups = (moment.moment_groups ?? [])
            .map((mg) => mg.groups)
            .filter((g): g is GroupRef => g !== null)

          return (
            <div key={moment.id} style={styles.card}>
              <button onClick={() => onSelectEvent({ id: moment.id, summary: momentSummary })} style={styles.titleButton}>
                {moment.occasion || 'Untitled moment'}
              </button>
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

              <p style={styles.description}>{moment.summary || 'Putting this memory into words…'}</p>

              {attendees.size > 0 && (
                <>
                  <p style={styles.chipLabel}>Who was there</p>
                  <div style={styles.chipRow}>
                    {sortByLastName(Array.from(attendees.values())).map((p) => (
                      <PersonChip
                        key={p.id}
                        label={`${p.name}${p.last_name ? ` ${p.last_name}` : ''}`}
                        onClick={() => onSelectPerson(p)}
                      />
                    ))}
                  </div>
                </>
              )}
            </div>
          )
        })}
      </div>

      <div style={styles.notesHeaderRow}>
        <h2 style={styles.editHeading}>Notes</h2>
        {groupNotes.length > 0 && (
          <button type="button" onClick={onToggleNotesOpen} style={styles.notesToggle}>
            {notesOpen ? '▾ Hide notes' : '▸ Show notes'}
          </button>
        )}
      </div>
      {!readOnly && (
        <>
          <p style={styles.chatHint}>Free-form context about this group — no event needed.</p>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              onSubmitGroupNote()
            }}
            style={styles.addNoteForm}
          >
            <AutoGrowTextarea
              value={newNote}
              onChange={onNewNoteChange}
              onEnter={onSubmitGroupNote}
              placeholder={`Add a note about ${name}…`}
              style={styles.addNoteInput}
              disabled={savingNote}
            />
            <VoiceInputButton
              disabled={savingNote}
              onTranscribed={(text) => onNewNoteChange(newNote ? `${newNote} ${text}` : text)}
            />
            <button type="submit" disabled={savingNote || !newNote.trim()} style={styles.addNoteButton}>
              {savingNote ? '…' : 'Add'}
            </button>
          </form>
        </>
      )}

      {notesOpen && groupNotes.length > 0 && (
        <div style={styles.notesList}>
          {groupNotes.map((note) => (
            <GroupNoteCard
              key={note.id}
              note={note}
              onEdit={readOnly ? undefined : onEditGroupNote}
              onDelete={readOnly ? undefined : onDeleteGroupNote}
            />
          ))}
        </div>
      )}

      {!readOnly && editChat && (
        <>
          <h2 style={styles.editHeading}>Edit this group</h2>
          <p style={styles.chatHint}>Add or remove someone, tag or untag an event, or rename it — just tell me what to change.</p>
          {editChat}
        </>
      )}

      {!readOnly && (
        <div style={styles.dangerZone}>
          <span style={styles.dangerHeading}>Group</span>

          {actionError && <p style={styles.actionErrorBanner}>{actionError}</p>}

          {!mergeOpen && !deleteConfirming && (
            <div style={styles.dangerButtonRow}>
              <button type="button" onClick={onOpenMerge} style={styles.dangerSecondaryButton} disabled={actionBusy}>
                This is a duplicate — merge it away…
              </button>
              <button
                type="button"
                onClick={onStartDelete}
                style={styles.dangerDeleteButton}
                disabled={actionBusy}
              >
                Delete this group
              </button>
            </div>
          )}

          {deleteConfirming && (
            <div style={styles.suggestBanner}>
              <span>
                Delete this group permanently? This removes its membership, notes, and event/group tags.
                {subgroups.length > 0 &&
                  ` Its ${subgroups.length} subgroup${subgroups.length === 1 ? '' : 's'} will become independent top-level groups, not deleted.`}{' '}
                This can't be undone.
              </span>
              <div style={styles.suggestButtonRow}>
                <button type="button" onClick={onConfirmDelete} style={styles.dangerDeleteButton} disabled={actionBusy}>
                  {actionBusy ? 'Deleting…' : 'Yes, delete'}
                </button>
                <button
                  type="button"
                  onClick={onCancelDelete}
                  style={styles.cancelButton}
                  disabled={actionBusy}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {mergeOpen && (
            <div style={styles.suggestBanner}>
              {!mergeCandidate ? (
                <>
                  <span>Search for the group you want to keep. Everything here will move there, and this group will be deleted:</span>
                  <SearchBox value={mergeSearch} onChange={onMergeSearchChange} placeholder="Search groups…" />
                  <div style={styles.mergeResultsList}>
                    {otherGroups
                      .filter((g) => (mergeSearch.trim() ? g.name.toLowerCase().includes(mergeSearch.trim().toLowerCase()) : false))
                      .slice(0, 8)
                      .map((g) => (
                        <button
                          key={g.id}
                          type="button"
                          onClick={() => onSelectMergeCandidate(g)}
                          style={styles.mergeResultButton}
                        >
                          {g.name}
                        </button>
                      ))}
                  </div>
                  <div style={styles.suggestButtonRow}>
                    <button type="button" onClick={onCancelMerge} style={styles.suggestNoButton}>
                      Cancel
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <span>
                    Merge this group into "{mergeCandidate.name}"? All membership, event tags, associated groups, and notes
                    move there, this group is deleted, and you'll be taken to the kept group. This can't be undone.
                  </span>
                  <div style={styles.suggestButtonRow}>
                    <button type="button" onClick={onConfirmMerge} style={styles.suggestYesButton} disabled={actionBusy}>
                      {actionBusy ? 'Merging…' : 'Yes, merge'}
                    </button>
                    <button
                      type="button"
                      onClick={onBackFromMergeCandidate}
                      style={styles.suggestNoButton}
                      disabled={actionBusy}
                    >
                      Back
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// One free-standing group note. Same hover-reveals-edit/delete pattern as PersonDetail.tsx's
// NoteCard, minus any source label — a group note is always native to this page, so there's
// nothing else to attribute it to. `onEdit`/`onDelete` omitted (demo read-only mode) simply never
// shows the hover badges.
function GroupNoteCard({
  note,
  onEdit,
  onDelete,
}: {
  note: GroupNote
  onEdit?: (noteId: string, newContent: string) => void
  onDelete?: (noteId: string) => void
}) {
  const [hovered, setHovered] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  function startEditing() {
    setDraft(note.content)
    setEditing(true)
  }

  function commitEdit() {
    if (draft.trim()) onEdit?.(note.id, draft.trim())
    setEditing(false)
  }

  if (editing) {
    return (
      <div style={styles.card}>
        <form onSubmit={(e) => { e.preventDefault(); commitEdit() }} style={styles.noteEditForm}>
          <AutoGrowTextarea value={draft} onChange={setDraft} onEnter={commitEdit} style={styles.noteEditInput} />
          <div style={styles.noteEditButtonRow}>
            <button type="submit" style={styles.noteSaveButton}>Save</button>
            <button type="button" onClick={() => setEditing(false)} style={styles.noteCancelButton}>Cancel</button>
          </div>
        </form>
      </div>
    )
  }

  return (
    <div style={styles.noteCardWrapper} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      <div style={styles.card}>
        <p style={styles.description}>{note.content}</p>
        <p style={styles.meta}>
          {new Date(note.created_at).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}
        </p>
      </div>
      {hovered && (onEdit || onDelete) && (
        <div style={styles.noteBadgeRow}>
          {onEdit && (
            <button onClick={startEditing} aria-label="Edit this note" style={styles.noteBadge}>
              <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" />
              </svg>
            </button>
          )}
          {onDelete && (
            <button onClick={() => onDelete(note.id)} aria-label="Delete this note" style={{ ...styles.noteBadge, ...styles.noteDeleteBadge }}>
              <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 6h18" />
                <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                <path d="M10 11v6" />
                <path d="M14 11v6" />
              </svg>
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// A member chip that reveals a trash icon on hover — hovering swaps its click action from
// Clicking the chip itself always goes to the person's profile — same as any other chip in the
// app. Hovering reveals a small trash badge in the corner, a separate control (not a swap of the
// main chip's content) that removes them from the group — same pattern as SuggestionChip's "×"
// below, chosen specifically because the earlier version (swapping the chip's own click action
// and content on hover) caused a resize-driven hover flicker. `onRemove` omitted (demo read-only
// mode) simply never shows the hover badge.
function MemberChip({
  person,
  isSelf = false,
  onSelect,
  onRemove,
}: {
  person: PersonRef
  isSelf?: boolean
  onSelect: () => void
  onRemove?: () => void
}) {
  const [hovered, setHovered] = useState(false)
  const label = isSelf ? 'You' : `${person.name}${person.last_name ? ` ${person.last_name}` : ''}`

  return (
    <div
      style={styles.suggestionWrapper}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <button onClick={onSelect} style={styles.person}>
        {label}
      </button>
      {hovered && onRemove && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            onRemove()
          }}
          aria-label={`Remove ${label} from this group`}
          style={styles.denyBadge}
        >
          <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 6h18" />
            <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
            <path d="M10 11v6" />
            <path d="M14 11v6" />
          </svg>
        </button>
      )}
    </div>
  )
}

// A suggested (event-only) attendee: the main chip approves them (adds to the group) on click,
// same as before. Hovering reveals a small "×" badge in the corner — a separate control, not a
// swap of the main chip's content — so denying doesn't resize anything and can't flicker the
// way the member chip's icon-swap used to.
function SuggestionChip({
  person,
  onApprove,
  onDeny,
}: {
  person: PersonRef
  onApprove: () => void
  onDeny: () => void
}) {
  const [hovered, setHovered] = useState(false)
  const label = `${person.name}${person.last_name ? ` ${person.last_name}` : ''}`

  return (
    <div
      style={styles.suggestionWrapper}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <button onClick={onApprove} style={styles.eventOnlyChip}>
        {label}
      </button>
      {hovered && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            onDeny()
          }}
          aria-label={`Don't suggest ${label} for this group again`}
          style={styles.denyBadge}
        >
          ×
        </button>
      )}
    </div>
  )
}

// Confirmed associated group: clicking goes to that group's profile, same as any other chip.
// Hovering reveals a trash badge that unlinks the association — same corner-badge pattern as
// MemberChip above, reused here for groups instead of people. `onRemove` omitted (demo read-only
// mode) simply never shows the hover badge.
function AssociatedGroupChip({
  group,
  onSelect,
  onRemove,
}: {
  group: GroupRef
  onSelect: () => void
  onRemove?: () => void
}) {
  const [hovered, setHovered] = useState(false)

  return (
    <div
      style={styles.suggestionWrapper}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <GroupChip label={group.name} onClick={onSelect} />
      {hovered && onRemove && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            onRemove()
          }}
          aria-label={`Remove ${group.name} as an associated group`}
          style={styles.denyBadge}
        >
          <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 6h18" />
            <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
            <path d="M10 11v6" />
            <path d="M14 11v6" />
          </svg>
        </button>
      )}
    </div>
  )
}

// A suggested associated group: the main chip approves (confirms the association) on click, same
// as SuggestionChip above. Hovering reveals a small "×" badge that dismisses the suggestion.
function GroupSuggestionChip({
  group,
  onApprove,
  onDeny,
}: {
  group: GroupRef
  onApprove: () => void
  onDeny: () => void
}) {
  const [hovered, setHovered] = useState(false)

  return (
    <div
      style={styles.suggestionWrapper}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <button onClick={onApprove} style={styles.groupEventOnlyChip}>
        <span style={styles.groupDot} />
        {group.name}
      </button>
      {hovered && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            onDeny()
          }}
          aria-label={`Don't suggest ${group.name} again`}
          style={styles.denyBadge}
        >
          ×
        </button>
      )}
    </div>
  )
}

const styles: { [key: string]: React.CSSProperties } = {
  person: {
    fontSize: '0.9rem',
    padding: '0.35rem 0.8rem',
    borderRadius: '999px',
    border: '1px solid #2E4034',
    backgroundColor: 'transparent',
    color: '#2E4034',
    cursor: 'pointer',
    fontFamily: 'Georgia, serif',
  },
  suggestionWrapper: { position: 'relative', display: 'inline-block' },
  denyBadge: {
    position: 'absolute',
    top: '-8px',
    right: '-8px',
    width: '18px',
    height: '18px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '50%',
    border: '1px solid #B04A3B',
    backgroundColor: '#FFF',
    color: '#B04A3B',
    fontSize: '0.8rem',
    lineHeight: 1,
    padding: 0,
    cursor: 'pointer',
    boxShadow: '0 1px 3px rgba(0,0,0,0.15)',
  },
  page: { maxWidth: '840px', margin: '0 auto', padding: '1rem 1.5rem 2rem', fontFamily: 'Georgia, serif' },
  backButton: {
    background: 'none',
    border: 'none',
    color: '#2E4034',
    fontSize: '1rem',
    cursor: 'pointer',
    marginBottom: '1rem',
    padding: 0,
  },
  heading: { fontSize: '2rem', color: '#2E4034', margin: 0 },
  headingRow: { display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.4rem', flexWrap: 'wrap' },
  parentLink: {
    display: 'block',
    background: 'none',
    border: 'none',
    padding: 0,
    marginBottom: '0.75rem',
    fontSize: '0.9rem',
    color: '#8A6A1F',
    cursor: 'pointer',
    fontFamily: 'Georgia, serif',
  },
  subgroupGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
    gap: '0.75rem',
    marginBottom: '0.75rem',
  },
  subgroupTile: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: '0.2rem',
    textAlign: 'left',
    backgroundColor: '#FFF',
    border: '1px solid #E0E0E0',
    borderRadius: '10px',
    padding: '0.75rem 0.9rem',
    cursor: 'pointer',
    fontFamily: 'Georgia, serif',
  },
  subgroupTileName: { fontSize: '1rem', color: '#2E4034' },
  subgroupTileMeta: { fontSize: '0.8rem', color: '#888' },
  renameForm: { display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.4rem', flexWrap: 'wrap' },
  typeSelect: {
    fontSize: '0.85rem',
    padding: '0.35rem 0.6rem',
    borderRadius: '6px',
    border: '1px solid #CCC',
    fontFamily: 'Georgia, serif',
    backgroundColor: '#FFF',
    color: '#666',
    marginBottom: '0.75rem',
  },
  typeBadgeStatic: {
    display: 'inline-block',
    fontSize: '0.7rem',
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
    color: '#8A6A1F',
    backgroundColor: '#FBF3E0',
    border: '1px solid #E6D6AC',
    borderRadius: '999px',
    padding: '0.2rem 0.6rem',
    marginBottom: '0.75rem',
  },
  familyTreeButton: {
    display: 'block',
    fontSize: '0.9rem',
    padding: '0.55rem 0.9rem',
    borderRadius: '8px',
    border: '2px solid #6B4E9E',
    backgroundColor: 'transparent',
    color: '#6B4E9E',
    cursor: 'pointer',
    fontFamily: 'Georgia, serif',
    marginBottom: '1.25rem',
  },
  summaryRow: { display: 'flex', alignItems: 'flex-start', gap: '0.5rem', marginBottom: '1.5rem' },
  summary: { margin: 0, flex: 1, fontSize: '1rem', color: '#666', fontStyle: 'italic' },
  membersHeading: { fontSize: '1.1rem', color: '#2E4034', margin: '0 0 0.5rem 0' },
  eventOnlyLabel: { margin: '0.75rem 0 0.5rem 0', fontSize: '0.85rem', color: '#888', fontStyle: 'italic' },
  suggestionHeaderRow: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap' },
  suggestionActionRow: { display: 'flex', gap: '0.9rem', flexWrap: 'wrap' },
  suggestionToggleRow: { display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap', margin: '0.75rem 0 0.5rem 0' },
  suggestionToggleLabel: { display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem', color: '#555', cursor: 'pointer' },
  suggestionToggleHint: { fontSize: '0.8rem', color: '#999', fontStyle: 'italic' },
  removeAllButton: {
    fontSize: '0.85rem',
    background: 'none',
    border: 'none',
    color: '#B04A3B',
    cursor: 'pointer',
    padding: 0,
    fontFamily: 'Georgia, serif',
    whiteSpace: 'nowrap',
  },
  addAllButton: {
    fontSize: '0.85rem',
    background: 'none',
    border: 'none',
    color: '#2E4034',
    cursor: 'pointer',
    padding: 0,
    fontFamily: 'Georgia, serif',
    whiteSpace: 'nowrap',
  },
  showMoreButton: {
    fontSize: '0.85rem',
    background: 'none',
    border: 'none',
    color: '#2E4034',
    cursor: 'pointer',
    padding: 0,
    marginBottom: '1rem',
    fontFamily: 'Georgia, serif',
    whiteSpace: 'nowrap',
  },
  eventOnlyChip: {
    fontSize: '0.9rem',
    padding: '0.35rem 0.8rem',
    borderRadius: '999px',
    border: '1px dashed #2E4034',
    backgroundColor: 'transparent',
    color: '#2E4034',
    cursor: 'pointer',
    fontFamily: 'Georgia, serif',
  },
  groupEventOnlyChip: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.45rem',
    fontSize: '0.88rem',
    fontWeight: 700,
    padding: '0.35rem 0.85rem 0.35rem 0.7rem',
    borderRadius: '8px',
    border: '1px dashed #B08B2E',
    backgroundColor: 'transparent',
    color: '#8A6A1F',
    cursor: 'pointer',
    fontFamily: 'Georgia, serif',
    letterSpacing: '0.02em',
  },
  groupDot: {
    width: '7px',
    height: '7px',
    borderRadius: '50%',
    backgroundColor: '#B08B2E',
    flexShrink: 0,
  },
  addGroupButton: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.3rem',
    fontSize: '0.85rem',
    padding: '0.3rem 0.7rem',
    borderRadius: '8px',
    border: '1px solid #B08B2E',
    backgroundColor: 'transparent',
    color: '#8A6A1F',
    cursor: 'pointer',
    fontFamily: 'Georgia, serif',
    whiteSpace: 'nowrap',
  },
  groupPickerPanel: {
    backgroundColor: '#FFF',
    border: '1px solid #E0E0E0',
    borderRadius: '10px',
    padding: '0.85rem 0.85rem 0.25rem',
    marginBottom: '1rem',
  },
  renameInput: {
    fontSize: '1.5rem',
    fontFamily: 'Georgia, serif',
    color: '#2E4034',
    padding: '0.25rem 0.5rem',
    borderRadius: '8px',
    border: '1px solid #CCC',
    flex: '1 1 200px',
  },
  saveButton: {
    fontSize: '0.9rem',
    padding: '0.5rem 0.9rem',
    borderRadius: '8px',
    border: 'none',
    backgroundColor: '#2E4034',
    color: '#FFF',
    cursor: 'pointer',
  },
  cancelButton: {
    fontSize: '0.9rem',
    padding: '0.5rem 0.9rem',
    borderRadius: '8px',
    border: '1px solid #CCC',
    backgroundColor: '#FFF',
    color: '#555',
    cursor: 'pointer',
  },
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
  chipRow: { display: 'flex', gap: '0.5rem', marginBottom: '0.75rem', flexWrap: 'wrap' },
  description: { margin: '0 0 0.75rem 0', fontSize: '1rem', color: '#2E2E2E', lineHeight: 1.5 },
  chipLabel: { margin: '0 0 0.4rem 0', fontSize: '0.85rem', fontWeight: 'bold', color: '#2E4034' },
  editHeading: { fontSize: '1.2rem', color: '#2E4034', margin: '2rem 0 0.5rem 0' },
  chatHint: { margin: '0 0 0.25rem 0', fontSize: '0.9rem', color: '#888' },
  notesHeaderRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', margin: '2rem 0 0' },
  notesToggle: {
    fontSize: '0.85rem',
    background: 'none',
    border: 'none',
    color: '#2E4034',
    cursor: 'pointer',
    padding: 0,
    fontFamily: 'Georgia, serif',
    whiteSpace: 'nowrap',
  },
  addNoteForm: { display: 'flex', alignItems: 'flex-end', gap: '0.5rem', marginBottom: '1rem' },
  addNoteInput: { flex: 1, fontSize: '1rem', padding: '0.6rem', borderRadius: '8px', border: '1px solid #CCC' },
  addNoteButton: {
    fontSize: '1rem',
    padding: '0.6rem 1.1rem',
    borderRadius: '8px',
    border: 'none',
    backgroundColor: '#2E4034',
    color: '#FFF',
    cursor: 'pointer',
  },
  notesList: { display: 'flex', flexDirection: 'column', gap: '1rem', marginBottom: '1rem' },
  noteCardWrapper: { position: 'relative' },
  noteBadgeRow: { position: 'absolute', top: '-6px', right: '-6px', display: 'flex', gap: '0.3rem' },
  noteBadge: {
    width: '20px',
    height: '20px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '50%',
    border: '1px solid #999',
    backgroundColor: '#FFF',
    color: '#555',
    padding: 0,
    cursor: 'pointer',
    boxShadow: '0 1px 3px rgba(0,0,0,0.15)',
  },
  noteDeleteBadge: { borderColor: '#B04A3B', color: '#B04A3B' },
  noteEditForm: { display: 'flex', flexDirection: 'column', gap: '0.4rem' },
  noteEditInput: { fontSize: '0.95rem', padding: '0.5rem', borderRadius: '6px', border: '1px solid #CCC' },
  noteEditButtonRow: { display: 'flex', gap: '0.5rem' },
  noteSaveButton: {
    fontSize: '0.85rem',
    padding: '0.3rem 0.7rem',
    borderRadius: '6px',
    border: '1px solid #2E4034',
    backgroundColor: 'transparent',
    color: '#2E4034',
    cursor: 'pointer',
  },
  noteCancelButton: {
    fontSize: '0.85rem',
    padding: '0.3rem 0.7rem',
    borderRadius: '6px',
    border: '1px solid #999',
    backgroundColor: 'transparent',
    color: '#666',
    cursor: 'pointer',
  },
  dangerZone: {
    marginTop: '2.5rem',
    paddingTop: '1.25rem',
    borderTop: '1px solid #E2DFD6',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.75rem',
  },
  dangerHeading: { fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.04em', color: '#6B7A6E', fontWeight: 700 },
  dangerButtonRow: { display: 'flex', gap: '0.75rem', flexWrap: 'wrap' },
  dangerSecondaryButton: {
    fontSize: '0.85rem',
    padding: '0.5rem 0.9rem',
    borderRadius: '6px',
    border: '1px solid #999',
    backgroundColor: 'transparent',
    color: '#555',
    cursor: 'pointer',
    fontFamily: 'Georgia, serif',
  },
  dangerDeleteButton: {
    fontSize: '0.85rem',
    padding: '0.5rem 0.9rem',
    borderRadius: '6px',
    border: '1px solid #B04A3B',
    backgroundColor: 'transparent',
    color: '#B04A3B',
    cursor: 'pointer',
    fontFamily: 'Georgia, serif',
  },
  actionErrorBanner: { fontSize: '0.9rem', color: '#A33', marginBottom: '0.5rem' },
  suggestBanner: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.6rem',
    fontSize: '0.9rem',
    color: '#5A4A20',
    backgroundColor: '#FBF3E0',
    border: '1px solid #E6D6AC',
    borderRadius: '10px',
    padding: '0.85rem 1rem',
  },
  suggestButtonRow: { display: 'flex', gap: '0.5rem' },
  suggestYesButton: {
    fontSize: '0.85rem',
    padding: '0.4rem 0.85rem',
    borderRadius: '6px',
    border: 'none',
    backgroundColor: '#2E4034',
    color: '#FFF',
    cursor: 'pointer',
  },
  suggestNoButton: {
    fontSize: '0.85rem',
    padding: '0.4rem 0.85rem',
    borderRadius: '6px',
    border: '1px solid #B08B2E',
    backgroundColor: 'transparent',
    color: '#8A6A1F',
    cursor: 'pointer',
  },
  mergeResultsList: { display: 'flex', flexDirection: 'column', gap: '0.35rem', maxHeight: '220px', overflowY: 'auto' },
  mergeResultButton: {
    textAlign: 'left',
    fontSize: '0.9rem',
    padding: '0.5rem 0.7rem',
    borderRadius: '6px',
    border: '1px solid #E6D6AC',
    backgroundColor: '#FFF',
    color: '#2E2E2E',
    cursor: 'pointer',
    fontFamily: 'Georgia, serif',
  },
}
