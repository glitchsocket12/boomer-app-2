import { describe, expect, it } from 'vitest'
import { eventSortDate, formatMonthYear, formatDateRange, formatFullDate, formatEventWhen } from './dates'

describe('eventSortDate', () => {
  it('uses event_date when set', () => {
    const result = eventSortDate({ event_date: '2026-03-15', created_at: '2026-07-01T12:00:00Z' })
    expect(result.getFullYear()).toBe(2026)
    expect(result.getMonth()).toBe(2) // March = index 2
    expect(result.getDate()).toBe(15)
  })

  it('falls back to created_at when event_date is null', () => {
    const result = eventSortDate({ event_date: null, created_at: '2025-11-02T08:30:00Z' })
    expect(result.toISOString()).toBe(new Date('2025-11-02T08:30:00Z').toISOString())
  })

  it('parses event_date as local midnight, not UTC midnight', () => {
    // A bare "YYYY-MM-DD" is parsed as UTC by Date and can roll back to the
    // previous day once displayed in a negative-UTC timezone. Appending
    // "T00:00:00" (no "Z") forces local-time parsing instead, so the
    // calendar date always matches what was stored, in any timezone.
    const result = eventSortDate({ event_date: '2026-01-01', created_at: '2026-01-01T00:00:00Z' })
    expect(result.getDate()).toBe(1)
    expect(result.getMonth()).toBe(0)
    expect(result.getFullYear()).toBe(2026)
  })
})

describe('formatMonthYear', () => {
  it('formats an event_date as "Month Year"', () => {
    expect(formatMonthYear({ event_date: '2026-03-15', created_at: '2026-07-01T12:00:00Z' })).toBe('March 2026')
  })

  it('falls back to created_at when event_date is missing', () => {
    expect(formatMonthYear({ event_date: null, created_at: '2025-11-02T08:30:00Z' })).toBe('November 2025')
  })
})

describe('formatDateRange', () => {
  it('formats a single day when endIso is null', () => {
    expect(formatDateRange('2026-08-15', null)).toBe('August 15, 2026')
  })

  it('formats a single day when endIso equals startIso', () => {
    expect(formatDateRange('2026-08-15', '2026-08-15')).toBe('August 15, 2026')
  })

  it('formats a same-month range', () => {
    expect(formatDateRange('2026-08-15', '2026-08-20')).toBe('August 15–20, 2026')
  })

  it('formats a cross-month, same-year range', () => {
    expect(formatDateRange('2026-08-28', '2026-09-02')).toBe('August 28 – September 2, 2026')
  })

  it('formats a cross-year range', () => {
    expect(formatDateRange('2026-12-28', '2027-01-03')).toBe('December 28, 2026 – January 3, 2027')
  })
})

describe('formatFullDate with event_end_date', () => {
  it('is unchanged when event_end_date is null', () => {
    expect(formatFullDate({ event_date: '2026-03-15', event_end_date: null, created_at: '2026-07-01T12:00:00Z' })).toBe('March 15, 2026')
  })

  it('is unchanged when event_end_date equals event_date', () => {
    expect(formatFullDate({ event_date: '2026-03-15', event_end_date: '2026-03-15', created_at: '2026-07-01T12:00:00Z' })).toBe(
      'March 15, 2026'
    )
  })

  it('renders a range when event_end_date differs', () => {
    expect(formatFullDate({ event_date: '2026-03-15', event_end_date: '2026-03-18', created_at: '2026-07-01T12:00:00Z' })).toBe(
      'March 15–18, 2026'
    )
  })
})

describe('formatEventWhen with event_end_date', () => {
  it('includes the day when event_end_date is null', () => {
    expect(
      formatEventWhen({ event_date: '2026-03-15', event_end_date: null, when_text: 'mid-March', created_at: '2026-07-01T12:00:00Z' })
    ).toBe('March 15, 2026')
  })

  it('renders a range when event_end_date differs', () => {
    expect(
      formatEventWhen({ event_date: '2026-03-15', event_end_date: '2026-03-18', when_text: 'mid-March', created_at: '2026-07-01T12:00:00Z' })
    ).toBe('March 15–18, 2026')
  })
})
