import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { fetchAllRows } from '../lib/pagedSelect'
import { formatDateRange } from '../lib/dates'
import { summarize } from '../lib/summarize'
import { findLikelyMatch } from '../lib/likelyDuplicate'
import { acceptCandidate, undoQuickAdd, type AcceptableCandidate } from '../lib/acceptCandidate'
import {
  canBulkSetAside,
  deferUntilIso,
  invalidateReviewCounts,
  loadRemindDays,
  probeTriageEnabled,
  saveRemindDays,
} from '../lib/reviewQueues'
import { momentDisplayName } from '../lib/momentDisplayName'
import SearchBox from '../components/SearchBox'
import RemindSheet from '../components/RemindSheet'
import UndoBanner from '../components/UndoBanner'
import { border, colors, fontFamily, fontSize, maxWidth, neutral, radius, space } from '../lib/theme'

type Row = AcceptableCandidate & { calendar_source_id: string | null }
type CalendarSourceRef = { id: string; label: string }
type ExistingMoment = { id: string; occasion: string | null; event_date: string | null; event_end_date: string | null; raw_description: string }

// What a row collapses into once it's been answered. The row does NOT leave the list — see the
// scroll note on setStatus below.
type Resolved =
  | { kind: 'added'; label: string; momentId: string }
  | { kind: 'detail'; label: string }
  | { kind: 'reminded'; label: string; days: number }
  | { kind: 'rejected'; label: string }

// What one "Set aside the rest" did, kept just long enough to offer it back. `stamp` is the
// reviewed_at written across the whole act, which is what makes Undo able to find precisely those
// rows again — see applyBulkRemind.
type BulkResult = { count: number; until: string; stamp: string }

// Almost always the status CHECK constraint, i.e. the triage migration hasn't been run. Bulk
// set-aside can't hit that — it's gated on the probe — so it carries its own wording rather than
// telling the founder a database update is missing when it isn't.
const ROW_WRITE_ERROR =
  "Couldn't save that one. This screen needs a database update that hasn't been run yet — see the pending step in PROJECT_CONTEXT.md §10."

const PAGE_SIZE = 50

const SELECT_COLUMNS =
  'id, occasion, location, event_date, event_end_date, raw_description, calendar_source_id, suggested_people, suggested_tags, suggested_group_ids'

