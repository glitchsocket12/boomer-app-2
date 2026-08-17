import { describe, expect, it } from 'vitest'
import { guessGenderFromName as edgeGuess, effectiveGender, _SETS as edgeSets } from './nameGender.ts'
import { guessGenderFromName as appGuess, _SETS as appSets } from '../../../src/lib/nameGender'

// The point of this file: the edge-function copy of the first-name gender guess and the browser copy
// are hand-maintained mirrors, so the name lists AND every lookup below run through BOTH and must
// agree. Drift fails the suite instead of quietly letting the AI call someone's brother their sister
// while the family tree on screen says "brother". (Same arrangement as familyRoster.test.ts and
// kinship.test.ts.)
//
// It runs at all because vitest's default glob reaches outside src/ — tsconfig.app.json doesn't, so
// `npm run build` won't typecheck this file. `npm test` is the gate.

// Both copies, one call. Every assertion below goes through this, so there is no way to test one
// copy without testing the other.
function guess(name: string | null | undefined) {
  const edge = edgeGuess(name)
  const app = appGuess(name)
  expect(app, `mirrors disagree on ${JSON.stringify(name)}`).toBe(edge)
  return edge
}

describe('nameGender edge/browser mirror', () => {
  // The lists themselves, not just spot-checked lookups — a name added to one copy and forgotten in
  // the other is the exact failure this file exists to catch, and it wouldn't show up in the cases
  // below unless someone remembered to add a test for that name too.
  it('has identical name lists in both copies', () => {
    for (const key of ['MALE', 'FEMALE', 'AMBIGUOUS'] as const) {
      expect([...appSets[key]].sort(), key).toEqual([...edgeSets[key]].sort())
    }
  })

  it('agrees on every name in every list', () => {
    for (const key of ['MALE', 'FEMALE', 'AMBIGUOUS'] as const) {
      for (const name of appSets[key]) guess(name)
    }
  })

  it('guesses the obvious ones', () => {
    expect(guess('Margaret')).toBe('female')
    expect(guess('Herman')).toBe('male')
    expect(guess('Linda Whitfield')).toBe('female')
    expect(guess('José')).toBe('male')
  })

  it('refuses the ambiguous and the unknown', () => {
    expect(guess('Jordan')).toBeNull()
    expect(guess('Casey')).toBeNull()
    expect(guess('Zzyzx')).toBeNull()
    expect(guess('J.')).toBeNull()
    expect(guess('')).toBeNull()
    expect(guess(null)).toBeNull()
    expect(guess(undefined)).toBeNull()
  })

  it('needs both halves of a hyphenated name to agree', () => {
    expect(guess('Mary-Jane')).toBe('female')
    expect(guess('Jean-Pierre')).toBeNull()
  })
})

describe('effectiveGender', () => {
  // The precedence rule that keeps a guess from ever overwriting a stated fact. 'non-binary' and
  // 'other' are the cases that matter most: both are people whose first name very likely reads
  // male or female, and both must survive untouched.
  it('always prefers what was actually recorded', () => {
    expect(effectiveGender('female', 'Herman')).toBe('female')
    expect(effectiveGender('non-binary', 'Margaret')).toBe('non-binary')
    expect(effectiveGender('other', 'Herman')).toBe('other')
  })

  it('falls back to the name only when nothing is on file', () => {
    expect(effectiveGender(null, 'Margaret')).toBe('female')
    expect(effectiveGender(undefined, 'Herman')).toBe('male')
    expect(effectiveGender('', 'Herman')).toBe('male')
  })

  it('is null when neither source can say', () => {
    expect(effectiveGender(null, 'Jordan')).toBeNull()
    expect(effectiveGender(null, null)).toBeNull()
  })
})
