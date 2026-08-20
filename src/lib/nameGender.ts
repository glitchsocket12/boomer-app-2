// First-name → likely gender, so the app stops asking about the obvious ones (founder, 2026-08-05:
// "Mark is obviously a man's name"). This was in item 44's original spec and deferred then; the
// clarify prompt is what made it worth doing, because a prompt that asks about every Mark and Susan
// in a 400-person tree is worse than no prompt at all.
//
// WHERE THE NAMES COME FROM (2026-08-19). This was a hand-typed list of ~840 names until the founder
// pointed out what a hand-typed list inevitably does: "it isn't even appropriately guessing if Ben
// or Braden is a male name, or Bridget or Joelle are female." Ben, Braden and Joelle were simply
// never typed in — and the next complaint would have been four different names. The lists now come
// from the US Social Security Administration's national birth counts, 1880–2024, via
// `nameGender.generated.ts` (16,002 names; see scripts/build-name-gender.mjs for the source and the
// two cutoffs). That covers essentially every name an American family tree contains, including the
// great-grandparents' generation and the rare-in-English ones — Svetlana, Giuseppe, Siobhan, Aditya.
//
// HOW THE THRESHOLD IS EXPRESSED. The founder asked to only be asked when the app is less than ~75%
// sure. That's now a real number rather than a judgement call: a name is in a list when at least 90%
// of the Americans given it were that gender, and names between 10% and 90% are in neither, so a
// Jordan or a Casey still gets asked about. Absent from both lists and genuinely split mean the same
// thing to callers: don't assume, ask.
//
// WHAT THE OVERRIDES BELOW ARE FOR. Birth-certificate counts get one class of name wrong: short
// forms. The SSA knows what a baby was registered as, not what the adult goes by, so it has never
// heard of the Alexandra who is Alex or the Jessica who is Jess. That's the exact mistake the
// founder caught the model making in live testing (2026-08-16, Alex Gregorian), so those names stay
// on the "ask me" pile no matter what the counts say.
//
// This NEVER writes to the database. A guess wears off the moment a real gender is recorded, and a
// wrong guess is one dropdown away from being fixed — whereas a guessed value saved into someone's
// record would be indistinguishable from a fact the founder actually stated.

import { FEMALE_NAMES, MALE_NAMES } from './nameGender.generated'

export type GenderGuess = 'male' | 'female' | null

// Checked FIRST, and it beats the data. Every one of these is lopsided on paper and unisex in real
// life, because the short form is shared: Alex is Alexander AND Alexandra, Sam is Samuel AND
// Samantha, Jess is 98% male at birth and almost always a Jessica by adulthood, Nat is Nathaniel AND
// Natalie. Getting one of these wrong is exactly the failure the founder would notice, so they
// always fall through to the question. Names that are merely split in ordinary usage — Jordan,
// Casey, Taylor, Riley, Morgan, Robin, Pat, Terry — don't need to be here: the counts already refuse
// to call them, and a second hand-written copy of that judgement would only drift from it.
const AMBIGUOUS = new Set(['alex', 'jess', 'nat', 'sam'])

// The other direction: names the counts leave just short of the line that this app answered before
// the switch to real data and has no reason to stop answering. Nobody has ever met a Willie who
// wasn't a man, but 24% of the Willies on file are women (Willie Mae), and Micah misses the 90% cut
// by six tenths of a percent. Keeping these ten is what makes the change strictly more helpful than
// the hand-written list rather than a trade.
const ALSO_MALE = ['donnie', 'freddie', 'joey', 'micah', 'rory', 'toby', 'willie']
const ALSO_FEMALE = ['carmen', 'laverne', 'stacy']

function buildSet(names: string, extra: string[]): Set<string> {
  const set = new Set(names.split(','))
  for (const name of extra) set.add(name)
  for (const name of AMBIGUOUS) set.delete(name)
  return set
}

const MALE = buildSet(MALE_NAMES, ALSO_MALE)
const FEMALE = buildSet(FEMALE_NAMES, ALSO_FEMALE)

// Exported for supabase/functions/_shared/nameGender.test.ts, which asserts these are identical to
// the edge-function mirror's copies. Nothing else should read them — callers want the guess, not the
// lists behind it.
export const _SETS = { MALE, FEMALE, AMBIGUOUS }

// Accents dropped so "José" matches "jose"; anything that isn't a letter, hyphen or apostrophe is
// stripped so a stray initial ("J.") or a quoted nickname doesn't defeat the lookup.
function normalize(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[^a-zA-Z'-]/g, '')
    .toLowerCase()
}

/**
 * A confident guess at someone's gender from their first name, or null when the app should ask
 * instead. Pure and synchronous — safe to call per person while building a graph.
 *
 * Takes a full name or a bare first name; only the first word is ever consulted, since `people.name`
 * already holds the first name with the surname in its own column.
 */
export function guessGenderFromName(name: string | null | undefined): GenderGuess {
  if (!name) return null
  const [firstWord] = name.trim().split(/\s+/)
  if (!firstWord) return null

  const whole = normalize(firstWord)
  if (whole.length < 2) return null
  if (AMBIGUOUS.has(whole)) return null
  if (MALE.has(whole)) return 'male'
  if (FEMALE.has(whole)) return 'female'

  // A hyphenated compound is decided by BOTH halves, not just the leading one. Reading only the
  // first half turns Jean-Pierre into a woman — the halves have to agree, or the name goes back in
  // the "ask me" pile where it belongs.
  const parts = whole.split('-').filter((p) => p.length >= 2)
  if (parts.length < 2) return null
  const found = new Set<GenderGuess>()
  for (const part of parts) {
    if (AMBIGUOUS.has(part)) return null
    if (MALE.has(part)) found.add('male')
    else if (FEMALE.has(part)) found.add('female')
  }
  return found.size === 1 ? [...found][0] : null
}
