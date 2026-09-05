import { describe, expect, it } from 'vitest'
import { resolveAncestorIds, resolveInheritedGroupIds } from './inheritedGroups'

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

describe('resolveInheritedGroupIds', () => {
  const direct = new Map<string, Set<string>>([
    ['trip', new Set(['airforce'])],
    ['wedding', new Set(['family'])],
    ['reception', new Set(['friends'])],
  ])

  it('hands a day its trip’s groups — the card the founder kept being shown', () => {
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

  it('is empty when the trip carries no group of its own', () => {
    expect([...resolveInheritedGroupIds('day3', parentById, new Map())]).toEqual([])
  })

  it('never reaches up: a tagged day does not put its trip in that group', () => {
    const dayTagged = new Map<string, Set<string>>([['day3', new Set(['airforce'])]])
    expect([...resolveInheritedGroupIds('trip', parentById, dayTagged)]).toEqual([])
  })

  // The Portugal case (founder, 2026-09-05): only the inherited group is filtered, so a pick for
  // a DIFFERENT group on the same day survives.
  it('leaves a group the trip does not carry alone', () => {
    const inherited = resolveInheritedGroupIds('day3', parentById, direct)
    expect(inherited.has('airforce')).toBe(true)
    expect(inherited.has('jake-and-caroline')).toBe(false)
  })
})
