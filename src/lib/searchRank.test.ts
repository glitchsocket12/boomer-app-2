import { describe, expect, it } from 'vitest'
import { rankSearchMatches } from './searchRank'

const item = (label: string) => ({ id: label, label })
const labels = (items: { label: string }[]) => items.map((i) => i.label)

describe('rankSearchMatches', () => {
  it('puts the parent group ahead of its subgroups', () => {
    // The reported bug: typing the parent's name only ever surfaced its children.
    const groups = [
      item('98 FTS / 2016'),
      item('98 FTS / 2017'),
      item('98 FTS / 2018'),
      item('98 FTS'),
      item('98 FTS / 2019'),
    ]
    expect(rankSearchMatches(groups, '98 FTS', 10).results[0].label).toBe('98 FTS')
  })

  it('keeps the parent even when the cap is smaller than the number of subgroups', () => {
    // Ten children and a cap of three: unranked, the parent was cut off entirely.
    const groups = [
      ...Array.from({ length: 10 }, (_, i) => item(`98 FTS / 20${10 + i}`)),
      item('98 FTS'),
    ]
    const { results, truncated } = rankSearchMatches(groups, '98 fts', 3)
    expect(labels(results)[0]).toBe('98 FTS')
    expect(results).toHaveLength(3)
    expect(truncated).toBe(true)
  })

  it('ranks a group whose own name matches above one that only inherits it from a parent', () => {
    const groups = [item('98 FTS / 2016'), item('Reunions / 98 FTS')]
    expect(labels(rankSearchMatches(groups, '98 FTS', 10).results)).toEqual([
      'Reunions / 98 FTS',
      '98 FTS / 2016',
    ])
  })

  it('is case-insensitive and ignores surrounding whitespace', () => {
    expect(rankSearchMatches([item('98 FTS')], '  98 fts  ', 10).results).toHaveLength(1)
  })

  it('prefers a word-start match over a mid-word one', () => {
    expect(labels(rankSearchMatches([item('Viking Club'), item('Ann King')], 'king', 10).results)).toEqual([
      'Ann King',
      'Viking Club',
    ])
  })

  it('still lets a label that starts with the query win outright', () => {
    // Standard autocomplete precedence: what you typed at the very front beats the same letters
    // starting a later word.
    expect(labels(rankSearchMatches([item('Ann King'), item('Kingston')], 'king', 10).results)).toEqual([
      'Kingston',
      'Ann King',
    ])
  })

  it('breaks ties toward the shorter label', () => {
    expect(labels(rankSearchMatches([item('98 FTS Reunion Committee'), item('98 FTS')], '98', 10).results)).toEqual([
      '98 FTS',
      '98 FTS Reunion Committee',
    ])
  })

  it('reports truncated:false when everything fits', () => {
    expect(rankSearchMatches([item('98 FTS')], '98', 10).truncated).toBe(false)
  })

  it('returns nothing for an empty query', () => {
    expect(rankSearchMatches([item('98 FTS')], '   ', 10)).toEqual({ results: [], truncated: false })
  })

  it('does not blow up on regex characters in the query', () => {
    // The word-boundary tier builds a RegExp from the query — an unescaped "(" would throw.
    expect(labels(rankSearchMatches([item('Smith (family)')], '(fam', 10).results)).toEqual(['Smith (family)'])
  })
})
