// The model occasionally emits a well-formed-looking but bogus "event_date"/"event_end_date"
// (wrong format, an out-of-range day, or hallucinated entirely) — trusting it blindly writes
// garbage into a column the UI sorts and displays by. Used by both converse and update-moment
// right after JSON.parse, before anything derived from moment_fields gets written or compared.
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export function sanitizeIsoDate(value: unknown): string | null {
  if (typeof value !== "string" || !ISO_DATE_RE.test(value)) return null
  const [year, month, day] = value.split("-").map(Number)
  const asDate = new Date(Date.UTC(year, month - 1, day))
  const isRealDate =
    asDate.getUTCFullYear() === year && asDate.getUTCMonth() === month - 1 && asDate.getUTCDate() === day
  if (!isRealDate) return null
  // Sanity bounds, not strict validation — catches obviously hallucinated years (e.g. "0002" or
  // "9999") without rejecting genuine decades-old memories or a few years of future planning.
  if (year < 1900 || year > 2100) return null
  return value
}
