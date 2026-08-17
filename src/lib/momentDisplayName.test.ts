import { describe, expect, it } from 'vitest'
import { momentDisplayName, momentPickerLabel, momentTitle } from './momentDisplayName'

// A trip with two days under it, plus an unrelated root event.
const rows = [
  { id: 'trip', occasion: 'Steamboat Trip', raw_description: '', event_date: '2026-06-10', event_end_date: '2026-06-14', created_at: '2026-01-01T00:00:00Z' },
  { id: 'hs', occasion: 'Strawberry Park Hot Springs', raw_description: '', event_date: '2026-06-12', event_end_date: null, created_at: '2026-01-01T00:00:00Z' },
  { id: 'ski', occasion: 'Ski day', raw_description: '', event_date: '2026-06-11', event_end_date: null, created_at: '2026-01-01T00:00:00Z' },
  { id: 'wed', occasion: 'Sid and Kate wedding', raw_description: '', event_date: null, event_end_date: null, created_at: '2026-01-01T00:00:00Z' },
]
const titleById = new Map(rows.map((r) => [r.id, momentTitle(r)]))
const parentById = new Map<string, string | null>([
  ['hs', 'trip'],
  ['ski', 'trip'],
])

describe('momentDisplayName', () => {
  it('returns a bare title for a top-level event', () => {
    expect(momentDisplayName(rows[0], titleById, parentById)).toBe('Steamboat Trip')
  })

  it('prefixes the parent event for a sub-event', () => {
    expect(momentDisplayName(rows[1], titleById, parentById)).toBe('Steamboat Trip / Strawberry Park Hot Springs')
  })

  it('reads parentage off the row when the map does not have it', () => {
    // Pages that DO select parent_moment_id (rather than the isolated fail-open query) still label
    // correctly — otherwise a page would silently show bare names depending on how it fetched.
    const orphanMap = new Map<string, string | null>()
    expect(momentDisplayName({ ...rows[1], parent_moment_id: 'trip' }, titleById, orphanMap)).toBe(
      'Steamboat Trip / Strawberry Park Hot Springs'
    )
  })

  it('truncates rather than blanking when the parent is missing from the list', () => {
    // e.g. Calendar's picker, whose moments query drops events with no date — the parent may not
    // be in the map the labels were built from.
    const partial = new Map([['hs', 'Strawberry Park Hot Springs']])
    expect(momentDisplayName(rows[1], partial, parentById)).toBe('Strawberry Park Hot Springs')
  })

  it('terminates on a cycle instead of hanging', () => {
    // The DB CHECK only rejects an event being its own DIRECT parent, so A -> B -> A survives it.
    const cyclic = new Map<string, string | null>([
      ['a', 'b'],
      ['b', 'a'],
    ])
    const titles = new Map([
      ['a', 'A'],
      ['b', 'B'],
    ])
    expect(momentDisplayName({ id: 'a', occasion: 'A', raw_description: '' }, titles, cyclic)).toBe('B / A')
  })

  it('falls back to the description, then to Untitled moment', () => {
    expect(momentTitle({ id: 'x', occasion: null, raw_description: 'we went bowling' })).toBe('we went bowling')
    expect(momentTitle({ id: 'x', occasion: null, raw_description: '' })).toBe('Untitled moment')
  })
})

describe('momentPickerLabel', () => {
  it('appends the event date so same-named events are still distinguishable', () => {
    expect(momentPickerLabel(rows[1], titleById, parentById)).toBe(
      'Steamboat Trip / Strawberry Park Hot Springs — June 12, 2026'
    )
  })

  it('renders a multi-day parent as a range', () => {
    expect(momentPickerLabel(rows[0], titleById, parentById)).toBe('Steamboat Trip — June 10–14, 2026')
  })

  it('shows no date at all when the event has none', () => {
    // Never the created_at fallback: the day a row was imported is not the day it happened, and a
    // wrong date in a picker is worse than no date.
    expect(momentPickerLabel(rows[3], titleById, parentById)).toBe('Sid and Kate wedding')
  })
})
