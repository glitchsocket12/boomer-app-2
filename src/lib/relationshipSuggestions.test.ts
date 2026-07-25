import { describe, expect, it } from 'vitest'
import { suggestFamilyMembers } from './relationshipSuggestions'
import type { PersonRelationships } from './relationshipsTable'

function rel(overrides: Partial<PersonRelationships> = {}): PersonRelationships {
  return { spouseIds: [], partnerIds: [], siblingIds: [], parentIds: [], childIds: [], ...overrides }
}

describe('suggestFamilyMembers', () => {
  it('suggests a spouse when only one half of the couple is attending', () => {
    const map = new Map([
      ['alice', rel({ spouseIds: ['bob'] })],
      ['bob', rel({ spouseIds: ['alice'] })],
    ])
    expect(suggestFamilyMembers(['alice'], map)).toEqual(['bob'])
  })

  it('suggests an unmarried partner the same as a spouse', () => {
    const map = new Map([
      ['alice', rel({ partnerIds: ['bob'] })],
      ['bob', rel({ partnerIds: ['alice'] })],
    ])
    expect(suggestFamilyMembers(['alice'], map)).toEqual(['bob'])
  })

  it('does not suggest children until the spouse is also attending', () => {
    const map = new Map([
      ['alice', rel({ spouseIds: ['bob'], childIds: ['casey'] })],
      ['bob', rel({ spouseIds: ['alice'], childIds: ['casey'] })],
      ['casey', rel({ parentIds: ['alice', 'bob'] })],
    ])
    expect(suggestFamilyMembers(['alice'], map)).toEqual(['bob'])
  })

  it('suggests children once both parents are attending', () => {
    const map = new Map([
      ['alice', rel({ spouseIds: ['bob'], childIds: ['casey'] })],
      ['bob', rel({ spouseIds: ['alice'], childIds: ['casey'] })],
      ['casey', rel({ parentIds: ['alice', 'bob'] })],
    ])
    expect(suggestFamilyMembers(['alice', 'bob'], map)).toEqual(['casey'])
  })

  it('unions children from both sides of a blended family without duplicates', () => {
    const map = new Map([
      ['alice', rel({ spouseIds: ['bob'], childIds: ['casey'] })],
      ['bob', rel({ spouseIds: ['alice'], childIds: ['casey', 'dana'] })],
    ])
    const result = suggestFamilyMembers(['alice', 'bob'], map)
    expect(new Set(result)).toEqual(new Set(['casey', 'dana']))
    expect(result.length).toBe(2)
  })

  it('never suggests someone already attending', () => {
    const map = new Map([
      ['alice', rel({ spouseIds: ['bob'], childIds: ['casey'] })],
      ['bob', rel({ spouseIds: ['alice'], childIds: ['casey'] })],
    ])
    expect(suggestFamilyMembers(['alice', 'bob', 'casey'], map)).toEqual([])
  })

  it('respects the exclude list (e.g. previously dismissed for this event)', () => {
    const map = new Map([
      ['alice', rel({ spouseIds: ['bob'] })],
      ['bob', rel({ spouseIds: ['alice'] })],
    ])
    expect(suggestFamilyMembers(['alice'], map, ['bob'])).toEqual([])
  })

  it('returns nothing for an attendee with no recorded relationships', () => {
    const map = new Map<string, PersonRelationships>()
    expect(suggestFamilyMembers(['alice'], map)).toEqual([])
  })
})
