import { describe, expect, it } from 'vitest'
import { sortSubEventsByDate } from './subEvents'

type Sub = { occasion: string; event_date: string | null; event_end_date: string | null; created_at: string }

const sub = (occasion: string, event_date: string | null, created_at: string, event_end_date: string | null = null): Sub => ({
  occasion,
  event_date,
  event_end_date,
  created_at,
})

const order = (subs: Sub[]) => sortSubEventsByDate(subs).map((s) => s.occasion)

describe('sortSubEventsByDate', () => {
  it('puts sub-events in date order regardless of when they were added', () => {
    const subs = [
      sub('Air show demo day', '2026-08-08', '2026-08-08 21:57:11+00'),
      sub('First night with Jesse and Mojo', '2026-08-06', '2026-08-08 02:11:37+00'),
      sub('Practice day', '2026-08-07', '2026-08-08 02:12:46+00'),
    ]
    expect(order(subs)).toEqual(['First night with Jesse and Mojo', 'Practice day', 'Air show demo day'])
  })

  it('sorts undated sub-events to the end', () => {
    const subs = [
      sub('No date yet', null, '2026-08-01 00:00:00+00'),
      sub('Wedding brunch', '2025-10-19', '2026-08-04 03:30:11+00'),
    ]
    expect(order(subs)).toEqual(['Wedding brunch', 'No date yet'])
  })

  it('keeps undated sub-events in creation order among themselves', () => {
    const subs = [
      sub('Second added', null, '2026-08-08 22:02:54+00'),
      sub('First added', null, '2026-08-08 02:12:46+00'),
    ]
    expect(order(subs)).toEqual(['First added', 'Second added'])
  })

  it('sorts a single-day sub-event ahead of a multi-day one starting the same day', () => {
    const subs = [
      sub('Three-day workshop', '2026-06-28', '2026-08-04 03:43:45+00', '2026-06-30'),
      sub('Morning ultrasound', '2026-06-28', '2026-08-04 03:44:05+00'),
    ]
    expect(order(subs)).toEqual(['Morning ultrasound', 'Three-day workshop'])
  })

  it('falls back to creation order only when the dates are genuinely identical', () => {
    // The Mexico City trip case: eight sub-events that all inherited the parent trip's start date.
    const subs = [
      sub('Birthday Dinner', '2023-10-30', '2026-08-04 03:33:49+00'),
      sub('Hot Air Ballooning', '2023-10-30', '2026-08-04 03:34:38+00'),
      sub('Rooftop Bar', '2023-10-30', '2026-08-04 03:34:53+00'),
    ]
    expect(order(subs)).toEqual(['Birthday Dinner', 'Hot Air Ballooning', 'Rooftop Bar'])
  })

  it('does not mutate the array it was given', () => {
    const subs = [sub('Later', '2026-08-08', '2026-08-01 00:00:00+00'), sub('Earlier', '2026-08-01', '2026-08-02 00:00:00+00')]
    const snapshot = subs.map((s) => s.occasion)
    sortSubEventsByDate(subs)
    expect(subs.map((s) => s.occasion)).toEqual(snapshot)
  })
})
