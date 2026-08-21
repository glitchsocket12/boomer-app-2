import { describe, expect, it } from 'vitest'
import { formerFullNames, formerNameLine, parseFormerLastNames } from './formerNames'
import { formerFullNames as edgeFormerFullNames } from '../../supabase/functions/_shared/formerNames.ts'

// Guards the hand-maintained mirror, the same way nameMatch.test.ts and familyRoster.test.ts do:
// formerFullNames lives in both src/lib/ and supabase/functions/_shared/ because neither side can
// import from the other. Every case runs through both copies.

function fullNames(name: string, former: string[]) {
  const app = formerFullNames(name, former)
  const edge = edgeFormerFullNames(name, former)
  expect(edge, `mirror drift for "${name}" + [${former.join(', ')}]`).toEqual(app)
  return app
}

describe('formerFullNames', () => {
  it('composes the whole former name, not just the surname', () => {
    expect(fullNames('Sarah', ['Jenkins'])).toEqual(['Sarah Jenkins'])
  })

  it('handles a remarriage, oldest first as recorded', () => {
    expect(fullNames('Sarah', ['Jenkins', 'Okafor'])).toEqual(['Sarah Jenkins', 'Sarah Okafor'])
  })

  it('reads a whole name stored in the name column', () => {
    // Rows predating the first/last split hold "Sarah Mitchell" in `name`; the former name is
    // still "Sarah Jenkins", never "Sarah Mitchell Jenkins".
    expect(fullNames('Sarah Mitchell', ['Jenkins'])).toEqual(['Sarah Jenkins'])
  })

  it('returns nothing when either side is empty', () => {
    expect(fullNames('Sarah', [])).toEqual([])
    expect(fullNames('', ['Jenkins'])).toEqual([])
    expect(fullNames('   ', ['Jenkins'])).toEqual([])
  })

  it('drops blanks left by a trailing comma in the column', () => {
    expect(fullNames('Sarah', ['Jenkins', '', '  '])).toEqual(['Sarah Jenkins'])
  })
})

describe('parseFormerLastNames', () => {
  it('splits, trims and drops empties', () => {
    expect(parseFormerLastNames('Jenkins, Okafor')).toEqual(['Jenkins', 'Okafor'])
    expect(parseFormerLastNames('  Jenkins ,, ')).toEqual(['Jenkins'])
    expect(parseFormerLastNames(null)).toEqual([])
    expect(parseFormerLastNames('')).toEqual([])
  })
})

describe('formerNameLine', () => {
  it('phrases the profile line', () => {
    expect(formerNameLine('Sarah', 'Jenkins')).toBe('Formerly Sarah Jenkins.')
    expect(formerNameLine('Sarah', 'Jenkins, Okafor')).toBe('Formerly Sarah Jenkins, Sarah Okafor.')
  })

  it('is empty when nothing is recorded, so the profile renders nothing', () => {
    expect(formerNameLine('Sarah', null)).toBe('')
    expect(formerNameLine('Sarah', '  ')).toBe('')
  })
})
