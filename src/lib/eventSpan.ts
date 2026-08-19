// How many days an event actually covers, once its sub-events are taken into account — and
// whether the weather already cached for it still covers all of them.
//
// MIRROR: supabase/functions/_shared/eventEnrichment.ts holds a byte-for-byte copy of eventSpan,
// weatherWindow and coversWindow, because Deno can't import from src/. The Edge Function decides
// which days to fetch; this copy decides whether the page needs to ask it again. If the two ever
// disagree the page asks forever or never asks at all, so src/lib/eventSpanParity.test.ts pins
// them together. Keep both in sync.

/** Shifts a plain YYYY-MM-DD by whole days without ever touching local time. */
export function shiftDate(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** Inclusive day count: a single day is 1, not 0. */
export function daysInSpan(startIso: string, endIso: string): number {
  const ms = Date.parse(`${endIso}T00:00:00Z`) - Date.parse(`${startIso}T00:00:00Z`)
  return Math.floor(ms / 86_400_000) + 1
}

/**
 * A trip longer than this is a data-entry error, not a trip. Capping is what stops one mistyped
 * end date from asking the weather archive for a decade and then rendering a day-by-day list
 * nobody could read.
 */
export const MAX_SPAN_DAYS = 31

export type DatedRow = { event_date: string | null; event_end_date?: string | null }

/**
 * The whole stretch of days an event covers, including everything its sub-events cover.
 *
 * Sub-events are what actually pin down a trip's shape (founder ask, 2026-08-17: the parent
 * event's weather should summarize the whole weekend, not just its first day). A parent row
 * routinely carries a start date and no end — "Sid and Kate's Wedding" is stored as one day while
 * its six sub-events between them run Thursday to Sunday — and a calendar-imported parent can
 * carry no date at all while its children are fully dated.
 */
export function eventSpan(
  moment: DatedRow,
  children: DatedRow[] = [],
): { start: string; end: string } | null {
  let start: string | null = null
  let end: string | null = null

  for (const row of [moment, ...children]) {
    const rowStart = row.event_date
    if (!rowStart) continue
    // An end date BEFORE its start is real in this data (one event is stored 2026-09-12 ->
    // 2026-08-15). Trusting it would invert the span and ask for a negative range, so a backwards
    // end is simply ignored rather than used.
    const rowEnd =
      row.event_end_date && row.event_end_date >= rowStart ? row.event_end_date : rowStart
    if (!start || rowStart < start) start = rowStart
    if (!end || rowEnd > end) end = rowEnd
  }

  if (!start || !end) return null
  return {
    start,
    end: daysInSpan(start, end) > MAX_SPAN_DAYS ? shiftDate(start, MAX_SPAN_DAYS - 1) : end,
  }
}

/** The days the weather archive can actually answer for, or why it can't. */
export type WeatherWindow =
  | { kind: 'none' }
  | { kind: 'too_soon' }
  | { kind: 'ok'; start: string; end: string }

/**
 * An event's span, stopped at today, because the archive answers a future date with a hard 400.
 *
 * A trip that has started but not finished therefore gets a window shorter than the trip. That is
 * on purpose: the stored weather then no longer matches the full window tomorrow, `coversWindow`
 * says so, and the remaining days fill themselves in without anyone touching the refresh button.
 */
export function weatherWindow(
  moment: DatedRow,
  children: DatedRow[],
  today: string,
): WeatherWindow {
  const span = eventSpan(moment, children)
  if (!span) return { kind: 'none' }
  if (span.start > today) return { kind: 'too_soon' }
  return { kind: 'ok', start: span.start, end: span.end > today ? today : span.end }
}

/**
 * Whether a stored weather value still covers the whole window. False is what re-fetches, so the
 * `kind !== 'ok'` cases answer true — a stored `too_soon` on a still-future event is handled by
 * its own rule, and re-running a lookup that has nothing to look up would just churn.
 */
export function coversWindow(
  weather: { date?: string | null; endDate?: string | null } | null | undefined,
  window: WeatherWindow,
): boolean {
  if (window.kind !== 'ok') return true
  if (!weather?.date) return false
  return weather.date === window.start && (weather.endDate ?? weather.date) === window.end
}
