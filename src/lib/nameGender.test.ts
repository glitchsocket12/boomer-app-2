import { describe, expect, it } from 'vitest'
import { guessGenderFromName } from './nameGender'

describe('guessGenderFromName', () => {
  // The founder's own example, and the reason this file exists.
  it('reads the obvious ones without asking', () => {
    expect(guessGenderFromName('Mark')).toBe('male')
    expect(guessGenderFromName('Susan')).toBe('female')
    expect(guessGenderFromName('Jake')).toBeNull() // not on the list — asked about, not guessed at
    expect(guessGenderFromName('Margaret')).toBe('female')
    expect(guessGenderFromName('Herman')).toBe('male')
  })

  it('takes only the first word, so a full name works the same', () => {
    expect(guessGenderFromName('Mark Berzins')).toBe('male')
    expect(guessGenderFromName('  linda   whitfield ')).toBe('female')
  })

  it('ignores case, accents and stray punctuation', () => {
    expect(guessGenderFromName('MARK')).toBe('male')
    expect(guessGenderFromName('José')).toBe('male')
    expect(guessGenderFromName('"Doug"')).toBe('male')
  })

  it('falls back to the leading half of a hyphenated name', () => {
    expect(guessGenderFromName('Mary-Jane')).toBe('female')
    expect(guessGenderFromName('Jean-Pierre')).toBeNull() // "jean" reads female, so refuse rather than guess wrong
  })

  // The whole point of the AMBIGUOUS set: these look decidable and aren't, so they must fall
  // through to the question instead of being answered by a coin flip.
  it('refuses to guess at genuinely unisex names', () => {
    for (const name of ['Jordan', 'Casey', 'Taylor', 'Alex', 'Sam', 'Riley', 'Morgan', 'Robin', 'Pat', 'Terry']) {
      expect(guessGenderFromName(name), name).toBeNull()
    }
  })

  it('returns null for anything it has no business answering', () => {
    expect(guessGenderFromName('')).toBeNull()
    expect(guessGenderFromName(null)).toBeNull()
    expect(guessGenderFromName(undefined)).toBeNull()
    expect(guessGenderFromName('Zzyzx')).toBeNull()
    expect(guessGenderFromName('J.')).toBeNull() // a bare initial is not a name
  })

  // A name in both confident lists would make the answer depend on lookup order, which is exactly
  // the kind of silent coin flip the AMBIGUOUS set exists to prevent.
  it('never lets one name resolve two ways', () => {
    const samples = ['mark', 'susan', 'jordan', 'casey', 'jean', 'francis', 'jesse', 'ashley', 'shawn', 'logan']
    for (const name of samples) {
      const a = guessGenderFromName(name)
      const b = guessGenderFromName(name.toUpperCase())
      expect(a, name).toBe(b)
    }
  })
})
