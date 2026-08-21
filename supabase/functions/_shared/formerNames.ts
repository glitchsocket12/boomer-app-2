// Former surnames — a maiden name, or any other last name someone used to go by.
//
// Stored in `people.former_last_names` as one comma-separated string, additive, exactly like
// `people.nicknames` (the merge/parse helpers below are that file's, unchanged — this is the same
// shape of list, so there is one implementation of it).
//
// What is NOT the same: every other alias the app records — nicknames, middle_name, goes_by_other
// — is folded into the GIVEN-name side of name matching, and personNameKeys() in nameMatch.ts
// spells out why ("count as given names but never as surnames"). A former name is a SURNAME alias
// and goes to the other side. Filing one in `nicknames` records "Jenkins" as a first name, which
// leaves Sarah Jenkins still failing to match Sarah Mitchell — the exact bug this exists to fix.
//
// MIRROR: src/lib/formerNames.ts holds a byte-for-byte copy of formerFullNames (the browser can't
// import from supabase/functions/, and Deno can't import from src/). formerNames.test.ts runs both
// over the same cases and fails on drift.

import { mergeNicknames, parseNicknames } from "./nicknames.ts"

/** Splits the raw comma-separated column into a list. */
export const parseFormerLastNames = parseNicknames

/** Additive merge, deduped case-insensitively; null when nothing new was stated. Same contract as
 *  mergeNicknames, including the warning that `existing` must be the RAW column and never a
 *  lookup list that has had other name fields folded into it. */
export const mergeFormerLastNames = mergeNicknames

/**
 * The names this person used to be known by, in full: "Sarah" + ["Jenkins"] -> ["Sarah Jenkins"].
 *
 * Only the surname changes in a name change, so the column stores surnames alone — but almost
 * every consumer needs the whole old name: a search for "Sarah Jenkins" has to hit, and the
 * name->id index has to claim "sarah jenkins" rather than a bare "jenkins" that any relative
 * would collide with.
 *
 * `name` is normally just the first name, but rows predating the first/last split hold a whole
 * name, so the first token is taken rather than the column whole.
 */
export function formerFullNames(name: string, formerLastNames: string[]): string[] {
  const first = (name ?? "").trim().split(/\s+/)[0] ?? ""
  if (!first) return []
  return formerLastNames
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => `${first} ${s}`)
}

/** The prompt clause telling the model when to fill `former_name_updates`. Identical wording in
 *  every function that captures one, so a fix lands in all of them at once — the item-76 bug class
 *  where a rule corrected in one chat prompt stays broken in the other. */
export const FORMER_NAME_PROMPT_CLAUSE =
  `- If the user says someone's last name USED TO BE something else — a maiden name, or a name changed by marriage, divorce, remarriage or adoption ("she was a Jenkins before she married", "Sarah Mitchell, née Jenkins", "Karen goes by her own name again now, Okafor") — capture the OLD SURNAME ONLY in "former_name_updates": just "Jenkins", never the whole old name and never their first name. This is NOT a nickname: it records the old name as a last name, which is what stops the same person being added twice under it. Only include a former surname that is newly stated, not one already shown in the roster provided in this prompt.`

/** How the roster renders a former name, explained to the model. Sits beside the clause that
 *  explains "(also goes by: …)". */
export const FORMER_NAME_ROSTER_CLAUSE =
  `Someone shown as "Sarah Mitchell (formerly Jenkins)" is ONE person whose last name changed — not two people, and not a nickname. Recognise them when the user calls them by the old name, but ALWAYS use their CURRENT name in your reply: copying it exactly as the roster spells it is what makes the name a clickable link.`

/** The JSON field, spliced into each function's response-shape line. */
export const FORMER_NAME_JSON_FIELD = `"former_name_updates": [{"person": "Name1", "former_last_names": ["Jenkins"]}]`

/** The roster parenthetical: "formerly Jenkins", or null when nothing is recorded. Only the
 *  surname, because the roster line already carries the current full name beside it. */
export function formerNameMarker(formerLastNames: string[]): string | null {
  const names = formerLastNames.map((s) => s.trim()).filter(Boolean)
  return names.length > 0 ? `formerly ${names.join(", ")}` : null
}

/**
 * Claims "{first} {formerLast}" for every person's former names in a name->id index that has
 * ALREADY been filled with everyone's current names and aliases. Call it after that loop and
 * before the `ambiguousKeys` sweep.
 *
 * A second pass, and deliberately subordinate to the first: a key some CURRENT name already
 * answers to is left alone. Otherwise a real Sarah Jenkins on file would lose her own lookup the
 * moment an unrelated Sarah recorded "Jenkins" as a former name — the old name would collide with
 * hers, the shared ambiguity guard would delete the key, and then neither of them would resolve.
 *
 * Two people sharing the same FORMER name still collide with each other, which is correct: the app
 * can't tell which was meant, the key drops out, and the model asks instead of guessing.
 */
export function claimFormerNameKeys(
  people: { id: string; name: string; former_last_names?: string | null }[],
  idByName: Record<string, string>,
  claimKey: (key: string, id: string) => void
) {
  const currentNameKeys = new Set(Object.keys(idByName))
  for (const p of people) {
    for (const former of formerFullNames(p.name, parseFormerLastNames(p.former_last_names))) {
      const key = former.toLowerCase()
      if (currentNameKeys.has(key)) continue
      claimKey(key, p.id)
    }
  }
}
