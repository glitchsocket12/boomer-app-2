export function eventSortDate(moment: { event_date: string | null; created_at: string }): Date {
  return moment.event_date ? new Date(`${moment.event_date}T00:00:00`) : new Date(moment.created_at)
}

export function formatMonthYear(moment: { event_date: string | null; created_at: string }): string {
  return eventSortDate(moment).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
}
