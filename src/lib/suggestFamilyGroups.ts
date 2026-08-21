import { supabase } from './supabase'
import { fetchAllRows } from './pagedSelect'
import type { Graph } from './familyTree'
import { isUnionEnded, loadFamilyGraph } from './familyTree'
import type { Dismissals } from './dismissedSuggestions'

// "These three are a household — want them as a group?" (founder, via the feedback widget
// 2026-08-08: "Any time a family tree is populated with 3 or more people (i.e. husband, wife, and
// child), I would like to automatically suggest creating a family group based off of them.")
//
// A household here is deliberately the narrow, nuclear one the founder described: a couple plus
// the children BOTH of them are recorded as parents of. The family graph is one enormous connected
// component — take "3 or more people connected in the tree" literally and the whole account is a
// single household — so the couple is what bounds it.
//
// Free and deterministic (no AI, CLAUDE.md rule 3): it reads the same family graph the tree page
// already loads, plus the memberships table.

export type FamilyGroupSuggestion = {
  kind: 'family_group'
  /** The couple the household is built from, normalized aId < bId — also the dismissal key. */
  aId: string
  bId: string
  /** Couple first, then the shared children, oldest-known-order as the graph has them. */
  memberIds: string[]
  memberNames: string[]
  /** What the group would be called. The founder can rename it afterwards like any other group. */
  suggestedName: string
}

export type MembershipRow = { person_id: string; group_id: string }

/** "Volin" out of "Jake Volin". The graph only carries the joined display name. */
function surnameOf(fullName: string): string | null {
  const parts = fullName.trim().split(/\s+/)
  return parts.length >= 2 ? parts[parts.length - 1] : null
}

/**
 * The surname shared by most of the household, or null when there's no clear winner — a blended
 * household with three different surnames shouldn't be named after whichever one sorts first.
 */
function dominantSurname(names: string[]): string | null {
  const counts = new Map<string, number>()
  for (const name of names) {
    const surname = surnameOf(name)
    if (!surname) continue
    counts.set(surname, (counts.get(surname) ?? 0) + 1)
  }
  let best: string | null = null
  let bestCount = 0
  let tied = false
  for (const [surname, n] of counts) {
    if (n > bestCount) {
      best = surname
      bestCount = n
      tied = false
    } else if (n === bestCount) {
      tied = true
    }
  }
  if (!best || tied || bestCount < 2) return null
  return best
}

function firstNameOf(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? fullName
}

/**
 * Names one household, given the names already spoken for. "Volin Family" when that reads
 * unambiguously; "Ward & Heather Carroll" when a second Carroll household is also on offer, which
 * on a real account is common — three of the founder's surnames span two generations each, and two
 * groups both called "Carroll Family" would be worse than no suggestion.
 */
export function proposeGroupName(memberNames: string[], taken: Set<string> = new Set()): string {
  const surname = dominantSurname(memberNames)
  const [a, b] = memberNames
  const couple = `${firstNameOf(a)} & ${firstNameOf(b)}`
  const candidates = surname
    ? [`${surname} Family`, `${couple} ${surname}`, `${couple} Family`]
    : [`${couple} Family`]
  for (const candidate of candidates) {
    if (!taken.has(candidate.toLowerCase())) return candidate
  }
  return candidates[candidates.length - 1]
}

/**
 * Pure over the graph + memberships, so the thresholds are testable without a database.
 *
 * Two things keep the volume honest on a real account. A household needs at least one shared
 * child (a couple on their own is not a group worth making), and it is dropped entirely if some
 * existing group already contains every one of its members — that group IS this family, whatever
 * it happens to be called.
 */
