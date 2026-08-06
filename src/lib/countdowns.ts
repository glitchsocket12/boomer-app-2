import { supabase } from './supabase'
import { summarize } from './summarize'

// Countdowns (2026-08-06) — the Calendar page's "how long it's been / how long until" cards.
//
// Two sources, and the split matters: MOST cards are DERIVED live from data already on file (past
// moments tagged "Milestone", plus birthdays/anniversaries that have a year), so the founder gets a
// populated section without adding anything. The `countdowns` table only holds what they added, what
// they pinned, and which derived cards they dismissed — see the migration header for the three row
// shapes.
//
// This module owns the date math and the write path. `buildCards` is deliberately a pure function
// (no queries, no callbacks) so the unit-selection and calendar arithmetic are testable — that math
// is the whole feature and it's the easy thing to get subtly wrong.

export type CountdownRow = {
  id: string
  label: string | null
  target_date: string | null
  moment_id: string | null
  reminder_id: string | null
  hidden: boolean
  created_at: string
}

/** The subset of a `moments` row this section needs. Calendar.tsx's MomentRow satisfies it. */
export type CountdownMoment = {
  id: string
  occasion: string | null
  raw_description: string
  event_date: string
  created_at: string
  moment_tags: { tags: { id: string; name: string } | null }[]
}

/** The subset of a `people` row this section needs. Calendar.tsx's PersonRow satisfies it. */
export type CountdownPerson = {
  id: string
  name: string
  last_name: string | null
  deceased_date?: string | null
  reminders: { id: string; label: string; month: number; day: number; year?: number | null }[]
}

export type CountdownCard = {
  key: string
  title: string
  /** Local midnight of the subject date — see parseDateOnly for why never a bare `new Date(iso)`. */
  date: Date
  /** 'up' = time since (past), 'down' = time until (future). */
  direction: 'up' | 'down'
  /** Present when a `countdowns` row backs this card (added, or pinned). */
  rowId?: string
  /** True when this card would also exist with no row at all (a Milestone event / dated reminder). */
  derived: boolean
  momentId?: string
  reminderId?: string
  personId?: string
}

export type Breakdown = {
  years: number
  months: number
  weeks: number
  days: number
  hours: number
  minutes: number
  seconds: number
}

export type DisplayUnit = { label: string; value: number }

const SECOND = 1000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** The starter tag (lib/ensureStarterTags.ts) that opts a past event into an auto count-up. */
export const MILESTONE_TAG = 'milestone'

/**
 * Local midnight for a "YYYY-MM-DD" column. A bare `new Date('2026-08-06')` is parsed as UTC
 * midnight and displays as the previous day west of UTC — the exact bug class in PROJECT_CONTEXT
 * §12. Every date column in this module goes through here.
 */
export function parseDateOnly(iso: string): Date {
  return new Date(`${iso}T00:00:00`)
}

export function startOfDay(d: Date): Date {
  const copy = new Date(d.getTime())
  copy.setHours(0, 0, 0, 0)
  return copy
}

/**
 * Month arithmetic that CLAMPS instead of overflowing: Jan 31 + 1 month is Feb 28, not Mar 3
 * (which is what `setMonth` alone gives you). Without this, "1 month since January 31st" would
 * start counting negative days.
 */
function addMonths(d: Date, count: number): Date {
  const result = new Date(d.getTime())
  const day = result.getDate()
  result.setDate(1)
  result.setMonth(result.getMonth() + count)
  const lastDayOfTargetMonth = new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate()
  result.setDate(Math.min(day, lastDayOfTargetMonth))
  return result
}

/** Whole calendar days between two instants, immune to DST (a local day can be 23 or 25 hours). */
function calendarDaysBetween(from: Date, to: Date): number {
  const a = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate())
  const b = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate())
  return Math.round((b - a) / DAY)
}

function msIntoDay(d: Date): number {
  return d.getHours() * HOUR + d.getMinutes() * MINUTE + d.getSeconds() * SECOND + d.getMilliseconds()
}

/**
 * Calendar-correct elapsed time from `from` to `to` (assumes from <= to; a reversed pair returns
 * all zeroes). Years and months are counted by walking real calendar months rather than dividing
 * milliseconds, because "1 month" has to mean a month — a 30.44-day average would render "1 month
 * ago" on the 30th of a 31-day month and be wrong on every card in February.
 */
