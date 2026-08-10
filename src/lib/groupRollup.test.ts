import { describe, expect, it } from 'vitest'
import {
  buildChildIndex,
  descendantGroupIds,
  mergeRolledUpMembers,
  rollUpMembersByGroup,
} from './groupRollup'

type P = { id: string }
const p = (id: string): P => ({ id })
const ids = (people: P[]) => people.map((m) => m.id).sort()

// A squadron with a flight under it and a crew under that — three levels, which is the case a
// direct-children-only rollup gets wrong.
const tree = [
  { id: 'squadron', parent_group_id: null, members: [p('kate')] },
  { id: 'flight', parent_group_id: 'squadron', members: [p('mike')] },
  { id: 'crew', parent_group_id: 'flight', members: [p('dana')] },
  { id: 'unrelated', parent_group_id: null, members: [p('sam')] },
]

describe('descendantGroupIds', () => {
  it('walks the whole chain, not just direct children', () => {
    const index = buildChildIndex(tree)
    expect(descendantGroupIds('squadron', index).sort()).toEqual(['crew', 'flight'])
    expect(descendantGroupIds('flight', index)).toEqual(['crew'])
    expect(descendantGroupIds('crew', index)).toEqual([])
  })

  it('never returns the group itself, and ignores unrelated branches', () => {
    const index = buildChildIndex(tree)
    expect(descendantGroupIds('squadron', index)).not.toContain('squadron')
    expect(descendantGroupIds('squadron', index)).not.toContain('unrelated')
  })

  it('terminates on a cycle the DB CHECK allows (A -> B -> A)', () => {
    const index = buildChildIndex([
      { id: 'a', parent_group_id: 'b' },
      { id: 'b', parent_group_id: 'a' },
    ])
    expect(descendantGroupIds('a', index)).toEqual(['b'])
  })
})

describe('mergeRolledUpMembers', () => {
  it('marks descendant-only people as rolled up, and explicit members as not', () => {
    const { members, rolledUpIds } = mergeRolledUpMembers([p('kate')], [p('mike'), p('dana')])
    expect(members.map((m) => m.id)).toEqual(['kate', 'mike', 'dana'])
    expect([...rolledUpIds].sort()).toEqual(['dana', 'mike'])
  })

  it('keeps someone who is BOTH an explicit member and in a subgroup removable', () => {
    // Their person_groups row on this group is real, so the untag badge has something to act on —
    // being in a subgroup as well must not take that away.
    const { members, rolledUpIds } = mergeRolledUpMembers([p('kate')], [p('kate')])
    expect(members).toHaveLength(1)
    expect(rolledUpIds.has('kate')).toBe(false)
  })

  it('de-dupes someone who is in several sibling subgroups', () => {
    const { members } = mergeRolledUpMembers([], [p('sarah'), p('sarah')])
    expect(members.map((m) => m.id)).toEqual(['sarah'])
  })

  it('is a no-op for a group with no subgroups', () => {
    const { members, rolledUpIds } = mergeRolledUpMembers([p('kate')], [])
    expect(members.map((m) => m.id)).toEqual(['kate'])
    expect(rolledUpIds.size).toBe(0)
  })
})

describe('rollUpMembersByGroup', () => {
  it('rolls a grandchild subgroup up past its parent to the top', () => {
    const rolled = rollUpMembersByGroup(tree)
    expect(ids(rolled.get('squadron')!.members)).toEqual(['dana', 'kate', 'mike'])
    expect([...rolled.get('squadron')!.rolledUpIds].sort()).toEqual(['dana', 'mike'])
  })

  it('rolls up, never down — a subgroup does not inherit its parent roster', () => {
    const rolled = rollUpMembersByGroup(tree)
    expect(ids(rolled.get('flight')!.members)).toEqual(['dana', 'mike'])
    expect(ids(rolled.get('crew')!.members)).toEqual(['dana'])
    expect(rolled.get('crew')!.rolledUpIds.size).toBe(0)
  })

  it('leaves an unrelated root group alone', () => {
    const rolled = rollUpMembersByGroup(tree)
    expect(ids(rolled.get('unrelated')!.members)).toEqual(['sam'])
    expect(rolled.get('unrelated')!.rolledUpIds.size).toBe(0)
  })
})
