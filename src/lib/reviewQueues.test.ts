import { describe, expect, it } from 'vitest'
import { DEFER_DAYS, EMPTY_COUNTS, REMIND_OPTIONS, deferUntilIso, reviewTotal, todayIso } from './reviewQueues'

describe('todayIso', () => {
  it('formats the browser-local calendar day, not a UTC instant', () => {
    // 11pm local on the 19th is already the 20th in UTC. A `date` column compares against the day
    // the founder is actually living in, so toISOString() would set things aside a day early.
    expect(todayIso(new Date(2026, 7, 19, 23, 30))).toBe('2026-08-19')
    expect(todayIso(new Date(2026, 0, 5, 0, 1))).toBe('2026-01-05')
  })

  it('zero-pads month and day', () => {
    expect(todayIso(new Date(2026, 8, 9))).toBe('2026-09-09')
  })
})

describe('deferUntilIso', () => {
  it('rolls over the month and the year', () => {
    expect(deferUntilIso(new Date(2026, 7, 19))).toBe('2026-09-18')
    expect(deferUntilIso(new Date(2026, 11, 20))).toBe('2027-01-19')
  })

  it('counts calendar days, so a short month still lands on a real date', () => {
    // 30 days from Jan 31 is Mar 2 in a non-leap year — adding a month to the month number would
    // have produced Feb 31.
    expect(deferUntilIso(new Date(2026, 0, 31))).toBe('2026-03-02')
  })

  it('is always DEFER_DAYS ahead of the same day', () => {
    const now = new Date(2026, 4, 1)
    const until = new Date(`${deferUntilIso(now)}T00:00:00`)
    expect(Math.round((until.getTime() - now.getTime()) / 86_400_000)).toBe(DEFER_DAYS)
  })
})

describe('reviewTotal', () => {
  it('sums every queue that is actually waiting on the founder', () => {
    expect(
      reviewTotal({
        ...EMPTY_COUNTS,
        calendarToTriage: 200,
        calendarToReview: 14,
        birthdays: 3,
        contactsToTriage: 40,
        contactsToReview: 2,
        photos: 1,
      })
    ).toBe(260)
  })

  it('leaves set-aside out — "Not now" has to actually take it off your plate', () => {
    expect(reviewTotal({ ...EMPTY_COUNTS, calendarToReview: 5, calendarSetAside: 100 })).toBe(5)
  })

  it('is 0 when everything is clear', () => {
    expect(reviewTotal(EMPTY_COUNTS)).toBe(0)
  })
})

describe('REMIND_OPTIONS', () => {
  it('every offered interval lands on a real future date', () => {
    // Jan 31 is the trap: adding a month to the month number would produce Feb 31. Day arithmetic
    // rolls properly, so each option has to come back as a date that actually exists.
    const from = new Date(2026, 0, 31)
    for (const option of REMIND_OPTIONS) {
      const iso = deferUntilIso(from, option.days)
      expect(iso).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      const parsed = new Date(`${iso}T00:00:00`)
      expect(Number.isNaN(parsed.getTime())).toBe(false)
      expect(todayIso(parsed)).toBe(iso) // round-trips, i.e. it is the day it claims to be
      expect(parsed.getTime()).toBeGreaterThan(from.getTime())
    }
  })

  it('offers increasing intervals, so the list reads as a scale', () => {
    const days = REMIND_OPTIONS.map((o) => o.days)
    expect(days).toEqual([...days].sort((a, b) => a - b))
  })
})

describe('reviewTotal — gender gaps', () => {
  it("leaves gender gaps out — it's a cleanup pass, not something that arrived", () => {
    // A few hundred blank genders would swamp a number whose whole job is "this much is waiting
    // on you". The inbox shows it on its own quiet row instead.
    expect(reviewTotal({ ...EMPTY_COUNTS, calendarToReview: 3, genderGaps: 400 })).toBe(3)
  })
})
