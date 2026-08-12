import { describe, expect, it } from 'vitest'
import type { HomeSuggestion } from './suggestConnections'
import { sampleAcrossKinds, suggestionKey } from './suggestConnections'

function personGroup(n: number): HomeSuggestion {
  return {
    kind: 'person_group',
    person: { id: `p${n}`, name: `Person ${n}`, last_name: null },
    group: { id: `g${n}`, name: `Group ${n}` },
  }
}

function eventGroup(n: number): HomeSuggestion {
  return { kind: 'event_group', momentId: `m${n}`, momentTitle: `Event ${n}`, groupId: `g${n}`, groupName: `Group ${n}` }
}

describe('sampleAcrossKinds', () => {
  it('takes from every pool before taking a second from any of them', () => {
    const out = sampleAcrossKinds([[personGroup(1), personGroup(2), personGroup(3)], [eventGroup(1)]], 2)
    expect(out.map((s) => s.kind).sort()).toEqual(['event_group', 'person_group'])
  })

  it('falls back to the pools that do have rows once a pool runs dry', () => {
    const out = sampleAcrossKinds([[personGroup(1), personGroup(2), personGroup(3)], [eventGroup(1)]], 4)
    expect(out).toHaveLength(4)
    expect(out.filter((s) => s.kind === 'person_group')).toHaveLength(3)
  })

  it('never returns more than the limit', () => {
    const out = sampleAcrossKinds([[personGroup(1), personGroup(2)], [eventGroup(1), eventGroup(2)]], 3)
    expect(out).toHaveLength(3)
  })

  it('terminates on empty pools instead of spinning', () => {
    expect(sampleAcrossKinds([[], []], 6)).toEqual([])
  })

  it('returns everything available when the pools are smaller than the limit', () => {
    const out = sampleAcrossKinds([[personGroup(1)], [eventGroup(1)]], 6)
    expect(out).toHaveLength(2)
  })

  // Home now asks for the whole pool and caps the DISPLAY itself, so answering a card can refill
  // from the rest with no refetch (item 58). An unbounded limit has to drain every pool and stop.
  it('drains every pool without spinning when the limit is unbounded', () => {
    const out = sampleAcrossKinds(
      [[personGroup(1), personGroup(2), personGroup(3)], [eventGroup(1), eventGroup(2)]],
      Infinity
    )
    expect(out).toHaveLength(5)
    expect(new Set(out.map(suggestionKey)).size).toBe(5)
  })

  // The first batch off an unbounded call still has to be kind-varied, since that ordering is
  // exactly what the founder sees before anything is answered.
  it('still round-robins the front of an unbounded result', () => {
    const out = sampleAcrossKinds(
      [[personGroup(1), personGroup(2), personGroup(3)], [eventGroup(1), eventGroup(2)]],
      Infinity
    )
    expect(out.slice(0, 2).map((s) => s.kind).sort()).toEqual(['event_group', 'person_group'])
  })
})

describe('suggestionKey', () => {
  it('is stable and distinct per question', () => {
    const keys = [
      suggestionKey(personGroup(1)),
      suggestionKey(eventGroup(1)),
      suggestionKey({ kind: 'family_coparent', parentId: 'a', parentName: 'A', childId: 'b', childName: 'B' }),
      suggestionKey({ kind: 'family_couple', aId: 'a', aName: 'A', bId: 'b', bName: 'B', childId: 'c', childName: 'C' }),
    ]
    expect(new Set(keys).size).toBe(4)
    expect(suggestionKey(personGroup(1))).toBe(suggestionKey(personGroup(1)))
  })
})
