// Merging nicknames onto a profile, shared by every chat function that can capture one.
//
// The `people.nicknames` column is a single comma-separated string. Every write to it must be
// ADDITIVE: a nickname mentioned in one conversation must not wipe one recorded months ago from a
// different screen. Deduped case-insensitively, because "Bob"/"bob" arriving from two different
// turns is one nickname, not two.
//
// Extracted from converse/index.ts (2026-08-11) so update-moment and update-group can capture
// nicknames too — the event and group chats only ever READ them for lookup before, so telling an
// event chat "everyone calls him Bob" used the name to find Bob and then threw it away.

/**
 * `existing` MUST be the raw `nicknames` column, split — never a lookup list that has had
 * `middle_name`/`goes_by_other` folded into it. update-moment and update-group build exactly such
 * a list for name resolution, and writing it back would copy someone's middle name into their
 * nickname field on the first unrelated nickname capture.
 *
 * Returns the merged list, or null when nothing new was stated — the caller skips the UPDATE
 * entirely in that case rather than writing a row identical to the one already there.
 */
export function mergeNicknames(existing: string[], incoming: unknown): string[] | null {
  if (!Array.isArray(incoming) || incoming.length === 0) return null
  const merged = [...existing]
  for (const candidate of incoming) {
    const trimmed = String(candidate ?? "").trim()
    if (!trimmed) continue
    if (merged.some((n) => n.toLowerCase() === trimmed.toLowerCase())) continue
    merged.push(trimmed)
  }
  return merged.length > existing.length ? merged : null
}

/** Splits the raw comma-separated column into the list `mergeNicknames` expects. */
export function parseNicknames(column: string | null | undefined): string[] {
  return (column ?? "")
    .split(",")
    .map((n) => n.trim())
    .filter(Boolean)
}

/** The prompt clause that tells the model when to fill `nickname_updates`. Identical wording in
 *  every function that captures nicknames, so a fix lands in all of them at once — the exact bug
 *  class item 76 is about (a rule fixed in one chat prompt silently staying broken in the other). */
export const NICKNAME_PROMPT_CLAUSE =
  `- If the user mentions a nickname or a name someone "goes by" (e.g. "she goes by Sammy", "everyone calls him Bob", "my friend Sam, who goes by Sammy"), that's a nickname update — capture it in "nickname_updates" so it becomes a real, searchable "goes by" name on their profile, in addition to however it naturally fits into the rest of your response. Only include nickname(s) that are newly stated, not ones already shown in the roster provided in this prompt.`

/** The JSON field, spliced into each function's response-shape line. */
export const NICKNAME_JSON_FIELD = `"nickname_updates": [{"person": "Name1", "nicknames": ["Nickname"]}]`
