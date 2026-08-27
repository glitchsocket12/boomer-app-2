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

/**
 * What "Remind Me" offers. Stored and applied as a plain day count (see
 * `2026-08-19-review-remind-default.sql`), so changing this list is a frontend edit with no
 * migration behind it.
 */
export const REMIND_OPTIONS: { label: string; days: number }[] = [
  { label: 'In a week', days: 7 },
  { label: 'In a month', days: 30 },
  { label: 'In 3 months', days: 90 },
  { label: 'In 6 months', days: 180 },
]

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
  /** People with no gender recorded — a cleanup pass, not an import queue. See reviewTotal. */
  genderGaps: number
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
  genderGaps: 0,
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
 *
 * Neither is `genderGaps`. It's a one-time cleanup pass rather than something that arrived and
 * needs deciding, and a few hundred blank genders would swamp a number whose whole job is to mean
 * "this much is waiting on you". It gets its own quiet row on the inbox instead.
 *
 * And NEITHER "still to look through" pile — `calendarToTriage`, `contactsToTriage` — for the same
 * reason, restored 2026-08-22 after a 1,300-event sync made Home read "1,300 things to review".
 * That number IS the overwhelm: an untriaged pile is a resting state, not a queue with your name on
 * it. ContactSelection was built this way from the start — Home counted only `selected`, with the
 * undecided count in a quieter secondary line, precisely so "a founder mid-way through curating a
 * large contacts file shouldn't feel nagged about the ones they haven't gotten to yet" — and
 * folding every pile into one number when this module was written quietly threw that away.
 *
 * What's left is the honest reading of the nudge: things you have already said yes to looking at.
 * Both piles keep their own quiet rows on ReviewInbox, so nothing is hidden and no count is lost.
 */
export function reviewTotal(c: Omit<ReviewCounts, 'total'>): number {
  return c.calendarToReview + c.birthdays + c.contactsToReview + c.photos
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

// Home → inbox → back to Home re-mounts three components that each want the same numbers, at
// 6-8 count queries a time. The answer can only change when this browser writes a review decision,
// so hold it until something does. `invalidateReviewCounts()` is that signal.
let countsCache: Promise<ReviewCounts> | null = null

/** Call after any write that changes a queue's size. Cheap to over-call. */
export function invalidateReviewCounts() {
  countsCache = null
}

export function loadReviewCounts(): Promise<ReviewCounts> {
  if (!countsCache) countsCache = fetchReviewCounts()
  return countsCache
}

async function fetchReviewCounts(): Promise<ReviewCounts> {
  const triageEnabled = await probeTriageEnabled()

  // Pre-migration there is no triage stage, so every pending calendar candidate is waiting on the
  // detailed card — which is exactly where ImportReview still reads it from. Reporting it as
  // "to triage" would point the founder at a page that isn't switched on yet.
  const [calendarPending, calendarSelected, birthdays, contactsPending, contactsSelected, photos, genderGaps] =
    await Promise.all([
      countRows('moment_import_candidates', (q) => q.eq('status', 'pending')),
      triageEnabled ? countRows('moment_import_candidates', (q) => q.eq('status', 'selected')) : Promise.resolve(0),
      countRows('birthday_import_candidates', (q) => q.eq('status', 'pending')),
      countRows('contact_import_candidates', (q) => q.eq('status', 'pending')),
      countRows('contact_import_candidates', (q) => q.eq('status', 'selected')),
      countRows('photo_clusters', (q) => q.eq('status', 'pending')),
      // Same isolated, fail-open query People.tsx already runs for its "Fill in gender for N
      // people" link — `gender` arrived by migration, so a missing column degrades to 0 rather
      // than taking the whole summary down.
      countRows('people', (q) => q.is('gender', null)),
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
    genderGaps,
  }
  return { ...counts, total: reviewTotal(counts) }
}

/**
 * The founder's saved "remind me in N days", or null if they haven't set one — in which case the
 * Remind Me sheet asks. Its own isolated query so that a not-yet-run
 * `2026-08-19-review-remind-default.sql` means "no default saved" rather than a broken button.
 */
export async function loadRemindDays(): Promise<number | null> {
  const { data, error } = await supabase.from('user_settings').select('review_remind_days').maybeSingle()
  if (error) return null
  return (data?.review_remind_days as number | null) ?? null
}

/** Upsert, not update: an account that has never opened Settings has no user_settings row yet. */
export async function saveRemindDays(days: number): Promise<void> {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return
  await supabase
    .from('user_settings')
    .upsert({ user_id: user.id, review_remind_days: days }, { onConflict: 'user_id' })
}
