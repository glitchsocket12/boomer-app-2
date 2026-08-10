// The membership side of the group tree, companion to groupDisplayName.ts (the naming side) and
// groupRoster.ts (the id -> row lookup).
//
// Anyone in a subgroup is in the group above it, all the way up (founder, 2026-08-10) — the
// group-side mirror of the sub-event attendee rollup EventDetail.tsx and Events.tsx already do.
// Rolled up at render time and NEVER written back to person_groups: the membership row stays on
// the subgroup it was added to, so removing someone there removes them from every ancestor too,
// with no duplicate rows to keep in sync.
//
// That "derived, not written" part is load-bearing. This is deliberately not the DB sync trigger
// that was tried and reverted 2026-07-26 (PROJECT_CONTEXT §6): the parent's own person_groups rows
// still mean exactly "who I explicitly put in this group", so the rollup stays reversible, and
// downward auto-population (parent's roster silently filling a new subgroup) still never happens.

export type ParentedGroup = { id: string; parent_group_id?: string | null }

// parentId -> its direct child ids. Built once by callers rolling up more than one group, so a
// whole page's worth of rollups stays linear rather than re-scanning the list per group.
export function buildChildIndex(groups: ParentedGroup[]): Map<string, string[]> {
  const index = new Map<string, string[]>()
  for (const g of groups) {
    const parentId = g.parent_group_id ?? null
    if (!parentId) continue
    const siblings = index.get(parentId)
    if (siblings) siblings.push(g.id)
    else index.set(parentId, [g.id])
  }
  return index
}

// Every group below `groupId`, at any depth — subgroups nest arbitrarily deep, so one level isn't
// enough. Cycle-guarded: the DB CHECK only rejects a group being its OWN direct parent, so
// A -> B -> A is still representable and this walk would otherwise never bottom out (same guard,
// same reason, as flattenGroupTree in Groups.tsx).
export function descendantGroupIds(groupId: string, childIndex: Map<string, string[]>): string[] {
  const out: string[] = []
  const seen = new Set<string>([groupId])
  const queue = [...(childIndex.get(groupId) ?? [])]
  while (queue.length > 0) {
    const id = queue.shift()!
    if (seen.has(id)) continue
    seen.add(id)
    out.push(id)
    queue.push(...(childIndex.get(id) ?? []))
  }
  return out
}

// Merges descendant members into a group's own explicit roster, de-duped by person id and keeping
// the explicit roster's order first. `rolledUpIds` is who's here ONLY by rollup: they have no
// person_groups row on this group, so there's nothing for a remove control to act on — callers
// use it to drop the untag badge and say where the membership actually lives.
export function mergeRolledUpMembers<P extends { id: string }>(
  explicit: P[],
  fromDescendants: P[]
): { members: P[]; rolledUpIds: Set<string> } {
  const byId = new Map<string, P>()
  for (const p of explicit) byId.set(p.id, p)

  const rolledUpIds = new Set<string>()
  for (const p of fromDescendants) {
    if (byId.has(p.id)) continue
    byId.set(p.id, p)
    rolledUpIds.add(p.id)
  }

  return { members: [...byId.values()], rolledUpIds }
}

// The batch form, for a page that already holds every group's roster in memory (Groups.tsx loads
// all of them in one query, so its rollup costs no extra round trip).
export function rollUpMembersByGroup<P extends { id: string }>(
  groups: (ParentedGroup & { members: P[] })[]
): Map<string, { members: P[]; rolledUpIds: Set<string> }> {
  const childIndex = buildChildIndex(groups)
  const membersById = new Map(groups.map((g) => [g.id, g.members]))

  const out = new Map<string, { members: P[]; rolledUpIds: Set<string> }>()
  for (const g of groups) {
    const fromDescendants: P[] = []
    for (const descendantId of descendantGroupIds(g.id, childIndex)) {
      fromDescendants.push(...(membersById.get(descendantId) ?? []))
    }
    out.set(g.id, mergeRolledUpMembers(g.members, fromDescendants))
  }
  return out
}
