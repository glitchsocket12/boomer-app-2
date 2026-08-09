import { supabase } from './supabase'
import { getRelationshipsMap } from './relationshipsTable'
import { suggestFamilyMembers } from './relationshipSuggestions'
import { loadDismissals } from './dismissedSuggestions'
import type { RelationshipGapSuggestion } from './suggestRelationshipGaps'
import { loadRelationshipGapSuggestions } from './suggestRelationshipGaps'
import type { EventGroupSuggestion } from './suggestEventGroups'
import { loadEventGroupSuggestions } from './suggestEventGroups'

export type ConnectionPerson = { id: string; name: string; last_name: string | null }
export type ConnectionGroup = { id: string; name: string }
export type ConnectionSuggestion = { kind: 'person_group'; person: ConnectionPerson; group: ConnectionGroup }

// Everything Home's "Connections to make" card can ask about. One card, several question shapes —
// see loadHomeSuggestions at the bottom for why they're pooled rather than given a card each.
export type HomeSuggestion = ConnectionSuggestion | RelationshipGapSuggestion | EventGroupSuggestion

// Stable identity for a suggestion, independent of object identity — Home uses it as the React key
// and to drop the right row from local state once a write comes back clean.
export function suggestionKey(s: HomeSuggestion): string {
  switch (s.kind) {
    case 'person_group':
      return `person_group:${s.group.id}:${s.person.id}`
    case 'family_coparent':
      return `family_coparent:${s.parentId}:${s.childId}`
    case 'family_couple':
      return `family_couple:${s.aId}:${s.bId}`
    case 'event_group':
      return `event_group:${s.momentId}:${s.groupId}`
  }
}

// How many suggestions Home shows at once — a rotating sample (see the shuffle below), not a
// fixed batch, since founders add people over time and the full candidate pool changes as they do.
const SAMPLE_SIZE = 6

