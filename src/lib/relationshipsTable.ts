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
