// What KIND of thing a calendar candidate looks like, and how to order the recommended ones.
//
// Browser side. The Edge Functions have their own copy of the same list in
// `supabase/functions/_shared/significance.ts`, because Vite and Deno can't import across that
// boundary — same split, and same "keep the two in sync" rule, as pagedSelect.ts. Both must match
// the CHECK constraint in `2026-08-27-candidate-significance.sql`.

export const SIGNIFICANCE_KINDS = ['trip', 'celebration', 'milestone', 'holiday', 'gathering', 'routine'] as const

export type Significance = (typeof SIGNIFICANCE_KINDS)[number]

/** Everything that isn't 'routine'. What the Recommended list is made of. */
export const RECOMMENDED_KINDS: Significance[] = SIGNIFICANCE_KINDS.filter((k) => k !== 'routine')

/**
 * How a recommended row explains itself, e.g. "looks like a trip".
 *
 * Showing the AI's reason costs about two output tokens and makes a wrong guess VISIBLY wrong
 * rather than mysteriously wrong — which is what lets the founder calibrate how much to trust the
 * list instead of having to take it on faith.
 */
export const KIND_LABEL: Record<Significance, string> = {
  trip: 'looks like a trip',
  celebration: 'looks like a celebration',
  milestone: 'looks like a milestone',
  holiday: 'looks like a holiday',
  gathering: 'looks like a get-together',
  routine: 'looks routine',
}

export type InterestSignals = {
  suggested_people?: { matched_person_id?: string | null }[] | null
  suggested_group_ids?: string[] | null
  event_date?: string | null
  event_end_date?: string | null
}

/**
 * Ranks candidates WITHIN the recommended list, using only signals the model never saw.
 *
 * Deliberately structural — a real person on file, a real group on file, a span of more than one
 * day. It never weighs one KIND against another: deciding that a trip beats a milestone would be
 * me inventing a hierarchy of what matters in someone else's life, which is exactly the overreach
 * that got the AI's filter removed on 2026-08-12. The model says what a thing IS; this only asks
 * how much of the founder's own recorded world is already attached to it.
 *
 * Higher sorts first. Ties fall through to the list's existing newest-first order.
 */
export function interestScore(c: InterestSignals): number {
  let score = 0

  // Someone already in their life was there. The strongest signal available, and the only one that
  // survives a vague title: "Dinner" means nothing, "Dinner" with Kate attached means a lot.
  const knownPeople = (c.suggested_people ?? []).filter((p) => p?.matched_person_id).length
  if (knownPeople > 0) score += 3
  // A second known person is worth something; a fifteenth isn't fifteen times a first, so this
  // deliberately stops counting after one extra.
  if (knownPeople > 1) score += 1

  // Tied to a group they actually keep — a unit, a team, a circle.
  if ((c.suggested_group_ids ?? []).length > 0) score += 2

  // Spans more than one day. Weekends away and holidays look like this; appointments never do.
  if (c.event_date && c.event_end_date && c.event_end_date > c.event_date) score += 2

  return score
}

/** Newest-first within equal interest — the same order the rest of the triage list uses. */
export function compareCandidates<T extends InterestSignals>(a: T, b: T): number {
  const diff = interestScore(b) - interestScore(a)
  if (diff !== 0) return diff
  return (b.event_date ?? '').localeCompare(a.event_date ?? '')
}
