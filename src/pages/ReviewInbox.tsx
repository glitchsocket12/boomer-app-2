import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { formatDateRange } from '../lib/dates'
import {
  EMPTY_COUNTS,
  loadReviewCounts,
  probeTriageEnabled,
  todayIso,
  wakeDueDeferrals,
  type ReviewCounts,
} from '../lib/reviewQueues'
import { border, colors, fontFamily, fontSize, maxWidth, radius, space } from '../lib/theme'

// The one place that answers "what's waiting for me?".
//
// Home used to stack up to FOUR separate "N found" nudges — calendar events, birthdays, contacts
// selected, contacts still undecided — each shouting its own number with no shared context and no
// single destination. Four pipelines is an implementation detail; the founder just wants to know
// whether there's anything to do. So Home now shows one line, and the breakdown lives here.
//
// Every row is a link to a queue that already existed. This page adds no new review mechanics of
// its own — it's a table of contents, plus the one thing that genuinely belongs at this level: the
// set-aside pile, which is cross-cutting and shouldn't nag from inside the queue it came from.
export default function ReviewInbox({
  onBack,
  backLabel,
  onOpenCalendarTriage,
  onOpenImportReview,
  onOpenBirthdayReview,
  onOpenContactSelection,
  onOpenContactImportReview,
  onOpenPhotoImport,
  onOpenGenderFill,
}: {
  onBack: () => void
  backLabel: string
  onOpenCalendarTriage: () => void
  onOpenImportReview: () => void
  onOpenBirthdayReview: () => void
  onOpenContactSelection: () => void
  onOpenContactImportReview: () => void
  onOpenPhotoImport: () => void
  onOpenGenderFill: () => void
}) {
  const [counts, setCounts] = useState<ReviewCounts>(EMPTY_COUNTS)
  const [triageEnabled, setTriageEnabled] = useState(true)
  const [loading, setLoading] = useState(true)
  const [waking, setWaking] = useState(false)

  useEffect(() => {
    load()
  }, [])

  async function load() {
    setLoading(true)
    // Anything whose "bring it back in a month" date has arrived rejoins the queue before the
    // numbers are counted, so the row the founder reads is already true.
    await wakeDueDeferrals()
    const [enabled, next] = await Promise.all([probeTriageEnabled(), loadReviewCounts()])
    setTriageEnabled(enabled)
    setCounts(next)
    setLoading(false)
  }

  // "Show them now" on the set-aside row: pull everything back into the queue rather than making
  // the founder wait out a deadline they set themselves.
  async function wakeAllDeferred() {
    setWaking(true)
    await supabase
      .from('moment_import_candidates')
      .update({ status: 'selected', deferred_until: null })
      .eq('status', 'deferred')
    await load()
    setWaking(false)
  }

  const rows: { key: string; label: string; count: number; blurb: string; onOpen: () => void; quiet?: boolean }[] = []

  if (counts.calendarToReview > 0) {
    rows.push({
      key: 'calendar-review',
      label: `${counts.calendarToReview.toLocaleString()} calendar event${counts.calendarToReview === 1 ? '' : 's'} ready to review`,
      count: counts.calendarToReview,
      blurb: 'Add who was there and what you remember, then save them as real events.',
      onOpen: onOpenImportReview,
    })
  }
  if (counts.calendarToTriage > 0) {
    rows.push({
      key: 'calendar-triage',
      label: `${counts.calendarToTriage.toLocaleString()} calendar event${counts.calendarToTriage === 1 ? '' : 's'} to look through`,
      count: counts.calendarToTriage,
      blurb: 'A quick pass — keep the ones that meant something, one line at a time.',
      onOpen: onOpenCalendarTriage,
      quiet: true,
    })
  }
  if (counts.birthdays > 0) {
    rows.push({
      key: 'birthdays',
      label: `${counts.birthdays.toLocaleString()} birthday${counts.birthdays === 1 ? '' : 's'} found`,
      count: counts.birthdays,
      blurb: 'Confirm who each one belongs to and it becomes a reminder.',
      onOpen: onOpenBirthdayReview,
    })
  }
  if (counts.contactsToReview > 0) {
    rows.push({
      key: 'contacts-review',
      label: `${counts.contactsToReview.toLocaleString()} contact${counts.contactsToReview === 1 ? '' : 's'} ready to review`,
      count: counts.contactsToReview,
      blurb: 'The ones you picked — confirm who they are and they get a profile.',
      onOpen: onOpenContactImportReview,
    })
  }
  if (counts.contactsToTriage > 0) {
    rows.push({
      key: 'contacts-triage',
      label: `${counts.contactsToTriage.toLocaleString()} more contact${counts.contactsToTriage === 1 ? '' : 's'} to look through`,
      count: counts.contactsToTriage,
      blurb: 'From your contacts file — pick the people you actually want on file.',
      onOpen: onOpenContactSelection,
      quiet: true,
    })
  }
  // Deliberately last and deliberately quiet, and NOT counted in the Home nudge (see reviewTotal):
  // this is a cleanup pass over data you already have, not something that arrived and needs
  // deciding. It belongs on this page because "what could I tidy up?" is the same question the
  // page answers — it just isn't urgent.
  if (counts.genderGaps > 0) {
    rows.push({
      key: 'gender',
      label: `${counts.genderGaps.toLocaleString()} ${counts.genderGaps === 1 ? 'person is' : 'people are'} missing a gender`,
      count: counts.genderGaps,
      blurb: "Boomer guesses from first names — confirm the ones it got right, fix the ones it didn't.",
      onOpen: onOpenGenderFill,
      quiet: true,
    })
  }
  if (counts.photos > 0) {
    rows.push({
      key: 'photos',
      label: `${counts.photos.toLocaleString()} photo group${counts.photos === 1 ? '' : 's'} to place`,
      count: counts.photos,
      blurb: 'Match each batch of imported photos to the event it belongs to.',
      onOpen: onOpenPhotoImport,
    })
  }

  return (
    <div style={styles.page}>
      <button onClick={onBack} style={styles.backButton}>← Back to {backLabel}</button>

      <h1 style={styles.heading}>To review</h1>

      {loading ? (
        <p style={styles.body}>Loading…</p>
      ) : (
        <>
          <p style={styles.intro}>
            {counts.total === 0
              ? "Nothing waiting — you're all caught up."
              : 'Everything waiting on you, in one place. There is no deadline on any of it.'}
          </p>

          {rows.map((r) => (
            <button key={r.key} type="button" onClick={r.onOpen} style={r.quiet ? styles.rowQuiet : styles.row}>
              <span style={styles.rowText}>
                <span style={styles.rowLabel}>{r.label}</span>
                <span style={styles.rowBlurb}>{r.blurb}</span>
              </span>
              <span style={styles.rowArrow}>→</span>
            </button>
          ))}

          {counts.calendarSetAside > 0 && (
            <div style={styles.setAside}>
              <p style={styles.setAsideLabel}>
                {counts.calendarSetAside.toLocaleString()} event{counts.calendarSetAside === 1 ? '' : 's'} set aside
              </p>
              <p style={styles.setAsideBlurb}>
                {counts.calendarSetAsideNext
                  ? counts.calendarSetAsideNext <= todayIso()
                    ? 'Coming back to your queue now.'
                    : `The first one comes back on ${formatDateRange(counts.calendarSetAsideNext, null)}.`
                  : 'These will come back to your queue on their own.'}
              </p>
              <button type="button" onClick={wakeAllDeferred} disabled={waking} style={styles.setAsideButton}>
                {waking ? '…' : 'Show them now'}
              </button>
            </div>
          )}

          {!triageEnabled && (
            <p style={styles.pendingNote}>
              A database update is pending, so the quick calendar pass and "Not now" aren't switched
              on yet — run <code>migrations_manual/2026-08-19-calendar-triage-and-defer.sql</code> and
              reload. Everything else works as normal until then.
            </p>
          )}
        </>
      )}
    </div>
  )
}