export function breakdown(from: Date, to: Date): Breakdown {
  const empty = { years: 0, months: 0, weeks: 0, days: 0, hours: 0, minutes: 0, seconds: 0 }
  if (to.getTime() <= from.getTime()) return empty

  const cursor = new Date(from.getTime())
  let years = 0
  for (;;) {
    const next = addMonths(cursor, 12)
    if (next.getTime() > to.getTime()) break
    cursor.setTime(next.getTime())
    years++
  }
  let months = 0
  for (;;) {
    const next = addMonths(cursor, 1)
    if (next.getTime() > to.getTime()) break
    cursor.setTime(next.getTime())
    months++
  }

  // Days are counted as calendar days and the time-of-day remainder handled separately, so a DST
  // boundary inside the remainder can't shave an hour off the day count.
  let dayCount = calendarDaysBetween(cursor, to)
  let restMs = msIntoDay(to) - msIntoDay(cursor)
  if (restMs < 0) {
    restMs += DAY
    dayCount -= 1
  }

  const weeks = Math.floor(dayCount / 7)
  const days = dayCount % 7
  const hours = Math.floor(restMs / HOUR)
  const minutes = Math.floor((restMs % HOUR) / MINUTE)
  const seconds = Math.floor((restMs % MINUTE) / SECOND)

  return { years, months, weeks, days, hours, minutes, seconds }
}

const UP_LADDER: { label: string; key: keyof Breakdown }[] = [
  { label: 'Years', key: 'years' },
  { label: 'Months', key: 'months' },
  { label: 'Weeks', key: 'weeks' },
  { label: 'Days', key: 'days' },
]
const DOWN_LADDER: { label: string; key: keyof Breakdown }[] = [
  ...UP_LADDER,
  { label: 'Hours', key: 'hours' },
  { label: 'Minutes', key: 'minutes' },
  { label: 'Seconds', key: 'seconds' },
]

/**
 * Which unit columns a card shows: four at most, starting at the largest non-zero unit, keeping
 * interior zeroes because they're part of the reading — "Years 4 · Months 2 · Weeks 0 · Days 1".
 *
 * Count-UPS stop at days (the subject is a stored `date` with no time of day, so an hours column
 * there would be precision the data doesn't have) and trim trailing zeroes, so a static "1 year and
 * 6 months ago" reads as "Years 1 · Months 6" instead of padding out two empty columns.
 *
 * Count-DOWNS run all the way to seconds — that's what makes something you're waiting for feel
 * close — and deliberately DON'T trim: a ticking card whose last column vanished every time seconds
 * or minutes hit zero would reflow its own layout once a minute.
 *
 * Returns [] when a count-up is under a day old — the card renders "Today" instead of "Days 0".
 */
export function displayUnits(bd: Breakdown, direction: 'up' | 'down'): DisplayUnit[] {
  const ladder = direction === 'up' ? UP_LADDER : DOWN_LADDER
  const firstNonZero = ladder.findIndex((u) => bd[u.key] > 0)
  if (firstNonZero === -1) return []
  const window = ladder.slice(firstNonZero, firstNonZero + 4).map((u) => ({ label: u.label, value: bd[u.key] }))
  if (direction === 'up') {
    while (window.length > 1 && window[window.length - 1].value === 0) window.pop()
  }
  return window
}

/**
 * How often the section needs to re-render: every second only when something on screen actually
 * shows minutes or seconds (a countdown inside a week), otherwise once a minute to keep an hours
 * column honest. A page-wide 1s tick for a screen full of "Years 4 · Months 2" cards is wasted
 * renders.
 */
export function tickMs(cards: CountdownCard[], now: Date): number {
  for (const card of cards) {
    const units = unitsForCard(card, now)
    if (units.some((u) => u.label === 'Seconds' || u.label === 'Minutes')) return SECOND
  }
  return MINUTE
}

/** The units for one card at a given instant — direction decides which end of the pair is "now". */
export function unitsForCard(card: CountdownCard, now: Date): DisplayUnit[] {
  const bd =
    card.direction === 'down' ? breakdown(now, card.date) : breakdown(card.date, startOfDay(now))
  return displayUnits(bd, card.direction)
}

