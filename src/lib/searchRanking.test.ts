import { describe, expect, it } from 'vitest'
import { rankMatches } from './searchRanking'

const item = (label: string) => ({ id: label, label })

// The founder report this was written for: "98 FTS" has a deep subgroup tree, and searching for
// it in the event's group picker only ever surfaced the leaves.
const airForce = [
  item('98 FTS / Alpha Flight'),
  item('98 FTS / Alpha Flight / Maintenance'),
  item('98 FTS / Alpha Flight / Pilots'),
  item('98 FTS / Bravo Flight'),
  item('98 FTS / Bravo Flight / Maintenance'),
  item('98 FTS / Bravo Flight / Pilots'),
  item('98 FTS / Charlie Flight'),
  item('98 FTS / Charlie Flight / Maintenance'),
  item('98 FTS / Charlie Flight / Pilots'),
  item('98 FTS'),
]

describe('rankMatches', () => {
  it('puts the exact match first even when it sorts last in the source list', () => {
    expect(rankMatches(airForce, '98 fts')[0].label).toBe('98 FTS')
  })

  it('lists a branch top-down: the group, then its direct children, then the leaves', () => {
    const ranked = rankMatches(airForce, '98 fts').map((i) => i.label)
    expect(ranked.slice(0, 4)).toEqual([
      '98 FTS',
      '98 FTS / Alpha Flight',
      '98 FTS / Bravo Flight',
      '98 FTS / Charlie Flight',
    ])
    // Everything below that is a grandchild — the level the founder kept getting dumped into.
    expect(ranked.slice(4).every((label) => label.split('/').length === 3)).toBe(true)
  })

  it('keeps the parent reachable within the first eight rows the picker shows', () => {
    expect(rankMatches(airForce, '98 fts').slice(0, 8).map((i) => i.label)).toContain('98 FTS')
  })

  it('ranks a match on the group\'s own name above one buried mid-label', () => {
    const items = [item('Pilots Association Newsletter Committee'), item('98 FTS / Alpha Flight / Pilots')]
    expect(rankMatches(items, 'pilots')[0].label).toBe('Pilots Association Newsletter Committee')
  })

  it('finds a subgroup by its own name when the ancestors are not typed', () => {
    expect(rankMatches(airForce, 'bravo').map((i) => i.label)).toEqual([
      '98 FTS / Bravo Flight',
      '98 FTS / Bravo Flight / Pilots',
      '98 FTS / Bravo Flight / Maintenance',
    ])
  })

  it('still matches anywhere in the label, so a partial memory of a name works', () => {
    expect(rankMatches(airForce, 'flight / pilots').map((i) => i.label)).toEqual([
      '98 FTS / Alpha Flight / Pilots',
      '98 FTS / Bravo Flight / Pilots',
      '98 FTS / Charlie Flight / Pilots',
    ])
  })

  it('leaves flat lists (people, tags) in a sensible order', () => {
    const people = [item('Bob Smith'), item('Bobby Jones'), item('Roberta Bobbins')]
    expect(rankMatches(people, 'bob').map((i) => i.label)).toEqual(['Bob Smith', 'Bobby Jones', 'Roberta Bobbins'])
  })

  it('returns nothing when nothing matches', () => {
    expect(rankMatches(airForce, 'delta')).toEqual([])
  })
})
