import { describe, expect, it } from 'vitest'
import { decorateMoments, firstPastMomentId, groupMomentsByYear, type Moment } from './Events'
import { compareEventsNewestFirst } from '../lib/dates'

// The Events list runs newest-first, so imported calendar events — real events with real future
// dates — stack up above everything that has actually happened. These cover where the Today line
// lands in that list, including the two ends where there is nothing on one side of it.

const NOW = new Date('2026-09-04T12:00:00')

const moment = (id: string, event_date: string | null, event_end_date: string | null = null): Moment =>
  ({
    id,
    occasion: `Event ${id}`,
    raw_description: null,
    when_text: null,
    event_date,
    event_end_date,
    location: null,
    parent_moment_id: null,
    created_at: '2026-01-01T00:00:00Z',
    notes: [],
    moment_groups: [],
    moment_tags: [],
  }) as unknown as Moment

// Mirrors what the page does: sort newest-first, then decorate.
const listOf = (...moments: Moment[]) =>
  decorateMoments([...moments].sort(compareEventsNewestFirst))

describe('firstPastMomentId', () => {
  it('marks the first event that has already finished', () => {
    const list = listOf(
      moment('future-far', '2026-12-25'),
      moment('future-near', '2026-09-20'),
      moment('past-recent', '2026-08-30'),
      moment('past-old', '2025-04-01'),
    )
    expect(list.map((d) => d.moment.id)).toEqual(['future-far', 'future-near', 'past-recent', 'past-old'])
    expect(firstPastMomentId(list, NOW)).toBe('past-recent')
  })

  it('treats an event happening today as not yet past', () => {
    const list = listOf(moment('today', '2026-09-04'), moment('yesterday', '2026-09-03'))
    expect(firstPastMomentId(list, NOW)).toBe('yesterday')
  })

  it('treats a multi-day event still running today as not yet past', () => {
    const list = listOf(moment('trip', '2026-09-01', '2026-09-08'), moment('before', '2026-08-01'))
    expect(firstPastMomentId(list, NOW)).toBe('before')
  })

  it('returns null when everything on screen is still upcoming', () => {
    const list = listOf(moment('a', '2026-10-01'), moment('b', '2026-11-01'))
    expect(firstPastMomentId(list, NOW)).toBeNull()
  })

  it('points at the very first card when everything has already happened', () => {
    const list = listOf(moment('a', '2026-08-01'), moment('b', '2026-07-01'))
    expect(firstPastMomentId(list, NOW)).toBe('a')
  })

  it('returns null for an empty list rather than throwing', () => {
    expect(firstPastMomentId([], NOW)).toBeNull()
  })

  // The line is placed by id during the year-grouped render, so the id it names has to actually
  // exist in exactly one group — otherwise the divider silently never renders.
  it('names an id that appears exactly once in the year grouping', () => {
    const list = listOf(
      moment('future', '2027-01-10'),
      moment('past-2026', '2026-08-30'),
      moment('past-2025', '2025-04-01'),
    )
    const boundary = firstPastMomentId(list, NOW)
    const hits = groupMomentsByYear(list)
      .flatMap((g) => g.items)
      .filter((d) => d.moment.id === boundary)
    expect(boundary).toBe('past-2026')
    expect(hits).toHaveLength(1)
  })
})
