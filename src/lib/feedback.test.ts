import { describe, expect, it } from 'vitest'
import { formatFeedbackNotesForExport, type FeedbackNote } from './feedback'

function note(over: Partial<FeedbackNote> & { note: string }): FeedbackNote {
  return {
    id: crypto.randomUUID(),
    page_label: 'Home',
    element_label: null,
    status: 'open',
    created_at: '2026-08-27T12:00:00Z',
    ...over,
  }
}

describe('formatFeedbackNotesForExport', () => {
  it('says so plainly when there is nothing open', () => {
    expect(formatFeedbackNotesForExport([])).toBe('No open feedback notes.')
  })

  it('groups by page and counts what it exported', () => {
    const text = formatFeedbackNotesForExport(
      [
        note({ page_label: 'Home', note: 'first' }),
        note({ page_label: 'Look through events', note: 'second' }),
        note({ page_label: 'Home', note: 'third' }),
      ],
      new Date('2026-08-30T09:00:00'),
    )

    expect(text.split('\n')[0]).toBe('Grove feedback notes — 3 open, exported 2026-08-30')
    expect(text).toContain('## Home (2)')
    expect(text).toContain('## Look through events (1)')
    expect(text.indexOf('## Home')).toBeLessThan(text.indexOf('## Look through events'))
  })

  it('reads oldest-first within a page — the order the problems were hit', () => {
    const text = formatFeedbackNotesForExport([
      note({ note: 'newer', created_at: '2026-08-27T12:00:00Z' }),
      note({ note: 'older', created_at: '2026-08-03T12:00:00Z' }),
    ])
    expect(text.indexOf('older')).toBeLessThan(text.indexOf('newer'))
  })

  it('dates every note and keeps the element it was left on', () => {
    const text = formatFeedbackNotesForExport([
      note({ note: 'too long', element_label: '<button> "Remind Me" (in div > div)' }),
    ])
    expect(text).toMatch(/^- \[\d{4}-\d{2}-\d{2}\] too long$/m)
    expect(text).toContain('  on: <button> "Remind Me" (in div > div)')
  })

  it('leaves out the element line when the note has no element', () => {
    expect(formatFeedbackNotesForExport([note({ note: 'no element' })])).not.toContain('on:')
  })

  it('indents a multi-line note so it still reads as one bullet', () => {
    const text = formatFeedbackNotesForExport([note({ note: 'line one\nline two' })])
    expect(text).toContain('line one\n  line two')
  })

  it('sorts the unlabelled bucket last however many pages there are', () => {
    const text = formatFeedbackNotesForExport([
      note({ page_label: null, note: 'orphan' }),
      note({ page_label: 'Zebra page', note: 'zebra' }),
      note({ page_label: 'Alpha page', note: 'alpha' }),
    ])
    const order = ['## Alpha page', '## Zebra page', '## Unlabelled page'].map((h) => text.indexOf(h))
    expect(order).toEqual([...order].sort((a, b) => a - b))
    expect(order.every((i) => i >= 0)).toBe(true)
  })

  it('treats a whitespace-only page label as unlabelled', () => {
    expect(formatFeedbackNotesForExport([note({ page_label: '   ', note: 'blank' })])).toContain('## Unlabelled page (1)')
  })

  it('survives a timestamp it cannot parse rather than printing "Invalid Date"', () => {
    const text = formatFeedbackNotesForExport([note({ note: 'broken clock', created_at: 'not a date' })])
    expect(text).toContain('- [undated] broken clock')
  })
})
