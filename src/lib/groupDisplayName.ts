// Disambiguates same-named subgroups under different parents (e.g. two units that each have a
// "Pilots" subgroup) by prefixing the parent chain wherever a group is picked or displayed.
export type GroupWithParent = { id: string; name: string; parent_group_id?: string | null }

// Subgroups nest arbitrarily deep (2026-08-03), so the label is the full ancestor chain —
// "Squadron / Alpha Flight / Pilots", not just "Alpha Flight / Pilots". Past two levels an
// immediate-parent-only label stops being unique, which was the whole point of qualifying it.
// `parentById` is optional: callers holding only a name map still get the old one-level label
// rather than an error, so nothing that hasn't been migrated to pass it changes behavior.
export function groupDisplayName(
  group: GroupWithParent,
  groupNameById: Map<string, string>,
  parentById?: Map<string, string | null>
): string {
  if (!parentById) {
    const parentName = group.parent_group_id ? groupNameById.get(group.parent_group_id) : null
    return parentName ? `${parentName} / ${group.name}` : group.name
  }

  const parts = [group.name]
  // Guards a cycle in the data. The DB CHECK only rejects a group being its OWN direct parent, so
  // a corrupted A -> B -> A chain is still representable; without `seen` this would loop forever
  // and hang the page rather than just rendering a slightly wrong label.
  const seen = new Set<string>([group.id])
  let currentId = group.parent_group_id ?? null
  while (currentId && !seen.has(currentId)) {
    seen.add(currentId)
    const parentName = groupNameById.get(currentId)
    // An ancestor missing from the roster (e.g. created server-side by `converse` after this map
    // was built) truncates the chain instead of dropping the whole label to a bare name.
    if (!parentName) break
    parts.unshift(parentName)
    currentId = parentById.get(currentId) ?? null
  }
  return parts.join(' / ')
}

// True when `candidateId` IS `ancestorId` or sits anywhere beneath it in the tree. The guard that
// keeps reparenting from building a cycle: a group can never be moved under itself or under one
// of its own descendants (which would silently detach that whole branch from every root).
export function isSelfOrDescendant(
  candidateId: string,
  ancestorId: string,
  parentById: Map<string, string | null>
): boolean {
  let currentId: string | null = candidateId
  const seen = new Set<string>()
  while (currentId && !seen.has(currentId)) {
    if (currentId === ancestorId) return true
    seen.add(currentId)
    currentId = parentById.get(currentId) ?? null
  }
  return false
}
