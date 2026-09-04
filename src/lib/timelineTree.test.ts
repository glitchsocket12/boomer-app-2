import { describe, expect, it } from 'vitest'
import { resolveRootIds } from './timelineTree'

// The real chain in the founder's data, as of 2026-09-04:
//   welcome -> reception -> wedding
const wedding = 'wedding'
const reception = 'reception'
const welcome = 'welcome'

describe('resolveRootIds', () => {
  it('flattens a three-deep chain onto the top ancestor', () => {
    const parents = new Map([
      [reception, wedding],
      [welcome, reception],
    ])
    const roots = resolveRootIds(parents, new Set([wedding, reception, welcome]))
    expect(roots.get(wedding)).toBe(wedding)
    expect(roots.get(reception)).toBe(wedding)
    // The grandchild lands beside its parent under the wedding, not nested inside it.
    expect(roots.get(welcome)).toBe(wedding)
  })

  it('climbs past an ancestor that is missing from the page', () => {
    // `reception` has no date, so Calendar never loaded it — but the wedding did load, and the
    // welcome party belongs under it rather than floating loose.
    const parents = new Map([
      [reception, wedding],
      [welcome, reception],
    ])
    const roots = resolveRootIds(parents, new Set([wedding, welcome]))
    expect(roots.get(welcome)).toBe(wedding)
    expect(roots.has(reception)).toBe(false)
  })

  it('leaves a node as its own root when no ancestor is present', () => {
    // A dateless parent with dated children: the children have to stay visible as top-level rows.
    const parents = new Map([[welcome, reception]])
    const roots = resolveRootIds(parents, new Set([welcome]))
    expect(roots.get(welcome)).toBe(welcome)
  })

  it('terminates on a cycle instead of hanging the page', () => {
    // The DB CHECK only rejects a row being its OWN direct parent, so A -> B -> A is storable.
    const parents = new Map([
      ['a', 'b'],
      ['b', 'a'],
    ])
    const roots = resolveRootIds(parents, new Set(['a', 'b']))
    expect(roots.get('a')).toBe('b')
    expect(roots.get('b')).toBe('a')
  })

  it('treats an empty parent map as "nothing is a sub-event"', () => {
    // fetchMomentParentIds fails open to an empty map, which must degrade to a flat timeline.
    const roots = resolveRootIds(new Map(), new Set([wedding, reception]))
    expect(roots.get(wedding)).toBe(wedding)
    expect(roots.get(reception)).toBe(reception)
  })
})
