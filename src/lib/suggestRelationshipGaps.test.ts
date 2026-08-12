import { describe, expect, it } from 'vitest'
import type { Graph } from './familyTree'
import { deriveRelationshipGaps } from './suggestRelationshipGaps'

// Same hand-built-Graph style as relationshipCalculator.test.ts — the derivation is pure over the
// graph, so none of this needs a database.
const emptyGraph = (over: Partial<Graph> = {}): Graph => ({
  nameById: new Map(),
  selfId: null,
  parentsOf: new Map(),
  childrenOf: new Map(),
  spousesOf: new Map(),
  siblingsOf: new Map(),
  deceasedIds: new Set(),
  endedPairs: new Set(),
  ...over,
})

function withChildren(parentsOf: Map<string, string[]>): Map<string, string[]> {
  const childrenOf = new Map<string, string[]>()
  for (const [child, parents] of parentsOf) {
    for (const p of parents) childrenOf.set(p, [...(childrenOf.get(p) ?? []), child])
  }
  return childrenOf
}

function couple(a: string, b: string): Map<string, string[]> {
  return new Map([
    [a, [b]],
    [b, [a]],
  ])
}

const names = new Map([
  ['mom', 'Kate Rivera'],
  ['dad', 'Ben Rivera'],
  ['kid', 'Sophie Rivera'],
  ['kid2', 'Theo Rivera'],
  ['step', 'Dana Fox'],
])

describe('deriveRelationshipGaps — co-parent gaps', () => {
  it("suggests a spouse who isn't recorded as a parent of the other's child", () => {
    const parentsOf = new Map([['kid', ['mom']]])
    const gaps = deriveRelationshipGaps(
      emptyGraph({ nameById: names, parentsOf, childrenOf: withChildren(parentsOf), spousesOf: couple('mom', 'dad') })
    )
    expect(gaps).toEqual([
      { kind: 'family_coparent', parentId: 'dad', parentName: 'Ben Rivera', childId: 'kid', childName: 'Sophie Rivera' },
    ])
  })

  it('stays quiet when both parents are already on file', () => {
    const parentsOf = new Map([['kid', ['mom', 'dad']]])
    const gaps = deriveRelationshipGaps(
      emptyGraph({ nameById: names, parentsOf, childrenOf: withChildren(parentsOf), spousesOf: couple('mom', 'dad') })
    )
    expect(gaps).toEqual([])
  })

  it('skips a divorced union rather than proposing an ex as a parent', () => {
    const parentsOf = new Map([['kid', ['mom']]])
    const gaps = deriveRelationshipGaps(
      emptyGraph({
        nameById: names,
        parentsOf,
        childrenOf: withChildren(parentsOf),
        spousesOf: couple('mom', 'dad'),
        endedPairs: new Set(['dad|mom']),
      })
    )
    expect(gaps).toEqual([])
  })

  it('skips a union ended by a death', () => {
    const parentsOf = new Map([['kid', ['mom']]])
    const gaps = deriveRelationshipGaps(
      emptyGraph({
        nameById: names,
        parentsOf,
        childrenOf: withChildren(parentsOf),
        spousesOf: couple('mom', 'dad'),
        deceasedIds: new Set(['dad']),
      })
    )
    expect(gaps).toEqual([])
  })

  it('asks about a step-parent once per child, not once per route to them', () => {
    const parentsOf = new Map([
      ['kid', ['mom']],
      ['kid2', ['mom']],
    ])
    const gaps = deriveRelationshipGaps(
      emptyGraph({
        nameById: names,
        parentsOf,
        childrenOf: withChildren(parentsOf),
        spousesOf: couple('mom', 'step'),
      })
    )
    expect(gaps.map((g) => g.kind === 'family_coparent' && g.childId).sort()).toEqual(['kid', 'kid2'])
  })

  it("stays quiet about a step-parent once the child's own two parents are both on file", () => {
    // The blended-family shape: the kid's mother and father are both recorded, and mom is now
    // married to Dana — a third adult, so a step-parent rather than a missing parent. (The
    // couple gap for mom/dad is a separate, still-correct question, hence the filter.)
    const parentsOf = new Map([['kid', ['mom', 'dad']]])
    const gaps = deriveRelationshipGaps(
      emptyGraph({
        nameById: names,
        parentsOf,
        childrenOf: withChildren(parentsOf),
        spousesOf: couple('mom', 'step'),
      })
    )
    expect(gaps.filter((g) => g.kind === 'family_coparent')).toEqual([])
  })

  it('refuses to invert an existing edge (child already on file as the spouse’s parent)', () => {
    // Bad data rather than a gap: "kid" is both mom's child and dad's parent. Filling this in
    // would write a cycle into the family graph.
    const parentsOf = new Map([
      ['kid', ['mom']],
      ['dad', ['kid']],
    ])
    const gaps = deriveRelationshipGaps(
      emptyGraph({ nameById: names, parentsOf, childrenOf: withChildren(parentsOf), spousesOf: couple('mom', 'dad') })
    )
    expect(gaps.filter((g) => g.kind === 'family_coparent')).toEqual([])
  })
})

describe('deriveRelationshipGaps — couple gaps', () => {
  it('suggests a couple link between two parents of the same child', () => {
    const parentsOf = new Map([['kid', ['mom', 'dad']]])
    const gaps = deriveRelationshipGaps(emptyGraph({ nameById: names, parentsOf, childrenOf: withChildren(parentsOf) }))
    expect(gaps).toEqual([
      {
        kind: 'family_couple',
        aId: 'dad',
        aName: 'Ben Rivera',
        bId: 'mom',
        bName: 'Kate Rivera',
        // The id rides along so Home can say "you" when the shared child is the account owner.
        childId: 'kid',
        childName: 'Sophie Rivera',
      },
    ])
  })

  it('stays quiet when the two are already linked', () => {
    const parentsOf = new Map([['kid', ['mom', 'dad']]])
    const gaps = deriveRelationshipGaps(
      emptyGraph({ nameById: names, parentsOf, childrenOf: withChildren(parentsOf), spousesOf: couple('mom', 'dad') })
    )
    expect(gaps).toEqual([])
  })

  it('asks about a pair once even when they share several children', () => {
    const parentsOf = new Map([
      ['kid', ['mom', 'dad']],
      ['kid2', ['mom', 'dad']],
    ])
    const gaps = deriveRelationshipGaps(emptyGraph({ nameById: names, parentsOf, childrenOf: withChildren(parentsOf) }))
    expect(gaps).toHaveLength(1)
  })

  it('normalizes the pair so the same two people always sort the same way', () => {
    const parentsOf = new Map([['kid', ['dad', 'mom']]])
    const gaps = deriveRelationshipGaps(emptyGraph({ nameById: names, parentsOf, childrenOf: withChildren(parentsOf) }))
    expect(gaps[0]).toMatchObject({ aId: 'dad', bId: 'mom' })
  })

  it('falls back to Unknown for a person with no name on file', () => {
    const parentsOf = new Map([['kid', ['mom', 'ghost']]])
    const gaps = deriveRelationshipGaps(emptyGraph({ nameById: names, parentsOf, childrenOf: withChildren(parentsOf) }))
    expect(gaps[0]).toMatchObject({ aId: 'ghost', aName: 'Unknown' })
  })
})
