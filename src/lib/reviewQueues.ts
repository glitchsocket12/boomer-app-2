import { supabase } from './supabase'

// One source of truth for "what's waiting for me to review".
//
// Home.tsx used to run four count queries inline and Calendar.tsx two more of its own, each with
// its own filter and its own copy — so the two screens could and did disagree about how much was
// left. Everything that counts a review queue now reads from here, and ReviewInbox.tsx renders the
// same numbers as a breakdown.
//
// Nothing in this file filters anything out of a queue. The 2026-08-12 directive stands: the scan
// syncs every new event and the founder decides. These helpers only count, order and defer.

// How long "Not now" sets a calendar candidate aside for. A month is long enough to be a real
// break from the queue and short enough that the promise ("we'll bring it back") stays true within
// a season.
export const DEFER_DAYS = 30

export type ReviewCounts = {
  /** Calendar events not yet triaged — the fast Keep / Not this one list. */
  calendarToTriage: number
  /** Calendar events kept in triage, waiting for their detailed card. */
  calendarToReview: number
  /** Calendar events the founder pressed "Not now" on, whatever their return date. */
  calendarSetAside: number
  /** The soonest date a set-aside calendar event comes back (ISO), if any are set aside. */
  calendarSetAsideNext: string | null
  birthdays: number
  contactsToTriage: number
  contactsToReview: number
  photos: number
  /** Everything above that is waiting on the founder — set-aside deliberately excluded. */
  total: number
}

export const EMPTY_COUNTS: ReviewCounts = {
  calendarToTriage: 0,
  calendarToReview: 0,
  calendarSetAside: 0,
  calendarSetAsideNext: null,
  birthdays: 0,
  contactsToTriage: 0,
  contactsToReview: 0,
  photos: 0,
  total: 0,
}

/** Today as the `YYYY-MM-DD` string a `date` column compares against, in the browser's own zone. */
export function todayIso(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

/** The `deferred_until` a "Not now" pressed today should write. */
export function deferUntilIso(now: Date = new Date(), days: number = DEFER_DAYS): string {
  const then = new Date(now.getFullYear(), now.getMonth(), now.getDate() + days)
  return todayIso(then)
}

/**
 * Everything the founder still has to look at, summed the way the Home nudge shows it.
 *
 * Set-aside is deliberately NOT in the total: pressing "Not now" is supposed to take something off
 * your plate, and counting it straight back into the nudge would make the button pointless. The
 * inbox still shows it on its own row, so nothing is lost — only un-nagged.
 */
export function reviewTotal(c: Omit<ReviewCounts, 'total'>): number {
  return c.calendarToTriage + c.calendarToReview + c.birthdays + c.contactsToTriage + c.contactsToReview + c.photos
}

// Each count is its own `head: true` query, so a table that doesn't exist yet (or a status value a
// not-yet-run migration doesn't allow) fails to 0 rather than taking the whole summary down. Same
// fail-open reasoning as Home.tsx's original birthday count.
async function countRows(table: string, apply: (q: any) => any): Promise<number> {
  const { count } = await apply(supabase.from(table).select('id', { count: 'exact', head: true }))
  return count ?? 0
}

/**
 * Has `2026-08-19-calendar-triage-and-defer.sql` been run?
 *
 * Probes for the COLUMN, not the status values: PostgREST errors on an unknown column but happily
 * returns zero rows for a status value the CHECK constraint doesn't allow, so only the column is a
 * reliable signal. Until this is true the app keeps its pre-triage behaviour — ImportReview reads
 * 'pending' as it always has, and the triage page and "Not now" button stay hidden.
 *
 * Memoised for the life of the page: the answer can't change without a SQL run, and every screen
 * that needs it would otherwise repeat the query.
 */
let triageProbe: Promise<boolean> | null = null

export function probeTriageEnabled(): Promise<boolean> {
  if (!triageProbe) {
    triageProbe = (async () => {
      const { error } = await supabase.from('moment_import_candidates').select('id, deferred_until').limit(1)
      return !error
    })()
  }
  return triageProbe
}

/** Test seam — the memo would otherwise leak between cases. */
export function resetTriageProbe() {
  triageProbe = null
}

/**
 * Puts every set-aside calendar candidate whose date has arrived back into the review queue.
 *
 * Idempotent and near-free: it matches only rows that have actually come due (a partial index
 * covers exactly this predicate), so on most visits it updates nothing. Called on load by the
 * inbox and by the review queue rather than run on a schedule — the same "cheap self-healing sweep
 * on the screen that cares" shape as sweepImplausibleMatches in ContactImportReview.tsx.
 */
export async function wakeDueDeferrals(): Promise<void> {
  if (!(await probeTriageEnabled())) return
  await supabase
    .from('moment_import_candidates')
    .update({ status: 'selected', deferred_until: null })
    .eq('status', 'deferred')
    .lte('deferred_until', todayIso())
}

export async function loadReviewCounts(): Promise<ReviewCounts> {
  const triageEnabled = await probeTriageEnabled()

  // Pre-migration there is no triage stage, so every pending calendar candidate is waiting on the
  // detailed card — which is exactly where ImportReview still reads it from. Reporting it as
  // "to triage" would point the founder at a page that isn't switched on yet.
  const [calendarPending, calendarSelected, birthdays, contactsPending, contactsSelected, photos] = await Promise.all([
    countRows('moment_import_candidates', (q) => q.eq('status', 'pending')),
    triageEnabled ? countRows('moment_import_candidates', (q) => q.eq('status', 'selected')) : Promise.resolve(0),
    countRows('birthday_import_candidates', (q) => q.eq('status', 'pending')),
    countRows('contact_import_candidates', (q) => q.eq('status', 'pending')),
    countRows('contact_import_candidates', (q) => q.eq('status', 'selected')),
    countRows('photo_clusters', (q) => q.eq('status', 'pending')),
  ])

  let setAside = 0
  let setAsideNext: string | null = null
  if (triageEnabled) {
    setAside = await countRows('moment_import_candidates', (q) => q.eq('status', 'deferred'))
    if (setAside > 0) {
      const { data } = await supabase
        .from('moment_import_candidates')
        .select('deferred_until')
        .eq('status', 'deferred')
        .order('deferred_until', { ascending: true })
        .limit(1)
      setAsideNext = data?.[0]?.deferred_until ?? null
    }
  }

  const counts = {
    calendarToTriage: triageEnabled ? calendarPending : 0,
    calendarToReview: triageEnabled ? calendarSelected : calendarPending,
    calendarSetAside: setAside,
    calendarSetAsideNext: setAsideNext,
    birthdays,
    contactsToTriage: contactsPending,
    contactsToReview: contactsSelected,
    photos,
  }
  return { ...counts, total: reviewTotal(counts) }
}
