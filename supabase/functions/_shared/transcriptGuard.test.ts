import { describe, expect, it } from 'vitest'
import { isUnreadableAudio, looksLikeKeywordEcho } from './transcriptGuard.ts'

const ROSTER = ['Sherry', 'Manuel', 'Sarah Chen', 'Volin', 'Nana']

describe('looksLikeKeywordEcho', () => {
  it('catches the failure it exists for: the roster handed back as a transcript', () => {
    expect(looksLikeKeywordEcho('Sherry, Manuel, Sarah Chen, Volin, Nana', ROSTER)).toBe(true)
  })

  it('catches it regardless of the punctuation or casing the model dresses it in', () => {
    expect(looksLikeKeywordEcho('sherry manuel nana.', ROSTER)).toBe(true)
    expect(looksLikeKeywordEcho('Sherry. Manuel. Nana!', ROSTER)).toBe(true)
  })

  it('lets a real sentence through even when it is mostly names', () => {
    // The load-bearing case. Every word here is a roster name except "and" and "called" — which is
    // exactly the property the check leans on, so it deserves to be pinned down.
    expect(looksLikeKeywordEcho('Sherry and Manuel called Nana', ROSTER)).toBe(false)
  })

  it('lets short genuine answers through rather than eating them', () => {
    // A one- or two-word note is entirely roster words and indistinguishable from a tiny echo, so
    // the 3-word floor deliberately errs toward keeping what the user said.
    expect(looksLikeKeywordEcho('Sherry', ROSTER)).toBe(false)
    expect(looksLikeKeywordEcho('Nana Volin', ROSTER)).toBe(false)
  })

  it('treats ordinary speech as speech', () => {
    expect(looksLikeKeywordEcho('We went to the lake house on Saturday', ROSTER)).toBe(false)
  })

  it('never fires when there was no roster to echo in the first place', () => {
    expect(looksLikeKeywordEcho('Sherry Manuel Nana', [])).toBe(false)
  })

  it('splits multi-word roster entries, so a surname alone still counts as a name', () => {
    expect(looksLikeKeywordEcho('Sarah Chen Sherry', ROSTER)).toBe(true)
  })

  it('reports empty and whitespace-only text as not-an-echo, leaving that to the emptiness check', () => {
    // Separation of concerns: the caller already rejects empty transcripts, and having two
    // different checks both claim this case is how the 2026-08-08 bug hid for as long as it did.
    expect(looksLikeKeywordEcho('', ROSTER)).toBe(false)
    expect(looksLikeKeywordEcho('   ', ROSTER)).toBe(false)
  })
})

describe('isUnreadableAudio', () => {
  // Verbatim from the founder's iPhone on 2026-08-23, the report this guard was written for.
  const CORRUPT_FILE = `{
  "error": {
    "message": "Audio file might be corrupted or unsupported",
    "type": "invalid_request_error",
    "param": "file",
    "code": "invalid_value"
  }
}`

  it('recognises the rejection a recording with no audio in it produces', () => {
    expect(isUnreadableAudio(CORRUPT_FILE)).toBe(true)
  })

  it('leaves the multipart rejection to the keyword ladder', () => {
    // The whole point of the ladder. Calling this one an audio problem would stop the retry that
    // fixes it and take name-steering — and with it the feature — down, exactly as in 2026-08-18.
    expect(
      isUnreadableAudio('{"error":{"message":"Could not parse multipart form","type":"invalid_request_error","param":null,"code":null}}')
    ).toBe(false)
  })

  it('is not fooled by a rate limit or an empty body', () => {
    expect(isUnreadableAudio('{"error":{"message":"Rate limit reached","code":"rate_limit_exceeded"}}')).toBe(false)
    expect(isUnreadableAudio('')).toBe(false)
  })

  it('reads the param regardless of how OpenAI spaces its JSON', () => {
    expect(isUnreadableAudio('{"error":{"param":"file"}}')).toBe(true)
    expect(isUnreadableAudio('{"error":{"param" : "file"}}')).toBe(true)
  })
})
