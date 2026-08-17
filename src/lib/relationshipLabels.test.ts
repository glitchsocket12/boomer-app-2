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

// The founder's 2026-08-16 note: the tree shouldn't say "spouse" about someone whose name plainly
// reads female. The real loadFamilyGraph fills genderById in from first names where the column is
// blank, so these words appear without anyone having filled in a form.
describe('describeRelationship — gendered wording', () => {
  const gendered = (over: Record<string, string>): Graph => ({
    ...buildGraph(),
    genderById: new Map(Object.entries(over)),
  })

  it('names each relationship by gender when it knows one', () => {
    const g = gendered({ andy: 'male', andi: 'female', michael: 'male', stepkid: 'female', kid1: 'male' })
    expect(describeRelationship(g, 'kid1', 'andy')).toBe('father')
    expect(describeRelationship(g, 'kid1', 'andi')).toBe('mother')
    expect(describeRelationship(g, 'kid1', 'michael')).toBe('stepfather')
    expect(describeRelationship(g, 'kid1', 'stepkid')).toBe('stepsister')
    expect(describeRelationship(g, 'andi', 'michael')).toBe('husband')
    expect(describeRelationship(g, 'michael', 'andi')).toBe('wife')
    expect(describeRelationship(g, 'andi', 'kid1')).toBe('son')
  })

  it('words each person from THEIR own gender, not the subject\'s', () => {
    // The word describes toId. Asking the same question from both ends must not hand back the same
    // noun just because the pair is the same pair.
    const g = gendered({ andi: 'female', michael: 'male' })
    expect(describeRelationship(g, 'andi', 'michael')).toBe('husband')
    expect(describeRelationship(g, 'michael', 'andi')).toBe('wife')
  })

  it('falls back to the neutral word when gender is unknown or has no gendered noun', () => {
    const g = gendered({ michael: 'non-binary' })
    expect(describeRelationship(g, 'kid1', 'michael')).toBe('step-parent')
    expect(describeRelationship(g, 'kid1', 'andy')).toBe('parent') // nothing on file at all
  })
})
