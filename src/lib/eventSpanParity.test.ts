import { describe, expect, it } from 'vitest'
import { coversWindow, eventSpan, weatherWindow } from './eventSpan'
import {
  coversWindow as serverCoversWindow,
  eventSpan as serverEventSpan,
  weatherWindow as serverWeatherWindow,
} from '../../supabase/functions/_shared/eventEnrichment'

// The span rules exist twice on purpose — once for the app (src/lib/eventSpan.ts) and once for the
// Edge Function (supabase/functions/_shared/eventEnrichment.ts), because Deno can't import from
// src/. Here the drift would be self-reinforcing and silent: the Edge Function decides which days
// to fetch, the app decides whether what's stored still covers the event, and if they disagree the
// page either re-fetches the same weather on every single view forever or never notices that a new
// sub-event stretched the trip. Neither one errors. This test is what stands in the way.

type Row = { event_date: string | null; event_end_date?: string | null }

function bothSpans(moment: Row, children: Row[]) {
  return { app: eventSpan(moment, children), server: serverEventSpan(moment, children) }
}

describe('eventSpan parity', () => {
  it('agrees that a plain single-day event spans one day', () => {
    const { app, server } = bothSpans({ event_date: '2026-08-14' }, [])
    expect(app).toEqual(server)
    expect(app).toEqual({ start: '2026-08-14', end: '2026-08-14' })
  })

  it('agrees on stretching a one-day parent over its sub-events', () => {
    // The real shape of "Sid and Kate's Wedding": the parent row is stored as a single Thursday,
    // and the six sub-events underneath it run through to the Sunday.
    const parent: Row = { event_date: '2026-08-13', event_end_date: null }
    const children: Row[] = [
      { event_date: '2026-08-13', event_end_date: null },
      { event_date: '2026-08-16', event_end_date: '2026-08-16' },
      { event_date: '2026-08-14', event_end_date: '2026-08-14' },
    ]
    const { app, server } = bothSpans(parent, children)
    expect(app).toEqual(server)
    expect(app).toEqual({ start: '2026-08-13', end: '2026-08-16' })
  })

  it('agrees that a dateless parent inherits its sub-events dates', () => {
    // "Defenders of Freedom Demo — 6-9 Aug 2026" carries the dates in its title and nowhere else.
    const { app, server } = bothSpans({ event_date: null, event_end_date: null }, [
      { event_date: '2026-08-06' },
      { event_date: '2026-08-09' },
      { event_date: null },
    ])
    expect(app).toEqual(server)
    expect(app).toEqual({ start: '2026-08-06', end: '2026-08-09' })
  })

  it('agrees on ignoring an end date that falls before its start', () => {
    // Real row: "Wedding Reception" is stored 2026-09-12 -> 2026-08-15. Believing it would ask the
    // archive for a backwards range.
    const { app, server } = bothSpans({ event_date: '2026-09-12', event_end_date: '2026-08-15' }, [])
    expect(app).toEqual(server)
    expect(app).toEqual({ start: '2026-09-12', end: '2026-09-12' })
  })

  it('agrees on capping an absurd span rather than fetching it', () => {
    const { app, server } = bothSpans({ event_date: '2020-01-01', event_end_date: '2029-01-01' }, [])
    expect(app).toEqual(server)
    expect(app).toEqual({ start: '2020-01-01', end: '2020-01-31' })
  })

  it('agrees that no date anywhere means no span', () => {
    const { app, server } = bothSpans({ event_date: null }, [{ event_date: null }])
    expect(app).toEqual(server)
    expect(app).toBeNull()
  })
})

describe('weatherWindow parity', () => {
  const cases: { name: string; moment: Row; children: Row[]; today: string }[] = [
    { name: 'wholly past', moment: { event_date: '2026-08-13' }, children: [{ event_date: '2026-08-16' }], today: '2026-08-20' },
    { name: 'still under way', moment: { event_date: '2026-08-13' }, children: [{ event_date: '2026-08-16' }], today: '2026-08-14' },
    { name: 'starts today', moment: { event_date: '2026-08-17' }, children: [], today: '2026-08-17' },
    { name: 'wholly future', moment: { event_date: '2026-09-12' }, children: [], today: '2026-08-17' },
    { name: 'undated', moment: { event_date: null }, children: [], today: '2026-08-17' },
  ]

  for (const c of cases) {
    it(`agrees on an event that is ${c.name}`, () => {
      expect(weatherWindow(c.moment, c.children, c.today)).toEqual(
        serverWeatherWindow(c.moment, c.children, c.today),
      )
    })
  }

  it('stops a trip in progress at today, so tomorrow fills in the rest', () => {
    expect(weatherWindow({ event_date: '2026-08-13' }, [{ event_date: '2026-08-16' }], '2026-08-14')).toEqual({
      kind: 'ok',
      start: '2026-08-13',
      end: '2026-08-14',
    })
  })
})

describe('coversWindow parity', () => {
  const window = weatherWindow({ event_date: '2026-08-13' }, [{ event_date: '2026-08-16' }], '2026-08-20')

  it('agrees that a matching stored range is still good', () => {
    const stored = { date: '2026-08-13', endDate: '2026-08-16' }
    expect(coversWindow(stored, window)).toBe(true)
    expect(serverCoversWindow(stored, window)).toBe(true)
  })

  it('agrees that a single stored day no longer covers a trip that grew', () => {
    // This is the case the whole mirror exists for: the weather was fetched when the wedding was
    // one Thursday, and five sub-events later it runs to Sunday.
    const stored = { date: '2026-08-13' }
    expect(coversWindow(stored, window)).toBe(false)
    expect(serverCoversWindow(stored, window)).toBe(false)
  })

  it('agrees that a single day covers itself, with no endDate stored', () => {
    const oneDay = weatherWindow({ event_date: '2026-08-14' }, [], '2026-08-20')
    expect(coversWindow({ date: '2026-08-14' }, oneDay)).toBe(true)
    expect(serverCoversWindow({ date: '2026-08-14' }, oneDay)).toBe(true)
  })

  it('agrees on leaving a sentinel alone when there is nothing to look up', () => {
    for (const w of [{ kind: 'none' } as const, { kind: 'too_soon' } as const]) {
      expect(coversWindow(null, w)).toBe(true)
      expect(serverCoversWindow(null, w)).toBe(true)
    }
  })
})
