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

/**
 * True when OpenAI rejected the recording itself rather than how the roster was attached.
 *
 * Worth telling apart from every other 400, for two reasons. `transcribe`'s keyword ladder retries
 * in a different encoding on any 4xx — which cannot possibly help when the complaint is about the
 * audio, so it re-uploads the same unreadable file for nothing. And the user can then be told what
 * actually happened instead of the catch-all "couldn't turn that into text".
 *
 * Narrow on purpose: the multipart-form rejection that the ladder DOES fix is also a 400, and
 * treating that one as an audio problem would put the feature back in the state it was in before
 * the ladder existed.
 */
export function isUnreadableAudio(errorBody: string): boolean {
  return /"param"\s*:\s*"file"/.test(errorBody) || errorBody.includes("Audio file might be corrupted")
}
