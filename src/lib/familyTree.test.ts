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

// Remarriage with NO death involved (the founder's point: divorce-and-remarry is the more common
// shape). Mom and Dad divorce; Mom remarries Steve, who already has Stepkid with his own ex. Steve
// also has a parent and a sibling on file, so this covers the "don't graft his family onto this
// tree" side too.
function buildRemarriageGraph(): Graph {
  return {
    nameById: new Map([
      ['kid', 'Kid'],
      ['mom', 'Mom'],
      ['dad', 'Dad'],
      ['steve', 'Steve'],
      ['stepkid', 'Stepkid'],
      ['steve-dad', 'Steve Sr'],
      ['steve-sis', 'Steve Sis'],
      ['ex', 'Ex'],
    ]),
    selfId: null,
    parentsOf: new Map([
      ['kid', ['mom', 'dad']],
      ['stepkid', ['steve', 'ex']],
      ['steve', ['steve-dad']],
    ]),
    childrenOf: new Map([
      ['mom', ['kid']],
      ['dad', ['kid']],
      ['steve', ['stepkid']],
      ['ex', ['stepkid']],
      ['steve-dad', ['steve']],
    ]),
    spousesOf: new Map([
      ['mom', ['dad', 'steve']],
      ['dad', ['mom']],
      ['steve', ['mom']],
    ]),
    siblingsOf: new Map([
      ['steve', ['steve-sis']],
      ['steve-sis', ['steve']],
    ]),
    deceasedIds: new Set(),
    endedPairs: new Set(['dad|mom']),
  }
}

describe('buildFamilyTreeFromGraph — step-parents and step-siblings without a death', () => {
  const tree = buildFamilyTreeFromGraph('kid', buildRemarriageGraph())
  const parentsTier = tree.tiers.find((t) => t.label === 'Parents')!
  const parentChain = [parentsTier.branches[0].union.a, ...parentsTier.branches[0].union.spouses]

  it("shows a living parent's new spouse on the marriage line, tagged and flagged as step-only", () => {
    const steve = parentChain.find((p) => p.id === 'steve')!
    expect(steve.relationLabel).toBe('step-parent')
    expect(steve.stepOnly).toBe(true)
    // No parentId — nothing may draw an ancestor line through a step-parent.
    expect(steve.parentId).toBeUndefined()
  })

  it('places the step-parent next to the parent they actually married, not the other one', () => {
    expect(parentChain.map((p) => p.id)).toEqual(['dad', 'mom', 'steve'])
  })

  it("leaves the step-parent's own family out of the tree entirely", () => {
    const shownIds = tree.tiers.flatMap((t) =>
      t.branches.flatMap((b) => [
        b.union.a.id,
        ...b.union.spouses.map((s) => s.id),
        ...[...b.leftExtended, ...b.rightExtended, ...b.siblings].flatMap((u) => [u.a.id, ...u.spouses.map((s) => s.id)]),
      ])
    )
    expect(shownIds).not.toContain('steve-dad')
    expect(shownIds).not.toContain('steve-sis')
    expect(tree.tiers.find((t) => t.label === 'Grandparents')?.branches ?? []).toEqual([])
  })

  it("hangs the step-parent's own child off the step-parent, never off the root's blood parents", () => {
    const rootTier = tree.tiers.find((t) => t.depth === 0)!
    const stepkid = rootTier.branches.flatMap((b) => b.siblings).find((u) => u.a.id === 'stepkid')!
    expect(stepkid.a.relationLabel).toBe('step-sibling')
    expect(stepkid.a.parentId).toBe('steve')
    expect(tree.rootDirect.siblings).toEqual([])
  })

  it('reports both step relations with the person they run through, for the add/remove controls', () => {
    expect(tree.rootDirect.stepParents.map((s) => [s.person.id, s.throughId, s.throughName])).toEqual([
      ['steve', 'mom', 'Mom'],
    ])
    expect(tree.rootDirect.stepSiblings.map((s) => [s.person.id, s.throughId, s.throughName])).toEqual([
      ['stepkid', 'steve', 'Steve'],
    ])
  })

  it("doesn't promote a deceased step-parent to a blood parent once both real parents are known", () => {
    const g = buildRemarriageGraph()
    g.deceasedIds.add('steve')
    const withDeadStep = buildFamilyTreeFromGraph('kid', g)
    const chain = [withDeadStep.tiers.find((t) => t.label === 'Parents')!.branches[0].union.a, ...withDeadStep.tiers.find((t) => t.label === 'Parents')!.branches[0].union.spouses]
    expect(chain.find((p) => p.id === 'steve')!.stepOnly).toBe(true)
    expect(withDeadStep.rootDirect.parents.map((p) => p.id)).toEqual(['mom', 'dad'])
  })
})
