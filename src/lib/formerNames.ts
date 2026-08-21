// Former surnames — a maiden name, or any other last name someone used to go by. Browser twin of
// supabase/functions/_shared/formerNames.ts; see that file for why a former name is a SURNAME
// alias and must never be folded in with nicknames/middle name/goes-by.
//
// MIRROR: formerFullNames below is a byte-for-byte copy of the Edge Function's, kept in sync by
// formerNames.test.ts.

/** Splits the raw comma-separated `people.former_last_names` column into a list. */
export function parseFormerLastNames(column: string | null | undefined): string[] {
  return (column ?? '')
    .split(',')
    .map((n) => n.trim())
    .filter(Boolean)
}

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
  const first = (name ?? '').trim().split(/\s+/)[0] ?? ''
  if (!first) return []
  return formerLastNames
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => `${first} ${s}`)
}

/** "Formerly Sarah Jenkins." — the muted line under the name on a profile, or '' when there is
 *  nothing recorded. Kept here so the profile and the search corpus phrase it the same way. */
export function formerNameLine(name: string, column: string | null | undefined): string {
  const names = formerFullNames(name, parseFormerLastNames(column))
  return names.length > 0 ? `Formerly ${names.join(', ')}.` : ''
}
