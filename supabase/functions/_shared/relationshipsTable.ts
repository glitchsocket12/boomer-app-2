// The `relationships` table (2026-07-20 migration) is the shared source of truth every entry
// point reads and writes through: the family tree, person-facts' Key Facts linking, "my mom/dad"
// resolution, and the reciprocal-note writes in relationships.ts. Kept as its own module (rather
// than folded into relationships.ts) so the note-text/reciprocal-note concerns and the
// structured-graph concerns can each be read on their own — applyFamilySignals calls into this
// for every note it writes so the two can never drift apart.

export type RelationshipKind = "spouse" | "sibling" | "partner" | "parent"

type MinimalSupabaseClient = {
  from: (table: string) => any
}

// spouse/sibling/partner are symmetric -> stored once, normalized so person_a_id < person_b_id
// (same convention `group_associations` already uses for its symmetric pairs). "parent" is
// directional and NOT normalized: aId is always the parent, bId the child — callers must pass
// them in that order.
export async function upsertRelationship(
  supabaseClient: MinimalSupabaseClient,
  userId: string | undefined | null,
  aId: string | undefined | null,
  bId: string | undefined | null,
  kind: RelationshipKind
): Promise<void> {
  if (!userId || !aId || !bId || aId === bId) return
  const [personA, personB] = kind === "parent" ? [aId, bId] : aId < bId ? [aId, bId] : [bId, aId]
  await supabaseClient
    .from("relationships")
    .upsert(
      { user_id: userId, person_a_id: personA, person_b_id: personB, kind },
      { onConflict: "person_a_id,person_b_id,kind", ignoreDuplicates: true }
    )
}

export type PersonRelationships = {
  spouseIds: string[]
  partnerIds: string[]
  siblingIds: string[]
  parentIds: string[]
  childIds: string[]
}

// All of one person's relationship links in one shape, regardless of which side of a row
// (person_a_id/person_b_id) they happen to be stored on — used by the family tree, "my mom/dad"
// resolution, and person-facts' Key Facts linking.
export async function getRelationshipsForPerson(
  supabaseClient: MinimalSupabaseClient,
  personId: string
): Promise<PersonRelationships> {
  const result: PersonRelationships = { spouseIds: [], partnerIds: [], siblingIds: [], parentIds: [], childIds: [] }
  if (!personId) return result

  const { data } = await supabaseClient
    .from("relationships")
    .select("person_a_id, person_b_id, kind")
    .or(`person_a_id.eq.${personId},person_b_id.eq.${personId}`)

  for (const row of data ?? []) {
    if (row.kind === "parent") {
      if (row.person_a_id === personId) result.childIds.push(row.person_b_id)
      else result.parentIds.push(row.person_a_id)
      continue
    }
    const other = row.person_a_id === personId ? row.person_b_id : row.person_a_id
    if (row.kind === "spouse") result.spouseIds.push(other)
    else if (row.kind === "partner") result.partnerIds.push(other)
    else if (row.kind === "sibling") result.siblingIds.push(other)
  }
  return result
}