export function deriveFamilyGroupSuggestions(
  g: Graph,
  memberships: MembershipRow[],
  existingGroupNames: string[] = []
): FamilyGroupSuggestion[] {
  const groupsByPerson = new Map<string, Set<string>>()
  for (const row of memberships) {
    let set = groupsByPerson.get(row.person_id)
    if (!set) {
      set = new Set()
      groupsByPerson.set(row.person_id, set)
    }
    set.add(row.group_id)
  }

  const out: FamilyGroupSuggestion[] = []
  const seenCouples = new Set<string>()

  for (const [personId, spouses] of g.spousesOf) {
    for (const spouse of spouses) {
      if (spouse === personId) continue
      const [aId, bId] = personId < spouse ? [personId, spouse] : [spouse, personId]
      const key = `${aId}|${bId}`
      if (seenCouples.has(key)) continue
      seenCouples.add(key)
      // A marriage that ended (or where one of them has died) still built a household, but it is
      // not the thing to hand someone as a new group unprompted.
      if (isUnionEnded(g, aId, bId)) continue

      const aKids = new Set(g.childrenOf.get(aId) ?? [])
      const shared = (g.childrenOf.get(bId) ?? []).filter((childId) => aKids.has(childId))
      if (shared.length === 0) continue

      const memberIds = [aId, bId, ...shared]
      if (memberIds.length < 3) continue

      // Already together somewhere? Then this group exists, and asking again is noise.
      let common: Set<string> | null = null
      for (const id of memberIds) {
        const groups = groupsByPerson.get(id)
        if (!groups || groups.size === 0) {
          common = null
          break
        }
        if (common === null) {
          common = new Set(groups)
          continue
        }
        const soFar: Set<string> = common
        common = new Set([...soFar].filter((groupId) => groups.has(groupId)))
        if (common.size === 0) break
      }
      if (common && common.size > 0) continue

      out.push({
        kind: 'family_group',
        aId,
        bId,
        memberIds,
        memberNames: memberIds.map((id) => g.nameById.get(id) ?? 'Unknown'),
        // Filled in below, once every household is known — see the naming pass.
        suggestedName: '',
      })
    }
  }

  // Biggest households first — a couple with four kids is a more obviously real group than a
  // couple with one, and the pooling in loadHomeSuggestions only ever shows the first few.
  out.sort((x, y) => y.memberIds.length - x.memberIds.length)

  // Naming happens here, after sorting, rather than inside the loop: a name is only ambiguous
  // relative to the OTHER names on offer, and the biggest household has the best claim to the
  // plain "Volin Family" form. Existing groups count as taken too, so a suggestion can never
  // propose a name the founder already used for something else.
  const taken = new Set(existingGroupNames.map((n) => n.trim().toLowerCase()))
  for (const suggestion of out) {
    suggestion.suggestedName = proposeGroupName(suggestion.memberNames, taken)
    taken.add(suggestion.suggestedName.toLowerCase())
  }
  return out
}

export async function loadFamilyGroupSuggestions(dismissals: Dismissals): Promise<FamilyGroupSuggestion[]> {
  if (!dismissals.supported) return []
  const [graph, membershipRes, groupsRes] = await Promise.all([
    loadFamilyGraph(),
    // Account-wide, so paged — person_groups was over PostgREST's 1000-row cap on the founder's
    // account, and a membership missing here makes an already-grouped family look ungrouped, which
    // is exactly the question this is supposed to suppress.
    fetchAllRows((from, to) =>
      supabase.from('person_groups').select('person_id, group_id').order('person_id').order('group_id').range(from, to)
    ),
    fetchAllRows((from, to) => supabase.from('groups').select('name').order('id').range(from, to)),
  ])
  const existingNames = ((groupsRes.data as { name: string | null }[] | null) ?? [])
    .map((g) => g.name ?? '')
    .filter(Boolean)
  return deriveFamilyGroupSuggestions(
    graph,
    (membershipRes.data as MembershipRow[] | null) ?? [],
    existingNames
  ).filter((s) => !dismissals.has('family_group', s.aId, s.bId))
}

/**
 * Creates the group and adds everyone in one go. Mirrors Groups.tsx's own create (same columns,
 * same `group_type`) and GroupDetail's add-member upsert, so a group made from Home is identical
 * to one made by hand. Returns the error rather than swallowing it — the caller keeps the card up
 * and says it didn't save (the 2026-08-03 "Yes doesn't stick" lesson).
 */
export async function acceptFamilyGroupSuggestion(
  s: FamilyGroupSuggestion
): Promise<{ error: string | null; groupId?: string }> {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Not signed in' }

  const { data: created, error: createError } = await supabase
    .from('groups')
    .insert({ user_id: user.id, name: s.suggestedName, group_type: 'Family' })
    .select('id')
    .single()
  if (createError || !created) return { error: createError?.message ?? "that didn't save" }

  const { error: memberError } = await supabase
    .from('person_groups')
    .upsert(
      s.memberIds.map((personId) => ({ person_id: personId, group_id: created.id })),
      { onConflict: 'person_id,group_id', ignoreDuplicates: true }
    )
  if (memberError) return { error: memberError.message, groupId: created.id }
  return { error: null, groupId: created.id }
}
