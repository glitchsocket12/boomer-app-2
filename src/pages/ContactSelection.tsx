import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import SearchBox from '../components/SearchBox'

type Row = { id: string; full_name: string; organization: string | null }

const PAGE_SIZE = 50

// Deliberate-curation step between upload (ContactsImport.tsx) and the detailed accept/reject
// review (ContactImportReview.tsx). A real contact export can be 1000+ entries — this page never
// loads them all at once, and every "Bring in"/"Not interested" tap writes to the DB immediately
// (no batch save), so a closed tab or accidental back-navigation never loses a decision already
// made. A row left untouched just stays 'pending' — that's a fine resting state, not an error.
export default function ContactSelection({
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
  const [totalPending, setTotalPending] = useState(0)
  const [selectedCount, setSelectedCount] = useState(0)
  const [skippedCount, setSkippedCount] = useState(0)
  const [showSkipped, setShowSkipped] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)

  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [searchResults, setSearchResults] = useState<Row[] | null>(null)

  useEffect(() => {
    loadCounts()
  }, [])

  useEffect(() => {
    loadPage()
  }, [page, showSkipped])

  // Small debounce so a server round-trip doesn't fire on every keystroke — this searches across
  // ALL pending/skipped rows (not just the current page), since the whole point is finding someone
  // without paging through hundreds of names first.
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
  }, [search, showSkipped])

  async function loadCounts() {
    const [pendingRes, selectedRes, skippedRes] = await Promise.all([
      supabase.from('contact_import_candidates').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
      supabase.from('contact_import_candidates').select('id', { count: 'exact', head: true }).eq('status', 'selected'),
      supabase.from('contact_import_candidates').select('id', { count: 'exact', head: true }).eq('status', 'skipped'),
    ])
    setTotalPending(pendingRes.count ?? 0)
    setSelectedCount(selectedRes.count ?? 0)
    setSkippedCount(skippedRes.count ?? 0)
  }

  async function loadPage() {
    setLoading(true)
    const status = showSkipped ? 'skipped' : 'pending'
    const from = page * PAGE_SIZE
    const to = from + PAGE_SIZE - 1
    const { data } = await supabase
      .from('contact_import_candidates')
      .select('id, full_name, organization')
      .eq('status', status)
      .order('full_name', { ascending: true })
      .range(from, to)
    setRows((data as Row[]) ?? [])
    setLoading(false)
  }

  async function runSearch(query: string) {
    const status = showSkipped ? 'skipped' : 'pending'
    const { data } = await supabase
      .from('contact_import_candidates')
      .select('id, full_name, organization')
      .eq('status', status)
      .ilike('full_name', `%${query}%`)
      .order('full_name', { ascending: true })
      .limit(25)
    setSearchResults((data as Row[]) ?? [])
  }

  async function setStatus(id: string, status: 'selected' | 'skipped' | 'pending') {
    setBusyId(id)
    await supabase.from('contact_import_candidates').update({ status }).eq('id', id)
    setBusyId(null)
    await Promise.all([loadCounts(), search ? runSearch(search) : loadPage()])
  }

  const displayRows = searchResults ?? rows
  const totalForCurrentFilter = showSkipped ? skippedCount : totalPending
  const totalPages = Math.max(1, Math.ceil(totalForCurrentFilter / PAGE_SIZE))

  return (
    <div style={styles.page}>
      <button onClick={onBack} style={styles.backButton}>← Back to {backLabel}</button>

      <h1 style={styles.heading}>Choose who to bring in</h1>
      <p style={styles.intro}>
        Nothing gets added just because it was in your contacts file — pick the people you actually
        want a profile for. Everything you tap is saved immediately, so you can stop anytime and
        pick up right where you left off.
      </p>

      <div style={styles.summaryRow}>
        <span>
          <strong>{selectedCount}</strong> selected
        </span>
        {(skippedCount > 0 || showSkipped) && (
          <button type="button" onClick={() => { setShowSkipped(!showSkipped); setPage(0); setSearchInput(''); setSearch(''); }} style={styles.linkButton}>
            {showSkipped ? '← Back to undecided' : `${skippedCount} skipped — review/undo`}
          </button>
        )}
        {selectedCount > 0 && (
          <button type="button" onClick={onReviewSelected} style={styles.reviewButton}>
            Review {selectedCount} selected contact{selectedCount === 1 ? '' : 's'} →
          </button>
        )}
      </div>

      <SearchBox value={searchInput} onChange={setSearchInput} placeholder="Search by name…" />

      {loading && !searchResults ? (
        <p style={styles.body}>Loading…</p>
      ) : displayRows.length === 0 ? (
        <p style={styles.body}>
          {search
            ? 'No matches.'
            : showSkipped
              ? 'Nothing skipped.'
              : totalPending === 0
                ? 'Nothing left to look through.'
                : 'Nothing here.'}
        </p>
      ) : (
        <div style={styles.list}>
          {displayRows.map((r) => (
            <div key={r.id} style={styles.row}>
              <div style={styles.rowInfo}>
                <p style={styles.rowName}>{r.full_name}</p>
                {r.organization && <p style={styles.rowMeta}>{r.organization}</p>}
              </div>
              <div style={styles.rowActions}>
                {showSkipped ? (
                  <button type="button" onClick={() => setStatus(r.id, 'pending')} disabled={busyId === r.id} style={styles.bringInButton}>
                    {busyId === r.id ? '…' : 'Undo'}
                  </button>
                ) : (
                  <>
                    <button type="button" onClick={() => setStatus(r.id, 'selected')} disabled={busyId === r.id} style={styles.bringInButton}>
                      {busyId === r.id ? '…' : '+ Bring in'}
                    </button>
                    <button type="button" onClick={() => setStatus(r.id, 'skipped')} disabled={busyId === r.id} style={styles.skipButton}>
                      Not interested
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {!search && (
        <div style={styles.pagination}>
          <button type="button" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0} style={styles.pageButton}>
            ← Prev
          </button>
          <span style={styles.pageLabel}>
            Page {page + 1} of {totalPages} —{' '}
            {showSkipped
              ? `${totalForCurrentFilter} skipped`
              : `${totalForCurrentFilter} contact${totalForCurrentFilter === 1 ? '' : 's'}`}
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
  page: { maxWidth: '840px', margin: '0 auto', padding: '1rem 1.5rem 2rem', fontFamily: 'Georgia, serif' },
  backButton: { background: 'none', border: 'none', color: '#2E4034', fontSize: '1rem', cursor: 'pointer', marginBottom: '1rem', padding: 0 },
  heading: { fontSize: '2rem', color: '#2E4034', margin: '0 0 0.5rem' },
  intro: { fontSize: '0.95rem', color: '#666', lineHeight: 1.5, margin: '0 0 1rem' },
  summaryRow: { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '1rem', fontSize: '0.95rem', color: '#2E2E2E', margin: '0 0 1rem' },
  linkButton: {
    background: 'none',
    border: 'none',
    color: '#2E4034',
    textDecoration: 'underline',
    cursor: 'pointer',
    fontSize: '0.9rem',
    fontFamily: 'Georgia, serif',
    padding: 0,
  },
  reviewButton: {
    marginLeft: 'auto',
    fontSize: '0.9rem',
    padding: '0.5rem 0.9rem',
    borderRadius: '8px',
    border: 'none',
    backgroundColor: '#2E4034',
    color: '#FFF',
    cursor: 'pointer',
    fontFamily: 'Georgia, serif',
    whiteSpace: 'nowrap',
  },
  body: { fontSize: '0.9rem', color: '#666', lineHeight: 1.5, margin: '0 0 0.75rem' },
  list: { display: 'flex', flexDirection: 'column', gap: '0.4rem', marginBottom: '1rem' },
  row: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '0.75rem',
    padding: '0.6rem 0.8rem',
    backgroundColor: '#FFF',
    border: '1px solid #E5E5E5',
    borderRadius: '8px',
  },
  rowInfo: { minWidth: 0 },
  rowName: { fontSize: '0.95rem', color: '#2E2E2E', margin: 0 },
  rowMeta: { fontSize: '0.8rem', color: '#999', margin: '0.1rem 0 0' },
  rowActions: { display: 'flex', gap: '0.4rem', flexShrink: 0 },
  bringInButton: {
    fontSize: '0.85rem',
    padding: '0.4rem 0.75rem',
    borderRadius: '8px',
    border: '1px solid #2E4034',
    backgroundColor: '#2E4034',
    color: '#FFF',
    cursor: 'pointer',
    fontFamily: 'Georgia, serif',
    whiteSpace: 'nowrap',
  },
  skipButton: {
    fontSize: '0.85rem',
    padding: '0.4rem 0.75rem',
    borderRadius: '8px',
    border: '1px solid #CCC',
    backgroundColor: '#FFF',
    color: '#999',
    cursor: 'pointer',
    fontFamily: 'Georgia, serif',
    whiteSpace: 'nowrap',
  },
  pagination: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '1rem', marginTop: '0.5rem' },
  pageButton: {
    fontSize: '0.85rem',
    padding: '0.4rem 0.85rem',
    borderRadius: '8px',
    border: '1px solid #2E4034',
    backgroundColor: '#FFF',
    color: '#2E4034',
    cursor: 'pointer',
    fontFamily: 'Georgia, serif',
  },
  pageLabel: { fontSize: '0.85rem', color: '#666' },
}
