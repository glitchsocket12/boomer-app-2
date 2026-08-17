// The "Parent / Child" label walk shared by groupDisplayName.ts (subgroups) and
// momentDisplayName.ts (sub-events). Both trees are the same shape — a nullable self-referencing
// parent id — and the founder reads both in the same style of dropdown, so they have to read
// identically: a bare "Pilots" or a bare "Day 3" in a picker is unidentifiable the moment two
// different parents each have one (founder, 2026-08-16 — the sub-event half of the same complaint
// that produced the group version).
export function qualifiedName(
  id: string,
  ownName: string,
  parentId: string | null | undefined,
  nameById: ReadonlyMap<string, string>,
  parentById: ReadonlyMap<string, string | null>
): string {
  const parts = [ownName]
  // Guards a cycle in the data. The DB CHECK only rejects a row being its OWN direct parent, so a
  // corrupted A -> B -> A chain is still representable; without `seen` this would loop forever and
  // hang the page rather than just rendering a slightly wrong label.
  const seen = new Set<string>([id])
  let currentId = parentId ?? null
  while (currentId && !seen.has(currentId)) {
    seen.add(currentId)
    const parentName = nameById.get(currentId)
    // An ancestor missing from the roster (e.g. a parent event filtered out of the list this map
    // was built from) truncates the chain instead of dropping the whole label to a bare name.
    if (!parentName) break
    parts.unshift(parentName)
    currentId = parentById.get(currentId) ?? null
  }
  return parts.join(' / ')
}
