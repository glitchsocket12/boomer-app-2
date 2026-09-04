export function eventSortDate(moment: { event_date: string | null; created_at: string }): Date {
  return moment.event_date ? new Date(`${moment.event_date}T00:00:00`) : new Date(moment.created_at)
}

/**
 * The last day an event covers — its end date when it has one, otherwise its start.
 *
 * Ignores an end date that falls BEFORE its start, the same way eventSpan() does: that shape is
 * real in this data (one event is stored 2026-09-12 -> 2026-08-15) and trusting it would rank the
 * event by a day it never reached.
 */
export function eventSortEndDate(moment: {
  event_date: string | null
  event_end_date?: string | null
  created_at: string
}): Date {
  const start = moment.event_date
  const end = moment.event_end_date
  if (!start || !end || end <= start) return eventSortDate(moment)
  return new Date(`${end}T00:00:00`)
}

/**
 * Newest-first order for an event list, ranked by when each event ENDED.
 *
 * A timeline is a chronology, so a trip that ran August 26–30 belongs above a single day on
 * August 27 even though it started first — it was still going while the shorter one came and went
 * (founder, 2026-09-03). Start date breaks ties, so two events finishing on the same day still
 * read newest-first.
 *
 * Deliberately not eventSortDate's job: that one answers "which single day stands in for this
 * event" and still drives the date labels and the date-range filter. Anything that has to line up
 * with THIS order — the Events page's year headings — reads eventSortEndDate instead, or a
 * year-spanning event would sort into one year and be labelled with another.
 */
export function compareEventsNewestFirst(
  a: { event_date: string | null; event_end_date?: string | null; created_at: string },
  b: { event_date: string | null; event_end_date?: string | null; created_at: string }
): number {
  const byEnd = eventSortEndDate(b).getTime() - eventSortEndDate(a).getTime()
  if (byEnd !== 0) return byEnd
  return eventSortDate(b).getTime() - eventSortDate(a).getTime()
}

export function formatMonthYear(moment: { event_date: string | null; created_at: string }): string {
  return eventSortDate(moment).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
}

// Single date ("August 15, 2026") or, when endIso differs, a range ("August 15–20, 2026",
// "August 15 – September 2, 2026", "December 28, 2026 – January 3, 2027" across a year
// boundary). Parses with "T00:00:00" (no "Z") for the same local-midnight reasoning as
// eventSortDate above. Mirrored server-side in supabase/functions/_shared/eventDates.ts —
// keep the two in sync.
export function formatDateRange(startIso: string, endIso: string | null): string {
  const start = new Date(`${startIso}T00:00:00`)
  if (!endIso || endIso === startIso) {
    return start.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })
  }
  const end = new Date(`${endIso}T00:00:00`)
  const sameYear = start.getFullYear() === end.getFullYear()
  const sameMonth = sameYear && start.getMonth() === end.getMonth()
  if (sameMonth) {
    const month = start.toLocaleDateString(undefined, { month: 'long' })
    return `${month} ${start.getDate()}–${end.getDate()}, ${start.getFullYear()}`
  }
  const startLabel = start.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: sameYear ? undefined : 'numeric' })
  const endLabel = end.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })
  return `${startLabel} – ${endLabel}`
}

export function formatFullDate(moment: { event_date: string | null; event_end_date?: string | null; created_at: string }): string {
  if (moment.event_date && moment.event_end_date && moment.event_end_date !== moment.event_date) {
    return formatDateRange(moment.event_date, moment.event_end_date)
  }
  return eventSortDate(moment).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })
}

// Prefer an exact date (or range) when one is known; vague when_text is fine when there's no
// exact date.
export function formatEventWhen(moment: {
  event_date: string | null
  event_end_date?: string | null
  when_text: string | null
  created_at: string
}): string {
  if (moment.event_date && moment.event_end_date && moment.event_end_date !== moment.event_date) {
    return formatDateRange(moment.event_date, moment.event_end_date)
  }
  if (moment.event_date) return formatFullDate(moment)
  if (moment.when_text) return moment.when_text
  return formatFullDate(moment)
}

// Next occurrence of a month/day reminder (birthday, anniversary) from today, wrapping into
// next year once this year's date has already passed.
export function nextOccurrenceDate(month: number, day: number): Date {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  let next = new Date(today.getFullYear(), month - 1, day)
  if (next < today) next = new Date(today.getFullYear() + 1, month - 1, day)
  return next
}

export function daysUntilNextOccurrence(month: number, day: number): number {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const next = nextOccurrenceDate(month, day)
  return Math.round((next.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
}
