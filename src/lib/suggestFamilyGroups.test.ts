import { describe, expect, it } from 'vitest'
import type { Graph } from './familyTree'
import { deriveFamilyGroupSuggestions, proposeGroupName } from './suggestFamilyGroups'

// A couple with two shared children, plus a spare person who isn't part of it.
function graph(overrides: Partial<Graph> = {}): Graph {
  return {
    nameById: new Map([
      ['mom', 'Amy Volin'],
      ['dad', 'Steve Volin'],
      ['kid1', 'Jake Volin'],
      ['kid2', 'Jess Volin'],
      ['other', 'Pat Carroll'],
    ]),
    selfId: null,
    parentsOf: new Map([
      ['kid1', ['mom', 'dad']],
      ['kid2', ['mom', 'dad']],
    ]),
    childrenOf: new Map([
      ['mom', ['kid1', 'kid2']],
      ['dad', ['kid1', 'kid2']],
    ]),
    spousesOf: new Map([
      ['mom', ['dad']],
      ['dad', ['mom']],
    ]),
    siblingsOf: new Map(),
    deceasedIds: new Set(),
    endedPairs: new Set(),
    ...overrides,
  }
}

describe('deriveFamilyGroupSuggestions', () => {
  it('suggests a household of a couple and their shared children', () => {
    const out = deriveFamilyGroupSuggestions(graph(), [])
    expect(out).toHaveLength(1)
    expect(out[0].memberIds.sort()).toEqual(['dad', 'kid1', 'kid2', 'mom'])
    expect(out[0].suggestedName).toBe('Volin Family')
  })

  it('reports the couple once, not once from each side', () => {
    const out = deriveFamilyGroupSuggestions(graph(), [])
    expect(out.filter((s) => s.aId === 'dad' || s.bId === 'dad')).toHaveLength(1)
  })

  // The founder's example was "husband, wife, and child" — a childless couple is two people, and
  // two people are not a group worth proposing.
  it('says nothing about a couple with no shared children', () => {
    const g = graph({ childrenOf: new Map(), parentsOf: new Map() })
    expect(deriveFamilyGroupSuggestions(g, [])).toEqual([])
  })

  it('says nothing about a child only one of them is a parent of', () => {
    const g = graph({
      parentsOf: new Map([['kid1', ['mom']]]),
      childrenOf: new Map([['mom', ['kid1']]]),
    })
    expect(deriveFamilyGroupSuggestions(g, [])).toEqual([])
  })

  it('stays quiet once every member already shares a group', () => {
    const memberships = [
      { person_id: 'mom', group_id: 'g1' },
      { person_id: 'dad', group_id: 'g1' },
      { person_id: 'kid1', group_id: 'g1' },
      { person_id: 'kid2', group_id: 'g1' },
    ]
    expect(deriveFamilyGroupSuggestions(graph(), memberships)).toEqual([])
  })

  it('still asks when only some of them share a group', () => {
    const memberships = [
      { person_id: 'mom', group_id: 'g1' },
      { person_id: 'dad', group_id: 'g1' },
      { person_id: 'kid1', group_id: 'g1' },
    ]
    expect(deriveFamilyGroupSuggestions(graph(), memberships)).toHaveLength(1)
  })

  it('leaves an ended marriage alone', () => {
    const g = graph({ endedPairs: new Set(['dad|mom']) })
    expect(deriveFamilyGroupSuggestions(g, [])).toEqual([])
  })

  it('leaves a household alone when one of the couple has died', () => {
    const g = graph({ deceasedIds: new Set(['dad']) })
    expect(deriveFamilyGroupSuggestions(g, [])).toEqual([])
  })

  it('puts the biggest household first', () => {
    const g = graph({
      nameById: new Map([
        ['mom', 'Amy Volin'],
        ['dad', 'Steve Volin'],
        ['kid1', 'Jake Volin'],
        ['kid2', 'Jess Volin'],
        ['ma', 'Mimi Carroll'],
        ['pa', 'Pat Carroll'],
        ['kid3', 'Susie Carroll'],
      ]),
      parentsOf: new Map([
        ['kid1', ['mom', 'dad']],
        ['kid2', ['mom', 'dad']],
        ['kid3', ['ma', 'pa']],
      ]),
      childrenOf: new Map([
        ['mom', ['kid1', 'kid2']],
        ['dad', ['kid1', 'kid2']],
        ['ma', ['kid3']],
        ['pa', ['kid3']],
      ]),
      spousesOf: new Map([
        ['mom', ['dad']],
        ['dad', ['mom']],
        ['ma', ['pa']],
        ['pa', ['ma']],
      ]),
    })
    const out = deriveFamilyGroupSuggestions(g, [])
    expect(out.map((s) => s.suggestedName)).toEqual(['Volin Family', 'Carroll Family'])
  })

  // Two generations of the same surname is the common real case — three of the founder's families
  // are shaped this way, and two groups both called "Carroll Family" would be worse than one.
  it('disambiguates a second household with the same surname', () => {
    const g = graph({
      nameById: new Map([
        ['pa', 'Pat Carroll'],
        ['ma', 'Mimi Carroll'],
        ['son', 'Ward Carroll'],
        ['sonWife', 'Heather Carroll'],
        ['grandkid', 'Will Carroll'],
        ['grandkid2', 'Margaret Carroll'],
      ]),
      parentsOf: new Map([
        ['son', ['pa', 'ma']],
        ['grandkid', ['son', 'sonWife']],
        ['grandkid2', ['son', 'sonWife']],
      ]),
      childrenOf: new Map([
        ['pa', ['son']],
        ['ma', ['son']],
        ['son', ['grandkid', 'grandkid2']],
        ['sonWife', ['grandkid', 'grandkid2']],
      ]),
      spousesOf: new Map([
        ['pa', ['ma']],
        ['ma', ['pa']],
        ['son', ['sonWife']],
        ['sonWife', ['son']],
      ]),
    })
    const names = deriveFamilyGroupSuggestions(g, []).map((s) => s.suggestedName)
    expect(new Set(names).size).toBe(names.length)
    expect(names).toContain('Carroll Family')
  })

  // The couple's order comes from their ids, which is arbitrary but stable — the point is that the
  // fallback names them rather than reusing a name the account already has.
  it("won't propose a name a group already has", () => {
    const out = deriveFamilyGroupSuggestions(graph(), [], ['volin family'])
    expect(out[0].suggestedName).not.toBe('Volin Family')
    expect(out[0].suggestedName).toBe('Steve & Amy Volin')
  })
})

describe('proposeGroupName', () => {
  it('uses the surname most of the household shares', () => {
    expect(proposeGroupName(['Amy Volin', 'Steve Volin', 'Jake Volin'])).toBe('Volin Family')
  })

  it('falls back to the couple when the household has no shared surname', () => {
    expect(proposeGroupName(['Amy Ruiz', 'Steve Volin', 'Jake Okafor'])).toBe('Amy & Steve Family')
  })

  it('falls back to the couple when two surnames tie', () => {
    expect(proposeGroupName(['Amy Ruiz', 'Steve Volin', 'Jake Volin', 'Mia Ruiz'])).toBe('Amy & Steve Family')
  })

  it('handles a one-word name without inventing a surname', () => {
    expect(proposeGroupName(['Cher', 'Steve Volin', 'Jake Volin'])).toBe('Volin Family')
  })
})
