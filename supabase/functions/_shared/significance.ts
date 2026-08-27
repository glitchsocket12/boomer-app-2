// What KIND of thing a calendar candidate looks like — the "Recommended" signal (see
// migrations_manual/2026-08-27-candidate-significance.sql for the why).
//
// Deno side. The browser has its own copy of the same list in src/lib/candidateInterest.ts,
// because Vite and Deno can't import across that boundary — same split, and same "keep the two in
// sync" rule, as pagedSelect.ts. Both must match the CHECK constraint.

export const SIGNIFICANCE_KINDS = [
  "trip",
  "celebration",
  "milestone",
  "holiday",
  "gathering",
  "routine",
] as const

export type Significance = (typeof SIGNIFICANCE_KINDS)[number]

// Near-misses worth catching rather than throwing away. Kept deliberately short: this is a safety
// net for obvious synonyms, not a place to quietly re-teach the model.
const ALIASES: Record<string, Significance> = {
  vacation: "trip",
  travel: "trip",
  wedding: "celebration",
  party: "celebration",
  birthday: "celebration",
  graduation: "milestone",
  anniversary: "milestone",
  visit: "gathering",
  dinner: "gathering",
  appointment: "routine",
  work: "routine",
  logistics: "routine",
}

/**
 * Coerces whatever the model said into a value the CHECK constraint will accept.
 *
 * Feeding model output straight into a CHECK is a write failure waiting to happen — one unexpected
 * word and the whole batch upsert fails. Anything unrecognized becomes 'routine', which is the
 * SAFE default precisely because nothing is hidden: a wrong 'routine' costs a missed boost, while a
 * wrong non-routine pollutes the one list whose entire value is its precision. Unrecognized values
 * are logged rather than swallowed, so drift shows up instead of quietly degrading the list.
 */
export function normalizeSignificance(value: unknown): Significance {
  if (typeof value !== "string") return "routine"
  const key = value.trim().toLowerCase()
  if ((SIGNIFICANCE_KINDS as readonly string[]).includes(key)) return key as Significance
  if (ALIASES[key]) return ALIASES[key]
  if (key) console.error("Unrecognized significance from model, defaulting to routine:", value)
  return "routine"
}