function fullName(p: { name: string; last_name: string | null }): string {
  return p.last_name ? `${p.name} ${p.last_name}` : p.name
}

function momentTitle(m: CountdownMoment): string {
  return m.occasion || summarize(m.occasion, m.raw_description) || 'Untitled moment'
}

function hasMilestoneTag(m: CountdownMoment): boolean {
  return (m.moment_tags ?? []).some((mt) => mt.tags?.name.trim().toLowerCase() === MILESTONE_TAG)
}

/**
 * Every card the section should show, ordered: what's coming (soonest first), then what's already
 * happened (most recent first). Pure — `moments`/`people` are the ones the Calendar page already
 * loaded, so this adds no queries.
 *
 * A moment with a row AND a Milestone tag renders once, from the row, with `derived: true` — that
 * flag is what stops dismissing a pinned milestone from immediately re-deriving the same card.
 */
export function buildCards({
  moments,
  people,
  rows,
  now,
}: {
  moments: CountdownMoment[]
  people: CountdownPerson[]
  rows: CountdownRow[]
  now: Date
}): CountdownCard[] {
  const momentById = new Map(moments.map((m) => [m.id, m]))
  const rowByMoment = new Map<string, CountdownRow>()
  const rowByReminder = new Map<string, CountdownRow>()
  const cards: CountdownCard[] = []

  for (const row of rows) {
    if (row.moment_id) rowByMoment.set(row.moment_id, row)
    else if (row.reminder_id) rowByReminder.set(row.reminder_id, row)
    else if (!row.hidden && row.label && row.target_date) {
      cards.push({
        key: `countdown-${row.id}`,
        title: row.label,
        date: parseDateOnly(row.target_date),
        direction: 'up',
        rowId: row.id,
        derived: false,
      })
    }
  }

  // Pinned events. A row whose moment lost its date (or was deleted before this page's data was
  // loaded) has nothing to count to, so it's skipped rather than rendered dateless.
  for (const [momentId, row] of rowByMoment) {
    if (row.hidden) continue
    const moment = momentById.get(momentId)
    if (!moment) continue
    cards.push({
      key: `countdown-${row.id}`,
      title: momentTitle(moment),
      date: parseDateOnly(moment.event_date),
      direction: 'up',
      rowId: row.id,
      derived: hasMilestoneTag(moment),
      momentId: moment.id,
    })
  }

  // Auto-derived milestones: past events the founder tagged "Milestone".
  const todayStart = startOfDay(now)
  for (const moment of moments) {
    if (rowByMoment.has(moment.id)) continue
    if (!hasMilestoneTag(moment)) continue
    const date = parseDateOnly(moment.event_date)
    if (date.getTime() > todayStart.getTime()) continue
    cards.push({
      key: `milestone-${moment.id}`,
      title: momentTitle(moment),
      date,
      direction: 'up',
      derived: true,
      momentId: moment.id,
    })
  }

  // Auto-derived life dates: a birthday/anniversary is only a milestone once a YEAR is on file
  // (first UI use of reminders.year, captured by the birthday-calendar import since 2026-07-26).
  // Deceased people are left out on purpose — a ticking count-up of the birthdays since someone
  // died is not what this section is for.
  for (const person of people) {
    if (person.deceased_date) continue
    for (const reminder of person.reminders ?? []) {
      if (!reminder.year) continue
      const row = rowByReminder.get(reminder.id)
      if (row?.hidden) continue
      const date = new Date(reminder.year, reminder.month - 1, reminder.day)
      if (date.getTime() > todayStart.getTime()) continue
      cards.push({
        key: `reminder-${reminder.id}`,
        title: `${fullName(person)}'s ${reminder.label.toLowerCase()}`,
        date,
        direction: 'up',
        rowId: row?.id,
        derived: true,
        reminderId: reminder.id,
        personId: person.id,
      })
    }
  }

  const nowMs = now.getTime()
  for (const card of cards) card.direction = card.date.getTime() > nowMs ? 'down' : 'up'

  return cards.sort((a, b) => {
    const aFuture = a.direction === 'down'
    const bFuture = b.direction === 'down'
    if (aFuture !== bFuture) return aFuture ? -1 : 1
    // Coming up: soonest first. Already happened: most recent first.
    return aFuture ? a.date.getTime() - b.date.getTime() : b.date.getTime() - a.date.getTime()
  })
}

