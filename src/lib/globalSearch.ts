// Matching and ranking for the global search panel (see components/GlobalSearch.tsx). Pure and
// separate from both the component and the loader so it can be tested directly, the same split
// searchRanking.ts uses for the pickers.
//
// This exists because the per-page filters only ever search their own list, and only its titles:
// People.tsx matches names, Events.tsx matches occasion/location/summary/attendees/tags. Note
// content and an event's raw_description — the actual stories — were searchable NOWHERE in the app
// (backlog item 14). A doc's `body` is what makes those reachable, and it deliberately scores below
// every title match so typing a name still lands on the person rather than on some note that
// mentions them in passing.

import { matchScore } from './searchRanking'

export type DocKind = 'person' | 'pet' | 'event' | 'group' | 'note' | 'tag' | 'notebook'

/** Where a result navigates to. A note points at whatever it hangs off, not at itself. */
export type SearchTarget = {
  kind: 'person' | 'pet' | 'event' | 'group' | 'tag' | 'notebook'
  id: string
  label: string
}

export type SearchDoc = {
  kind: DocKind
  /** The record's own id — unique per kind, not across kinds, so React keys need both. */
  id: string
  /** Searched, and shown as the result's main line unless `display` overrides it. */
  title: string
  /**
   * Rendered instead of `title` when the two differ. Only the account owner uses this today
   * ("You", per backlog item 33) — their real name stays in `title` so typing it still finds them.
   */
  display?: string
  /** The quiet second line: "on Steve Volin", "Maui · March 2024". Not searched. */
  subtitle?: string
  /** Searched, never shown whole — a match here renders as a snippet. See `snippet`. */
  body?: string
  target: SearchTarget
}

// One letter matches most of an account, which is noise rather than a search.
export const MIN_QUERY_LENGTH = 2

// A body-only hit, ranked below matchScore's worst title hit (4). Someone typing a name wants the
// person, not the eleven notes that mention them.
const BODY_ONLY_SCORE = 5

// Which kind wins a tie. People first because a name is the most common thing to look up, notes
// second-to-last because they're the most numerous and the least specific.
const KIND_ORDER: Record<DocKind, number> = { person: 0, group: 1, event: 2, pet: 3, tag: 4, notebook: 5, note: 6 }

function scoreDoc(doc: SearchDoc, q: string): number | null {
  if (doc.title.toLowerCase().includes(q)) return matchScore(doc.title, q)
  if (doc.body?.toLowerCase().includes(q)) return BODY_ONLY_SCORE
  return null
}

/**
 * Filtered AND sorted. `query` is taken raw — unlike rankMatches, which requires its caller to
 * pre-trim and pre-lowercase — because every call site here is a text input and forgetting that
 * step silently returns nothing.
 *
 * Ties break by kind, then shortest title, then alphabetically, so the order can't shuffle between
 * keystrokes while someone is reaching for a row.
 */
export function searchDocs(docs: SearchDoc[], query: string): SearchDoc[] {
  const q = query.trim().toLowerCase()
  if (q.length < MIN_QUERY_LENGTH) return []
  return docs
    .map((doc) => ({ doc, score: scoreDoc(doc, q) }))
    .filter((r): r is { doc: SearchDoc; score: number } => r.score !== null)
    .sort(
      (a, b) =>
        a.score - b.score ||
        KIND_ORDER[a.doc.kind] - KIND_ORDER[b.doc.kind] ||
        a.doc.title.length - b.doc.title.length ||
        a.doc.title.localeCompare(b.doc.title)
    )
    .map((r) => r.doc)
}

/** Results split into their own sections, each in `searchDocs` order. Empty kinds are dropped. */
export function groupByKind(results: SearchDoc[]): { kind: DocKind; docs: SearchDoc[] }[] {
  const byKind = new Map<DocKind, SearchDoc[]>()
  for (const doc of results) {
    const existing = byKind.get(doc.kind)
    if (existing) existing.push(doc)
    else byKind.set(doc.kind, [doc])
  }
  return [...byKind.entries()]
    .sort((a, b) => KIND_ORDER[a[0]] - KIND_ORDER[b[0]])
    .map(([kind, docs]) => ({ kind, docs }))
}

/**
 * A window of `body` centred on the match, so a note result shows the words that actually matched
 * rather than its first line. Ellipses mark a trimmed edge, so "…retiring to Hawaii one day…" reads
 * as an excerpt and not as the whole note.
 *
 * Falls back to the head of the text when the query isn't in `body` at all — the caller may be
 * rendering a title-matched doc through the same row component.
 */
export function snippet(body: string, query: string, radius = 34): string {
  const text = body.replace(/\s+/g, ' ').trim()
  const q = query.trim().toLowerCase()
  const at = q ? text.toLowerCase().indexOf(q) : -1
  if (at === -1) return text.length > radius * 2 ? `${text.slice(0, radius * 2).trimEnd()}…` : text

  const start = Math.max(0, at - radius)
  const end = Math.min(text.length, at + q.length + radius)
  return `${start > 0 ? '…' : ''}${text.slice(start, end).trim()}${end < text.length ? '…' : ''}`
}
