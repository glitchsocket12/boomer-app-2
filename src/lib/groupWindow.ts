import { normalizeLocation } from './locationGroups'
import { daysInSpan } from './eventSpan'

// "This group is a thing that happens at a time and a place." Founder report, 2026-08-23: they
// created a group for a week-long Navy course in Pensacola, posted "just landed in Pensacola" on
// its first day, and nothing connected the two. Nothing could have — a group was a name, a type
// and a member list, so neither the chat brain nor the suggestion card had a date or a place to
// reason from (see the migration comment in migrations_manual/2026-08-23-group-active-window.sql).
//
// This module owns the rules for "does this event fall inside this group's window", kept pure so
// the thresholds are testable without a database — same split lib/suggestEventGroups.ts and
// lib/locationGroups.ts already make.

export type GroupWindow = {
  start_date: string | null
  end_date: string | null
  location: string | null
}

/** The stretch of days an event covers, as lib/eventSpan.ts computes it. */
export type Span = { start: string; end: string }

/**
 * A window longer than this can't justify a match on dates alone.
 *
 * The whole point of the signal is "these dates are the same thing" — which reads as true for a
 * five-day course and as nonsense for "Air Force Academy, 2010–2014", where a date match would
 * claim every event across four years. Past this length the location has to agree too.
 *
 * Deliberately NOT eventSpan.ts's MAX_SPAN_DAYS, which is also 31 but means something else
 * entirely (a trip longer than that is a mistyped end date). Two different ideas that happen to
 * land on the same number — coupling them would make one of them wrong the first time either
 * is tuned.
 */
export const MAX_BOUNDED_WINDOW_DAYS = 31

// Tokens that carry no place-identity of their own, so two locations sharing only these share
// nothing. State abbreviations are the ones that matter ("Pensacola, FL" vs "Portland, FL" must
// not match on "fl"), but they're all under the 4-character floor in tokensOf anyway — the real
// work here is done on the longer generic words a base or address picks up.
const PLACE_STOPWORDS = new Set([
  'base', 'city', 'town', 'county', 'north', 'south', 'east', 'west', 'saint',
  'fort', 'camp', 'station', 'airport', 'downtown', 'united', 'states',
])

/**
 * The identity-bearing words in a location string: normalized, 4 characters or longer, and not
 * generic. The floor is what drops street numbers, state abbreviations and "the"/"at" without
 * needing to enumerate them.
 */
function tokensOf(value: string): Set<string> {
  return new Set(
    normalizeLocation(value)
      .split(' ')
      .filter((t) => t.length >= 4 && !PLACE_STOPWORDS.has(t))
  )
}

/**
 * Whether two free-text locations name the same place.
 *
 * One shared identity-bearing word is the bar, which is what makes "Pensacola", "Pensacola, FL"
 * and "NAS Pensacola" all agree — the founder will type all three across a week and none of them
 * is wrong. It deliberately does NOT collapse "Denver Zoo" into "Denver, CO": "denver" is shared,
 * so those two DO match here, which is correct for this use (a group located in Denver really is
 * relevant to an event at the Denver Zoo) even though lib/locationGroups.ts refuses to MERGE
 * them. Different question, different answer: that module rewrites stored data and must never be
 * wrong; this one only decides whether to ask.
 */
export function locationsMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a?.trim() || !b?.trim()) return false
  const at = tokensOf(a)
  if (at.size === 0) return false
  for (const token of tokensOf(b)) {
    if (at.has(token)) return true
  }
  return false
}

/** Inclusive overlap between a group's window and an event's span. An open end runs forever. */
export function windowOverlapsSpan(group: GroupWindow, span: Span): boolean {
  if (!group.start_date) return false
  if (span.end < group.start_date) return false
  if (group.end_date && span.start > group.end_date) return false
  return true
}

/** How many days a window covers, or null when it has no end (open-ended runs forever). */
export function windowLengthDays(group: GroupWindow): number | null {
  if (!group.start_date || !group.end_date) return null
  if (group.end_date < group.start_date) return null
  return daysInSpan(group.start_date, group.end_date)
}

export type WindowMatch =
  /** Dates line up and the window is short enough to mean something on its own. */
  | { kind: 'dates' }
  /** Dates line up and so does the place — the strongest signal there is. */
  | { kind: 'dates_and_place' }

/**
 * Does this event belong to this group, judged only on when and where?
 *
 * The bar is PRECISION, the same call suggestEventGroups.ts made for its attendance rule: this
 * ends up as a card asking the founder a question, and a wrong question costs more than a
 * missing one. So there are exactly two ways through:
 *
 *   - a CLOSED window of at most MAX_BOUNDED_WINDOW_DAYS days that the event overlaps; or
 *   - any window the event overlaps, when the two locations also name the same place.
 *
 * A long or open-ended window with no location agreement returns null, which is why a group like
 * "Air Force Academy, 2010–2014" stays silent instead of claiming four years of events.
 */
export function matchGroupWindow(
  group: GroupWindow,
  span: Span | null,
  eventLocation: string | null | undefined
): WindowMatch | null {
  if (!span) return null
  if (!windowOverlapsSpan(group, span)) return null

  if (locationsMatch(group.location, eventLocation)) return { kind: 'dates_and_place' }

  const length = windowLengthDays(group)
  if (length !== null && length <= MAX_BOUNDED_WINDOW_DAYS) return { kind: 'dates' }
  return null
}
