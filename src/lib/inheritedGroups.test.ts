import { describe, expect, it } from 'vitest'
import { hasInheritedGroup, resolveAncestorIds, resolveInheritedGroupIds } from './inheritedGroups'

// day3 -> trip, and a three-deep chain modelled on the real one (welcome -> reception -> wedding).
const parentById = new Map<string, string>([
  ['day3', 'trip'],
  ['welcome', 'reception'],
  ['reception', 'wedding'],
])

describe('resolveAncestorIds', () => {
  it('returns nothing for a root event', () => {
    expect(resolveAncestorIds('trip', parentById)).toEqual([])
  })

  it('climbs the whole chain, nearest first', () => {
    expect(resolveAncestorIds('welcome', parentById)).toEqual(['reception', 'wedding'])
  })

  it('terminates on a cycle instead of hanging', () => {
    const cyclic = new Map([
      ['a', 'b'],
      ['b', 'a'],
    ])
    expect(resolveAncestorIds('a', cyclic)).toEqual(['b'])
  })
})

describe('hasInheritedGroup', () => {
  it('is true for a day inside a tagged trip — the card the founder kept being shown', () => {
    expect(hasInheritedGroup('day3', parentById, new Set(['trip']))).toBe(true)
  })

  it('is false when the trip carries no group of its own', () => {
    expect(hasInheritedGroup('day3', parentById, new Set())).toBe(false)
  })

  it('is false for a root event, however many of its children are tagged', () => {
    expect(hasInheritedGroup('trip', parentById, new Set(['day3']))).toBe(false)
  })

  it('reaches a grandparent', () => {
    expect(hasInheritedGroup('welcome', parentById, new Set(['wedding']))).toBe(true)
  })
})

describe('resolveInheritedGroupIds', () => {
  const direct = new Map<string, Set<string>>([
    ['trip', new Set(['airforce'])],
    ['wedding', new Set(['family'])],
    ['reception', new Set(['friends'])],
  ])

  it('hands a day its trip’s groups', () => {
    expect([...resolveInheritedGroupIds('day3', parentById, direct)]).toEqual(['airforce'])
  })

  it('unions every ancestor up the chain', () => {
    expect([...resolveInheritedGroupIds('welcome', parentById, direct)].sort()).toEqual(['family', 'friends'])
  })

  it('drops a group the day already carries directly, so it is not shown twice', () => {
    const alsoTaggedByHand = new Map(direct).set('day3', new Set(['airforce']))
    expect([...resolveInheritedGroupIds('day3', parentById, alsoTaggedByHand)]).toEqual([])
  })

  it('is empty for a root event', () => {
    expect([...resolveInheritedGroupIds('trip', parentById, direct)]).toEqual([])
  })
})
