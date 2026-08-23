// Builds a full IANA time zone picklist for the Settings dropdown, each labeled with its city
// and current UTC offset (e.g. "Denver (GMT-6)"). Uses Intl.supportedValuesOf when available
// (Chrome 99+, Firefox 93+, Safari/iOS 15.4+ — well within Grove's real target, see
// PROJECT_CONTEXT.md §1/§14 on the iPhone-app goal) and falls back to a curated list of common
// zones on older browsers so the picker never renders empty.
const FALLBACK_ZONES = [
  'Pacific/Honolulu',
  'America/Anchorage',
  'America/Los_Angeles',
  'America/Denver',
  'America/Phoenix',
  'America/Chicago',
  'America/New_York',
  'America/Puerto_Rico',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Madrid',
  'Africa/Cairo',
  'Asia/Jerusalem',
  'Asia/Kolkata',
  'Asia/Shanghai',
  'Asia/Tokyo',
  'Australia/Sydney',
  'Pacific/Auckland',
  'UTC',
]

export type TimeZoneOption = { value: string; label: string }

function offsetLabel(zone: string, at: Date): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'shortOffset' }).formatToParts(at)
    return parts.find((p) => p.type === 'timeZoneName')?.value ?? 'GMT'
  } catch {
    return 'GMT'
  }
}

function offsetMinutes(label: string): number {
  const match = label.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/)
  if (!match) return 0
  const sign = match[1] === '-' ? -1 : 1
  return sign * (Number(match[2]) * 60 + Number(match[3] ?? 0))
}

export function detectBrowserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone
  } catch {
    return 'UTC'
  }
}

// `ensureCurrent` guarantees the caller's already-saved value is always a selectable option, even
// if it's a zone this browser's list happens to omit — otherwise a <select> silently falls back
// to its first option and the visible choice wouldn't match what's actually saved.
export function buildTimeZoneOptions(ensureCurrent?: string | null): TimeZoneOption[] {
  const now = new Date()
  const supported =
    typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : FALLBACK_ZONES
  const zones = new Set(supported)
  if (ensureCurrent) zones.add(ensureCurrent)

  return Array.from(zones)
    .map((zone) => {
      const label = offsetLabel(zone, now)
      const city = zone.split('/').pop()?.replace(/_/g, ' ') ?? zone
      return { value: zone, display: `${city} (${label})`, sortKey: offsetMinutes(label) }
    })
    .sort((a, b) => a.sortKey - b.sortKey || a.display.localeCompare(b.display))
    .map(({ value, display }) => ({ value, label: display }))
}
