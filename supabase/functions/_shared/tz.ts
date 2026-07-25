// Formats a Date as a calendar-date string in a given IANA time zone rather than the server's
// own UTC clock — Edge Functions run in UTC, so "today" computed with plain new Date() rolls over
// at UTC midnight, which is late afternoon/evening across the US. Falls back to UTC formatting if
// the zone string is invalid (e.g. corrupted data) instead of throwing and failing the request.

export function isoDateInTimeZone(date: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date)
  } catch {
    return date.toISOString().slice(0, 10)
  }
}

export function fullDateInTimeZone(date: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone, weekday: "long", year: "numeric", month: "long", day: "numeric" }).format(date)
  } catch {
    return date.toDateString()
  }
}
