import { describe, expect, it } from 'vitest'
import { howYouKnowMarker, parseNewPersonEntry } from './howYouKnow.ts'

describe('howYouKnowMarker', () => {
  it('labels the line so the model knows it is context, not a name', () => {
    expect(howYouKnowMarker("Manuel's friend")).toBe("how you know them: Manuel's friend")
  })

  it('emits nothing for a person who has no line on file', () => {
    expect(howYouKnowMarker(null)).toBeNull()
    expect(howYouKnowMarker(undefined)).toBeNull()
    expect(howYouKnowMarker('')).toBeNull()
  })

  // A whitespace-only column would otherwise render "(how you know them: )" on every roster line
  // it touched — wasted tokens telling the model nothing.
  it('treats a whitespace-only value as absent', () => {
    expect(howYouKnowMarker('   ')).toBeNull()
  })

  it('trims, so the roster never carries the stray spacing a text input allows', () => {
    expect(howYouKnowMarker('  barista at Rosetta  ')).toBe('how you know them: barista at Rosetta')
  })
})

describe('parseNewPersonEntry', () => {
  // The shape every existing prompt still emits for a name nobody else on file shares.
  it('accepts a bare string, with no distinguisher', () => {
    expect(parseNewPersonEntry('Dave Kwon')).toEqual({ name: 'Dave Kwon', howYouKnowThem: null })
  })

  it('accepts the object shape and keeps the distinguisher', () => {
    expect(parseNewPersonEntry({ name: 'Sarah', how_you_know_them: "Manuel's friend" })).toEqual({
      name: 'Sarah',
      howYouKnowThem: "Manuel's friend",
    })
  })

  it('trims the distinguisher and treats a blank one as absent, so the collision guard still bites', () => {
    expect(parseNewPersonEntry({ name: 'Sarah', how_you_know_them: '   ' })).toEqual({
      name: 'Sarah',
      howYouKnowThem: null,
    })
    expect(parseNewPersonEntry({ name: 'Sarah', how_you_know_them: '  a friend of Manuel  ' })).toEqual({
      name: 'Sarah',
      howYouKnowThem: 'a friend of Manuel',
    })
  })

  // Model JSON is never clean (§12). A malformed entry has to be skippable, not insertable — the
  // failure mode being guarded against is a real people row named "undefined".
  it('returns null for anything with no usable name', () => {
    expect(parseNewPersonEntry('')).toBeNull()
    expect(parseNewPersonEntry('   ')).toBeNull()
    expect(parseNewPersonEntry({} as never)).toBeNull()
    expect(parseNewPersonEntry({ how_you_know_them: "Manuel's friend" } as never)).toBeNull()
    expect(parseNewPersonEntry({ name: 42 } as never)).toBeNull()
    expect(parseNewPersonEntry(null as never)).toBeNull()
  })
})