// The fast pass over calendar-import candidates — one line each, four answers, no 695px editor
// unless you ask for one. A real 3-year calendar produces ~230 candidates and most of them only
// need "yes that happened" or "no".
//
// This page never filters anything itself. It shows every pending candidate and asks the founder,
// one line at a time — the 2026-08-12 directive ("just simply sync all new events, and let the
// person decide themselves") at a size a person can actually get through.
//
// Every tap writes immediately (no batch save), so a closed tab or a stray back-navigation never
// loses a decision. A row left untouched stays 'pending' — a fine resting state, not an error.
export default function CalendarTriage({
  onBack,
  backLabel,
  onReviewSelected,
  onSelectEvent,
}: {
  onBack: () => void
  backLabel: string
  onReviewSelected: () => void
  onSelectEvent: (event: { id: string; summary: string }) => void
}) {
  const [page, setPage] = useState(0)
  const [rows, setRows] = useState<Row[]>([])
  const [sources, setSources] = useState<CalendarSourceRef[]>([])
  const [existingMoments, setExistingMoments] = useState<ExistingMoment[]>([])
  const [totalPending, setTotalPending] = useState(0)
  const [selectedCount, setSelectedCount] = useState(0)
  const [turnedDownCount, setTurnedDownCount] = useState(0)
  const [showTurnedDown, setShowTurnedDown] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [writeError, setWriteError] = useState<string | null>(null)
  const [resolved, setResolved] = useState<Map<string, Resolved>>(new Map())
  const [remindTarget, setRemindTarget] = useState<Row | null>(null)
  const [defaultRemindDays, setDefaultRemindDays] = useState<number | null>(null)
  const [triageEnabled, setTriageEnabled] = useState(false)
  const [bulkOpen, setBulkOpen] = useState(false)
  const [bulkBusy, setBulkBusy] = useState(false)
  const [bulkResult, setBulkResult] = useState<BulkResult | null>(null)

  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [searchResults, setSearchResults] = useState<Row[] | null>(null)

  useEffect(() => {
    loadCounts()
    loadContext()
  }, [])

  useEffect(() => {
    loadPage()
  }, [page, showTurnedDown])

  // Same small debounce as ContactSelection — this searches across ALL rows in the current filter,
  // not just the page on screen, since finding one event without paging through 200 is the point.
  useEffect(() => {
    const handle = setTimeout(() => setSearch(searchInput.trim()), 300)
    return () => clearTimeout(handle)
  }, [searchInput])

  useEffect(() => {
    if (!search) {
      setSearchResults(null)
      return
    }
    runSearch(search)
  }, [search, showTurnedDown])

  // Everything the rows need that isn't the rows themselves: the calendar labels for the per-row
  // badge (only shown when there's more than one calendar to tell apart — same rule as
  // ImportReview.tsx), the events already on file so Quick Add can refuse to create a duplicate,
  // and whether the founder has a saved "remind me in N days".
  async function loadContext() {
    const [sourcesRes, momentsRes, remindDays, enabled] = await Promise.all([
      fetchAllRows<CalendarSourceRef>((from, to) =>
        supabase.from('calendar_sources').select('id, label').order('label').order('id').range(from, to)
      ),
      fetchAllRows<ExistingMoment>((from, to) =>
        supabase
          .from('moments')
          .select('id, occasion, event_date, event_end_date, raw_description')
          .order('event_date', { ascending: false, nullsFirst: false })
          .order('id')
          .range(from, to)
      ),
      loadRemindDays(),
      probeTriageEnabled(),
    ])
    setSources(sourcesRes.data ?? [])
    setExistingMoments(momentsRes.data ?? [])
    setDefaultRemindDays(remindDays)
    setTriageEnabled(enabled)
  }

  async function loadCounts() {
    const [pendingRes, selectedRes, rejectedRes] = await Promise.all([
      supabase.from('moment_import_candidates').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
      supabase.from('moment_import_candidates').select('id', { count: 'exact', head: true }).eq('status', 'selected'),
      supabase.from('moment_import_candidates').select('id', { count: 'exact', head: true }).eq('status', 'rejected'),
    ])
    setTotalPending(pendingRes.count ?? 0)
    setSelectedCount(selectedRes.count ?? 0)
    setTurnedDownCount(rejectedRes.count ?? 0)
  }

  async function loadPage() {
    setLoading(true)
    setResolved(new Map())
    const from = page * PAGE_SIZE
    const to = from + PAGE_SIZE - 1
    // Undecided reads newest-event-first (the ones you actually remember are the recent ones);
    // turned-down reads most-recently-decided first, because that's where a mis-tap will be.
    const query = supabase.from('moment_import_candidates').select(SELECT_COLUMNS)
    const { data } = showTurnedDown
      ? await query.eq('status', 'rejected').order('reviewed_at', { ascending: false, nullsFirst: false }).range(from, to)
      : await query.eq('status', 'pending').order('event_date', { ascending: false, nullsFirst: false }).range(from, to)
    setRows((data as unknown as Row[]) ?? [])
    setLoading(false)
  }

  async function runSearch(query: string) {
    const status = showTurnedDown ? 'rejected' : 'pending'
    const { data } = await supabase
      .from('moment_import_candidates')
      .select(SELECT_COLUMNS)
      .eq('status', status)
      .ilike('occasion', `%${query}%`)
      .order('event_date', { ascending: false, nullsFirst: false })
      .limit(25)
    setSearchResults((data as unknown as Row[]) ?? [])
  }

  function rowTitle(r: Row): string {
    return summarize(r.occasion, r.raw_description ?? '', 9)
  }

  // Adjusts the counters in state instead of refetching them. Refetching flips `loading`, which
  // swaps the whole list for "Loading…", collapses the page height and dumps you back at the top —
  // founder report 2026-08-19. Same reasoning as Groups.tsx's `silent` reload, which exists because
  // flashing a placeholder over an in-place change "would read as the drop bouncing".
  function countDelta(from: 'pending' | 'rejected', to: 'pending' | 'selected' | 'rejected' | 'accepted' | 'deferred') {
    if (from === 'pending') setTotalPending((n) => Math.max(0, n - 1))
    if (from === 'rejected') setTurnedDownCount((n) => Math.max(0, n - 1))
    if (to === 'pending') setTotalPending((n) => n + 1)
    if (to === 'selected') setSelectedCount((n) => n + 1)
    if (to === 'rejected') setTurnedDownCount((n) => n + 1)
    invalidateReviewCounts()
  }

  function markResolved(id: string, result: Resolved | null) {
    setResolved((prev) => {
      const next = new Map(prev)
      if (result) next.set(id, result)
      else next.delete(id)
      return next
    })
  }

  async function setStatus(row: Row, status: 'selected' | 'rejected' | 'deferred', extra: Record<string, unknown> = {}) {
    setBusyId(row.id)
    const { error } = await supabase
      .from('moment_import_candidates')
      // reviewed_at is stamped only by a real decision. "Add more detail" isn't one yet — the
      // detailed card still has to happen — and leaving it null is what makes the turned-down
      // list's most-recently-decided-first ordering mean anything.
      .update({ status, reviewed_at: status === 'selected' ? null : new Date().toISOString(), ...extra })
      .eq('id', row.id)
    setBusyId(null)
    if (error) {
      setWriteError(ROW_WRITE_ERROR)
      return false
    }
    setWriteError(null)
    countDelta(showTurnedDown ? 'rejected' : 'pending', status)
    return true
  }

  async function handleQuickAdd(row: Row) {
    setBusyId(row.id)
    const result = await acceptCandidate(row)
    setBusyId(null)
    if (!result) {
      setWriteError(ROW_WRITE_ERROR)
      return
    }
    setWriteError(null)
    setExistingMoments((prev) => [{ ...result.moment }, ...prev])
    countDelta('pending', 'accepted')
    markResolved(row.id, { kind: 'added', label: rowTitle(row), momentId: result.moment.id })
  }

  async function handleAddDetail(row: Row) {
    if (await setStatus(row, 'selected')) markResolved(row.id, { kind: 'detail', label: rowTitle(row) })
  }

  async function handleReject(row: Row) {
    if (await setStatus(row, 'rejected')) markResolved(row.id, { kind: 'rejected', label: rowTitle(row) })
  }

  // With a saved default this applies straight away — a preference that still asked every time
  // wouldn't be one. Without one, the sheet asks and offers to remember the answer.
  async function handleRemind(row: Row) {
    if (defaultRemindDays) {
      await applyRemind(row, defaultRemindDays, false)
      return
    }
    setRemindTarget(row)
  }

  async function applyRemind(row: Row, days: number, makeDefault: boolean) {
    const ok = await setStatus(row, 'deferred', { deferred_until: deferUntilIso(new Date(), days) })
    if (!ok) return
    if (makeDefault) {
      await saveRemindDays(days)
      setDefaultRemindDays(days)
    }
    markResolved(row.id, { kind: 'reminded', label: rowTitle(row), days })
  }

  // "Set aside the rest" — the founder's "delay the need to accept/reject" ask applied to the whole
  // pile instead of one row at a time. A three-year calendar can produce 1,300 candidates; at ten
  // to a sitting that is 130 sittings, and nothing that makes a single decision cheaper fixes a
  // queue that asks 1,300 questions.
  //
  // Written server-side BY FILTER, never as a list of ids: 1,300 ids is a ~48KB URL, the trap
  // sweepImplausibleMatches chunks at 100 to avoid. `.eq('status', 'pending')` is the only thing
  // standing between this and a very bad day — see canBulkSetAside for the rules about when the
  // button may be offered at all.
  //
  // The saved "remind me in N days" is deliberately NOT applied here, unlike the one-row button:
  // at this size the interval is the whole decision, and firing it off a preference set for single
  // rows would make the biggest act in the app a one-tap accident.
  async function applyBulkRemind(days: number) {
    setBulkBusy(true)
    const until = deferUntilIso(new Date(), days)
    // One timestamp across the act, so Undo can match exactly these rows without a new column —
    // and without also waking something set aside on its own an hour earlier.
    const stamp = new Date().toISOString()
    const count = totalPending
    const { error } = await supabase
      .from('moment_import_candidates')
      .update({ status: 'deferred', deferred_until: until, reviewed_at: stamp })
      .eq('status', 'pending')
    setBulkBusy(false)
    if (error) {
      // Deliberately doesn't claim nothing was written — a dropped connection can leave that
      // genuinely unknown, and this is the worst possible moment to guess on the founder's behalf.
      setWriteError("Couldn't set those aside. Reload the page to see where things stand, then try again.")
      return
    }
    setWriteError(null)
    setTotalPending(0)
    invalidateReviewCounts()
    // Confirmations from this sitting stay put, Undo and all — only the still-undecided rows go,
    // because those are the ones that just left the pile. Filtered in place rather than refetched:
    // see the note on countDelta about what `loading` does to your scroll position.
    setRows((prev) => prev.filter((r) => resolved.has(r.id)))
    setBulkResult({ count, until, stamp })
  }

  // The immediate way back, on the page where it happened rather than two screens away. Matches on
  // the act's own reviewed_at, so it takes back exactly what that press did.
  async function undoBulkRemind(result: BulkResult) {
    setBulkBusy(true)
    const { error } = await supabase
      .from('moment_import_candidates')
      .update({ status: 'pending', deferred_until: null, reviewed_at: null })
      .eq('status', 'deferred')
      .eq('reviewed_at', result.stamp)
    setBulkBusy(false)
    if (error) {
      setWriteError("Couldn't bring those back. Reload the page to see where things stand, then try again.")
      return
    }
    setWriteError(null)
    setBulkResult(null)
    setTotalPending(result.count)
    invalidateReviewCounts()
    loadPage()
  }

  // Undo always means "put it back to undecided", including from the turned-down list — un-rejecting
  // something is the whole point of that list, and restoring it to 'rejected' would make the button
  // do nothing.
  async function handleUndo(row: Row, result: Resolved) {
    setBusyId(row.id)
    let ok = true
    if (result.kind === 'added') {
      ok = await undoQuickAdd(row.id, result.momentId, 'pending')
      if (ok) setExistingMoments((prev) => prev.filter((m) => m.id !== result.momentId))
    } else {
      const { error } = await supabase
        .from('moment_import_candidates')
        // deferred_until is only cleared for something that was actually set aside: the column
        // arrives with 2026-08-19-calendar-triage-and-defer.sql, and sending it unconditionally
        // would make undoing a plain rejection fail on a database that hasn't run it yet.
        .update({ status: 'pending', reviewed_at: null, ...(result.kind === 'reminded' ? { deferred_until: null } : {}) })
        .eq('id', row.id)
      ok = !error
    }
    setBusyId(null)
    if (!ok) {
      setWriteError(ROW_WRITE_ERROR)
      return
    }

    // Give back whichever pile it was sitting in, and put it back among the undecided.
    if (result.kind === 'detail') setSelectedCount((n) => Math.max(0, n - 1))
    if (result.kind === 'rejected') setTurnedDownCount((n) => Math.max(0, n - 1))
    setTotalPending((n) => n + 1)
    invalidateReviewCounts()

    if (showTurnedDown) {
      // It isn't turned down any more, so it leaves this list rather than sitting here as a row the
      // filter no longer describes. Dropped locally, not refetched — see setStatus on why.
      const drop = (rows: Row[]) => rows.filter((r) => r.id !== row.id)
      setRows(drop)
      setSearchResults((prev) => (prev ? drop(prev) : prev))
    } else {
      markResolved(row.id, null)
    }
  }

  const displayRows = searchResults ?? rows
  // Reads the raw input, not the debounced `search`, so the bulk button leaves the moment the
  // founder starts typing rather than 300ms later.
  const filtering = Boolean(searchInput.trim() || search)
  const offerBulk = canBulkSetAside({ triageEnabled, showTurnedDown, filtering, pending: totalPending })
  const totalForCurrentFilter = showTurnedDown ? turnedDownCount : totalPending
  const totalPages = Math.max(1, Math.ceil(totalForCurrentFilter / PAGE_SIZE))
  const sourceLabel = (id: string | null) => (sources.length > 1 ? sources.find((s) => s.id === id)?.label ?? null : null)

  return (
    <div style={styles.page}>
      <button onClick={onBack} style={styles.backButton}>← Back to {backLabel}</button>

      <h1 style={styles.heading}>Which of these are worth keeping?</h1>
      <p style={styles.intro}>
        Everything your calendars turned up, one line at a time. Add the ones that meant something —
        most just need a tap. Every choice here saves right away, so you can stop whenever you like
        and pick up where you left off.
      </p>

      {writeError && <p style={styles.errorBanner}>{writeError}</p>}

      <div style={styles.summaryRow}>
        {selectedCount > 0 && (
          <span>
            <strong>{selectedCount}</strong> waiting for detail
          </span>
        )}
        {(turnedDownCount > 0 || showTurnedDown) && (
          <button
            type="button"
            onClick={() => {
              setShowTurnedDown(!showTurnedDown)
              setPage(0)
              setSearchInput('')
              setSearch('')
            }}
            style={styles.linkButton}
          >
            {showTurnedDown ? '← Back to undecided' : `${turnedDownCount} turned down — review/undo`}
          </button>
        )}
        {selectedCount > 0 && (
          <button type="button" onClick={onReviewSelected} style={styles.reviewButton}>
            Review {selectedCount} in detail →
          </button>
        )}
      </div>

      {offerBulk && (
        <div style={styles.bulkBar}>
          <p style={styles.bulkText}>
            {totalPending.toLocaleString()} still to look through — you don't have to face them all today.
          </p>
          <button type="button" onClick={() => setBulkOpen(true)} disabled={bulkBusy} style={styles.secondaryButton}>
            {bulkBusy ? '…' : 'Set aside the rest →'}
          </button>
        </div>
      )}

      {bulkResult && (
        <UndoBanner
          message={`${bulkResult.count.toLocaleString()} set aside — back on ${formatDateRange(bulkResult.until, null)}.`}
          onUndo={() => undoBulkRemind(bulkResult)}
          busy={bulkBusy}
        />
      )}

      <SearchBox value={searchInput} onChange={setSearchInput} placeholder="Search by title…" />

      {loading && !searchResults ? (
        <p style={styles.body}>Loading…</p>
      ) : displayRows.length === 0 ? (
        <p style={styles.body}>
          {search
            ? 'No matches.'
            : showTurnedDown
              ? 'Nothing turned down.'
              : totalPending === 0
                ? bulkResult
                  ? "All set aside — nothing here until they come back."
                  : "Nothing left to look through — you're all caught up."
                : 'Nothing here.'}
        </p>
      ) : (
        <div style={styles.list}>
          {displayRows.map((r) => {
            const result = resolved.get(r.id)
            if (result) {
              return (
                <div key={r.id} style={styles.rowResolved}>
                  <p style={styles.resolvedText}>
                    {result.kind === 'added'
                      ? `Added — ${result.label}`
                      : result.kind === 'detail'
                        ? `Saved for detail — ${result.label}`
                        : result.kind === 'reminded'
                          ? `Set aside — ${result.label}. Back in ${result.days} days.`
                          : `Turned down — ${result.label}`}
                  </p>
                  <div style={styles.rowActions}>
                    {result.kind === 'added' && (
                      <button
                        type="button"
                        onClick={() => onSelectEvent({ id: result.momentId, summary: result.label })}
                        style={styles.linkButton}
                      >
                        View event →
                      </button>
                    )}
                    <button type="button" onClick={() => handleUndo(r, result)} disabled={busyId === r.id} style={styles.skipButton}>
                      {busyId === r.id ? '…' : 'Undo'}
                    </button>
                  </div>
                </div>
              )
            }

            const when = r.event_date ? formatDateRange(r.event_date, r.event_end_date) : null
            const badge = sourceLabel(r.calendar_source_id)
            // Quick Add saves in one tap and never shows the four-way merge banner, so without this
            // it would be the fastest way in the app to create a duplicate. Free client-side check,
            // no AI call — see lib/likelyDuplicate.ts.
            const duplicate = showTurnedDown ? null : findLikelyMatch(r, existingMoments)
            const busy = busyId === r.id

            return (
              <div key={r.id} style={styles.row}>
                <div style={styles.rowInfo}>
                  <p style={styles.rowName}>{rowTitle(r)}</p>
                  <p style={styles.rowMeta}>
                    {when ?? 'No date'}
                    {r.location && ` · ${r.location}`}
                    {badge && ` · ${badge}`}
                  </p>
                  {duplicate && (
                    <p style={styles.duplicateNote}>
                      Looks like "{momentDisplayName(duplicate, new Map(), new Map())}", already on file.
                    </p>
                  )}
                </div>
                {/* Buttons get their own wrapping row rather than sitting beside the title: four of
                    them will not fit next to text at phone width, and the phone is the primary
                    surface (§8 item 72). */}
                <div style={styles.rowActions}>
                  {showTurnedDown ? (
                    <button type="button" onClick={() => handleUndo(r, { kind: 'rejected', label: rowTitle(r) })} disabled={busy} style={styles.quickAddButton}>
                      {busy ? '…' : 'Undo'}
                    </button>
                  ) : (
                    <>
                      {duplicate ? (
                        <button type="button" onClick={() => handleAddDetail(r)} disabled={busy} style={styles.quickAddButton}>
                          {busy ? '…' : 'Looks familiar — review it'}
                        </button>
                      ) : (
                        <>
                          <button type="button" onClick={() => handleQuickAdd(r)} disabled={busy} style={styles.quickAddButton}>
                            {busy ? '…' : 'Quick Add'}
                          </button>
                          <button type="button" onClick={() => handleAddDetail(r)} disabled={busy} style={styles.secondaryButton}>
                            Add More Detail
                          </button>
                        </>
                      )}
                      <button type="button" onClick={() => handleRemind(r)} disabled={busy} style={styles.secondaryButton}>
                        Remind Me
                      </button>
                      <button type="button" onClick={() => handleReject(r)} disabled={busy} style={styles.skipButton}>
                        Reject
                      </button>
                    </>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {!search && totalForCurrentFilter > PAGE_SIZE && (
        <div style={styles.pagination}>
          <button type="button" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0} style={styles.pageButton}>
            ← Prev
          </button>
          <span style={styles.pageLabel}>
            Page {page + 1} of {totalPages} — {totalForCurrentFilter.toLocaleString()}{' '}
            {showTurnedDown ? 'turned down' : `event${totalForCurrentFilter === 1 ? '' : 's'}`}
          </span>
          <button type="button" onClick={() => setPage((p) => p + 1)} disabled={page + 1 >= totalPages} style={styles.pageButton}>
            Next →
          </button>
        </div>
      )}

      <RemindSheet
        open={remindTarget !== null}
        onClose={() => setRemindTarget(null)}
        onPick={(days, makeDefault) => {
          const target = remindTarget
          setRemindTarget(null)
          if (target) applyRemind(target, days, makeDefault)
        }}
      />

      <RemindSheet
        open={bulkOpen}
        onClose={() => setBulkOpen(false)}
        title={`Set aside all ${totalPending.toLocaleString()}?`}
        subtitle="They leave this list now and come back on their own. Nothing is deleted — and you can bring them all back whenever you like from Things to review."
        showDefault={false}
        onPick={(days) => {
          setBulkOpen(false)
          applyBulkRemind(days)
        }}
      />
    </div>
  )
}

const styles: { [key: string]: React.CSSProperties } = {
  page: { maxWidth: maxWidth.page, margin: '0 auto', padding: '1rem 1.5rem 2rem', fontFamily },
  backButton: { background: 'none', border: 'none', color: colors.ink, fontSize: fontSize.base, cursor: 'pointer', marginBottom: '1rem', padding: 0 },
  heading: { fontSize: fontSize.h1, color: colors.ink, margin: '0 0 0.5rem' },
  intro: { fontSize: fontSize.bodyLg, color: colors.textMuted, lineHeight: 1.5, margin: '0 0 1rem' },
  errorBanner: {
    fontSize: fontSize.body,
    color: colors.danger,
    backgroundColor: colors.surface,
    border: border.danger,
    borderRadius: radius.md,
    padding: '0.6rem 0.8rem',
    lineHeight: 1.5,
    margin: '0 0 1rem',
  },
  summaryRow: { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: space.xl, fontSize: fontSize.bodyLg, color: colors.inkPlain, margin: '0 0 1rem' },
  linkButton: {
    background: 'none',
    border: 'none',
    color: colors.ink,
    textDecoration: 'underline',
    cursor: 'pointer',
    fontSize: fontSize.body,
    fontFamily,
    padding: 0,
  },
  reviewButton: {
    marginLeft: 'auto',
    fontSize: fontSize.body,
    padding: '0.5rem 0.9rem',
    borderRadius: radius.md,
    border: 'none',
    backgroundColor: colors.primary,
    color: colors.onFill,
    cursor: 'pointer',
    fontFamily,
    whiteSpace: 'nowrap',
  },
  body: { fontSize: fontSize.body, color: colors.textMuted, lineHeight: 1.5, margin: '0 0 0.75rem' },
  bulkBar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: space.md,
    padding: '0.6rem 0.8rem',
    backgroundColor: colors.surfaceSunk,
    borderRadius: radius.md,
    margin: '0 0 1rem',
  },
  bulkText: { fontSize: fontSize.body, color: colors.textMuted, margin: 0 },
  list: { display: 'flex', flexDirection: 'column', gap: '0.4rem', marginBottom: '1rem' },
  row: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.55rem',
    padding: '0.7rem 0.8rem',
    backgroundColor: colors.surface,
    border: `1px solid ${neutral.grey100}`,
    borderRadius: radius.md,
  },
  rowResolved: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: '0.5rem',
    padding: '0.7rem 0.8rem',
    backgroundColor: colors.surfaceSunk,
    border: `1px solid ${neutral.grey100}`,
    borderRadius: radius.md,
  },
  resolvedText: { fontSize: fontSize.body, color: colors.textMuted, margin: 0 },
  rowInfo: { minWidth: 0 },
  rowName: { fontSize: fontSize.bodyLg, color: colors.inkPlain, margin: 0 },
  rowMeta: { fontSize: fontSize.small, color: colors.textFaintest, margin: '0.1rem 0 0' },
  duplicateNote: { fontSize: fontSize.small, color: colors.suggest, margin: '0.25rem 0 0' },
  rowActions: { display: 'flex', flexWrap: 'wrap', gap: '0.4rem' },
  quickAddButton: {
    fontSize: fontSize.label,
    padding: '0.45rem 0.8rem',
    borderRadius: radius.md,
    border: border.primary,
    backgroundColor: colors.primary,
    color: colors.onFill,
    cursor: 'pointer',
    fontFamily,
    whiteSpace: 'nowrap',
  },
  secondaryButton: {
    fontSize: fontSize.label,
    padding: '0.45rem 0.8rem',
    borderRadius: radius.md,
    border: border.default,
    backgroundColor: colors.surface,
    color: colors.textBody,
    cursor: 'pointer',
    fontFamily,
    whiteSpace: 'nowrap',
  },
  skipButton: {
    fontSize: fontSize.label,
    padding: '0.45rem 0.8rem',
    borderRadius: radius.md,
    border: border.default,
    backgroundColor: colors.surface,
    color: colors.textFaintest,
    cursor: 'pointer',
    fontFamily,
    whiteSpace: 'nowrap',
  },
  pagination: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: space.xl, marginTop: '0.5rem' },
  pageButton: {
    fontSize: fontSize.label,
    padding: '0.4rem 0.85rem',
    borderRadius: radius.md,
    border: border.primary,
    backgroundColor: colors.surface,
    color: colors.ink,
    cursor: 'pointer',
    fontFamily,
  },
  pageLabel: { fontSize: fontSize.label, color: colors.textMuted },
}
