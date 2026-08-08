// Ranking for the type-to-pick lists (SearchAddPicker). Plain substring filtering was fine when
// every label was a bare name, but group labels are now full ancestor paths ("98 FTS / 2016" —
// see groupDisplayName.ts), so typing a parent's name matches the parent AND every one of its
// descendants. Unranked and capped, the parent could fall off the end of the list entirely: you'd
// type "98 FTS" and be offered only its subgroups, with no way to pick the thing you actually
// named. Ranking puts the closest match first so the cap can only ever cut the least relevant
// rows.

export type RankableItem = { id: string; label: string }

// The separator groupDisplayName joins ancestor chains with. Split on it so the group's OWN name
// can be scored separately from the inherited prefix — "Alpha / 98 FTS" is a better answer to
// "98 FTS" than "98 FTS / 2016" is, even though the latter matches earlier in the string.
const PATH_SEPARATOR = '/'

// Lower is better. Tiers are deliberately coarse — inside a tier the tiebreakers below decide,
// which keeps the ordering predictable instead of fuzzy-score soup.
const NO_MATCH = 99

function scoreLabel(label: string, q: string): number {
  const lower = label.toLowerCase()
  const segments = lower.split(PATH_SEPARATOR).map((s) => s.trim())
  const own = segments[segments.length - 1] ?? lower

  if (lower === q) return 0 // the whole label, exactly
  if (own === q) return 1 // this group's own name, exactly — its ancestors just came along
  if (lower.startsWith(q)) return 2 // "98 FTS" typed, "98 FTS / 2016" offered
  if (own.startsWith(q)) return 3
  if (segments.some((segment) => segment.startsWith(q))) return 4
  // A word anywhere in the label starts with the query ("smith" finding "Jane Smith").
  if (new RegExp(`\\b${escapeRegExp(q)}`).test(lower)) return 5
  if (lower.includes(q)) return 6
  return NO_MATCH
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function depth(label: string): number {
  return label.split(PATH_SEPARATOR).length
}

// Filters to labels matching `query` and sorts best-first, then caps. Returns `truncated` so the
// caller can say so out loud rather than silently hiding options — the failure this whole module
// exists to fix was a silent cut.
export function rankSearchMatches<T extends RankableItem>(
  items: T[],
  query: string,
  limit: number
): { results: T[]; truncated: boolean } {
  const q = query.trim().toLowerCase()
  if (!q) return { results: [], truncated: false }

  const scored = items
    .map((item) => ({ item, score: scoreLabel(item.label, q) }))
    .filter((entry) => entry.score !== NO_MATCH)

  scored.sort((a, b) => {
    if (a.score !== b.score) return a.score - b.score
    // Shallower first: within an equally good match, a parent group is the more likely target
    // than any of the subgroups that merely inherited its name in their path.
    const depthDiff = depth(a.item.label) - depth(b.item.label)
    if (depthDiff !== 0) return depthDiff
    // Then shorter, so "98 FTS" beats "98 FTS Reunion Committee" — less padding around the words
    // you typed means a closer match.
    if (a.item.label.length !== b.item.label.length) return a.item.label.length - b.item.label.length
    return a.item.label.localeCompare(b.item.label)
  })

  return { results: scored.slice(0, limit).map((entry) => entry.item), truncated: scored.length > limit }
}
