import { describe, expect, it } from 'vitest'
import { sanitizeIsoDate } from './dateValidation.ts'

// This is the guard standing between a hallucinated model date and a column the Events list sorts
// and displays by, so the cases that matter are the ones that LOOK valid and aren't.
describe('sanitizeIsoDate', () => {
  it('passes a real date through unchanged', () => {
    expect(sanitizeIsoDate('2026-08-12')).toBe('2026-08-12')
  })

  it('accepts a genuine leap day and rejects one in a non-leap year', () => {
    expect(sanitizeIsoDate('2024-02-29')).toBe('2024-02-29')
    // Date.UTC rolls this to March 1 rather than throwing — the round-trip check is what catches it.
    expect(sanitizeIsoDate('2023-02-29')).toBeNull()
  })

  it('rejects an out-of-range day or month that still matches the format', () => {
    expect(sanitizeIsoDate('2026-04-31')).toBeNull()
    expect(sanitizeIsoDate('2026-13-01')).toBeNull()
    expect(sanitizeIsoDate('2026-00-10')).toBeNull()
    expect(sanitizeIsoDate('2026-08-00')).toBeNull()
  })

  it('rejects anything not in strict YYYY-MM-DD shape', () => {
    expect(sanitizeIsoDate('2026-8-12')).toBeNull()
    expect(sanitizeIsoDate('08/12/2026')).toBeNull()
    expect(sanitizeIsoDate('2026-08-12T00:00:00Z')).toBeNull()
    expect(sanitizeIsoDate('')).toBeNull()
  })

  it('rejects non-strings, including the values a missing JSON field arrives as', () => {
    expect(sanitizeIsoDate(null)).toBeNull()
    expect(sanitizeIsoDate(undefined)).toBeNull()
    expect(sanitizeIsoDate(20260812)).toBeNull()
    expect(sanitizeIsoDate({ date: '2026-08-12' })).toBeNull()
  })

  it('applies the sanity bounds without rejecting real old memories or near-future plans', () => {
    expect(sanitizeIsoDate('0002-01-01')).toBeNull()
    expect(sanitizeIsoDate('9999-12-31')).toBeNull()
    expect(sanitizeIsoDate('1900-01-01')).toBe('1900-01-01')
    expect(sanitizeIsoDate('1899-12-31')).toBeNull()
    expect(sanitizeIsoDate('2100-12-31')).toBe('2100-12-31')
    expect(sanitizeIsoDate('2101-01-01')).toBeNull()
  })
})
