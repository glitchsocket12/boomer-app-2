import { describe, expect, it } from 'vitest'
import {
  compareEventsNewestFirst,
  eventSortDate,
  eventSortEndDate,
  formatMonthYear,
  formatDateRange,
  formatFullDate,
  formatEventWhen,
} from './dates'

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

describe('eventSortEndDate', () => {
  const created_at = '2026-07-01T12:00:00Z'

  it('uses event_end_date when it is after the start', () => {
    const result = eventSortEndDate({ event_date: '2026-08-26', event_end_date: '2026-08-30', created_at })
    expect(result.getMonth()).toBe(7)
    expect(result.getDate()).toBe(30)
  })

  it('falls back to the start date when there is no end date', () => {
    const result = eventSortEndDate({ event_date: '2026-08-27', event_end_date: null, created_at })
    expect(result.getDate()).toBe(27)
  })

  it('ignores an end date stored before its start', () => {
    const result = eventSortEndDate({ event_date: '2026-09-12', event_end_date: '2026-08-15', created_at })
    expect(result.getMonth()).toBe(8)
    expect(result.getDate()).toBe(12)
  })

  it('falls back to created_at when there is no event_date at all', () => {
    const result = eventSortEndDate({ event_date: null, event_end_date: '2026-08-30', created_at })
    expect(result.toISOString()).toBe(new Date(created_at).toISOString())
  })
})

describe('compareEventsNewestFirst', () => {
  const created_at = '2026-07-01T12:00:00Z'
  const occasions = (list: { occasion: string; event_date: string | null; event_end_date?: string | null }[]) =>
    [...list].map((m) => ({ ...m, created_at })).sort(compareEventsNewestFirst).map((m) => m.occasion)

  // The founder's case (2026-09-03): a visit that ran Aug 26–30 was sorting below a single day on
  // Aug 27, because it *started* first.
  it('puts a still-running trip above a shorter event that started later', () => {
    expect(
      occasions([
        { occasion: 'Air museum', event_date: '2026-08-27', event_end_date: null },
        { occasion: 'Mary Alice visit', event_date: '2026-08-26', event_end_date: '2026-08-30' },
      ])
    ).toEqual(['Mary Alice visit', 'Air museum'])
  })

  it('breaks a tie on the end date with the later start date', () => {
    expect(
      occasions([
        { occasion: 'Long trip', event_date: '2026-08-26', event_end_date: '2026-08-30' },
        { occasion: 'Last-day dinner', event_date: '2026-08-30', event_end_date: null },
      ])
    ).toEqual(['Last-day dinner', 'Long trip'])
  })

  it('still orders single-day events newest first', () => {
    expect(
      occasions([
        { occasion: 'Older', event_date: '2026-03-15', event_end_date: null },
        { occasion: 'Newer', event_date: '2026-05-02', event_end_date: null },
      ])
    ).toEqual(['Newer', 'Older'])
  })

  it('is unaffected by an end date that predates its start', () => {
    expect(
      occasions([
        { occasion: 'Backwards dates', event_date: '2026-09-12', event_end_date: '2026-08-15' },
        { occasion: 'Early September', event_date: '2026-09-05', event_end_date: null },
      ])
    ).toEqual(['Backwards dates', 'Early September'])
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
