import { describe, it, expect } from 'vitest'
import { parseSubEventLine, parseSummaryBlocks, hasSubEventBlocks } from './summaryFormat'

// A trimmed-down copy of the real "Defenders of Freedom Demo" summary that prompted this — the
// event that read as a wall of text before the sub-event lines were given their own styling.
const REAL_SUMMARY = [
  'The Defenders of Freedom Air Show ran from August 6-9, 2026 at Offutt AFB in Omaha, Nebraska, and turned into a busy few days of demo flying.',
  '',
  "Aug 6 · First night with Jesse and Mojo — I went to Mazza in Omaha for a family-style dinner with Jesse Waldron and Patrick Mojica.",
  'Aug 8 · Visit with Mike Smith & Family — I reunited with pilot training buddy Mike Smith and his family — wife Ariel and the kids — and gave him a tour of the Otter.',
].join('\n')

describe('parseSubEventLine', () => {
  it('splits a line into date, title and body', () => {
    expect(parseSubEventLine('Aug 7 · Day 1 — I flew my first demo in the Twin Otter.')).toEqual({
      date: 'Aug 7',
      title: 'Day 1',
      body: 'I flew my first demo in the Twin Otter.',
    })
  })

  it('splits on the first dash, so an em dash inside the sentence stays in the body', () => {
    const parsed = parseSubEventLine(
      'Aug 8 · Visit with Mike Smith & Family — I reunited with Mike and his family — wife Ariel and the kids — and gave him a tour.'
    )
    expect(parsed?.title).toBe('Visit with Mike Smith & Family')
    expect(parsed?.body).toBe('I reunited with Mike and his family — wife Ariel and the kids — and gave him a tour.')
  })

  it('accepts the date the prompt uses when a sub-event has no date', () => {
    expect(parseSubEventLine('Date not set · Somewhere — Something happened.')?.date).toBe('Date not set')
  })

  it('accepts an en dash or a spaced hyphen as the separator', () => {
    expect(parseSubEventLine('Aug 7 · Day 1 – Something happened.')?.body).toBe('Something happened.')
    expect(parseSubEventLine('Aug 7 · Day 1 - Something happened.')?.body).toBe('Something happened.')
  })

  it('rejects prose that happens to contain a separator', () => {
    expect(
      parseSubEventLine('We drove out to the lake · which took an hour — and then set up the tent.')
    ).toBeNull()
  })

  it('rejects a line missing either separator, or with an empty half', () => {
    expect(parseSubEventLine('Aug 7 · Day 1')).toBeNull()
    expect(parseSubEventLine('Aug 7 — I flew my first demo.')).toBeNull()
    expect(parseSubEventLine('Aug 7 ·  — I flew my first demo.')).toBeNull()
    expect(parseSubEventLine('Aug 7 · Day 1 — ')).toBeNull()
  })
})

describe('parseSummaryBlocks', () => {
  it('separates the overview paragraph from the sub-event lines', () => {
    const blocks = parseSummaryBlocks(REAL_SUMMARY)
    expect(blocks.map((b) => b.kind)).toEqual(['paragraph', 'subEvent', 'subEvent'])
    expect(blocks[1]).toMatchObject({ date: 'Aug 6', title: 'First night with Jesse and Mojo' })
    expect(blocks[2]).toMatchObject({ date: 'Aug 8', title: 'Visit with Mike Smith & Family' })
    expect(hasSubEventBlocks(blocks)).toBe(true)
  })

  it('leaves an ordinary prose summary as plain paragraphs', () => {
    const blocks = parseSummaryBlocks('We went to the lake.\nIt rained all afternoon.\n\nThen we drove home.')
    expect(blocks).toEqual([
      { kind: 'paragraph', text: 'We went to the lake.\nIt rained all afternoon.' },
      { kind: 'paragraph', text: 'Then we drove home.' },
    ])
    expect(hasSubEventBlocks(blocks)).toBe(false)
  })

  it('handles an empty summary', () => {
    expect(parseSummaryBlocks('')).toEqual([])
    expect(hasSubEventBlocks([])).toBe(false)
  })
})
