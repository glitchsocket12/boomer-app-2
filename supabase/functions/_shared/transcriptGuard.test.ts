import { describe, expect, it } from 'vitest'
import { looksLikeKeywordEcho } from './transcriptGuard.ts'

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
