import { describe, expect, it } from 'vitest'
import { groupDisplayName, isSelfOrDescendant } from './groupDisplayName'

// Squadron -> Alpha Flight -> Pilots, plus an unrelated root.
const rows = [
  { id: 'sq', name: 'Squadron', parent_group_id: null },
  { id: 'af', name: 'Alpha Flight', parent_group_id: 'sq' },
  { id: 'pi', name: 'Pilots', parent_group_id: 'af' },
  { id: 'fam', name: 'Family', parent_group_id: null },
]
const nameById = new Map(rows.map((r) => [r.id, r.name]))
const parentById = new Map(rows.map((r) => [r.id, r.parent_group_id]))

describe('groupDisplayName', () => {
  it('returns a bare name for a root group', () => {
    expect(groupDisplayName(rows[0], nameById, parentById)).toBe('Squadron')
  })

  it('walks the full ancestor chain, not just the immediate parent', () => {
    expect(groupDisplayName(rows[2], nameById, parentById)).toBe('Squadron / Alpha Flight / Pilots')
  })

  it('falls back to one level when no parent map is supplied', () => {
    // The un-migrated call shape — must keep behaving exactly as it did before deep nesting.
    expect(groupDisplayName(rows[2], nameById)).toBe('Alpha Flight / Pilots')
  })

  it('truncates rather than blanking when an ancestor is missing from the roster', () => {
    // e.g. a parent `converse` created server-side after this roster was fetched.
    const partial = new Map([['pi', 'Pilots']])
    expect(groupDisplayName(rows[2], partial, parentById)).toBe('Pilots')
  })

  it('terminates on a cycle instead of hanging', () => {
    // The DB CHECK only rejects a group being its own DIRECT parent, so A -> B -> A is still
    // representable in the data and must not spin forever.
    const cyclic = new Map([
      ['a', 'b'],
      ['b', 'a'],
    ])
    const names = new Map([
      ['a', 'A'],
      ['b', 'B'],
    ])
    expect(groupDisplayName({ id: 'a', name: 'A', parent_group_id: 'b' }, names, cyclic)).toBe('B / A')
  })
})

describe('isSelfOrDescendant', () => {
  it('is true for the group itself', () => {
    expect(isSelfOrDescendant('sq', 'sq', parentById)).toBe(true)
  })

  it('is true for a direct child and a grandchild', () => {
    expect(isSelfOrDescendant('af', 'sq', parentById)).toBe(true)
    expect(isSelfOrDescendant('pi', 'sq', parentById)).toBe(true)
  })

  it('is false upward and across the tree', () => {
    // A parent is not a descendant of its own child — this is the direction that decides whether
    // "move Squadron under Pilots" gets rejected (it must be) vs. "move Family under Squadron".
    expect(isSelfOrDescendant('sq', 'pi', parentById)).toBe(false)
    expect(isSelfOrDescendant('fam', 'sq', parentById)).toBe(false)
  })

  it('terminates on a cycle instead of hanging', () => {
    const cyclic = new Map([
      ['a', 'b'],
      ['b', 'a'],
    ])
    expect(isSelfOrDescendant('a', 'unrelated', cyclic)).toBe(false)
  })
})
