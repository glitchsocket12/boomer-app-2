import { describe, expect, it } from 'vitest'
import { normalizeLinkPair, relatedIdsFromLinks } from './relatedEvents'

describe('normalizeLinkPair', () => {
  it('sorts the pair so either direction produces the same row', () => {
    expect(normalizeLinkPair('a', 'b')).toEqual(['a', 'b'])
    expect(normalizeLinkPair('b', 'a')).toEqual(['a', 'b'])
  })

  // The whole point of storing one row per pair: linking from either event must collide on the
  // unique index instead of writing a second, invisible duplicate.
  it('is stable whichever event the link was started from', () => {
    const fromWedding = normalizeLinkPair('wedding', 'rehearsal')
    const fromRehearsal = normalizeLinkPair('rehearsal', 'wedding')
    expect(fromWedding).toEqual(fromRehearsal)
  })
})

describe('relatedIdsFromLinks', () => {
  it('returns the far side of each link regardless of which column this event sits in', () => {
    const rows = [
      { moment_a_id: 'this', moment_b_id: 'other-1' },
      { moment_a_id: 'other-2', moment_b_id: 'this' },
    ]
    expect(relatedIdsFromLinks(rows, 'this').sort()).toEqual(['other-1', 'other-2'])
  })

  it('de-duplicates, so two rows naming the same pair render one tile', () => {
    const rows = [
      { moment_a_id: 'this', moment_b_id: 'other' },
      { moment_a_id: 'other', moment_b_id: 'this' },
    ]
    expect(relatedIdsFromLinks(rows, 'this')).toEqual(['other'])
  })

  // A self-link can't be written (the CHECK rules it out) — filtered anyway, since the failure
  // mode is an event rendering itself in its own Related Events list.
  it('never returns the event itself', () => {
    expect(relatedIdsFromLinks([{ moment_a_id: 'this', moment_b_id: 'this' }], 'this')).toEqual([])
  })

  it('returns nothing for an event with no links', () => {
    expect(relatedIdsFromLinks([], 'this')).toEqual([])
  })
})
