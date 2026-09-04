// Which Timeline row a sub-event belongs under.
//
// The Calendar page collapses a trip into ONE row — the parent, with its sub-events tucked
// underneath — so something has to decide which row is the parent. That isn't just "follow
// parent_moment_id once". Three shapes in the real data break the naive version:
//
//   1. Depth greater than two. One event today is a grandchild ("Wedding Welcome Party" ->
//      "Wedding Reception" -> "Mary Alice and Schyler Get Married") and the founder wants one row
//      for the wedding, not a row nested inside a row. So a node resolves to its HIGHEST
//      ancestor, not its immediate parent.
//   2. An ancestor that isn't on the page. Calendar only loads dated events
//      (`.not('event_date','is',null)`), and a calendar-imported parent routinely carries no date
//      while its children are fully dated — eventSpan.ts documents that shape. Grouping under an
//      ancestor nobody can see would make those children vanish, so the walk keeps climbing past
//      a missing ancestor and settles on the highest one that IS present. A node with no present
//      ancestor is simply its own root, which puts it back on the timeline as a normal row.
//   3. A cycle. The DB CHECK only rejects a row being its own direct parent, so a corrupted
//      A -> B -> A chain is still representable. Without the `seen` guard this loops forever and
//      hangs the page — same guard, same reason, as qualifiedName.ts.

/**
 * `{ id => rootId }` for every id in `presentIds`, where the root is the highest ancestor that is
 * itself present. An id with no present ancestor maps to itself.
 */
export function resolveRootIds(
  parentById: ReadonlyMap<string, string>,
  presentIds: ReadonlySet<string>
): Map<string, string> {
  const rootById = new Map<string, string>()
  for (const id of presentIds) {
    let root = id
    const seen = new Set<string>([id])
    let current = parentById.get(id)
    while (current && !seen.has(current)) {
      seen.add(current)
      if (presentIds.has(current)) root = current
      current = parentById.get(current)
    }
    rootById.set(id, root)
  }
  return rootById
}
