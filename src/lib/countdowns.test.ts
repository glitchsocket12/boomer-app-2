import { describe, expect, it } from 'vitest'
import {
  breakdown,
  buildCards,
  displayUnits,
  parseDateOnly,
  tickMs,
  unitsForCard,
  type CountdownMoment,
  type CountdownPerson,
  type CountdownRow,
} from './countdowns'

const at = (y: number, m: number, d: number, h = 0, min = 0, s = 0) => new Date(y, m - 1, d, h, min, s)

describe('breakdown', () => {
  it('counts whole calendar months, not 30-day chunks', () => {
    // Feb is 28 days in 2026 — a ms-division month would call this "1 month, 1 day".
    expect(breakdown(at(2026, 1, 15), at(2026, 3, 15))).toMatchObject({ years: 0, months: 2, weeks: 0, days: 0 })
    expect(breakdown(at(2026, 2, 1), at(2026, 3, 1))).toMatchObject({ months: 1, weeks: 0, days: 0 })
  })

  it('clamps month-end arithmetic instead of overflowing', () => {
    // Jan 31 + 1 month must be Feb 28, so Jan 31 -> Mar 1 is "1 month, 1 day". Naive setMonth
    // would land on Mar 3 and report 0 months.
    expect(breakdown(at(2026, 1, 31), at(2026, 3, 1))).toMatchObject({ months: 1, weeks: 0, days: 1 })
  })

  it('handles a leap day', () => {
    expect(breakdown(at(2024, 2, 29), at(2025, 3, 1))).toMatchObject({ years: 1, months: 0, weeks: 0, days: 1 })
    expect(breakdown(at(2024, 2, 1), at(2024, 3, 1))).toMatchObject({ months: 1, weeks: 0, days: 0 })
  })

  it('splits the remainder into weeks, days and time of day', () => {
    expect(breakdown(at(2026, 1, 1), at(2026, 3, 18, 5, 30, 20))).toMatchObject({
      years: 0,
      months: 2,
      weeks: 2,
      days: 3,
      hours: 5,
      minutes: 30,
      seconds: 20,
    })
  })

  it('reads a multi-year span the way the card renders it', () => {
    expect(breakdown(at(2022, 6, 5), at(2026, 8, 6))).toMatchObject({ years: 4, months: 2, weeks: 0, days: 1 })
  })

  it('is all zeroes for the same instant or a reversed pair', () => {
    const same = breakdown(at(2026, 8, 6), at(2026, 8, 6))
    expect(same).toEqual({ years: 0, months: 0, weeks: 0, days: 0, hours: 0, minutes: 0, seconds: 0 })
    expect(breakdown(at(2026, 8, 6), at(2020, 1, 1))).toEqual(same)
  })
})

describe('displayUnits', () => {
  it('starts at the largest non-zero unit and keeps interior zeroes', () => {
    const bd = breakdown(at(2022, 6, 5), at(2026, 8, 6))
    expect(displayUnits(bd, 'up')).toEqual([
      { label: 'Years', value: 4 },
      { label: 'Months', value: 2 },
      { label: 'Weeks', value: 0 },
      { label: 'Days', value: 1 },
    ])
  })

  it('trims trailing zeroes on a count-up', () => {
    const bd = breakdown(at(2025, 2, 6), at(2026, 8, 6))
    expect(displayUnits(bd, 'up')).toEqual([
      { label: 'Years', value: 1 },
      { label: 'Months', value: 6 },
    ])
  })

  it('keeps a countdown at a fixed width so a ticking card never reflows', () => {
    // Seconds hits 0 once a minute; trimming there would drop and restore a column while you watch.
    const bd = breakdown(at(2026, 8, 6, 9, 0, 0), at(2026, 8, 8, 12, 0, 0))
    expect(displayUnits(bd, 'down')).toEqual([
      { label: 'Days', value: 2 },
      { label: 'Hours', value: 3 },
      { label: 'Minutes', value: 0 },
      { label: 'Seconds', value: 0 },
    ])
  })

  it('skips leading zero units', () => {
    const bd = breakdown(at(2026, 8, 3), at(2026, 8, 6))
    expect(displayUnits(bd, 'up')).toEqual([{ label: 'Days', value: 3 }])
  })

  it('caps a count-up at days but lets a countdown reach seconds', () => {
    const bd = breakdown(at(2026, 8, 6), at(2026, 8, 6, 4, 30, 15))
    expect(displayUnits(bd, 'up')).toEqual([])
    expect(displayUnits(bd, 'down')).toEqual([
      { label: 'Hours', value: 4 },
      { label: 'Minutes', value: 30 },
      { label: 'Seconds', value: 15 },
    ])
  })

  it('shows at most four columns', () => {
    const bd = breakdown(at(2022, 1, 1), at(2026, 8, 6, 5, 5, 5))
    expect(displayUnits(bd, 'down')).toHaveLength(4)
    expect(displayUnits(bd, 'down')[0].label).toBe('Years')
  })
})

