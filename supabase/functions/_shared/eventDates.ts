// Deterministic, non-AI "when_text" formatter for calendar-synced events — the resolved
// start/end dates ARE ground truth here (unlike a conversationally-described moment), so
// when_text is a rendering of them, not AI-guessed prose (founder feedback: "the actual event
// dates are already on the calendar"). Mirrors src/lib/dates.ts's formatDateRange — duplicated,
// not shared, because Edge Functions (Deno) can't import from src/. Keep both in sync. Uses
// fixed "en-US"/UTC formatting since this runs once server-side to freeze a persisted string,
// not live-rendered for a particular visitor's locale.
export function formatEventDateText(startIso: string, endIso: string | null): string {
  const start = new Date(`${startIso}T00:00:00Z`)
  if (!endIso || endIso === startIso) {
    return start.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" })
  }
  const end = new Date(`${endIso}T00:00:00Z`)
  const sameYear = start.getUTCFullYear() === end.getUTCFullYear()
  const sameMonth = sameYear && start.getUTCMonth() === end.getUTCMonth()
  if (sameMonth) {
    const month = start.toLocaleDateString("en-US", { month: "long", timeZone: "UTC" })
    return `${month} ${start.getUTCDate()}–${end.getUTCDate()}, ${start.getUTCFullYear()}`
  }
  const startLabel = start.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: sameYear ? undefined : "numeric",
    timeZone: "UTC",
  })
  const endLabel = end.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" })
  return `${startLabel} – ${endLabel}`
}
