// Ordering for an event's sub-events ("Sub Events" on EventDetail).
//
// The founder's ask (2026-08-08): the tiles should read left-to-right in the order the sub-events
// happened, not in the order they were added to the database. The Supabase query already sorts by
// event_date, but that leaves same-date sub-events in whatever order Postgres hands back — in
// practice creation order, because every new sub-event inherits its parent's start date. This
// makes the tie-breaks explicit and deliberate instead.
//
// Dates are ISO `YYYY-MM-DD` strings from a Postgres `date` column, so plain string comparison is
// already chronological — no Date parsing (and no timezone shifting) needed.

export type DatedSubEvent = {
  event_date: string | null
  event_end_date: string | null
  created_at: string
}

function compareDates(a: string | null, b: string | null, nullsLast: boolean): number {
  const aVal = a ?? ''
  const bVal = b ?? ''
  if (aVal === bVal) return 0
  if (!aVal) return nullsLast ? 1 : -1
  if (!bVal) return nullsLast ? -1 : 1
  return aVal < bVal ? -1 : 1
}

/**
 * Sorts sub-events chronologically: start date first, then end date, then creation time.
 *
 * - A sub-event with no date sorts to the end — a missing date means "unknown", not "earliest",
 *   and burying it mid-list would misrepresent when it happened.
 * - Among sub-events sharing a start date, a single-day one (no end date) sorts ahead of one that
 *   runs on for several days.
 * - created_at is the last resort only, so the order is stable rather than arbitrary when two
 *   sub-events carry genuinely identical dates.
 */
export function sortSubEventsByDate<T extends DatedSubEvent>(subEvents: T[]): T[] {
  return [...subEvents].sort((a, b) => {
    const byStart = compareDates(a.event_date, b.event_date, true)
    if (byStart !== 0) return byStart
    const byEnd = compareDates(a.event_end_date, b.event_end_date, false)
    if (byEnd !== 0) return byEnd
    return a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0
  })
}
