import { describe, expect, it } from 'vitest'
import type { Graph } from './familyTree'
import { findTreeIssues } from './treeHealth'

// Builds a Graph by hand the way familyTree.test.ts does. Edges are written symmetrically here on
// purpose — that is what loadFamilyGraph produces, so a fixture that skips a direction would be
// testing a state the app can't reach.
function graph(overrides: Partial<Graph> = {}): Graph {
  return {
    nameById: new Map([
      ['a', 'Ann Reyes'],
      ['b', 'Ben Reyes'],
      ['c', 'Cass Reyes'],
      ['d', 'Dev Reyes'],
    ]),
    selfId: null,
    parentsOf: new Map(),
    childrenOf: new Map(),
    spousesOf: new Map(),
    siblingsOf: new Map(),
    deceasedIds: new Set(),
    endedPairs: new Set(),
    ...overrides,
  }
}

function kinds(g: Graph): string[] {
  return findTreeIssues(g).map((i) => i.kind)
}

describe('findTreeIssues', () => {
  it('says nothing about an ordinary family', () => {
    const g = graph({
      parentsOf: new Map([['c', ['a', 'b']]]),
      childrenOf: new Map([
        ['a', ['c']],
        ['b', ['c']],
      ]),
      spousesOf: new Map([
        ['a', ['b']],
        ['b', ['a']],
      ]),
    })
    expect(findTreeIssues(g)).toEqual([])
  })

  it('catches a two-person parent loop', () => {
    const g = graph({
      parentsOf: new Map([
        ['a', ['b']],
        ['b', ['a']],
      ]),
      childrenOf: new Map([
        ['a', ['b']],
        ['b', ['a']],
      ]),
    })
    const issues = findTreeIssues(g)
    expect(issues).toHaveLength(1)
    expect(issues[0].kind).toBe('self_ancestor')
    expect(issues[0].personIds.sort()).toEqual(['a', 'b'])
  })

  it('catches a longer loop and reports it once, not once per person in it', () => {
    const g = graph({
      parentsOf: new Map([
        ['a', ['b']],
        ['b', ['c']],
        ['c', ['a']],
      ]),
      childrenOf: new Map([
        ['b', ['a']],
        ['c', ['b']],
        ['a', ['c']],
      ]),
    })
    const issues = findTreeIssues(g)
    expect(issues.filter((i) => i.kind === 'self_ancestor')).toHaveLength(1)
  })

  // The check walks every person, so a graph with a loop must terminate rather than hang — that is
  // the reason this exists at all, since the tree renderers walking the same edges would not.
  it('terminates on a loop that hangs off a longer chain', () => {
    const g = graph({
      parentsOf: new Map([
        ['d', ['c']],
        ['c', ['b']],
        ['b', ['a']],
        ['a', ['c']],
      ]),
      childrenOf: new Map([
        ['c', ['d', 'a']],
        ['b', ['c']],
        ['a', ['b']],
      ]),
    })
    expect(kinds(g)).toContain('self_ancestor')
  })

  it('catches someone recorded as their own parent', () => {
    const g = graph({ parentsOf: new Map([['a', ['a']]]), childrenOf: new Map([['a', ['a']]]) })
    const issues = findTreeIssues(g)
    expect(issues.some((i) => i.kind === 'related_to_self')).toBe(true)
    expect(issues.find((i) => i.kind === 'related_to_self')!.message).toContain('their own parent')
  })

  it('catches a couple who are also parent and child', () => {
    const g = graph({
      parentsOf: new Map([['b', ['a']]]),
      childrenOf: new Map([['a', ['b']]]),
      spousesOf: new Map([
        ['a', ['b']],
        ['b', ['a']],
      ]),
    })
    const issues = findTreeIssues(g).filter((i) => i.kind === 'spouse_is_relative')
    expect(issues).toHaveLength(1)
    expect(issues[0].message).toContain('parent and child')
  })

  it('catches a couple who are also siblings, and reports the pair once', () => {
    const g = graph({
      spousesOf: new Map([
        ['a', ['b']],
        ['b', ['a']],
      ]),
      siblingsOf: new Map([
        ['a', ['b']],
        ['b', ['a']],
      ]),
    })
    const issues = findTreeIssues(g).filter((i) => i.kind === 'spouse_is_relative')
    expect(issues).toHaveLength(1)
    expect(issues[0].message).toContain('siblings')
  })

  it('catches someone who is both a parent and a sibling of the same person', () => {
    const g = graph({
      parentsOf: new Map([['b', ['a']]]),
      childrenOf: new Map([['a', ['b']]]),
      siblingsOf: new Map([
        ['a', ['b']],
        ['b', ['a']],
      ]),
    })
    expect(kinds(g)).toContain('parent_is_sibling')
  })

  it('asks about a third parent but leaves two alone', () => {
    const two = graph({ parentsOf: new Map([['c', ['a', 'b']]]) })
    expect(kinds(two)).not.toContain('many_parents')

    const three = graph({ parentsOf: new Map([['c', ['a', 'b', 'd']]]) })
    const issue = findTreeIssues(three).find((i) => i.kind === 'many_parents')!
    expect(issue.message).toContain('3 parents')
    expect(issue.message).toContain('Ann Reyes, Ben Reyes and Dev Reyes')
  })

  it('asks about two current partners, but not when one of them ended', () => {
    const both = graph({
      spousesOf: new Map([
        ['a', ['b', 'c']],
        ['b', ['a']],
        ['c', ['a']],
      ]),
    })
    expect(kinds(both)).toContain('two_current_partners')

    // Same shape with the first marriage marked as ended — the app's own divorce state.
    const ended = graph({
      spousesOf: new Map([
        ['a', ['b', 'c']],
        ['b', ['a']],
        ['c', ['a']],
      ]),
      endedPairs: new Set(['a|b']),
    })
    expect(kinds(ended)).not.toContain('two_current_partners')
  })

  // Death already ends a union everywhere else in the app (isUnionEnded), so a widow who remarried
  // is not two current partners — she is one, plus a memory.
  it('does not count a deceased partner as current', () => {
    const g = graph({
      spousesOf: new Map([
        ['a', ['b', 'c']],
        ['b', ['a']],
        ['c', ['a']],
      ]),
      deceasedIds: new Set(['b']),
    })
    expect(kinds(g)).not.toContain('two_current_partners')
  })
})
