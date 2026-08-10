// Server-side twin of src/lib/groupRollup.ts. Same rule, deliberately duplicated: Edge Functions
// run on Deno and can't import from src/, which is why _shared/ exists at all (see groupNames.ts,
// the naming-side twin of src/lib/groupDisplayName.ts).
//
// Anyone in a subgroup is a member of every group above it, at any depth (founder, 2026-08-10).
// Derived only — nothing is written back to person_groups, here or in the app.

export type ParentedGroup = { id: string; parent_group_id?: string | null }
export type MembershipRow = { person_id: string; group_id: string }

// groupId -> every member's person id, own roster plus the whole subtree below it, de-duped.
//
// Sorted by person id rather than left in visit order: the walk reaches subgroups in tree order,
// so reparenting one subgroup would otherwise reshuffle an unrelated parent's member list. In
// converse that list is serialized into a prompt tier cached for an hour, and a reshuffle is a
// cache miss for a turn where nobody's membership actually changed.
export function rollUpGroupMemberIds(
  groups: ParentedGroup[],
  personGroups: MembershipRow[],
  // Lets a caller drop rows it can't resolve (converse skips person ids with no name on file)
  // without having to filter the array first.
  includePerson: (personId: string) => boolean = () => true
): Record<string, string[]> {
  const memberIdsByGroup: Record<string, string[]> = {}
  for (const row of personGroups) {
    if (!includePerson(row.person_id)) continue
    ;(memberIdsByGroup[row.group_id] ??= []).push(row.person_id)
  }

  const childIdsByParent: Record<string, string[]> = {}
  for (const g of groups) {
    if (g.parent_group_id) (childIdsByParent[g.parent_group_id] ??= []).push(g.id)
  }

  const out: Record<string, string[]> = {}
  for (const g of groups) {
    const memberIds = new Set<string>(memberIdsByGroup[g.id] ?? [])
    // Cycle-guarded: the DB CHECK only rejects a group being its OWN direct parent, so A -> B -> A
    // is still representable and an unguarded walk would never terminate.
    const seen = new Set<string>([g.id])
    const queue = [...(childIdsByParent[g.id] ?? [])]
    while (queue.length > 0) {
      const childId = queue.shift()!
      if (seen.has(childId)) continue
      seen.add(childId)
      for (const personId of memberIdsByGroup[childId] ?? []) memberIds.add(personId)
      queue.push(...(childIdsByParent[childId] ?? []))
    }
    if (memberIds.size > 0) out[g.id] = [...memberIds].sort()
  }
  return out
}
