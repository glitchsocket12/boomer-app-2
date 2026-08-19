import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { fetchAllRows } from '../lib/pagedSelect'
import { formatDateRange } from '../lib/dates'
import { summarize } from '../lib/summarize'
import SearchBox from '../components/SearchBox'
import { border, colors, fontFamily, fontSize, maxWidth, neutral, radius, space } from '../lib/theme'

type Row = {
  id: string
  occasion: string | null
  location: string | null
  event_date: string | null
  event_end_date: string | null
  raw_description: string | null
  calendar_source_id: string | null
}
type CalendarSourceRef = { id: string; label: string }

const PAGE_SIZE = 50

// Fast curation step between the calendar sync and the detailed accept/reject cards
// (ImportReview.tsx) — the same two-stage shape ContactSelection.tsx has had since 2026-07-27, now
// applied to the queue that actually has the volume. A real 3-year calendar produces ~230
// candidates, and answering "was this even a thing worth remembering?" does not need a 695px
// editor with attendees, tags, groups and merge options on it.
//
// This page never filters anything itself. It shows every pending candidate and asks the founder,
// one line at a time — which is exactly the 2026-08-12 directive ("just simply sync all new events,
// and let the person decide themselves"), just at a size a person can actually get through.
//
// Every tap writes immediately (no batch save), so a closed tab or a stray back-navigation never
// loses a decision. A row left untouched stays 'pending' — a fine resting state, not an error.
export default function CalendarTriage({
  onBack,
  backLabel,
  onReviewSelected,
}: {
  onBack: () => void
  backLabel: string
  onReviewSelected: () => void
}) {
  const [page, setPage] = useState(0)
  const [rows, setRows] = useState<Row[]>([])
  const [sources, setSources] = useState<CalendarSourceRef[]>([])
  const [totalPending, setTotalPending] = useState(0)
  const [selectedCount, setSelectedCount] = useState(0)
  const [turnedDownCount, setTurnedDownCount] = useState(0)
  const [showTurnedDown, setShowTurnedDown] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [writeError, setWriteError] = useState(false)

  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [searchResults, setSearchResults] = useState<Row[] | null>(null)

  useEffect(() => {
    loadCounts()
    loadSources()
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

  // Only used for the per-row badge, and only when there's more than one calendar to tell apart —
  // same rule ImportReview.tsx applies to its own source badge.
  async function loadSources() {
    const { data } = await fetchAllRows<CalendarSourceRef>((from, to) =>
      supabase.from('calendar_sources').select('id, label').order('label').order('id').range(from, to)
    )
    setSources(data ?? [])
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

  const SELECT_COLUMNS = 'id, occasion, location, event_date, event_end_date, raw_description, calendar_source_id'

  async function loadPage() {
    setLoading(true)
    const from = page * PAGE_SIZE
    const to = from + PAGE_SIZE - 1
    // Undecided reads newest-event-first (the ones you actually remember are the recent ones);
    // turned-down reads most-recently-decided first, because that's where a mis-tap will be.
    const query = supabase.from('moment_import_candidates').select(SELECT_COLUMNS)
    const { data } = showTurnedDown
      ? await query.eq('status', 'rejected').order('reviewed_at', { ascending: false, nullsFirst: false }).range(from, to)
      : await query.eq('status', 'pending').order('event_date', { ascending: false, nullsFirst: false }).range(from, to)
    setRows((data as Row[]) ?? [])
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
    setSearchResults((data as Row[]) ?? [])
  }

  // 'rejected' rather than a triage-specific status: "Not this one" IS the founder saying no, and
  // conflating it with 'skipped' (which means the MACHINE said no — see
  // 2026-08-12-calendar-skipped-status.sql) is exactly what that migration separated.
  async function setStatus(id: string, status: 'selected' | 'rejected' | 'pending') {
    setBusyId(id)
    const { error } = await supabase
      .from('moment_import_candidates')
      // reviewed_at is stamped only by a real "no". Keeping something isn't reviewing it — the
      // detailed card still has to happen — and leaving it null is what makes the turned-down
      // list's most-recently-decided-first ordering mean anything.
      .update({ status, reviewed_at: status === 'rejected' ? new Date().toISOString() : null })
      .eq('id', id)
    setBusyId(null)
    if (error) {
      // Almost certainly the status CHECK constraint, i.e. the migration hasn't been run yet.
      // Say so instead of silently doing nothing — see the banner below.
      setWriteError(true)
      return
    }
    setWriteError(false)
    await Promise.all([loadCounts(), search ? runSearch(search) : loadPage()])
  }

  function rowTitle(r: Row): string {
    return summarize(r.occasion, r.raw_description ?? '', 9)
  }

  function rowWhen(r: Row): string | null {
    return r.event_date ? formatDateRange(r.event_date, r.event_end_date) : null
  }

  const displayRows = searchResults ?? rows
  const totalForCurrentFilter = showTurnedDown ? turnedDownCount : totalPending
  const totalPages = Math.max(1, Math.ceil(totalForCurrentFilter / PAGE_SIZE))
  const sourceLabel = (id: string | null) =>
    sources.length > 1 ? sources.find((s) => s.id === id)?.label ?? null : null

  return (
    <div style={styles.page}>
      <button onClick={onBack} style={styles.backButton}>← Back to {backLabel}</button>

      <h1 style={styles.heading}>Which of these are worth keeping?</h1>
      <p style={styles.intro}>
        Everything your calendars turned up, one line at a time. Keep the ones that meant something —
        you'll add the details afterwards. Nothing is saved to an event until then, and every tap
        here is stored right away, so you can stop whenever you like and pick up where you left off.
      </p>

      {writeError && (
        <p style={styles.errorBanner}>
          Couldn't save that one. This screen needs a database update that hasn't been run yet —
          see the pending step in PROJECT_CONTEXT.md §10.
        </p>
      )}

      <div style={styles.summaryRow}>
        <span>
          <strong>{selectedCount}</strong> kept
        </span>
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
            Review {selectedCount} kept event{selectedCount === 1 ? '' : 's'} →
          </button>
        )}
      </div>

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
                ? "Nothing left to look through — you're all caught up."
                : 'Nothing here.'}
        </p>
      ) : (
        <div style={styles.list}>
          {displayRows.map((r) => {
            const when = rowWhen(r)
            const badge = sourceLabel(r.calendar_source_id)
            return (
              <div key={r.id} style={styles.row}>
                <div style={styles.rowInfo}>
                  <p style={styles.rowName}>{rowTitle(r)}</p>
                  <p style={styles.rowMeta}>
                    {when ?? 'No date'}
                    {r.location && ` · ${r.location}`}
                    {badge && ` · ${badge}`}
                  </p>
                </div>
                <div style={styles.rowActions}>
                  {showTurnedDown ? (
                    <button type="button" onClick={() => setStatus(r.id, 'pending')} disabled={busyId === r.id} style={styles.keepButton}>
                      {busyId === r.id ? '…' : 'Undo'}
                    </button>
                  ) : (
                    <>
                      <button type="button" onClick={() => setStatus(r.id, 'selected')} disabled={busyId === r.id} style={styles.keepButton}>
                        {busyId === r.id ? '…' : '+ Keep'}
                      </button>
                      <button type="button" onClick={() => setStatus(r.id, 'rejected')} disabled={busyId === r.id} style={styles.skipButton}>
                        Not this one
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
  list: { display: 'flex', flexDirection: 'column', gap: '0.4rem', marginBottom: '1rem' },
  row: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '0.75rem',
    padding: '0.6rem 0.8rem',
    backgroundColor: colors.surface,
    border: `1px solid ${neutral.grey100}`,
    borderRadius: radius.md,
  },
  rowInfo: { minWidth: 0 },
  rowName: { fontSize: fontSize.bodyLg, color: colors.inkPlain, margin: 0 },
  rowMeta: { fontSize: fontSize.small, color: colors.textFaintest, margin: '0.1rem 0 0' },
  rowActions: { display: 'flex', gap: '0.4rem', flexShrink: 0 },
  keepButton: {
    fontSize: fontSize.label,
    padding: '0.4rem 0.75rem',
    borderRadius: radius.md,
    border: border.primary,
    backgroundColor: colors.primary,
    color: colors.onFill,
    cursor: 'pointer',
    fontFamily,
    whiteSpace: 'nowrap',
  },
  skipButton: {
    fontSize: fontSize.label,
    padding: '0.4rem 0.75rem',
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
