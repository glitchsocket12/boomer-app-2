import { describe, expect, it } from 'vitest'
import { formatEventDateText } from './eventDates.ts'

// The output is persisted into `moments.when_text` once, server-side, so these strings are what the
// founder reads on the Events list forever after — worth pinning exactly.
describe('formatEventDateText', () => {
  it('writes a single day in full', () => {
    expect(formatEventDateText('2026-08-12', null)).toBe('August 12, 2026')
  })

  it('treats an end date equal to the start as a single day', () => {
    expect(formatEventDateText('2026-08-12', '2026-08-12')).toBe('August 12, 2026')
  })

  it('collapses a range inside one month to one month name', () => {
    expect(formatEventDateText('2027-06-17', '2027-06-19')).toBe('June 17–19, 2027')
  })

  it('keeps both months for a range that crosses one, without repeating the year', () => {
    expect(formatEventDateText('2026-08-30', '2026-09-02')).toBe('August 30 – September 2, 2026')
  })

  it('spells out both years for a range that crosses new year', () => {
    expect(formatEventDateText('2026-12-30', '2027-01-02')).toBe('December 30, 2026 – January 2, 2027')
  })

  it('reads dates as UTC, so a date never slips a day', () => {
    // The bug this guards: parsing "2026-01-01" in a negative-offset local zone lands on Dec 31.
    expect(formatEventDateText('2026-01-01', null)).toBe('January 1, 2026')
    expect(formatEventDateText('2026-12-31', null)).toBe('December 31, 2026')
  })
})
