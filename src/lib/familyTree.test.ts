import { describe, expect, it } from 'vitest'
import type { Graph } from './familyTree'
import { buildFamilyTreeFromGraph } from './familyTree'

// Same shape as relationshipLabels.test.ts's fixture (the founder's exact scenario), with a
// grandparent added above Andy so building a tree rooted on the grandparent renders Andy in the
// Kids tier — the position that actually exercises spouseChain (root's own direct spouse list is
// deliberately left unexpanded; see familyTree.ts's buildFamilyTreeFromGraph comment).
function buildGraph(): Graph {
  return {
    nameById: new Map([
      ['g1', 'Grandparent'],
      ['andy', 'Andy'],
      ['andi', 'Andi'],
      ['michael', 'Michael'],
      ['kid1', 'Kid1'],
    ]),
    selfId: null,
    parentsOf: new Map([
      ['andy', ['g1']],
      ['kid1', ['andy', 'andi']],
    ]),
    childrenOf: new Map([
      ['g1', ['andy']],
      ['andy', ['kid1']],
      ['andi', ['kid1']],
    ]),
    spousesOf: new Map([
      ['andy', ['andi']],
      ['andi', ['andy', 'michael']],
      ['michael', ['andi']],
    ]),
    siblingsOf: new Map(),
    deceasedIds: new Set(['andy']),
    endedPairs: new Set(),
  }
}

describe('buildFamilyTreeFromGraph — spouse chain', () => {
  it("shows a deceased blood relative's widow AND her later remarriage, each with correct ended status and a step-parent label on the 2nd-hop spouse", () => {
    const g = buildGraph()
    const tree = buildFamilyTreeFromGraph('g1', g)
    const kidsTier = tree.tiers.find((t) => t.label === 'Kids')!
    const andyBranch = kidsTier.branches.find((b) => b.union.a.id === 'andy')!

    expect(andyBranch.union.spouses.map((s) => s.id)).toEqual(['andi', 'michael'])

    const andi = andyBranch.union.spouses[0]
    expect(andi.endedWithAnchor).toBe(true)
    expect(andi.relationLabel).toBeUndefined()

    const michael = andyBranch.union.spouses[1]
    expect(michael.endedWithAnchor).toBe(false)
    expect(michael.relationLabel).toBe('step-parent')
  })
})
