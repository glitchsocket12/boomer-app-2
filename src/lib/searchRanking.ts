// Ranking for the type-to-search pickers (see SearchAddPicker). Pure and separate from the
// component so it can be tested directly.

export type RankableItem = { id: string; label: string }

// How well a label answers the query; lower is better.
//
// A plain "does the label contain what I typed" filter stops working once labels are hierarchical
// ("98 FTS / Alpha Flight / Pilots"). Searching a parent's name matches every one of its
// descendants too, and with the results list capped, the parent itself could fall off the bottom
// entirely — so tagging an event to a top-level group was impossible once that group had more
// than a handful of subgroups (founder report, 2026-08-10). Ranking puts the thing you actually
// named first and pushes its descendants below it.
export function matchScore(label: string, q: string): number {
  const l = label.toLowerCase()
  if (l === q) return 0 // the exact thing typed
  if (l.startsWith(q)) return 1 // that thing's descendants ("98 FTS / …"), and partial names
  // Past the last separator is a group's own name; everything before it is just ancestor context.
  // Lets "pilots" find "98 FTS / Alpha Flight / Pilots" ahead of an unrelated "Pilots Association
  // Newsletter" match buried mid-label.
  const own = l.slice(l.lastIndexOf('/') + 1).trim()
  if (own === q) return 2
  if (own.startsWith(q)) return 3
  return 4 // matched somewhere in the middle
}

// Sorted, not just filtered. Ties break shallowest-first so a search lands on the top of a branch
// rather than on the deepest leaves under it, then shortest, then alphabetically so the order is
// stable between keystrokes.
export function rankMatches<T extends RankableItem>(items: T[], q: string): T[] {
  return items
    .filter((item) => item.label.toLowerCase().includes(q))
    .map((item) => ({
      item,
      score: matchScore(item.label, q),
      depth: (item.label.match(/\//g) ?? []).length,
    }))
    .sort(
      (a, b) =>
        a.score - b.score ||
        a.depth - b.depth ||
        a.item.label.length - b.item.label.length ||
        a.item.label.localeCompare(b.item.label)
    )
    .map((r) => r.item)
}
