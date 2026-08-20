// Edge-function mirror of src/lib/nameGender.ts. Deno can't import across the Vite boundary, so this
// is a hand-maintained copy in the same pattern as kinship.ts, relationshipsTable.ts and
// familyRoster.ts. nameGender.test.ts compares the three name sets and every lookup result across
// BOTH copies, so drift fails the suite rather than quietly letting the AI call someone's brother
// their sister.
//
// WHY THE MODEL NEEDS THIS AT ALL (founder, 2026-08-16: the app "still is asking 'is this his
// mother?' when her name is clearly a woman's name"). The browser already fills gender gaps from
// first names when it builds the family graph, which is why the family TREE says "husband" and
// "stepmother" — but nothing gendered ever reached the Edge Functions. Every family fact the model
// was handed came through genderless: "parents: A, B", "siblings: C, D", "A + B — children: …". So
// the model could not say "his mother" even about a Margaret, and asked instead. Same guess, same
// never-written-to-the-database rule, now on both sides of the boundary.
//
// The name lists themselves are US Social Security Administration birth counts (2026-08-19) and live
// in nameGender.generated.ts, which is written to both sides by scripts/build-name-gender.mjs. See
// the browser copy for the 90% threshold and why the short-form overrides below beat the data.

import { FEMALE_NAMES, MALE_NAMES } from "./nameGender.generated.ts"

export type GenderGuess = "male" | "female" | null

// Checked FIRST, and it beats the data: lopsided on a birth certificate, unisex in real life,
// because the short form is shared. Alex is Alexander AND Alexandra; Jess is 98% male at birth and
// almost always a Jessica by adulthood.
const AMBIGUOUS = new Set(["alex", "jess", "nat", "sam"])

// Names the counts leave just short of the 90% line that this app answered before the switch to real
// data and has no reason to stop answering.
const ALSO_MALE = ["donnie", "freddie", "joey", "micah", "rory", "toby", "willie"]
const ALSO_FEMALE = ["carmen", "laverne", "stacy"]

function buildSet(names: string, extra: string[]): Set<string> {
  const set = new Set(names.split(","))
  for (const name of extra) set.add(name)
  for (const name of AMBIGUOUS) set.delete(name)
  return set
}

const MALE = buildSet(MALE_NAMES, ALSO_MALE)
const FEMALE = buildSet(FEMALE_NAMES, ALSO_FEMALE)

// Nothing else should read them — callers want the guess, not the lists behind it.
export const _SETS = { MALE, FEMALE, AMBIGUOUS }

function normalize(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[^a-zA-Z'-]/g, "")
    .toLowerCase()
}

/**
 * A confident guess at someone's gender from their first name, or null when the app should ask
 * instead. Pure and synchronous — safe to call per person while building a roster.
 */
export function guessGenderFromName(name: string | null | undefined): GenderGuess {
  if (!name) return null
  const [firstWord] = name.trim().split(/\s+/)
  if (!firstWord) return null

  const whole = normalize(firstWord)
  if (whole.length < 2) return null
  if (AMBIGUOUS.has(whole)) return null
  if (MALE.has(whole)) return "male"
  if (FEMALE.has(whole)) return "female"

  const parts = whole.split("-").filter((p) => p.length >= 2)
  if (parts.length < 2) return null
  const found = new Set<GenderGuess>()
  for (const part of parts) {
    if (AMBIGUOUS.has(part)) return null
    if (MALE.has(part)) found.add("male")
    else if (FEMALE.has(part)) found.add("female")
  }
  return found.size === 1 ? [...found][0] : null
}

/**
 * The gender to USE for someone: what's actually recorded, else what the first name suggests, else
 * null. Recorded always wins — including a recorded 'non-binary' or 'other', which must never be
 * overridden by whatever a first name reads like. Same precedence as the browser's loadFamilyGraph.
 */
export function effectiveGender(recorded: string | null | undefined, name: string | null | undefined): string | null {
  if (recorded) return recorded
  return guessGenderFromName(name)
}
