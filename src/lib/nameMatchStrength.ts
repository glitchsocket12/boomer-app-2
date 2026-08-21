// How strongly an imported contact's name matches a person already on file. No AI call — just
// surnames.
//
// This replaces a word-overlap score that divided by the SHORTER of the two names, which meant
// "Alex Lesar" vs. "Alex Smith" scored 0.5 (a match) and "Alex Lesar" vs. a bare "Alex" on file
// scored 1.0 (high confidence). Every Alex in an address book got proposed as every other Alex.
// The rule now: if both sides have a surname and the surnames disagree, it is not the same person.
//
// MIRROR: supabase/functions/_shared/nameMatch.ts holds a byte-for-byte copy of the three
// functions below (the Edge Function can't import from src/). nameMatch.test.ts runs both over the
// same cases and fails the suite if they ever drift apart.

/** Titles and suffixes are noise on both sides of the comparison, never a given name or surname. */
const HONORIFICS = new Set(['mr', 'mrs', 'ms', 'miss', 'mx', 'dr', 'prof', 'professor', 'rev', 'sir', 'dame'])
const SUFFIXES = new Set(['jr', 'jnr', 'sr', 'snr', 'ii', 'iii', 'iv', 'md', 'phd', 'dds', 'dvm', 'esq', 'jd', 'rn', 'cpa'])

/** The name keys for one person on file: what they might be called, and their surname(s). */
export type PersonNameKeys = { givens: Set<string>; surnames: Set<string> }

function nameTokens(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((t) => t && !HONORIFICS.has(t) && !SUFFIXES.has(t))
}

// Single letters are dropped from surnames on purpose: a middle initial is not a surname, and
// keeping them would make "Alex J Smith" and "Alex J Lesar" agree on "j".
function surnameSet(tokens: string[]): Set<string> {
  return new Set(tokens.filter((t) => t.length > 1))
}

/**
 * Builds the comparison keys for someone already on file. `aliases` is anything else they answer
 * to — nicknames, middle name, goes-by — which count as given names but never as surnames, so a
 * nickname can't quietly overrule a surname that disagrees.
 *
 * `formerLastNames` is the one alias that works the other way round: a maiden or other former
 * surname joins `surnames`, never `givens`. That asymmetry is the entire reason it needs its own
 * column rather than riding along in `nicknames` — see 2026-08-21-former-last-names.sql.
 */
export function personNameKeys(
  name: string,
  lastName: string | null,
  aliases: string[] = [],
  formerLastNames: string[] = []
): PersonNameKeys {
  const tokens = nameTokens(name)
  const givens = new Set<string>()
  if (tokens[0]) givens.add(tokens[0])
  for (const alias of aliases) {
    const aliasTokens = nameTokens(alias)
    if (aliasTokens[0]) givens.add(aliasTokens[0])
  }
  // people.name is normally the first name with the surname in last_name, but rows predating that
  // split hold a whole name — so fall back to "everything after the first word" when last_name is
  // empty rather than treating those people as having no surname at all.
  const surnames = lastName ? surnameSet(nameTokens(lastName)) : surnameSet(tokens.slice(1))
  // Both names count from here on, so an imported "Sarah Jenkins" reaches Sarah Mitchell through
  // surnameRelation's ordinary 'match' branch instead of being thrown out as a 'conflict'.
  for (const former of formerLastNames) {
    for (const token of surnameSet(nameTokens(former))) surnames.add(token)
  }
  return { givens, surnames }
}

function givenRelation(given: string | null, givens: Set<string>): 'match' | 'initial' | 'none' {
  if (!given || givens.size === 0) return 'none'
  if (givens.has(given)) return 'match'
  // "A. Lesar" in a vCard vs. "Alex Lesar" on file, either direction.
  for (const g of givens) {
    if ((given.length === 1 && g.startsWith(given)) || (g.length === 1 && given.startsWith(g))) return 'initial'
  }
  return 'none'
}

// True when one insertion, deletion, or substitution turns `a` into `b`. Only ever called on a
// pair whose given names already agree, so it never runs at import-wide scale.
function withinOneEdit(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false
  let i = 0
  let j = 0
  let edits = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++
      j++
      continue
    }
    if (++edits > 1) return false
    if (a.length > b.length) i++
    else if (a.length < b.length) j++
    else {
      i++
      j++
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1
}

// 'near' is a one-character difference on a long surname — "Baerman" against "Baermann", i.e. a
// typo in one of the two records rather than a different family. Worth asking about, never worth
// asserting, so it's kept distinct from an exact 'match'.
function surnameRelation(a: Set<string>, b: Set<string>): 'match' | 'near' | 'conflict' | 'unknown' {
  // Neither side has a surname at all, so the names are simply equal — nothing is left unknown.
  if (a.size === 0 && b.size === 0) return 'match'
  if (a.size === 0 || b.size === 0) return 'unknown'
  let near = false
  for (const s of a) {
    if (b.has(s)) return 'match'
    for (const t of b) if (s.length >= 5 && t.length >= 5 && withinOneEdit(s, t)) near = true
  }
  return near ? 'near' : 'conflict'
}

/** True when both names carry a surname and they share one — used to let an exact email/phone hit
 *  rescue a given-name mismatch ("Bob Smith" imported, "Robert Smith" on file, same address). */
export function sharesSurname(contactFullName: string, keys: PersonNameKeys): boolean {
  const relation = surnameRelation(surnameSet(nameTokens(contactFullName).slice(1)), keys.surnames)
  return relation === 'match' || relation === 'near'
}

/**
 * `strong` — same given name and same surname; safe to propose confidently.
 * `weak`   — plausible but unproven: matching given name where one side has no surname on file, or
 *            a matching initial against a matching surname. Worth asking about, not asserting.
 * `none`   — surnames disagree, or the given names have nothing in common.
 */
export function nameMatchStrength(contactFullName: string, keys: PersonNameKeys): 'strong' | 'weak' | 'none' {
  const tokens = nameTokens(contactFullName)
  const given = tokens[0] ?? null
  const relation = givenRelation(given, keys.givens)
  if (relation === 'none') return 'none'
  const surnames = surnameRelation(surnameSet(tokens.slice(1)), keys.surnames)
  if (surnames === 'conflict') return 'none'
  if (surnames === 'match') return relation === 'match' ? 'strong' : 'weak'
  // Surname near-miss or unknown on one side: a shared first name is worth a question, but a
  // shared initial on top of an inexact surname is two guesses stacked, so it doesn't count.
  return relation === 'match' ? 'weak' : 'none'
}
