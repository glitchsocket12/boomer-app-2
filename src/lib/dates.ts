export function eventSortDate(moment: { event_date: string | null; created_at: string }): Date {
  return moment.event_date ? new Date(`${moment.event_date}T00:00:00`) : new Date(moment.created_at)
}

export function formatMonthYear(moment: { event_date: string | null; created_at: string }): string {
  return eventSortDate(moment).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
}

export function formatFullDate(moment: { event_date: string | null; created_at: string }): string {
  return eventSortDate(moment).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })
}

// Prefer an exact date when one is known; vague when_text is fine when there's no exact date.
export function formatEventWhen(moment: { event_date: string | null; when_text: string | null; created_at: string }): string {
  if (moment.event_date) return formatMonthYear(moment)
  if (moment.when_text) return moment.when_text
  return formatMonthYear(moment)
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
