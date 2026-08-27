import { describe, expect, it } from 'vitest'
import {
  BULK_SET_ASIDE_MIN,
  DEFER_DAYS,
  EMPTY_COUNTS,
  REMIND_OPTIONS,
  canBulkSetAside,
  canBulkSetAsideRoutine,
  deferUntilIso,
  reviewTotal,
  todayIso,
} from './reviewQueues'

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
  it('sums only the queues that are actually waiting on the founder', () => {
    expect(
      reviewTotal({
        ...EMPTY_COUNTS,
        calendarToReview: 14,
        birthdays: 3,
        contactsToReview: 2,
        photos: 1,
      })
    ).toBe(20)
  })

  it('leaves BOTH "still to look through" piles out, however big they get', () => {
    // The case this exists for: a 1,300-event calendar sync made Home read "1,300 things to
    // review", which is the overwhelm itself. An untriaged pile is a resting state, not a queue
    // with your name on it — same reasoning ContactSelection was built with from the start.
    expect(
      reviewTotal({
        ...EMPTY_COUNTS,
        calendarToTriage: 1300,
        contactsToTriage: 2008,
        calendarToReview: 4,
      })
    ).toBe(4)
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

describe('canBulkSetAside', () => {
  // The guard on the largest single write in the app — one statement that defers every undecided
  // calendar candidate at once. Each clause gets its own case because dropping any one of them
  // silently is the failure mode that matters.
  const ok = { triageEnabled: true, showTurnedDown: false, filtering: false, pending: 1300 }

  it('is offered on a big undecided pile', () => {
    expect(canBulkSetAside(ok)).toBe(true)
  })

  it('is withheld until the triage migration has been run', () => {
    // Gating on the probe rather than the per-row fail-open banner: a bulk button that fails after
    // you press it is much worse than one that was never there.
    expect(canBulkSetAside({ ...ok, triageEnabled: false })).toBe(false)
  })

  it('is withheld while a search is narrowing the list', () => {
    // It acts on the whole pending pile, so it must never sit next to a filtered list — the
    // founder would reasonably read it as "set aside these 23 dentist appointments".
    expect(canBulkSetAside({ ...ok, filtering: true })).toBe(false)
  })

  it('is withheld on the turned-down list', () => {
    // Those rows are already decided; there is nothing there for it to act on and the label would
    // describe the wrong pile.
    expect(canBulkSetAside({ ...ok, showTurnedDown: true })).toBe(false)
  })

  it('is withheld for a pile small enough to just do', () => {
    expect(canBulkSetAside({ ...ok, pending: BULK_SET_ASIDE_MIN - 1 })).toBe(false)
    expect(canBulkSetAside({ ...ok, pending: BULK_SET_ASIDE_MIN })).toBe(true)
    expect(canBulkSetAside({ ...ok, pending: 0 })).toBe(false)
  })
})

describe('canBulkSetAsideRoutine', () => {
  // The narrower of the two bulk guards: this one acts only on rows the AI called routine.
  const ok = { significanceEnabled: true, scoringComplete: true, filtering: false, routine: 1120 }

  it('is offered once everything has been sorted', () => {
    expect(canBulkSetAsideRoutine(ok)).toBe(true)
  })

  it('is withheld while any pending row is still unsorted', () => {
    // The failure this prevents: setting events aside because the backfill hadn't reached them
    // yet, which reads to the founder as the AI deciding they were unimportant.
    expect(canBulkSetAsideRoutine({ ...ok, scoringComplete: false })).toBe(false)
  })

  it('is withheld until the significance migration has been run', () => {
    expect(canBulkSetAsideRoutine({ ...ok, significanceEnabled: false })).toBe(false)
  })

  it('is withheld while a search is narrowing the list', () => {
    // Unlike the generic button it is safe beside the Recommended view, because its label and its
    // confirmation both name exactly what it acts on. A search box is different: a bulk control
    // sitting under search results reads as acting on them whatever it says.
    expect(canBulkSetAsideRoutine({ ...ok, filtering: true })).toBe(false)
  })

  it('is withheld for a handful', () => {
    expect(canBulkSetAsideRoutine({ ...ok, routine: BULK_SET_ASIDE_MIN - 1 })).toBe(false)
    expect(canBulkSetAsideRoutine({ ...ok, routine: 0 })).toBe(false)
  })
})
