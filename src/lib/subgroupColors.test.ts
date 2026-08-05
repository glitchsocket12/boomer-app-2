import { describe, expect, it } from 'vitest'
import { isUnassigned, subgroupColorMap, subgroupsByPerson, type SubgroupLike } from './subgroupColors'
import { subgroupPalette } from './theme'

const sg = (id: string, name: string, personIds: (string | null)[]): SubgroupLike => ({
  id,
  name,
  person_groups: personIds.map((pid) => ({ people: pid ? { id: pid } : null })),
})

// Sarah is in two subgroups, Mike in one, Dana in none.
const subgroups = [sg('cousins', 'Cousins', ['sarah', 'mike']), sg('aunts', 'The Aunts', ['sarah'])]

describe('subgroupColorMap', () => {
  it('gives each subgroup a distinct color, in palette order', () => {
    const map = subgroupColorMap(subgroups)
    expect(map.cousins).toBe(subgroupPalette[0])
    expect(map.aunts).toBe(subgroupPalette[1])
    expect(map.cousins).not.toBe(map.aunts)
  })

  it('cycles once there are more subgroups than colors', () => {
    const many = Array.from({ length: subgroupPalette.length + 2 }, (_, i) => sg(`g${i}`, `G${i}`, []))
    const map = subgroupColorMap(many)
    expect(map.g0).toBe(map[`g${subgroupPalette.length}`])
    // The point of the cycle is that it never produces `undefined` past the end of the palette.
    expect(Object.values(map).every(Boolean)).toBe(true)
  })

  it('returns an empty map for a group with no subgroups', () => {
    expect(subgroupColorMap([])).toEqual({})
  })
})

describe('subgroupsByPerson', () => {
  it('lists every subgroup a person belongs to, not just the first', () => {
    const byPerson = subgroupsByPerson(subgroups)
    expect(byPerson.get('sarah')?.map((s) => s.id)).toEqual(['cousins', 'aunts'])
    expect(byPerson.get('mike')?.map((s) => s.id)).toEqual(['cousins'])
  })

  it('omits people who are in no subgroup rather than mapping them to an empty list', () => {
    expect(subgroupsByPerson(subgroups).has('dana')).toBe(false)
  })

  it('skips membership rows whose person is missing', () => {
    // Real row shape when a person was deleted but the join row lingers — the tile's member
    // count filters these for the same reason.
    const byPerson = subgroupsByPerson([sg('cousins', 'Cousins', ['mike', null])])
    expect(byPerson.size).toBe(1)
    expect(byPerson.get('mike')?.map((s) => s.id)).toEqual(['cousins'])
  })

  it('does not list the same subgroup twice for a duplicated membership row', () => {
    const byPerson = subgroupsByPerson([sg('cousins', 'Cousins', ['mike', 'mike'])])
    expect(byPerson.get('mike')?.map((s) => s.id)).toEqual(['cousins'])
  })

  it('handles an empty subgroup', () => {
    expect(subgroupsByPerson([sg('empty', 'Empty', [])]).size).toBe(0)
  })
})

describe('isUnassigned', () => {
  const byPerson = subgroupsByPerson(subgroups)

  it('is true for someone in none of the subgroups', () => {
    expect(isUnassigned('dana', byPerson)).toBe(true)
  })

  it('is false for someone in at least one', () => {
    expect(isUnassigned('mike', byPerson)).toBe(false)
    expect(isUnassigned('sarah', byPerson)).toBe(false)
  })

  it('treats everyone as unassigned when the group has no subgroups', () => {
    expect(isUnassigned('sarah', subgroupsByPerson([]))).toBe(true)
  })
})
