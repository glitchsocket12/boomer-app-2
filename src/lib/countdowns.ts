import { supabase } from './supabase'
import { summarize } from './summarize'
import { fullName } from './personLabel'

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
  // Per-card settings (2026-08-06, second migration). All optional in TypeScript because a database
  // that hasn't had `2026-08-06-countdown-settings.sql` run yet returns rows without them — see
  // loadCountdowns's two-step select.
  custom_title?: string | null
  units?: string[] | null
  repeat_rule?: RepeatRule | null
  keep_counting?: boolean | null
}

/** How a card's date rolls forward once it passes. `null` = it happens once. */
export type RepeatRule = 'weekly' | 'monthly' | 'yearly'

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
  /** The title before any per-card rename — what the input's placeholder offers to go back to. */
  defaultTitle: string
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
  /** Chosen unit columns (see UNIT_KEYS). Empty/absent = the automatic ladder. */
  units?: UnitKey[]
  repeat?: RepeatRule | null
  /** False = retire the card once its date passes instead of counting up from it. */
  keepCounting: boolean
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

export type UnitKey = 'years' | 'months' | 'weeks' | 'days' | 'hours' | 'minutes' | 'seconds'

/** Every unit a card can be shown in, largest first — the order the settings panel lists them in. */
export const ALL_UNITS: { key: UnitKey; label: string }[] = [
  { key: 'years', label: 'Years' },
  { key: 'months', label: 'Months' },
  { key: 'weeks', label: 'Weeks' },
  { key: 'days', label: 'Days' },
  { key: 'hours', label: 'Hours' },
  { key: 'minutes', label: 'Minutes' },
  { key: 'seconds', label: 'Seconds' },
]

const UNIT_KEYS = ALL_UNITS.map((u) => u.key)

export function isUnitKey(value: string): value is UnitKey {
  return (UNIT_KEYS as string[]).includes(value)
}

/**
 * The breakdown in EXACTLY the units the founder picked, which is the whole point of choosing them:
 * pick Days alone and a wedding four years ago reads "Days 1,523", not "Days 1" with the years
 * silently dropped. Each selected unit greedily takes as much as it can and hands the remainder
 * down; whatever isn't selected gets folded into the next unit that is.
 *
 * Years and months still walk real calendar months (same reason as `breakdown`), and days are still
 * counted as calendar days so a DST change can't shave an hour off one.
 */
export function breakdownIn(from: Date, to: Date, units: UnitKey[]): DisplayUnit[] {
  const chosen = UNIT_KEYS.filter((k) => units.includes(k))
  if (chosen.length === 0) return []
  const values: Record<UnitKey, number> = {
    years: 0, months: 0, weeks: 0, days: 0, hours: 0, minutes: 0, seconds: 0,
  }
  if (to.getTime() > from.getTime()) {
    const cursor = new Date(from.getTime())
    if (chosen.includes('years')) {
      for (;;) {
        const next = addMonths(cursor, 12)
        if (next.getTime() > to.getTime()) break
        cursor.setTime(next.getTime())
        values.years++
      }
    }
    if (chosen.includes('months')) {
      // Without Years selected this counts every month since the date — "Months 50", not "Months 2".
      for (;;) {
        const next = addMonths(cursor, 1)
        if (next.getTime() > to.getTime()) break
        cursor.setTime(next.getTime())
        values.months++
      }
    }

    let dayCount = calendarDaysBetween(cursor, to)
    let restMs = msIntoDay(to) - msIntoDay(cursor)
    if (restMs < 0) {
      restMs += DAY
      dayCount -= 1
    }
    if (chosen.includes('weeks')) {
      values.weeks = Math.floor(dayCount / 7)
      dayCount -= values.weeks * 7
    }
    if (chosen.includes('days')) {
      values.days = dayCount
      dayCount = 0
    }
    // Days that no selected unit claimed become hours, so "Hours" alone reads as total hours.
    let rest = restMs + dayCount * DAY
    if (chosen.includes('hours')) {
      values.hours = Math.floor(rest / HOUR)
      rest -= values.hours * HOUR
    }
    if (chosen.includes('minutes')) {
      values.minutes = Math.floor(rest / MINUTE)
      rest -= values.minutes * MINUTE
    }
    if (chosen.includes('seconds')) values.seconds = Math.floor(rest / SECOND)
  }
  return chosen.map((key) => ({ label: ALL_UNITS.find((u) => u.key === key)!.label, value: values[key] }))
}

