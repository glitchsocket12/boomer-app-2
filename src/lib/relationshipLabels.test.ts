import { describe, expect, it } from 'vitest'
import type { Graph } from './familyTree'
import { describeRelationship } from './relationshipLabels'

// Andy + Andi have Kid1. Andy dies, Andi remarries Michael, who already has StepKid from an
// earlier marriage — the founder's exact scenario (see PROJECT_CONTEXT.md).
function buildGraph(): Graph {
  const parentsOf = new Map<string, string[]>([
    ['kid1', ['andy', 'andi']],
    ['stepkid', ['michael', 'other-parent']],
  ])
  const childrenOf = new Map<string, string[]>([
    ['andy', ['kid1']],
    ['andi', ['kid1']],
    ['michael', ['stepkid']],
    ['other-parent', ['stepkid']],
  ])
  const spousesOf = new Map<string, string[]>([
    ['andy', ['andi']],
    ['andi', ['andy', 'michael']],
    ['michael', ['andi']],
  ])
  return {
    nameById: new Map(),
    selfId: null,
    parentsOf,
    childrenOf,
    spousesOf,
    siblingsOf: new Map(),
    deceasedIds: new Set(['andy']),
    endedPairs: new Set(),
  }
}

describe('describeRelationship', () => {
  const g = buildGraph()

  it('resolves a biological parent', () => {
    expect(describeRelationship(g, 'kid1', 'andy')).toBe('parent')
    expect(describeRelationship(g, 'kid1', 'andi')).toBe('parent')
  })

  it('resolves a step-parent: spouse of a parent who is not themselves a parent', () => {
    expect(describeRelationship(g, 'kid1', 'michael')).toBe('step-parent')
  })

  it('resolves a step-sibling: child of a step-parent, no shared biological parent', () => {
    expect(describeRelationship(g, 'kid1', 'stepkid')).toBe('step-sibling')
    expect(describeRelationship(g, 'stepkid', 'kid1')).toBe('step-sibling')
  })

  it('resolves spouse both directions', () => {
    expect(describeRelationship(g, 'andi', 'michael')).toBe('spouse')
    expect(describeRelationship(g, 'michael', 'andi')).toBe('spouse')
  })

  it('death does not change the parent/spouse label itself', () => {
    // Andy is deceased, but he's still kid1's parent and andi's spouse — death is a rendering/
    // union-status concern (isUnionEnded), not a relationship-kind concern.
    expect(describeRelationship(g, 'kid1', 'andy')).toBe('parent')
    expect(describeRelationship(g, 'andi', 'andy')).toBe('spouse')
  })
})
