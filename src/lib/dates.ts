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