// Generalizes GroupDetail.tsx's own per-group suggestion logic (event attendance on a
// group-tagged moment, membership in a CONFIRMED associated group, or family — spouse of a
// current member, then kids once the spouse is also a member) across every group at once, for a
// Home-page nudge. Deliberately free/deterministic, no AI call — same signals GroupDetail already
// surfaces one group at a time, just aggregated, so it's cheap enough to recompute on every Home
// visit instead of needing a cache (CLAUDE.md rule 3).
//
// Returns the WHOLE candidate pool; sampling happens in loadHomeSuggestions, which has to balance
// this pool against the other question types.
export async function loadConnectionSuggestions(): Promise<ConnectionSuggestion[]> {
  const [groupsRes, personGroupsRes, associationsRes] = await Promise.all([
    supabase.from('groups').select('id, name, dismissed_person_ids, suggestions_enabled'),
    supabase.from('person_groups').select('person_id, group_id, people(id, name, last_name)'),
    supabase.from('group_associations').select('group_id_a, group_id_b'),
  ])

  const groups = (groupsRes.data ?? []) as { id: string; name: string; dismissed_person_ids: string[] | null; suggestions_enabled: boolean | null }[]
  if (groups.length === 0) return []
  const groupById = new Map(groups.map((g) => [g.id, g]))
  const groupIds = groups.map((g) => g.id)

  const membersByGroup: Record<string, Set<string>> = {}
  const personById = new Map<string, ConnectionPerson>()
  for (const row of (personGroupsRes.data as unknown as { person_id: string; group_id: string; people: ConnectionPerson | null }[]) ?? []) {
    ;(membersByGroup[row.group_id] ??= new Set()).add(row.person_id)
    if (row.people) personById.set(row.people.id, row.people)
  }

  const associatedGroupsOf: Record<string, Set<string>> = {}
  for (const row of (associationsRes.data as { group_id_a: string; group_id_b: string }[]) ?? []) {
    ;(associatedGroupsOf[row.group_id_a] ??= new Set()).add(row.group_id_b)
    ;(associatedGroupsOf[row.group_id_b] ??= new Set()).add(row.group_id_a)
  }

  // Attendance signal: moments tagged to any of this account's groups, then who attended them —
  // same "moment_groups -> notes with a person_id" path GroupDetail reads, scoped by the small
  // groups list rather than the much larger people list (see the scan-calendar-sources gotcha in
  // PROJECT_CONTEXT.md §2 about `.in()` scoping — same precaution, kept consistent here).
  const { data: momentGroupsData } = await supabase.from('moment_groups').select('moment_id, group_id').in('group_id', groupIds)
  const groupIdsByMoment: Record<string, string[]> = {}
  for (const row of (momentGroupsData as { moment_id: string; group_id: string }[]) ?? []) {
    ;(groupIdsByMoment[row.moment_id] ??= []).push(row.group_id)
  }
  const momentIds = Object.keys(groupIdsByMoment)
  const attendanceRes =
    momentIds.length > 0
      ? await supabase.from('notes').select('person_id, moment_id, people(id, name, last_name)').in('moment_id', momentIds).not('person_id', 'is', null)
      : { data: [] as { person_id: string; moment_id: string; people: ConnectionPerson | null }[] }

  const suggestionsByKey = new Map<string, ConnectionSuggestion>()
  function addCandidate(groupId: string, person: ConnectionPerson | null | undefined) {
    if (!person) return
    if (membersByGroup[groupId]?.has(person.id)) return
    const group = groupById.get(groupId)
    if (!group) return
    if (group.suggestions_enabled !== true) return
    if ((group.dismissed_person_ids ?? []).includes(person.id)) return
    suggestionsByKey.set(`${groupId}:${person.id}`, {
      kind: 'person_group',
      person,
      group: { id: group.id, name: group.name },
    })
  }

  for (const row of (attendanceRes.data as unknown as { person_id: string; moment_id: string; people: ConnectionPerson | null }[]) ?? []) {
    for (const groupId of groupIdsByMoment[row.moment_id] ?? []) addCandidate(groupId, row.people)
  }
  for (const group of groups) {
    for (const otherGroupId of associatedGroupsOf[group.id] ?? []) {
      for (const personId of membersByGroup[otherGroupId] ?? []) addCandidate(group.id, personById.get(personId))
    }
  }

  // Family signal: spouse of a current member, then that couple's kids once the spouse is ALSO a
  // member — same suggestFamilyMembers chaining as GroupDetail.tsx's own per-group "Family of a
  // current member?" box, generalized across every group here (founder feedback 2026-07-26).
  // Asks for everyone already in some group. On a small account that scopes the query; past a few
  // hundred it's most of the table anyway, so getRelationshipsMap fetches it unscoped rather than
  // building a URL too long for the gateway to accept (see its own note — that overflow was a live
  // bug here until 2026-08-07). A suggested spouse/child not yet in personById gets backfilled by
  // id below.
  const relationshipsById = await getRelationshipsMap([...personById.keys()])
  const familyCandidates: { groupId: string; personId: string }[] = []
  for (const group of groups) {
    const members = membersByGroup[group.id]
    if (!members || members.size === 0) continue
    const exclude = new Set([...(group.dismissed_person_ids ?? []), ...members])
    for (const personId of suggestFamilyMembers(members, relationshipsById, exclude)) {
      familyCandidates.push({ groupId: group.id, personId })
    }
  }
  const missingIds = [...new Set(familyCandidates.map((f) => f.personId).filter((id) => !personById.has(id)))]
  if (missingIds.length > 0) {
    const { data } = await supabase.from('people').select('id, name, last_name').in('id', missingIds)
    for (const p of (data as ConnectionPerson[]) ?? []) personById.set(p.id, p)
  }
  for (const f of familyCandidates) addCandidate(f.groupId, personById.get(f.personId))

  return [...suggestionsByKey.values()]
}