/**
 * Where a repeating date lands next: the first occurrence on or after today. Used for display only
 * — the underlying event/birthday keeps its real date, so an anniversary counts down to this year's
 * without the original ever moving.
 *
 * Yearly and monthly clamp (Feb 29 in a common year lands on Feb 28) rather than spilling into the
 * following month, same reasoning as addMonths.
 */
export function nextOccurrence(date: Date, rule: RepeatRule, now: Date): Date {
  const today = startOfDay(now)
  if (date.getTime() >= today.getTime()) return date
  if (rule === 'weekly') {
    const weeks = Math.ceil(calendarDaysBetween(date, today) / 7)
    const next = new Date(date.getTime())
    next.setDate(next.getDate() + weeks * 7)
    return next
  }
  const step = rule === 'yearly' ? 12 : 1
  // Jump most of the way in one multiplication, then walk — a 1941 birthday is 1000+ single-month
  // steps otherwise, on every render.
  const monthsApart =
    (today.getFullYear() - date.getFullYear()) * 12 + (today.getMonth() - date.getMonth())
  let next = addMonths(date, Math.max(0, Math.floor(monthsApart / step)) * step)
  while (next.getTime() < today.getTime()) next = addMonths(next, step)
  return next
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

/**
 * The units for one card at a given instant — direction decides which end of the pair is "now".
 *
 * A count-up normally measures to the START of today so it reads as whole days (its date has no
 * time of day to be more precise than). Picking Hours/Minutes/Seconds by hand overrides that: if
 * you asked to see seconds since something, a card frozen at midnight isn't what you meant.
 */
export function unitsForCard(card: CountdownCard, now: Date): DisplayUnit[] {
  const chosen = card.units && card.units.length > 0 ? card.units : null
  if (chosen) {
    if (card.direction === 'down') return breakdownIn(now, card.date, chosen)
    const wantsTimeOfDay = chosen.some((u) => u === 'hours' || u === 'minutes' || u === 'seconds')
    return breakdownIn(card.date, wantsTimeOfDay ? now : startOfDay(now), chosen)
  }
  const bd =
    card.direction === 'down' ? breakdown(now, card.date) : breakdown(card.date, startOfDay(now))
  return displayUnits(bd, card.direction)
}

function momentTitle(m: CountdownMoment): string {
  return m.occasion || summarize(m.occasion, m.raw_description) || 'Untitled moment'
}

function hasMilestoneTag(m: CountdownMoment): boolean {
  return (m.moment_tags ?? []).some((mt) => mt.tags?.name.trim().toLowerCase() === MILESTONE_TAG)
}

/**
 * A card's identity ACROSS a rebuild, which its `key` deliberately isn't: saving settings on a
 * derived milestone creates a row for it, and the row-backed card that replaces it has a different
 * key. Anything the UI holds onto between renders (which panel is open, which card is being
 * removed) is keyed by this instead.
 */
export function cardIdentity(card: CountdownCard): string {
  if (card.momentId) return `moment:${card.momentId}`
  if (card.reminderId) return `reminder:${card.reminderId}`
  return `row:${card.rowId}`
}

/** The per-card settings a row carries, defaulted for the derived cards that have no row. */
function settingsOf(row: CountdownRow | undefined): {
  units: UnitKey[]
  repeat: RepeatRule | null
  keepCounting: boolean
} {
  return {
    units: (row?.units ?? []).filter(isUnitKey),
    repeat: row?.repeat_rule ?? null,
    keepCounting: row?.keep_counting !== false,
  }
}

/**
 * Every card the section should show, in one chronological line: oldest at the top, then today,
 * then what's coming, soonest last. That's what the "Today" button scrolls you back to — scroll up
 * for how long it's been, scroll down for how long until. Pure — `moments`/`people` are the ones the
 * Calendar page already loaded, so this adds no queries.
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
        title: row.custom_title || row.label,
        defaultTitle: row.label,
        date: parseDateOnly(row.target_date),
        direction: 'up',
        rowId: row.id,
        derived: false,
        ...settingsOf(row),
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
      title: row.custom_title || momentTitle(moment),
      defaultTitle: momentTitle(moment),
      date: parseDateOnly(moment.event_date),
      direction: 'up',
      rowId: row.id,
      derived: hasMilestoneTag(moment),
      momentId: moment.id,
      ...settingsOf(row),
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
      defaultTitle: momentTitle(moment),
      date,
      direction: 'up',
      derived: true,
      momentId: moment.id,
      ...settingsOf(undefined),
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
      const title = `${fullName(person)}'s ${reminder.label.toLowerCase()}`
      cards.push({
        key: `reminder-${reminder.id}`,
        title: row?.custom_title || title,
        defaultTitle: title,
        date,
        direction: 'up',
        rowId: row?.id,
        derived: true,
        reminderId: reminder.id,
        personId: person.id,
        ...settingsOf(row),
      })
    }
  }

  const nowMs = now.getTime()
  const visible: CountdownCard[] = []
  for (const card of cards) {
    // A repeating card is displayed at its next occurrence, so it's always counting down to the one
    // ahead rather than up from the first one.
    if (card.repeat) card.date = nextOccurrence(card.date, card.repeat, now)
    card.direction = card.date.getTime() > nowMs ? 'down' : 'up'
    // "Stop when it passes": the card retires the day after, instead of turning into a count-up.
    if (!card.keepCounting && card.date.getTime() < todayStart.getTime()) continue
    visible.push(card)
  }

  // One timeline, oldest first: what's already happened sits above the Today line, what's ahead
  // below it, both reading outward from now.
  return visible.sort((a, b) => a.date.getTime() - b.date.getTime())
}

const BASE_COLUMNS = 'id, label, target_date, moment_id, reminder_id, hidden, created_at'
const SETTINGS_COLUMNS = 'custom_title, units, repeat_rule, keep_counting'
const COUNTDOWN_COLUMNS = `${BASE_COLUMNS}, ${SETTINGS_COLUMNS}`

// The settings columns arrived in a second migration, so every read/write here asks for them first
// and silently falls back to the original column list when the database says they don't exist. That
// keeps the gap between "code deployed" and "founder pasted the SQL" costing the settings gear only,
// not the whole section — same fail-open reasoning as `available` below, one migration finer.
let settingsColumnsMissing = false

function isMissingColumn(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false
  // 42703 = undefined_column. PostgREST also rejects the select in its own schema cache first (PGRST204).
  return error.code === '42703' || error.code === 'PGRST204' || /custom_title|units|repeat_rule|keep_counting/.test(error.message ?? '')
}

function columnList(): string {
  return settingsColumnsMissing ? BASE_COLUMNS : COUNTDOWN_COLUMNS
}

/**
 * Isolated and fail-open, the same reasoning as `loadPetsForPerson`: this table depends on a
 * migration the founder runs by hand, so a pre-migration database errors on this ONE query instead
 * of blanking the Calendar page. `available: false` means "the table isn't there yet" (as opposed
 * to "no countdowns saved") and the section hides its Add/dismiss controls — offering a write
 * against a missing table would swallow it silently, which is the house bug this repo keeps
 * catching. Derived milestones need no table and still render.
 */
export async function loadCountdowns(): Promise<{
  rows: CountdownRow[]
  available: boolean
  settingsAvailable: boolean
}> {
  let { data, error } = await supabase.from('countdowns').select(columnList())
  if (error && isMissingColumn(error)) {
    settingsColumnsMissing = true
    ;({ data, error } = await supabase.from('countdowns').select(BASE_COLUMNS))
  }
  if (error) {
    console.error('loadCountdowns: countdowns unavailable (migration not run?)', error)
    return { rows: [], available: false, settingsAvailable: false }
  }
  return { rows: (data as unknown as CountdownRow[]) ?? [], available: true, settingsAvailable: !settingsColumnsMissing }
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
    .select(columnList())
    .single()
  if (error) {
    console.error('addCountdown failed', error)
    return null
  }
  return data as unknown as CountdownRow
}

/**
 * Pin an event (existing, or one just created) onto the section. Un-hides rather than duplicates
 * when a row already exists for it — pinning a milestone that was previously dismissed is a
 * legitimate change of mind, and the partial unique index would reject a second row anyway.
 */
export async function pinMoment(momentId: string): Promise<CountdownRow | null> {
  const { data: existing } = await supabase
    .from('countdowns')
    .select(columnList())
    .eq('moment_id', momentId)
    .maybeSingle()
  if (existing) {
    const { data, error } = await supabase
      .from('countdowns')
      .update({ hidden: false })
      .eq('id', (existing as unknown as CountdownRow).id)
      .select(columnList())
      .single()
    if (error) {
      console.error('pinMoment: un-hide failed', error)
      return null
    }
    return data as unknown as CountdownRow
  }

  const user_id = await currentUserId()
  const { data, error } = await supabase
    .from('countdowns')
    .insert({ user_id, moment_id: momentId })
    .select(columnList())
    .single()
  if (error) {
    console.error('pinMoment failed', error)
    return null
  }
  return data as unknown as CountdownRow
}

/**
 * Take a card off the section. Three cases, one gesture — and the middle one is why this isn't just
 * a delete: a pinned event that ALSO qualifies as a derived milestone has to be recorded as hidden,
 * or deleting the pin would just re-derive the identical card on the next render.
 *
 * Never touches the underlying event, birthday or person.
 *
 * Returns WHAT changed rather than just "it worked", so the section can fold the one row into the
 * list it's already holding. Re-fetching instead is what made the page jump: the reload blanked the
 * section for a beat, the page got shorter, and the browser threw the scroll position away.
 */
export type DismissResult =
  | { ok: false }
  /** The row is gone — drop it from `rows`. */
  | { ok: true; removedRowId: string }
  /** A hidden row (updated, or newly inserted for a derived card) — merge it into `rows`. */
  | { ok: true; row: CountdownRow }

export async function dismissCountdown(card: CountdownCard): Promise<DismissResult> {
  if (card.rowId && !card.derived) {
    const { error } = await supabase.from('countdowns').delete().eq('id', card.rowId)
    if (error) {
      console.error('dismissCountdown: delete failed', error)
      return { ok: false }
    }
    return { ok: true, removedRowId: card.rowId }
  }
  if (card.rowId) {
    const { data, error } = await supabase
      .from('countdowns')
      .update({ hidden: true })
      .eq('id', card.rowId)
      .select(columnList())
      .single()
    if (error) {
      console.error('dismissCountdown: hide failed', error)
      return { ok: false }
    }
    return { ok: true, row: data as unknown as CountdownRow }
  }
  const user_id = await currentUserId()
  const { data, error } = await supabase
    .from('countdowns')
    .insert({
      user_id,
      hidden: true,
      moment_id: card.momentId ?? null,
      reminder_id: card.momentId ? null : card.reminderId ?? null,
    })
    .select(columnList())
    .single()
  if (error) {
    console.error('dismissCountdown: hide-derived failed', error)
    return { ok: false }
  }
  return { ok: true, row: data as unknown as CountdownRow }
}

/** What one card's settings panel can change. Anything absent is left alone. */
export type CountdownSettingsPatch = {
  custom_title?: string | null
  units?: UnitKey[] | null
  repeat_rule?: RepeatRule | null
  keep_counting?: boolean
}

/**
 * Save a card's settings, creating the row first if the card is one of the auto-derived ones (a
 * Milestone event, a birthday) that has never needed a row of its own. That insert is exactly a pin
 * — visible, pointing at the same event/reminder — so the card it produces is the card that was
 * already on screen, now with somewhere to keep its settings.
 */
export async function saveCountdownSettings(
  card: CountdownCard,
  patch: CountdownSettingsPatch
): Promise<CountdownRow | null> {
  let rowId = card.rowId
  if (!rowId) {
    const user_id = await currentUserId()
    const { data, error } = await supabase
      .from('countdowns')
      .insert({
        user_id,
        moment_id: card.momentId ?? null,
        reminder_id: card.momentId ? null : card.reminderId ?? null,
      })
      .select(columnList())
      .single()
    if (error || !data) {
      console.error('saveCountdownSettings: could not create a row for a derived card', error)
      return null
    }
    rowId = (data as unknown as CountdownRow).id
  }

  const { data, error } = await supabase
    .from('countdowns')
    .update(patch)
    .eq('id', rowId)
    .select(columnList())
    .single()
  if (error) {
    console.error('saveCountdownSettings failed', error)
    return null
  }
  return data as unknown as CountdownRow
}
