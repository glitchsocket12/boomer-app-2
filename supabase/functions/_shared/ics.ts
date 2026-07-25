// Minimal RFC5545 (iCalendar) VEVENT parser — extracts only the fields the calendar-import
// pipeline needs (UID, SUMMARY, DESCRIPTION, LOCATION, DTSTART, STATUS, RECURRENCE-ID, RRULE
// presence, ATTENDEE). Not a full spec implementation (no property values besides these),
// deliberately — every calendar host (Google, Apple, Outlook) emits these fields in the same
// simple forms, and pulling in a full ICS library for this would be overkill. icsDateToIsoDate
// below does use the platform's real IANA tz database (via Intl) for the one case that actually
// needs it — a UTC-stamped DTSTART.

import { isoDateInTimeZone } from "./tz.ts"

export type IcsAttendee = { name: string | null; email: string | null }

export type IcsEvent = {
  uid: string
  summary: string | null
  description: string | null
  location: string | null
  dtstart: string | null
  dtstartIsDateOnly: boolean
  status: string | null
  recurrenceId: string | null
  isRecurring: boolean
  attendees: IcsAttendee[]
}

function unescapeText(v: string): string {
  return v.replace(/\\n/gi, "\n").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\")
}

// Folded lines (RFC5545 §3.1): a line longer than 75 octets continues on the next line, which
// starts with a single space or tab that must be stripped before rejoining.
function unfold(text: string): string[] {
  const rawLines = text.split(/\r\n|\n|\r/)
  const lines: string[] = []
  for (const line of rawLines) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && lines.length > 0) {
      lines[lines.length - 1] += line.slice(1)
    } else {
      lines.push(line)
    }
  }
  return lines
}

function parseLine(line: string): { name: string; params: Record<string, string>; value: string } | null {
  const colonIdx = line.indexOf(":")
  if (colonIdx === -1) return null
  const head = line.slice(0, colonIdx)
  const value = line.slice(colonIdx + 1)
  const parts = head.split(";")
  const name = parts[0].toUpperCase()
  const params: Record<string, string> = {}
  for (const p of parts.slice(1)) {
    const eq = p.indexOf("=")
    if (eq === -1) continue
    params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, "")
  }
  return { name, params, value }
}

export function parseIcs(text: string): IcsEvent[] {
  const lines = unfold(text)
  const events: IcsEvent[] = []
  let current: (Partial<IcsEvent> & { attendees: IcsAttendee[] }) | null = null

  for (const rawLine of lines) {
    const trimmed = rawLine.trimEnd()
    if (trimmed === "BEGIN:VEVENT") {
      current = { attendees: [] }
      continue
    }
    if (trimmed === "END:VEVENT") {
      if (current && current.uid) {
        events.push({
          uid: current.uid,
          summary: current.summary ?? null,
          description: current.description ?? null,
          location: current.location ?? null,
          dtstart: current.dtstart ?? null,
          dtstartIsDateOnly: current.dtstartIsDateOnly ?? false,
          status: current.status ?? null,
          recurrenceId: current.recurrenceId ?? null,
          isRecurring: current.isRecurring ?? false,
          attendees: current.attendees,
        })
      }
      current = null
      continue
    }
    if (!current) continue

    const parsed = parseLine(trimmed)
    if (!parsed) continue

    switch (parsed.name) {
      case "UID":
        current.uid = parsed.value
        break
      case "SUMMARY":
        current.summary = unescapeText(parsed.value)
        break
      case "DESCRIPTION":
        current.description = unescapeText(parsed.value)
        break
      case "LOCATION":
        current.location = unescapeText(parsed.value)
        break
      case "DTSTART":
        current.dtstart = parsed.value
        current.dtstartIsDateOnly = parsed.params["VALUE"] === "DATE" || /^\d{8}$/.test(parsed.value)
        break
      case "STATUS":
        current.status = parsed.value.toUpperCase()
        break
      case "RECURRENCE-ID":
        current.recurrenceId = parsed.value
        break
      case "RRULE":
        current.isRecurring = true
        break
      case "ATTENDEE": {
        const email = parsed.value.replace(/^mailto:/i, "").trim() || null
        const name = parsed.params["CN"] ?? null
        current.attendees.push({ name, email })
        break
      }
    }
  }

  return events
}

// DTSTART shows up as "20260803" (date-only), "20260803T140000" (floating local time, no
// timezone attached — conventionally read as whoever's viewing it, so the date portion is already
// the intended wall date), or "20260803T140000Z" (UTC). The pipeline only needs a sortable
// calendar date, not exact time — for the first two forms that's just the leading YYYY-MM-DD, but
// a UTC timestamp has to be converted into the given IANA time zone first, or an evening event
// (UTC midnight falls in the afternoon/evening across the US) lands one day late.
export function icsDateToIsoDate(dtstart: string, timeZone = "UTC"): string | null {
  const utcMatch = dtstart.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/)
  if (utcMatch) {
    const [, y, mo, d, h, mi, s] = utcMatch
    const instant = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s)))
    return isoDateInTimeZone(instant, timeZone)
  }
  const match = dtstart.match(/^(\d{4})(\d{2})(\d{2})/)
  if (!match) return null
  return `${match[1]}-${match[2]}-${match[3]}`
}