// Fisher-Yates, so repeat Home visits surface a different slice of a large candidate pool instead
// of always the same first few (a founder who never gets to today's batch would otherwise never
// see the rest).
function shuffled<T>(items: T[]): T[] {
  const all = [...items]
  for (let i = all.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[all[i], all[j]] = [all[j], all[i]]
  }
  return all
}

// Round-robin across the question types rather than shuffling them all together. A single pooled
// shuffle can hand back six rows of the same kind — which is how the card spent its life looking
// like it only knew one trick, and the founder would never learn it does anything else.
export function sampleAcrossKinds(pools: HomeSuggestion[][], limit = SAMPLE_SIZE): HomeSuggestion[] {
  const queues = pools.map((pool) => shuffled(pool))
  const out: HomeSuggestion[] = []
  for (let round = 0; out.length < limit; round++) {
    const before = out.length
    for (const queue of queues) {
      if (out.length >= limit) break
      const next = queue[round]
      if (next) out.push(next)
    }
    if (out.length === before) break
  }
  return out
}

// The one call Home makes. All four question types are free and deterministic — no Anthropic call
// anywhere in here — so the whole thing is recomputed per Home visit rather than cached
// (CLAUDE.md rule 3). The two newer types self-suppress when their dismissal table is missing, so
// a pre-migration account quietly keeps the original person->group behaviour.
export async function loadHomeSuggestions(): Promise<HomeSuggestion[]> {
  const dismissals = await loadDismissals()
  const [personGroup, relationshipGaps, eventGroups] = await Promise.all([
    loadConnectionSuggestions(),
    loadRelationshipGapSuggestions(dismissals),
    loadEventGroupSuggestions(dismissals),
  ])
  // family_coparent and family_couple are split into separate pools on purpose: they come from one
  // source but read as different questions, and pooling them lets a big pile of co-parent gaps
  // crowd out everything else.
  return sampleAcrossKinds([
    personGroup,
    relationshipGaps.filter((s) => s.kind === 'family_coparent'),
    relationshipGaps.filter((s) => s.kind === 'family_couple'),
    eventGroups,
  ])
}

// Mirrors GroupDetail.tsx's handleAddMember exactly (same upsert shape, same summary
// invalidation — membership changed, so the cached AI summary would otherwise go stale).
// Returns the error (if any) instead of swallowing it, so the caller can keep the suggestion
// visible and tell the founder it didn't save rather than silently no-op-ing (bug reported
// 2026-08-03: clicking "Yes" repeatedly never persisted because both the write's own error and
// the click handler's fire-and-forget call were silently dropped).
export async function acceptConnectionSuggestion(personId: string, groupId: string): Promise<{ error: string | null }> {
  const { error: upsertError } = await supabase
    .from('person_groups')
    .upsert({ person_id: personId, group_id: groupId }, { onConflict: 'person_id,group_id', ignoreDuplicates: true })
  if (upsertError) return { error: upsertError.message }
  const { error: summaryError } = await supabase.from('groups').update({ summary: null }).eq('id', groupId)
  return { error: summaryError ? summaryError.message : null }
}

// Mirrors GroupDetail.tsx's handleDenySuggestion — appends to the same dismissed_person_ids
// column that group's own page reads, so a suggestion dismissed from Home also stays dismissed
// if the founder later opens that group directly (single source of truth, no new column).
export async function dismissConnectionSuggestion(personId: string, groupId: string): Promise<{ error: string | null }> {
  const { data, error: fetchError } = await supabase.from('groups').select('dismissed_person_ids').eq('id', groupId).single()
  if (fetchError) return { error: fetchError.message }
  const updated = [...new Set([...((data?.dismissed_person_ids as string[] | null) ?? []), personId])]
  const { error } = await supabase.from('groups').update({ dismissed_person_ids: updated }).eq('id', groupId)
  return { error: error ? error.message : null }
}
