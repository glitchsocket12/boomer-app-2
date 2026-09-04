// The "you've typed this before" half of AddressSuggestInput's dropdown — the other half is the
// live Geoapify lookup inside the component itself. `moments.location` is free text with no id
// behind it (see lib/locationGroups.ts for what that costs), so the column IS the vocabulary of
// places this account knows about, and offering it back is what stops a fourth spelling of an
// address being typed in the first place.
//
// Pure and shared so every address field builds the identical list: EventDetail's "Edit name,
// date & location" form, ImportReview's calendar card, and ManageLocations' rewrite boxes. It was
// inlined in ImportReview until 2026-08-29; a second copy is how two dropdowns quietly start
// ranking differently.

/**
 * Distinct, trimmed, non-empty values, IN THE ORDER GIVEN. Callers pass their rows already sorted
 * most-recent-first (`event_date` descending), which is the whole point — the place you were last
 * month should be offered above the one you went to in 2011. Case-insensitive dedupe keeps the
 * FIRST spelling seen, since that's the most recent one, not the oldest.
 */
export function buildRecentLocations(values: (string | null | undefined)[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const raw of values) {
    const value = raw?.trim()
    if (!value) continue
    const key = value.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    result.push(value)
  }
  return result
}
