// Backlog item 15's "resolve 'my parents'" need — now that a person row can be flagged is_self
// (2026-07-20 migration), converse/update-moment/update-group can tell the model who "my"/"our"
// refers to and what's already known about them. Kept as its own dynamic (per-user, per-request)
// instruction paragraph rather than folded into any function's STABLE system-prompt tier — the
// self person's name and relationships are per-user data, and CLAUDE.md's caching rule requires
// the stable tier to stay byte-identical across every user/session (zero interpolated data), so
// this must live in whichever tier already carries the per-user roster instead.

import { getRelationshipsForPerson } from "./relationshipsTable.ts"
import { bucketCloseKin, type KinGraph } from "./kinship.ts"

export type SelfInfo = { id: string; name: string } | null

type MinimalSupabaseClient = {
  from: (table: string) => any
}

export function findSelfPerson(
  people: { id: string; is_self?: boolean | null }[] | null | undefined,
  nameById: Record<string, string>
): SelfInfo {
  const row = (people ?? []).find((p) => p.is_self)
  if (!row) return null
  return { id: row.id, name: nameById[row.id] ?? "" }
}

// A short instruction paragraph to append to a function's own per-request roster/context tier
// (never the stable tier — see the module comment above). Empty string when there's no self
// profile yet, so callers can always just append the result with no extra branching.
export async function buildSelfInstruction(
  supabaseClient: MinimalSupabaseClient,
  self: SelfInfo,
  nameById: Record<string, string>
): Promise<string> {
  if (!self || !self.name) return ""
  const rel = await getRelationshipsForPerson(supabaseClient, self.id)
  const describe = (ids: string[]) => {
    const names = ids.map((id) => nameById[id]).filter(Boolean)
    return names.length > 0 ? names.join(", ") : "none on file yet"
  }

  // Step-parent/step-sibling (death/divorce/remarriage backlog item): only surfaces once a
  // parent's OTHER union is on file, so most users cost nothing extra here — bounded to one query
  // per known parent (almost always 0-2), not a full graph walk, since this is a per-request tier
  // and can't afford building the whole relationships graph on every converse call. Both levels
  // (parents, then their spouses) are fetched with Promise.all instead of sequential awaits inside
  // the loops — each parent's/spouse's relationships are independent of the others, so there's no
  // reason to pay for them one round-trip at a time.
  const stepParentNames = new Set<string>()
  const stepSiblingNames = new Set<string>()
  const parentRels = await Promise.all(rel.parentIds.map((parentId) => getRelationshipsForPerson(supabaseClient, parentId)))
  const stepParentIds = new Set<string>()
  for (const parentRel of parentRels) {
    for (const spouseId of [...parentRel.spouseIds, ...parentRel.partnerIds]) {
      if (rel.parentIds.includes(spouseId)) continue // the OTHER known parent, not a step-parent
      stepParentIds.add(spouseId)
      const name = nameById[spouseId]
      if (name) stepParentNames.add(name)
    }
  }
  const spouseRels = await Promise.all([...stepParentIds].map((spouseId) => getRelationshipsForPerson(supabaseClient, spouseId)))
  for (const spouseRel of spouseRels) {
    for (const childId of spouseRel.childIds) {
      if (childId === self.id || rel.childIds.includes(childId)) continue
      const childName = nameById[childId]
      if (childName) stepSiblingNames.add(childName)
    }
  }
  const stepText =
    stepParentNames.size > 0 || stepSiblingNames.size > 0
      ? ` Step-parent(s): ${stepParentNames.size > 0 ? [...stepParentNames].join(", ") : "none on file"}; step-sibling(s): ${stepSiblingNames.size > 0 ? [...stepSiblingNames].join(", ") : "none on file"}.`
      : ""

  return `\n\nThe app's user is themselves recorded in this app as "${self.name}". When they refer to their OWN relative with "my"/"our" and name no other specific subject (e.g. "my mom is Amy", "my brother Josh", "we visited my parents"), treat "${self.name}" as the "subject" in family_signals, exactly as if they'd said "${self.name}'s mom is Amy." You can also use this to directly answer questions like "who are my parents" or "what's my brother's name" from what's already known. Known relationships already on file for ${self.name} — parents: ${describe(rel.parentIds)}; spouse/partner: ${describe([...rel.spouseIds, ...rel.partnerIds])}; siblings: ${describe(rel.siblingIds)}; kids: ${describe(rel.childIds)}.${stepText}`
}

