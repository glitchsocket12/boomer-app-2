// Guards against a transcriber returning its own context instead of anything the user said.
//
// This exists because the failure it catches has already shipped once, in a slightly different
// costume. Before 2026-08-08 the mic sent audio to whisper-1, which returns " " for silence; the
// check was `!data?.text`, which " " passes; so a recording of nothing counted as a success and
// inserted nothing, and the user got a mic that appeared to work and silently ate what they said.
//
// The streaming rewrite (2026-08-18) feeds the model the account's roster as spelling hints, which
// reintroduces the same shape by another route: these models are documented to echo their
// prompt/keyword context back on silent or near-empty audio. A transcript that is just a list of
// the user's relatives' names is not a transcript — but it is a non-empty string, so every
// truthiness check in the world says it succeeded. Hence a real check, in a file that can be tested.

/**
 * True when `text` looks like the keyword list handed back rather than speech.
 *
 * The 3-word floor is deliberate: a genuine short answer ("Sherry", "Aunt Sherry") is made entirely
 * of roster words too, and rejecting those would break a real if uncommon use. Any actual sentence
 * contains at least one word that is nobody's name, so the floor costs almost nothing while a
 * dumped roster — which is long, and by definition all names — is caught every time.
 */
export function looksLikeKeywordEcho(text: string, keywords: string[]): boolean {
  const words = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s']/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
  if (words.length < 3) return false
  const nameWords = new Set(keywords.flatMap((k) => k.toLowerCase().split(/\s+/)))
  return words.every((w) => nameWords.has(w))
}
