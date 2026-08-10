import { describe, expect, it } from 'vitest'
import { flattenGroupTree, type GroupRow } from './Groups'

// Minimal rows — flattenGroupTree only ever reads group.id and group.parent_group_id.
function row(id: string, parent: string | null): GroupRow {
  return {
    group: {
      id,
      name: id,
      summary: null,
      group_type: null,
      parent_group_id: parent,
      person_groups: [],
      moment_groups: [],
    },
    members: [],
    events: [],
  }
}

const shape = (rows: ReturnType<typeof flattenGroupTree>) => rows.map((r) => `${'-'.repeat(r.depth)}${r.group.id}`)

describe('flattenGroupTree', () => {
  it('nests children under their parent with increasing depth', () => {
    const out = flattenGroupTree([row('sq', null), row('af', 'sq'), row('pi', 'af'), row('fam', null)])
    expect(shape(out)).toEqual(['sq', '-af', '--pi', 'fam'])
  })

  it('flags which rows have children', () => {
    const out = flattenGroupTree([row('sq', null), row('af', 'sq')])
    expect(out.map((r) => [r.group.id, r.hasChildren])).toEqual([
      ['sq', true],
      ['af', false],
    ])
  })

  it('hides the subtree of a collapsed group but keeps the group itself', () => {
    const out = flattenGroupTree([row('sq', null), row('af', 'sq'), row('pi', 'af'), row('fam', null)], new Set(['sq']))
    expect(shape(out)).toEqual(['sq', 'fam'])
  })

  it('promotes a row whose parent is missing to a root instead of dropping it', () => {
    // Happens when a type filter keeps the child but removes the parent. Falling through to
    // "unreachable from any root" would make the group vanish from the only page that lists it.
    const out = flattenGroupTree([row('orphan', 'not-loaded')])
    expect(shape(out)).toEqual(['orphan'])
  })

  it('renders every input row exactly once', () => {
    const rows = [row('a', null), row('b', 'a'), row('c', 'b'), row('d', 'a'), row('e', null)]
    const out = flattenGroupTree(rows)
    expect(out).toHaveLength(rows.length)
    expect(new Set(out.map((r) => r.group.id)).size).toBe(rows.length)
  })

  it('terminates on a cycle instead of recursing forever', () => {
    // The DB CHECK only rejects a group being its OWN direct parent, so a -> b -> a is still
    // representable. Both rows are unreachable from any root, so neither renders — the point of
    // the test is that this returns at all rather than blowing the stack.
    const out = flattenGroupTree([row('a', 'b'), row('b', 'a')])
    expect(out).toEqual([])
  })
})
