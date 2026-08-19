import { summarize } from './summarize'

// Free, client-side "might already be on file" heuristic — no AI call. Normalized word-overlap on
// the title, optionally corroborated by date proximity/overlap. Deliberately simple and tunable
// rather than a fuzzy-match library, since a human always reviews the suggestion before anything
// merges.
//
// Lives here rather than in ImportReview.tsx because CalendarTriage.tsx needs the same answer:
// "Quick Add" saves an event in one tap without ever showing the four-way merge banner, so without
// this check that button would be the fastest way in the app to create a duplicate. Two copies of
// the thresholds would drift on the first tuning pass, so there is one.

/** What the heuristic needs from a candidate — both callers pass more than this. */
export type DuplicateCandidate = {
  occasion: string | null
  event_date: string | null
  event_end_date: string | null
}

/** What it needs from something already on file. */
export type DuplicateTarget = {
  occasion: string | null
  event_date: string | null
  event_end_date: string | null
  raw_description: string
}

const STOPWORDS = new Set(['the', 'a', 'an', 'and', 'or', 'of', 'for', 'to', 'with', 'at', 'in', 'on'])
const TITLE_OVERLAP_THRESHOLD = 0.5
const HIGH_CONFIDENCE_TITLE_THRESHOLD = 0.8
const DATE_PROXIMITY_DAYS = 3

export function titleWords(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w && !STOPWORDS.has(w))
  )
}

export function titleOverlapRatio(a: string, b: string): number {
  const wa = titleWords(a)
  const wb = titleWords(b)
  if (wa.size === 0 || wb.size === 0) return 0
  let intersection = 0
  for (const w of wa) if (wb.has(w)) intersection++
  return intersection / Math.min(wa.size, wb.size)
}

export function datesAreClose(candidate: DuplicateCandidate, existing: DuplicateTarget): boolean {
  if (!candidate.event_date || !existing.event_date) return false
  const dayMs = 24 * 60 * 60 * 1000
  const cStart = new Date(`${candidate.event_date}T00:00:00`).getTime()
  const cEnd = new Date(`${candidate.event_end_date || candidate.event_date}T00:00:00`).getTime()
  const eStart = new Date(`${existing.event_date}T00:00:00`).getTime()
  const eEnd = new Date(`${existing.event_end_date || existing.event_date}T00:00:00`).getTime()
  if (cStart <= eEnd && eStart <= cEnd) return true // ranges overlap
  const gap = cStart > eEnd ? cStart - eEnd : eStart - cEnd
  return gap <= DATE_PROXIMITY_DAYS * dayMs
}

export function findLikelyMatch<T extends DuplicateTarget>(candidate: DuplicateCandidate, existing: T[]): T | null {
  const candidateTitle = candidate.occasion?.trim()
  if (!candidateTitle) return null
  let best: T | null = null
  let bestScore = 0
  for (const m of existing) {
    const title = m.occasion?.trim() || summarize(null, m.raw_description)
    const overlap = titleOverlapRatio(candidateTitle, title)
    const matches = overlap >= HIGH_CONFIDENCE_TITLE_THRESHOLD || (overlap >= TITLE_OVERLAP_THRESHOLD && datesAreClose(candidate, m))
    if (matches && overlap > bestScore) {
      bestScore = overlap
      best = m
    }
  }
  return best
}
