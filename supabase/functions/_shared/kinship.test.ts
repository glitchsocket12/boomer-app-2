import { describe, expect, it } from 'vitest'
import { bucketCloseKin, kinBetween, type KinGraph as EdgeGraph } from './kinship.ts'
import { calculateRelationship, type KinGraph as AppGraph } from '../../../src/lib/relationshipCalculator'

// The point of this file: the edge-function copy of the kinship math and the app's original are
// hand-maintained mirrors, so every case below runs through BOTH and asserts they agree. Drift
// fails the suite instead of quietly telling a user their nephew is their cousin.
//
// It runs at all because vitest's default glob reaches outside src/ — tsconfig.app.json doesn't,
// so `npm run build` won't typecheck this file. `npm test` is the gate.

// me ← mom ← gm ← ggm, with aunt/cuz/cuzkid hanging off gm and gunc/p2 off ggm.
const PARENTS: [string, string[]][] = [
  ['gm', ['ggm', 'ggp']],
  ['gunc', ['ggm', 'ggp']],
  ['p2', ['gunc']],
  ['mom', ['gm', 'gp']],
  ['aunt', ['gm', 'gp']],
  ['cuz', ['aunt', 'unc']],
  ['cuzkid', ['cuz']],
  ['me', ['mom', 'dad']],
  ['sis', ['mom', 'dad']],
  ['kid', ['me']],
  ['grandkid', ['kid']],
]

function childrenFrom(parentsOf: Map<string, string[]>): Map<string, string[]> {
  const childrenOf = new Map<string, string[]>()
  for (const [child, parents] of parentsOf) {
    for (const p of parents) childrenOf.set(p, [...(childrenOf.get(p) ?? []), child])
  }
  return childrenOf
}

function edgeGraph(): EdgeGraph {
  const parentsOf = new Map(PARENTS)
  return { parentsOf, childrenOf: childrenFrom(parentsOf), spousesOf: new Map() }
}

function appGraph(): AppGraph {
  const parentsOf = new Map(PARENTS)
  return {
    parentsOf,
    childrenOf: childrenFrom(parentsOf),
    spousesOf: new Map(),
    siblingsOf: new Map(),
    endedPairs: new Set(),
  }
}

// Maps the app's richer Kinship back onto the mirror's smaller vocabulary.
function appCategory(fromId: string, toId: string) {
  const k = calculateRelationship(appGraph(), fromId, toId)
  return { category: k.kind, degree: k.degree ?? 0, removal: k.removal ?? 0 }
}

describe('kinship mirror agrees with relationshipCalculator', () => {
  const g = edgeGraph()

  const cases: [string, string, string, number, number][] = [
    // from, to, category, degree, removal
    ['me', 'cuz', 'cousin', 1, 0],
    ['cuz', 'me', 'cousin', 1, 0],
    ['kid', 'cuzkid', 'cousin', 2, 0],
    ['me', 'cuzkid', 'cousin', 1, 1],
    ['kid', 'cuz', 'cousin', 1, 1],
    ['kid', 'p2', 'cousin', 1, 2],
    ['me', 'aunt', 'pibling', 2, 0],
    ['aunt', 'me', 'nibling', 2, 0],
    ['me', 'gunc', 'pibling', 3, 0],
    ['kid', 'aunt', 'pibling', 3, 0],
    ['aunt', 'kid', 'nibling', 3, 0],
    ['me', 'mom', 'ancestor', 1, 0],
    ['me', 'gm', 'ancestor', 2, 0],
    ['me', 'ggm', 'ancestor', 3, 0],
    ['me', 'kid', 'descendant', 1, 0],
    ['me', 'grandkid', 'descendant', 2, 0],
    ['me', 'me', 'self', 0, 0],
    ['me', 'nobody', 'unrelated', 0, 0],
  ]

  for (const [from, to, category, degree, removal] of cases) {
    it(`${from} → ${to} is ${category}${degree ? ` (${degree}/${removal})` : ''} in both copies`, () => {
      expect(kinBetween(g, from, to)).toEqual({ category, degree, removal })
      expect(appCategory(from, to)).toEqual({ category, degree, removal })
    })
  }

  // Siblings are the one case where the two intentionally differ in DETAIL, not in category: the
  // app tracks full vs. half, the mirror doesn't need to.
  it('agrees that full siblings are siblings, and only the app tracks half-ness', () => {
    expect(kinBetween(g, 'me', 'sis').category).toBe('sibling')
    const rich = calculateRelationship(appGraph(), 'me', 'sis')
    expect(rich.kind).toBe('sibling')
    expect(rich.half).toBe(false)
  })

  it('terminates on a parent cycle rather than looping', { timeout: 1000 }, () => {
    const cyclic: EdgeGraph = {
      parentsOf: new Map([['a', ['b']], ['b', ['a']]]),
      childrenOf: new Map([['a', ['b']], ['b', ['a']]]),
      spousesOf: new Map(),
    }
    expect(() => kinBetween(cyclic, 'a', 'b')).not.toThrow()
  })

  it('gives up past the generation cap', { timeout: 1000 }, () => {
    const parentsOf = new Map<string, string[]>()
    for (let i = 0; i < 40; i++) parentsOf.set(`p${i}`, [`p${i + 1}`])
    const deep: EdgeGraph = { parentsOf, childrenOf: childrenFrom(parentsOf), spousesOf: new Map() }
    expect(kinBetween(deep, 'p0', 'p40').category).toBe('unrelated')
    expect(kinBetween(deep, 'p0', 'p3')).toEqual({ category: 'ancestor', degree: 3, removal: 0 })
  })

  it('handles an empty graph', () => {
    const empty: EdgeGraph = { parentsOf: new Map(), childrenOf: new Map(), spousesOf: new Map() }
    expect(kinBetween(empty, 'x', 'y').category).toBe('unrelated')
  })
})

describe('bucketCloseKin', () => {
  const g = edgeGraph()
  const nameById: Record<string, string> = {
    me: 'Me', mom: 'Mom', dad: 'Dad', sis: 'Sis', gm: 'Gm', gp: 'Gp', aunt: 'Aunt', unc: 'Unc',
    cuz: 'Cuz', cuzkid: 'Cuzkid', gunc: 'Gunc', p2: 'P2', ggm: 'Ggm', ggp: 'Ggp', kid: 'Kid', grandkid: 'Grandkid',
  }
  const everyone = Object.keys(nameById)

  it('collects exactly the two-generations-up-and-down vocabulary', () => {
    const b = bucketCloseKin(g, 'me', everyone, nameById)
    expect(b.grandparents).toEqual(['Gm', 'Gp'])
    expect(b.auntsUncles).toEqual(['Aunt'])
    expect(b.firstCousins).toEqual(['Cuz'])
    expect(b.grandchildren).toEqual(['Grandkid'])
    // Great-uncle Gunc and first-cousin-once-removed P2 are deliberately left out — they're the
    // long tail nobody says out loud, and every name here costs tokens in a cached prompt tier.
    expect(b.auntsUncles).not.toContain('Gunc')
    expect(b.firstCousins).not.toContain('P2')
  })

  it('sorts within each bucket so an unchanged roster serializes identically', () => {
    const shuffled = [...everyone].reverse()
    expect(bucketCloseKin(g, 'me', shuffled, nameById)).toEqual(bucketCloseKin(g, 'me', everyone, nameById))
  })

  it('skips people with no name on file rather than emitting blanks', () => {
    const b = bucketCloseKin(g, 'me', [...everyone, 'ghost'], { ...nameById })
    expect(Object.values(b).flat()).not.toContain('')
  })
})
