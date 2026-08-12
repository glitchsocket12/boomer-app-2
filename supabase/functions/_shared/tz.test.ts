import { describe, expect, it } from 'vitest'
import { fullDateInTimeZone, isoDateInTimeZone } from './tz.ts'

// Edge Functions run in UTC, so "today" is wrong for most of the founder's evening. These two
// helpers are the fix, and the case that matters is exactly the one where the UTC date has already
// rolled over and the local one hasn't.
describe('isoDateInTimeZone', () => {
  it('returns the local calendar date, not the UTC one, after UTC midnight', () => {
    const justAfterUtcMidnight = new Date('2026-08-13T03:00:00Z')
    expect(justAfterUtcMidnight.toISOString().slice(0, 10)).toBe('2026-08-13')
    expect(isoDateInTimeZone(justAfterUtcMidnight, 'America/Denver')).toBe('2026-08-12')
  })

  it('returns the same date when the zone is UTC', () => {
    expect(isoDateInTimeZone(new Date('2026-08-12T12:00:00Z'), 'UTC')).toBe('2026-08-12')
  })

  it('handles a zone ahead of UTC rolling forward', () => {
    expect(isoDateInTimeZone(new Date('2026-08-12T23:00:00Z'), 'Asia/Tokyo')).toBe('2026-08-13')
  })

  it('falls back to the UTC date rather than throwing on a corrupt zone', () => {
    expect(isoDateInTimeZone(new Date('2026-08-12T12:00:00Z'), 'Not/AZone')).toBe('2026-08-12')
  })
})

describe('fullDateInTimeZone', () => {
  it('spells out the local date', () => {
    expect(fullDateInTimeZone(new Date('2026-08-12T18:00:00Z'), 'America/Denver')).toBe(
      'Wednesday, August 12, 2026'
    )
  })

  it('uses the local day when UTC has already rolled over', () => {
    expect(fullDateInTimeZone(new Date('2026-08-13T03:00:00Z'), 'America/Denver')).toBe(
      'Wednesday, August 12, 2026'
    )
  })

  it('falls back instead of throwing on a corrupt zone', () => {
    expect(fullDateInTimeZone(new Date('2026-08-12T12:00:00Z'), 'Not/AZone')).toBe(
      new Date('2026-08-12T12:00:00Z').toDateString()
    )
  })
})