// The EXTENDED family buildSelfInstruction stops short of: grandparents, aunts/uncles, first
// cousins, nieces/nephews, grandchildren, and the three in-law slots. Without this the model can
// resolve "my mom" but not "my cousin Steve", and quietly guesses or asks who that is.
//
// Cost (CLAUDE.md rule 3): this lands in the same per-request roster tier buildSelfInstruction does,
// which converse marks with a 1h cache TTL — so the per-turn cost is a cache READ, and what matters
// is the size and the rewrite on roster change. Hence the hard bound at two generations out
// (typically 10-40 names, ~150-250 tokens) rather than a line per roster person, and hence the
// sorted, fixed-order serialization: a reshuffle on unchanged data would throw the cache away.
//
// One unfiltered relationships select REPLACES the 4-6 bounded round-trips buildSelfInstruction
// makes, so this is fewer queries, not more — and it ends the divergence between what the family
// tree says and what the AI says, since both now run the same math.
export async function buildKinInstruction(
  supabaseClient: MinimalSupabaseClient,
  self: SelfInfo,
  nameById: Record<string, string>
): Promise<string> {
  if (!self || !self.name) return ""

  const { data } = await supabaseClient.from("relationships").select("person_a_id, person_b_id, kind")
  const parentsOf = new Map<string, string[]>()
  const childrenOf = new Map<string, string[]>()
  const spousesOf = new Map<string, string[]>()
  const siblingsOf = new Map<string, string[]>()
  const push = (map: Map<string, string[]>, key: string, value: string) => {
    const arr = map.get(key) ?? []
    if (!arr.includes(value)) arr.push(value)
    map.set(key, arr)
  }
  for (const row of data ?? []) {
    const a = row.person_a_id
    const b = row.person_b_id
    if (row.kind === "parent") {
      push(parentsOf, b, a)
      push(childrenOf, a, b)
    } else if (row.kind === "spouse" || row.kind === "partner") {
      push(spousesOf, a, b)
      push(spousesOf, b, a)
    } else if (row.kind === "sibling") {
      push(siblingsOf, a, b)
      push(siblingsOf, b, a)
    }
  }

  const graph: KinGraph = { parentsOf, childrenOf, spousesOf }
  // Sorted so the walk order — and therefore nothing at all — depends on row order from PostgREST.
  const everyoneIds = Object.keys(nameById).sort()
  const buckets = bucketCloseKin(graph, self.id, everyoneIds, nameById)

  // The three in-law slots are one hop each on the maps already built above, so they don't need any
  // of the kinship math (and don't grow the mirror to get it).
  const named = (ids: Iterable<string>) => [...new Set([...ids].map((id) => nameById[id]).filter(Boolean))].sort()
  const spouseIds = spousesOf.get(self.id) ?? []
  const parentsInLaw = named(spouseIds.flatMap((s) => parentsOf.get(s) ?? []))
  const siblingsInLaw = named([
    ...spouseIds.flatMap((s) => siblingsOf.get(s) ?? []),
    ...(siblingsOf.get(self.id) ?? []).flatMap((sib) => spousesOf.get(sib) ?? []),
  ])
  const childrenInLaw = named((childrenOf.get(self.id) ?? []).flatMap((c) => spousesOf.get(c) ?? []))

  const parts: string[] = []
  const add = (label: string, names: string[]) => {
    if (names.length > 0) parts.push(`${label}: ${names.join(", ")}`)
  }
  add("grandparents", buckets.grandparents)
  add("aunts/uncles", buckets.auntsUncles)
  add("first cousins", buckets.firstCousins)
  add("nieces/nephews", buckets.niecesNephews)
  add("grandchildren", buckets.grandchildren)
  add("parents-in-law", parentsInLaw)
  add("siblings-in-law", siblingsInLaw)
  add("children-in-law", childrenInLaw)
  if (parts.length === 0) return ""

  return ` Extended family already on file for ${self.name} — ${parts.join("; ")}. Use these to resolve "my cousin", "my aunt", "my nephew", "my mother-in-law" and the like to the named person rather than asking who they mean. This list is exhaustive for those relationships: do not infer any that isn't in it.`
}
