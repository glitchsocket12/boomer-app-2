import { describe, expect, it } from 'vitest'
import { guessGenderFromName } from './nameGender'

describe('guessGenderFromName', () => {
  // The founder's own example, and the reason this file exists.
  it('reads the obvious ones without asking', () => {
    expect(guessGenderFromName('Mark')).toBe('male')
    expect(guessGenderFromName('Susan')).toBe('female')
    expect(guessGenderFromName('Jake')).toBe('male')
    expect(guessGenderFromName('Margaret')).toBe('female')
    expect(guessGenderFromName('Herman')).toBe('male')
  })

  // The four the founder named on 2026-08-19 ("it isn't even appropriately guessing if Ben or
  // Braden is a male name, or Bridget or Joelle are female"), which is what moved this off a
  // hand-typed list and onto the SSA birth counts. Bridget was already answered; the other three
  // had simply never been typed in.
  it('answers the names that were missing from the hand-written list', () => {
    expect(guessGenderFromName('Ben')).toBe('male')
    expect(guessGenderFromName('Braden')).toBe('male')
    expect(guessGenderFromName('Bridget')).toBe('female')
    expect(guessGenderFromName('Joelle')).toBe('female')
  })

  // Breadth is the actual point of the change, so it gets asserted rather than assumed: names from
  // outside the Anglo-American mainstream, and modern ones the old list stopped short of.
  it('covers names a hand-written list would never reach', () => {
    for (const name of ['Giuseppe', 'Dmitri', 'Rahul', 'Yosef', 'Kwame', 'Bjorn', 'Xavier', 'Braxton']) {
      expect(guessGenderFromName(name), name).toBe('male')
    }
    for (const name of ['Siobhan', 'Svetlana', 'Priya', 'Ingrid', 'Fatima', 'Aoife', 'Kaitlyn', 'Nevaeh']) {
      expect(guessGenderFromName(name), name).toBe('female')
    }
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

  // These look decidable and aren't, so they must fall through to the question instead of being
  // answered by a coin flip. Most are refused by the birth counts themselves; Alex and Sam are
  // refused by the hand-written override, because a birth certificate can't see that the Alexandra
  // and the Samantha both go by the short form.
  it('refuses to guess at genuinely unisex names', () => {
    for (const name of ['Jordan', 'Casey', 'Taylor', 'Alex', 'Sam', 'Riley', 'Morgan', 'Robin', 'Pat', 'Terry']) {
      expect(guessGenderFromName(name), name).toBeNull()
    }
  })

  // The override has to beat the data in both directions, or it isn't an override.
  it('lets the hand-written overrides beat the counts', () => {
    expect(guessGenderFromName('Jess')).toBeNull() // 98% male at birth, almost always a Jessica
    expect(guessGenderFromName('Micah')).toBe('male') // 89.4%, six tenths under the cut
    expect(guessGenderFromName('Willie')).toBe('male')
    expect(guessGenderFromName('Carmen')).toBe('female')
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
