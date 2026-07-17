import { describe, expect, it } from 'vitest'
import { eventSortDate, formatMonthYear } from './dates'

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
