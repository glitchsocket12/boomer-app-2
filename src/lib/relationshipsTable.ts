import { supabase } from './supabase'

// Browser-side mirror of supabase/functions/_shared/relationshipsTable.ts — the `relationships`
// table is the shared source of truth (2026-07-20 migration), so a relationship confirmed via a
// suggestion banner (RelationshipSuggestions.tsx) must land in the same table a confident
// edge-function match writes to directly. Kept as a separate small module (Deno functions can't
// import across the Vite/frontend boundary) — keep in sync if the table shape ever changes.

export type RelationshipKind = 'spouse' | 'sibling' | 'partner' | 'parent'

// spouse/sibling/partner are symmetric -> stored once, normalized so person_a_id < person_b_id.
// "parent" is directional and NOT normalized: aId is always the parent, bId the child.
export async function upsertRelationship(
  userId: string | undefined | null,
  aId: string | undefined | null,
  bId: string | undefined | null,
  kind: RelationshipKind
): Promise<void> {
  if (!userId || !aId || !bId || aId === bId) return
  const [personA, personB] = kind === 'parent' ? [aId, bId] : aId < bId ? [aId, bId] : [bId, aId]
  await supabase
    .from('relationships')
    .upsert(
      { user_id: userId, person_a_id: personA, person_b_id: personB, kind },
      { onConflict: 'person_a_id,person_b_id,kind', ignoreDuplicates: true }
    )
}

// Inverse of upsertRelationship — same normalization, so a mis-added edge (wrong kind, wrong
// direction) can be cleanly removed rather than left to rot as bad data once someone notices.
export async function removeRelationship(
  aId: string | undefined | null,
  bId: string | undefined | null,
  kind: RelationshipKind
): Promise<void> {
  if (!aId || !bId || aId === bId) return
  const [personA, personB] = kind === 'parent' ? [aId, bId] : aId < bId ? [aId, bId] : [bId, aId]
  await supabase.from('relationships').delete().eq('person_a_id', personA).eq('person_b_id', personB).eq('kind', kind)
}

// Sets/clears ended_reason on a spouse/partner pair (divorce) — kept as its own function rather
// than routed through upsertRelationship since it updates an existing row's status column instead
// of inserting a new relationship row. Pass null to clear (e.g. an accidental mark, or reconciling
// a mistaken entry) without deleting the underlying spouse/partner relationship itself.
export async function setRelationshipEndedReason(
  aId: string | undefined | null,
  bId: string | undefined | null,
  kind: 'spouse' | 'partner',
  reason: 'divorce' | null
): Promise<void> {
  if (!aId || !bId || aId === bId) return
  const [personA, personB] = aId < bId ? [aId, bId] : [bId, aId]
  await supabase
    .from('relationships')
    .update({ ended_reason: reason })
    .eq('person_a_id', personA)
    .eq('person_b_id', personB)
    .eq('kind', kind)
}

export type PersonRelationships = {
  spouseIds: string[]
  partnerIds: string[]
  siblingIds: string[]
  parentIds: string[]
  childIds: string[]
}

export async function getRelationshipsForPerson(personId: string): Promise<PersonRelationships> {
  const result: PersonRelationships = { spouseIds: [], partnerIds: [], siblingIds: [], parentIds: [], childIds: [] }
  if (!personId) return result

  const { data } = await supabase
    .from('relationships')
    .select('person_a_id, person_b_id, kind')
    .or(`person_a_id.eq.${personId},person_b_id.eq.${personId}`)

  for (const row of data ?? []) {
    if (row.kind === 'parent') {
      if (row.person_a_id === personId) result.childIds.push(row.person_b_id)
      else result.parentIds.push(row.person_a_id)
      continue
    }
    const other = row.person_a_id === personId ? row.person_b_id : row.person_a_id
    if (row.kind === 'spouse') result.spouseIds.push(other)
    else if (row.kind === 'partner') result.partnerIds.push(other)
    else if (row.kind === 'sibling') result.siblingIds.push(other)
  }
  return result
}

// Batched form of getRelationshipsForPerson, for callers that need several people's relationships
// at once (e.g. suggestFamilyMembers in relationshipSuggestions.ts) without one round-trip each.
// Pass an id list to scope the query to just those people (either side of the row); omit it to
// pull the whole table in one shot, same "one full-table fetch" pattern familyTree.ts already
// uses for the same table. An empty array short-circuits to an empty map, not a scopeless fetch.
export async function getRelationshipsMap(personIds?: string[]): Promise<Map<string, PersonRelationships>> {
  const result = new Map<string, PersonRelationships>()
  function ensure(id: string): PersonRelationships {
    let rel = result.get(id)
    if (!rel) {
      rel = { spouseIds: [], partnerIds: [], siblingIds: [], parentIds: [], childIds: [] }
      result.set(id, rel)
    }
    return rel
  }

  if (personIds && personIds.length === 0) return result

  let query = supabase.from('relationships').select('person_a_id, person_b_id, kind')
  if (personIds) {
    const idList = personIds.join(',')
    query = query.or(`person_a_id.in.(${idList}),person_b_id.in.(${idList})`)
  }
  const { data } = await query

  for (const row of data ?? []) {
    if (row.kind === 'parent') {
      ensure(row.person_a_id).childIds.push(row.person_b_id)
      ensure(row.person_b_id).parentIds.push(row.person_a_id)
      continue
    }
    const a = ensure(row.person_a_id)
    const b = ensure(row.person_b_id)
    if (row.kind === 'spouse') {
      a.spouseIds.push(row.person_b_id)
      b.spouseIds.push(row.person_a_id)
    } else if (row.kind === 'partner') {
      a.partnerIds.push(row.person_b_id)
      b.partnerIds.push(row.person_a_id)
    } else if (row.kind === 'sibling') {
      a.siblingIds.push(row.person_b_id)
      b.siblingIds.push(row.person_a_id)
    }
  }
  return result
}
