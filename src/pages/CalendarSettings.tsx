import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'

type CalendarSource = {
  id: string
  ical_url: string
  label: string
  last_synced_at: string | null
  last_sync_error: string | null
}

// Deliberately NOT Google OAuth / full account access — each source is just a calendar's own
// secret iCal URL (read-only, revocable from that calendar's own settings, and the founder
// chooses exactly which calendar(s) to paste in here). See PROJECT_CONTEXT.md item 48.
export default function CalendarSettings({ onBack, backLabel }: { onBack: () => void; backLabel: string }) {
  const [sources, setSources] = useState<CalendarSource[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)

  const [url, setUrl] = useState('')
  const [label, setLabel] = useState('')
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)

  const [removingId, setRemovingId] = useState<string | null>(null)

  const [syncing, setSyncing] = useState(false)
  const [syncError, setSyncError] = useState<string | null>(null)
  const [syncResult, setSyncResult] = useState<string | null>(null)

  useEffect(() => {
    load()
  }, [])

  async function handleSync() {
    setSyncing(true)
    setSyncError(null)
    setSyncResult(null)
    const { data, error } = await supabase.functions.invoke('scan-calendar-sources', { body: {} })
    setSyncing(false)
    if (error) {
      setSyncError("Couldn't sync right now — please try again.")
      return
    }
    const added = data?.candidatesAdded ?? 0
    setSyncResult(
      added > 0
        ? `Found ${added} event${added === 1 ? '' : 's'} — check the Calendar page to review.`
        : "All synced — nothing new found."
    )
    load()
  }

  async function load() {
    setLoading(true)
    const { data, error } = await supabase
      .from('calendar_sources')
      .select('id, ical_url, label, last_synced_at, last_sync_error')
      .order('created_at')
    // A missing table (migration not yet applied) surfaces as a PostgREST error, not just an
    // empty list — show the empty state rather than crash, since this page should still render.
    setSources(error ? [] : (data ?? []))
    setLoadError(!!error)
    setLoading(false)
  }

  async function handleAdd(e: FormEvent) {
    e.preventDefault()
    const trimmedUrl = url.trim()
    if (!trimmedUrl) return
    setAdding(true)
    setAddError(null)

    const { data: validation, error: validateError } = await supabase.functions.invoke('validate-calendar-source', {
      body: { url: trimmedUrl },
    })
    if (validateError || !validation?.valid) {
      setAdding(false)
      setAddError(validation?.error ?? "Couldn't verify that calendar — please try again.")
      return
    }

    const {
      data: { user },
    } = await supabase.auth.getUser()
    const finalLabel = label.trim() || validation.suggestedLabel || 'Calendar'

    const { error } = await supabase
      .from('calendar_sources')
      .insert({ user_id: user?.id, ical_url: trimmedUrl, label: finalLabel })

    setAdding(false)
    if (error) {
      setAddError("Couldn't save that calendar — please try again.")
      return
    }
    setUrl('')
    setLabel('')
    load()
  }

  async function handleRemove(id: string) {
    setRemovingId(id)
    await supabase.from('calendar_sources').delete().eq('id', id)
    setRemovingId(null)
    load()
  }

  return (
    <div style={styles.page}>
      <button onClick={onBack} style={styles.backButton}>← Back to {backLabel}</button>

      <h1 style={styles.heading}>Calendar settings</h1>
      <p style={styles.intro}>
        Connect calendars you want Boomer to read from — nothing here shares your whole Google
        account, just the specific calendar(s) you choose below.
      </p>

      <section style={styles.section}>
        <div style={styles.sectionHeadingRow}>
          <h2 style={styles.sectionHeading}>Connected calendars</h2>
          {sources.length > 0 && (
            <button onClick={handleSync} style={styles.syncButton} disabled={syncing}>
              {syncing ? 'Syncing…' : 'Sync now'}
            </button>
          )}
        </div>
        {syncResult && <p style={styles.successText}>{syncResult}</p>}
        {syncError && <p style={styles.errorText}>{syncError}</p>}
        {loading ? (
          <p style={styles.body}>Loading…</p>
        ) : sources.length === 0 ? (
          <p style={styles.body}>
            {loadError
              ? "Calendar connections aren't set up on this account yet."
              : 'No calendars connected yet — add one below.'}
          </p>
        ) : (
          <div style={styles.sourceList}>
            {sources.map((s) => (
              <div key={s.id} style={styles.sourceRow}>
                <div style={styles.sourceInfo}>
                  <p style={styles.sourceLabel}>{s.label}</p>
                  <p style={s.last_sync_error ? styles.sourceErrorText : styles.sourceMeta}>
                    {s.last_sync_error
                      ? `Couldn't sync — ${s.last_sync_error}`
                      : s.last_synced_at
                        ? `Last synced ${new Date(s.last_synced_at).toLocaleDateString()}`
                        : 'Not synced yet'}
                  </p>
                </div>
                <button
                  onClick={() => handleRemove(s.id)}
                  style={styles.removeButton}
                  disabled={removingId === s.id}
                >
                  {removingId === s.id ? '…' : 'Remove'}
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section style={styles.section}>
        <h2 style={styles.sectionHeading}>Add a calendar</h2>
        <p style={styles.body}>
          In Google Calendar: Settings → pick a calendar on the left → "Integrate calendar" →
          copy the "Secret address in iCal format."
        </p>
        <form onSubmit={handleAdd} style={styles.formColumn}>
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://calendar.google.com/calendar/ical/…"
            style={styles.input}
            disabled={adding}
          />
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Label, like Personal or Family (optional)"
            style={styles.input}
            disabled={adding}
          />
          <button type="submit" style={styles.actionButtonPrimary} disabled={adding || !url.trim()}>
            {adding ? 'Checking…' : 'Add calendar'}
          </button>
        </form>
        {addError && <p style={styles.errorText}>{addError}</p>}
      </section>
    </div>
  )
}

const styles: { [key: string]: React.CSSProperties } = {
  page: { maxWidth: '840px', margin: '0 auto', padding: '1rem 1.5rem 2rem', fontFamily: 'Georgia, serif' },
  backButton: {
    background: 'none',
    border: 'none',
    color: '#2E4034',
    fontSize: '1rem',
    cursor: 'pointer',
    marginBottom: '1rem',
    padding: 0,
  },
  heading: { fontSize: '2rem', color: '#2E4034', margin: '0 0 0.5rem' },
  intro: { fontSize: '0.95rem', color: '#666', lineHeight: 1.5, margin: '0 0 1.25rem' },
  section: {
    backgroundColor: '#FFF',
    border: '1px solid #CFE0D6',
    borderRadius: '10px',
    padding: '1rem 1.1rem',
    marginBottom: '1rem',
  },
  sectionHeadingRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', marginBottom: '0.5rem' },
  sectionHeading: { fontSize: '1.1rem', color: '#2E4034', margin: 0 },
  syncButton: {
    fontSize: '0.85rem',
    padding: '0.4rem 0.85rem',
    borderRadius: '8px',
    border: '1px solid #2E4034',
    backgroundColor: '#FFF',
    color: '#2E4034',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    fontFamily: 'Georgia, serif',
  },
  successText: { color: '#3A7A4A', fontSize: '0.85rem', margin: '0 0 0.75rem' },
  body: { fontSize: '0.9rem', color: '#666', lineHeight: 1.5, margin: '0 0 0.75rem' },
  sourceList: { display: 'flex', flexDirection: 'column', gap: '0.5rem' },
  sourceRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '0.75rem',
    padding: '0.5rem 0',
    borderBottom: '1px solid #F0EEE8',
  },
  sourceInfo: { minWidth: 0 },
  sourceLabel: { fontSize: '0.95rem', color: '#2E2E2E', margin: 0 },
  sourceMeta: { fontSize: '0.8rem', color: '#999', margin: '0.15rem 0 0' },
  sourceErrorText: { fontSize: '0.8rem', color: '#B04A3B', margin: '0.15rem 0 0' },
  removeButton: {
    fontSize: '0.85rem',
    padding: '0.4rem 0.75rem',
    borderRadius: '8px',
    border: '1px solid #CCC',
    backgroundColor: '#FFF',
    color: '#B04A3B',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    fontFamily: 'Georgia, serif',
  },
  formColumn: { display: 'flex', flexDirection: 'column', gap: '0.5rem', maxWidth: '420px' },
  input: {
    fontSize: '0.95rem',
    padding: '0.6rem 0.75rem',
    borderRadius: '8px',
    border: '1px solid #CCC',
    fontFamily: 'Georgia, serif',
  },
  actionButtonPrimary: {
    fontSize: '0.95rem',
    padding: '0.6rem 1rem',
    borderRadius: '8px',
    border: 'none',
    backgroundColor: '#2E4034',
    color: '#FFF',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    fontFamily: 'Georgia, serif',
    alignSelf: 'flex-start',
  },
  errorText: { color: '#B04A3B', fontSize: '0.85rem', margin: '0.5rem 0 0' },
}
