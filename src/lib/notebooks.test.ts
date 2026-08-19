import { describe, expect, it } from 'vitest'
import { isMissingTable, sortEntries } from './notebooks'

describe('sortEntries', () => {
  it('puts the newest first', () => {
    const rows = [
      { id: 'old', entry_date: '2026-08-02', created_at: '2026-08-02T00:00:00Z' },
      { id: 'new', entry_date: '2026-08-16', created_at: '2026-08-16T00:00:00Z' },
    ]
    expect(sortEntries(rows).map((r) => r.id)).toEqual(['new', 'old'])
  })

  it('ranks an undated entry by when it was written, not below every dated one', () => {
    // The mixed case is the one that matters: a notebook is usually all-dated or all-undated, but
    // an undated movie added today must not sink beneath a log entry dated last year.
    const rows = [
      { id: 'dated-last-year', entry_date: '2025-09-01', created_at: '2025-09-01T00:00:00Z' },
      { id: 'undated-today', entry_date: null, created_at: '2026-08-18T00:00:00Z' },
      { id: 'dated-last-week', entry_date: '2026-08-11', created_at: '2026-08-11T00:00:00Z' },
    ]
    expect(sortEntries(rows).map((r) => r.id)).toEqual(['undated-today', 'dated-last-week', 'dated-last-year'])
  })

  it('does not mutate its input', () => {
    const rows = [
      { id: 'a', entry_date: '2026-01-01', created_at: '2026-01-01T00:00:00Z' },
      { id: 'b', entry_date: '2026-06-01', created_at: '2026-06-01T00:00:00Z' },
    ]
    sortEntries(rows)
    expect(rows.map((r) => r.id)).toEqual(['a', 'b'])
  })
})

describe('isMissingTable', () => {
  it('recognises both shapes PostgREST reports a missing table as', () => {
    expect(isMissingTable({ message: 'relation "public.notebooks" does not exist' })).toBe(true)
    expect(isMissingTable({ message: "Could not find the table 'public.notebook_entries' in the schema cache" })).toBe(
      true
    )
  })

  it('is false for a real error, so a genuine failure is never shown as "not switched on yet"', () => {
    expect(isMissingTable({ message: 'new row violates row-level security policy for table "notebooks"' })).toBe(false)
    expect(isMissingTable({ message: 'relation "public.pets" does not exist' })).toBe(false)
    expect(isMissingTable(null)).toBe(false)
  })
})