const styles: { [key: string]: React.CSSProperties } = {
  page: { maxWidth: maxWidth.page, margin: '0 auto', padding: '1rem 1.5rem 2rem', fontFamily },
  backButton: { background: 'none', border: 'none', color: colors.ink, fontSize: fontSize.base, cursor: 'pointer', marginBottom: '1rem', padding: 0 },
  heading: { fontSize: fontSize.h1, color: colors.ink, margin: '0 0 0.5rem' },
  intro: { fontSize: fontSize.bodyLg, color: colors.textMuted, lineHeight: 1.5, margin: '0 0 1.25rem' },
  body: { fontSize: fontSize.body, color: colors.textMuted, lineHeight: 1.5, margin: '0 0 0.75rem' },
  row: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.xl,
    width: '100%',
    textAlign: 'left',
    padding: '0.85rem 1rem',
    marginBottom: '0.5rem',
    backgroundColor: colors.surface,
    border: border.primary,
    borderRadius: radius.lg,
    cursor: 'pointer',
    fontFamily,
  },
  // The "still to look through" piles are real, but they're the low-stakes half of the work and
  // shouldn't compete with the queues that are actually ready — same reasoning Home.tsx applied to
  // the contacts-undecided line before this page existed.
  rowQuiet: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.xl,
    width: '100%',
    textAlign: 'left',
    padding: '0.85rem 1rem',
    marginBottom: '0.5rem',
    backgroundColor: colors.surface,
    border: border.default,
    borderRadius: radius.lg,
    cursor: 'pointer',
    fontFamily,
  },
  rowText: { display: 'flex', flexDirection: 'column', gap: '0.15rem', minWidth: 0 },
  rowLabel: { fontSize: fontSize.bodyLg, color: colors.ink },
  rowBlurb: { fontSize: fontSize.label, color: colors.textMuted, lineHeight: 1.4 },
  rowArrow: { fontSize: fontSize.bodyLg, color: colors.textMuted, flexShrink: 0 },
  setAside: {
    padding: '0.85rem 1rem',
    marginTop: '1rem',
    backgroundColor: colors.surfaceSunk,
    border: border.light,
    borderRadius: radius.lg,
  },
  setAsideLabel: { fontSize: fontSize.body, color: colors.textBody, margin: 0 },
  setAsideBlurb: { fontSize: fontSize.label, color: colors.textMuted, lineHeight: 1.4, margin: '0.15rem 0 0.6rem' },
  setAsideButton: {
    fontSize: fontSize.label,
    padding: '0.4rem 0.85rem',
    borderRadius: radius.md,
    border: border.default,
    backgroundColor: colors.surface,
    color: colors.textBody,
    cursor: 'pointer',
    fontFamily,
  },
  pendingNote: {
    fontSize: fontSize.label,
    color: colors.textMuted,
    lineHeight: 1.5,
    marginTop: '1.5rem',
    paddingTop: '0.75rem',
    borderTop: border.light,
  },
}