describe('tickMs', () => {
  const now = at(2026, 8, 6, 9, 0, 0)
  const card = (date: Date) => ({ key: 'k', title: 't', date, direction: 'down' as const, derived: false })

  it('ticks every second only when something on screen shows minutes or seconds', () => {
    expect(tickMs([card(at(2026, 8, 8, 12, 0, 0))], now)).toBe(1000)
    // Months out: the columns stop at hours, so a per-second re-render would be wasted work.
    expect(tickMs([card(at(2027, 3, 1))], now)).toBe(60000)
    expect(tickMs([], now)).toBe(60000)
  })
})

describe('unitsForCard', () => {
  it('measures a count-up to the start of today, so it reads as whole days', () => {
    const card = { key: 'k', title: 't', date: at(2026, 8, 1), direction: 'up' as const, derived: true }
    expect(unitsForCard(card, at(2026, 8, 6, 23, 45, 0))).toEqual([{ label: 'Days', value: 5 }])
  })

  it('renders nothing for a count-up dated today (the card says "Today" instead)', () => {
    const card = { key: 'k', title: 't', date: at(2026, 8, 6), direction: 'up' as const, derived: true }
    expect(unitsForCard(card, at(2026, 8, 6, 10, 0, 0))).toEqual([])
  })
})

describe('buildCards', () => {
  const now = at(2026, 8, 6, 9, 0, 0)

  const moment = (over: Partial<CountdownMoment> & { id: string; event_date: string }): CountdownMoment => ({
    occasion: 'An event',
    raw_description: '',
    created_at: '2026-01-01T00:00:00Z',
    moment_tags: [],
    ...over,
  })
  const milestoneTag = [{ tags: { id: 't1', name: 'Milestone' } }]
  const row = (over: Partial<CountdownRow> & { id: string }): CountdownRow => ({
    label: null,
    target_date: null,
    moment_id: null,
    reminder_id: null,
    hidden: false,
    created_at: '2026-01-01T00:00:00Z',
    ...over,
  })
  const empty = { moments: [] as CountdownMoment[], people: [] as CountdownPerson[], rows: [] as CountdownRow[], now }

  it('derives a count-up from a past Milestone-tagged event and ignores untagged ones', () => {
    const cards = buildCards({
      ...empty,
      moments: [
        moment({ id: 'm1', occasion: 'Moved to Colorado', event_date: '2025-02-06', moment_tags: milestoneTag }),
        moment({ id: 'm2', occasion: 'Coffee with Ray', event_date: '2025-03-01' }),
      ],
    })
    expect(cards.map((c) => c.title)).toEqual(['Moved to Colorado'])
    expect(cards[0]).toMatchObject({ direction: 'up', derived: true, momentId: 'm1' })
  })

  it('matches the Milestone tag case-insensitively', () => {
    const cards = buildCards({
      ...empty,
      moments: [moment({ id: 'm1', event_date: '2025-02-06', moment_tags: [{ tags: { id: 't', name: 'milestone' } }] })],
    })
    expect(cards).toHaveLength(1)
  })

  it('leaves a future Milestone-tagged event out unless it is pinned', () => {
    const future = moment({ id: 'm1', event_date: '2027-01-01', moment_tags: milestoneTag })
    expect(buildCards({ ...empty, moments: [future] })).toHaveLength(0)
    const pinned = buildCards({ ...empty, moments: [future], rows: [row({ id: 'r1', moment_id: 'm1' })] })
    expect(pinned).toHaveLength(1)
    expect(pinned[0]).toMatchObject({ direction: 'down', rowId: 'r1', derived: true })
  })

  it('reads a pinned event\'s title and date off the moment, not the row', () => {
    const cards = buildCards({
      ...empty,
      moments: [moment({ id: 'm1', occasion: 'Conor & Shelly’s wedding', event_date: '2027-06-17' })],
      rows: [row({ id: 'r1', moment_id: 'm1' })],
    })
    expect(cards[0].title).toBe('Conor & Shelly’s wedding')
    expect(cards[0].date).toEqual(parseDateOnly('2027-06-17'))
  })

  it('skips a pinned row whose event is missing or has lost its date', () => {
    expect(buildCards({ ...empty, rows: [row({ id: 'r1', moment_id: 'gone' })] })).toHaveLength(0)
  })

  it('renders a standalone countdown and points it forward', () => {
    const cards = buildCards({ ...empty, rows: [row({ id: 'r1', label: 'Baby due date', target_date: '2027-02-10' })] })
    expect(cards[0]).toMatchObject({ title: 'Baby due date', direction: 'down', derived: false, rowId: 'r1' })
  })

  it('hides a dismissed derived milestone and a dismissed standalone', () => {
    const cards = buildCards({
      moments: [moment({ id: 'm1', event_date: '2025-02-06', moment_tags: milestoneTag })],
      people: [],
      rows: [
        row({ id: 'r1', moment_id: 'm1', hidden: true }),
        row({ id: 'r2', label: 'Old thing', target_date: '2026-01-01', hidden: true }),
      ],
      now,
    })
    expect(cards).toHaveLength(0)
  })

  it('renders one card, from the row, when a milestone is also pinned', () => {
    const cards = buildCards({
      ...empty,
      moments: [moment({ id: 'm1', event_date: '2025-02-06', moment_tags: milestoneTag })],
      rows: [row({ id: 'r1', moment_id: 'm1' })],
    })
    expect(cards).toHaveLength(1)
    // derived stays true so dismissing writes hidden=true instead of deleting and re-deriving.
    expect(cards[0]).toMatchObject({ rowId: 'r1', derived: true })
  })

  it('derives a life date only when the reminder has a year, and never for someone deceased', () => {
    const people: CountdownPerson[] = [
      {
        id: 'p1',
        name: 'Nate',
        last_name: 'Volin',
        reminders: [
          { id: 'rem1', label: 'Anniversary', month: 6, day: 5, year: 2022 },
          { id: 'rem2', label: 'Birthday', month: 4, day: 2 },
        ],
      },
      {
        id: 'p2',
        name: 'Harold',
        last_name: null,
        deceased_date: '2024-03-02',
        reminders: [{ id: 'rem3', label: 'Birthday', month: 1, day: 9, year: 1941 }],
      },
    ]
    const cards = buildCards({ ...empty, people })
    expect(cards.map((c) => c.title)).toEqual(["Nate Volin's anniversary"])
    expect(cards[0]).toMatchObject({ reminderId: 'rem1', personId: 'p1', derived: true })
  })

  it('orders upcoming soonest-first, then past most-recent-first', () => {
    const cards = buildCards({
      ...empty,
      moments: [
        moment({ id: 'm1', occasion: 'Old milestone', event_date: '2020-01-01', moment_tags: milestoneTag }),
        moment({ id: 'm2', occasion: 'Recent milestone', event_date: '2026-07-01', moment_tags: milestoneTag }),
      ],
      rows: [
        row({ id: 'r1', label: 'Far future', target_date: '2028-01-01' }),
        row({ id: 'r2', label: 'Near future', target_date: '2026-09-01' }),
      ],
    })
    expect(cards.map((c) => c.title)).toEqual(['Near future', 'Far future', 'Recent milestone', 'Old milestone'])
  })
})
