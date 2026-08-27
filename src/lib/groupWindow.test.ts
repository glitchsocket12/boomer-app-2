import { describe, expect, it } from 'vitest'
import {
  MAX_BOUNDED_WINDOW_DAYS,
  locationsMatch,
  matchGroupWindow,
  windowLengthDays,
  windowOverlapsSpan,
} from './groupWindow'

// The founder's real case, and the one every threshold here is tuned against.
const crmSchool = { start_date: '2026-08-23', end_date: '2026-08-27', location: 'Pensacola, FL' }
const academy = { start_date: '2010-06-24', end_date: '2014-05-28', location: 'Colorado Springs, CO' }
const currentJob = { start_date: '2024-01-08', end_date: null, location: null }
const undated = { start_date: null, end_date: null, location: null }

describe('windowOverlapsSpan', () => {
  it('matches a single day inside the window', () => {
    expect(windowOverlapsSpan(crmSchool, { start: '2026-08-25', end: '2026-08-25' })).toBe(true)
  })

  it('includes both boundary days', () => {
    expect(windowOverlapsSpan(crmSchool, { start: '2026-08-23', end: '2026-08-23' })).toBe(true)
    expect(windowOverlapsSpan(crmSchool, { start: '2026-08-27', end: '2026-08-27' })).toBe(true)
  })

  it('excludes the days just outside it', () => {
    expect(windowOverlapsSpan(crmSchool, { start: '2026-08-22', end: '2026-08-22' })).toBe(false)
    expect(windowOverlapsSpan(crmSchool, { start: '2026-08-28', end: '2026-08-28' })).toBe(false)
  })

  it('matches a multi-day event that only clips the edge', () => {
    expect(windowOverlapsSpan(crmSchool, { start: '2026-08-20', end: '2026-08-23' })).toBe(true)
    expect(windowOverlapsSpan(crmSchool, { start: '2026-08-27', end: '2026-08-30' })).toBe(true)
  })

  it('runs forever when the window has no end', () => {
    expect(windowOverlapsSpan(currentJob, { start: '2030-01-01', end: '2030-01-01' })).toBe(true)
    expect(windowOverlapsSpan(currentJob, { start: '2023-12-01', end: '2023-12-01' })).toBe(false)
  })

  it('never matches a group with no start date', () => {
    expect(windowOverlapsSpan(undated, { start: '2026-08-25', end: '2026-08-25' })).toBe(false)
  })
})

describe('windowLengthDays', () => {
  it('counts inclusively', () => {
    expect(windowLengthDays(crmSchool)).toBe(5)
  })

  it('is null for an open-ended or undated window', () => {
    expect(windowLengthDays(currentJob)).toBeNull()
    expect(windowLengthDays(undated)).toBeNull()
  })

  it('is null when the end precedes the start', () => {
    expect(windowLengthDays({ start_date: '2026-08-27', end_date: '2026-08-23', location: null })).toBeNull()
  })
})

describe('locationsMatch', () => {
  it('agrees across the spellings one trip produces', () => {
    expect(locationsMatch('Pensacola, FL', 'Pensacola')).toBe(true)
    expect(locationsMatch('Pensacola, FL', 'NAS Pensacola')).toBe(true)
    expect(locationsMatch('Pensacola, FL', 'pensacola florida')).toBe(true)
  })

  it('does not match two different places in the same state', () => {
    expect(locationsMatch('Pensacola, FL', 'Orlando, FL')).toBe(false)
  })

  it('does not match on a generic word alone', () => {
    expect(locationsMatch('Fort Worth, TX', 'Fort Bragg, NC')).toBe(false)
  })

  it('is false when either side is missing or empty', () => {
    expect(locationsMatch(null, 'Pensacola')).toBe(false)
    expect(locationsMatch('Pensacola', undefined)).toBe(false)
    expect(locationsMatch('   ', 'Pensacola')).toBe(false)
  })

  it('treats a venue in a city as that city, unlike locationGroups merging', () => {
    expect(locationsMatch('Denver, CO', 'Denver Zoo')).toBe(true)
  })
})

describe('matchGroupWindow', () => {
  it('matches a short course on dates alone', () => {
    expect(matchGroupWindow(crmSchool, { start: '2026-08-25', end: '2026-08-25' }, null)).toEqual({
      kind: 'dates',
    })
  })

  it('reports the stronger signal when the place agrees too', () => {
    expect(
      matchGroupWindow(crmSchool, { start: '2026-08-23', end: '2026-08-23' }, 'Pensacola')
    ).toEqual({ kind: 'dates_and_place' })
  })

  it('stays silent on a four-year window with no location agreement', () => {
    expect(matchGroupWindow(academy, { start: '2012-03-04', end: '2012-03-04' }, 'Denver, CO')).toBeNull()
  })

  it('still fires on a four-year window when the place agrees', () => {
    expect(
      matchGroupWindow(academy, { start: '2012-03-04', end: '2012-03-04' }, 'Colorado Springs')
    ).toEqual({ kind: 'dates_and_place' })
  })

  it('stays silent on an open-ended window with no location agreement', () => {
    expect(matchGroupWindow(currentJob, { start: '2026-08-25', end: '2026-08-25' }, 'Pensacola')).toBeNull()
  })

  it('honours the bounded-window cap exactly', () => {
    const atCap = { start_date: '2026-01-01', end_date: '2026-01-31', location: null }
    const overCap = { start_date: '2026-01-01', end_date: '2026-02-01', location: null }
    expect(windowLengthDays(atCap)).toBe(MAX_BOUNDED_WINDOW_DAYS)
    expect(matchGroupWindow(atCap, { start: '2026-01-15', end: '2026-01-15' }, null)).toEqual({ kind: 'dates' })
    expect(matchGroupWindow(overCap, { start: '2026-01-15', end: '2026-01-15' }, null)).toBeNull()
  })

  it('is null for an undated event or an undated group', () => {
    expect(matchGroupWindow(crmSchool, null, 'Pensacola')).toBeNull()
    expect(matchGroupWindow(undated, { start: '2026-08-25', end: '2026-08-25' }, 'Pensacola')).toBeNull()
  })
})