const COUNTDOWN_COLUMNS = 'id, label, target_date, moment_id, reminder_id, hidden, created_at'

/**
 * Isolated and fail-open, the same reasoning as `loadPetsForPerson`: this table depends on a
 * migration the founder runs by hand, so a pre-migration database errors on this ONE query instead
 * of blanking the Calendar page. `available: false` means "the table isn't there yet" (as opposed
 * to "no countdowns saved") and the section hides its Add/dismiss controls — offering a write
 * against a missing table would swallow it silently, which is the house bug this repo keeps
 * catching. Derived milestones need no table and still render.
 */
export async function loadCountdowns(): Promise<{ rows: CountdownRow[]; available: boolean }> {
  const { data, error } = await supabase.from('countdowns').select(COUNTDOWN_COLUMNS)
  if (error) {
    console.error('loadCountdowns: countdowns unavailable (migration not run?)', error)
    return { rows: [], available: false }
  }
  return { rows: (data as CountdownRow[]) ?? [], available: true }
}

async function currentUserId(): Promise<string | undefined> {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  return user?.id
}

/** A countdown that is only a countdown — "Baby due date", not an event with attendees. */
export async function addCountdown(label: string, targetDate: string): Promise<CountdownRow | null> {
  const user_id = await currentUserId()
  const { data, error } = await supabase
    .from('countdowns')
    .insert({ user_id, label, target_date: targetDate })
    .select(COUNTDOWN_COLUMNS)
    .single()
  if (error) {
    console.error('addCountdown failed', error)
    return null
  }
  return data as CountdownRow
}

/**
 * Pin an event (existing, or one just created) onto the section. Un-hides rather than duplicates
 * when a row already exists for it — pinning a milestone that was previously dismissed is a
 * legitimate change of mind, and the partial unique index would reject a second row anyway.
 */
export async function pinMoment(momentId: string): Promise<CountdownRow | null> {
  const { data: existing } = await supabase
    .from('countdowns')
    .select(COUNTDOWN_COLUMNS)
    .eq('moment_id', momentId)
    .maybeSingle()
  if (existing) {
    const { data, error } = await supabase
      .from('countdowns')
      .update({ hidden: false })
      .eq('id', (existing as CountdownRow).id)
      .select(COUNTDOWN_COLUMNS)
      .single()
    if (error) {
      console.error('pinMoment: un-hide failed', error)
      return null
    }
    return data as CountdownRow
  }

  const user_id = await currentUserId()
  const { data, error } = await supabase
    .from('countdowns')
    .insert({ user_id, moment_id: momentId })
    .select(COUNTDOWN_COLUMNS)
    .single()
  if (error) {
    console.error('pinMoment failed', error)
    return null
  }
  return data as CountdownRow
}

/**
 * Take a card off the section. Three cases, one gesture — and the middle one is why this isn't just
 * a delete: a pinned event that ALSO qualifies as a derived milestone has to be recorded as hidden,
 * or deleting the pin would just re-derive the identical card on the next render.
 *
 * Never touches the underlying event, birthday or person.
 */
export async function dismissCountdown(card: CountdownCard): Promise<boolean> {
  if (card.rowId && !card.derived) {
    const { error } = await supabase.from('countdowns').delete().eq('id', card.rowId)
    if (error) console.error('dismissCountdown: delete failed', error)
    return !error
  }
  if (card.rowId) {
    const { error } = await supabase.from('countdowns').update({ hidden: true }).eq('id', card.rowId)
    if (error) console.error('dismissCountdown: hide failed', error)
    return !error
  }
  const user_id = await currentUserId()
  const { error } = await supabase.from('countdowns').insert({
    user_id,
    hidden: true,
    moment_id: card.momentId ?? null,
    reminder_id: card.momentId ? null : card.reminderId ?? null,
  })
  if (error) console.error('dismissCountdown: hide-derived failed', error)
  return !error
}
