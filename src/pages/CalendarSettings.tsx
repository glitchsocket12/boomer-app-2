import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { border, colors, fontFamily, fontSize, maxWidth, neutral, radius, space } from '../lib/theme'

type CalendarSource = {
  id: string
  ical_url: string
  label: string
  last_synced_at: string | null
  last_sync_error: string | null
  source_type: 'events' | 'birthdays'
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
  const [sourceType, setSourceType] = useState<'events' | 'birthdays'>('events')
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
    const birthdaysAdded = data?.birthdayCandidatesAdded ?? 0
    // A batch the AI never answered used to come back as an empty result set, which read exactly
    // like "no new events" — that wording is what hid a nine-day API-key outage (PROJECT_CONTEXT.md
    // §10). The count now comes back from the function, and a failed run says so.
    const failures = data?.extractionFailures ?? 0
    const parts: string[] = []
    if (added > 0) parts.push(`${added} event${added === 1 ? '' : 's'}`)
    if (birthdaysAdded > 0) parts.push(`${birthdaysAdded} birthday${birthdaysAdded === 1 ? '' : 's'}`)
    const found =
      parts.length > 0
        ? `Found ${parts.join(' and ')} — check the Calendar page to review.`
        : 'All synced — nothing new found.'
    if (failures > 0) {
      setSyncError(
        parts.length > 0
          ? `${found} Some of your calendar couldn't be read this time, so there may be more — try Sync now again in a few minutes.`
          : "Grove couldn't read your calendar this time — that's a problem on its end, not yours. Nothing was missed; try Sync now again in a few minutes."
      )
      setSyncResult(null)
    } else {
      setSyncResult(found)
    }
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
    const baseSources = error ? [] : (data ?? [])
    // source_type is a newer column (2026-07-26) fetched separately and merged in, fail-open to
    // 'events' — code always ships before the founder runs the matching migration, and a missing
    // column in the MAIN select above would 400 the whole query, blanking the list of existing
    // calendars during that gap (see PROJECT_CONTEXT.md's calendar-import notes).
    let typeById = new Map<string, 'events' | 'birthdays'>()
    if (baseSources.length > 0) {
      const { data: typeData } = await supabase.from('calendar_sources').select('id, source_type')
      typeById = new Map((typeData ?? []).map((r: any) => [r.id, r.source_type as 'events' | 'birthdays']))
    }
    setSources(baseSources.map((s) => ({ ...s, source_type: typeById.get(s.id) ?? 'events' })))
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
      .insert({ user_id: user?.id, ical_url: trimmedUrl, label: finalLabel, source_type: sourceType })

    setAdding(false)
    if (error) {
      setAddError("Couldn't save that calendar — please try again.")
      return
    }
    setUrl('')
    setLabel('')
    setSourceType('events')
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
        Connect calendars you want Grove to read from — nothing here shares your whole Google
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
                  <p style={styles.sourceLabel}>
                    {s.label}
                    {s.source_type === 'birthdays' && <span style={styles.typeBadge}>Birthdays</span>}
                  </p>
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

        <div style={styles.typeChoiceRow}>
          <label style={styles.typeChoiceLabel}>
            <input
              type="radio"
              name="sourceType"
              checked={sourceType === 'events'}
              onChange={() => setSourceType('events')}
              disabled={adding}
            />
            Regular calendar (events)
          </label>
          <label style={styles.typeChoiceLabel}>
            <input
              type="radio"
              name="sourceType"
              checked={sourceType === 'birthdays'}
              onChange={() => setSourceType('birthdays')}
              disabled={adding}
            />
            Birthdays calendar
          </label>
        </div>

        {sourceType === 'events' ? (
          <p style={styles.body}>
            In Google Calendar: Settings → pick a calendar on the left → "Integrate calendar" →
            copy the "Secret address in iCal format."
          </p>
        ) : (
          <p style={styles.body}>
            iPhone automatically keeps a "Birthdays" calendar in sync with your Contacts app — connect
            that one here and Grove stays current as you add or update contacts, with no re-uploading.
            On your iPhone: open <strong>Calendar</strong> → tap <strong>Calendars</strong> at the
            bottom → tap the <strong>(i)</strong> next to <strong>Birthdays</strong> → tap{' '}
            <strong>Share Calendar</strong> → turn on <strong>Public Calendar</strong> → tap{' '}
            <strong>Copy Link</strong>. Paste it below, but change the very beginning from{' '}
            <code>webcal://</code> to <code>https://</code> before pasting (it's the same link, just a
            different way of writing the start of it).
          </p>
        )}

        <form onSubmit={handleAdd} style={styles.formColumn}>
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder={
              sourceType === 'events' ? 'https://calendar.google.com/calendar/ical/…' : 'https://p01-caldav.icloud.com/published/…'
            }
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
  page: { maxWidth: maxWidth.page, margin: '0 auto', padding: '1rem 1.5rem 2rem', fontFamily },
  backButton: {
    background: 'none',
    border: 'none',
    color: colors.ink,
    fontSize: fontSize.base,
    cursor: 'pointer',
    marginBottom: '1rem',
    padding: 0,
  },
  heading: { fontSize: fontSize.h1, color: colors.ink, margin: '0 0 0.5rem' },
  intro: { fontSize: fontSize.bodyLg, color: colors.textMuted, lineHeight: 1.5, margin: '0 0 1.25rem' },
  section: {
    backgroundColor: colors.surface,
    border: border.inkPale,
    borderRadius: radius.lg,
    padding: '1rem 1.1rem',
    marginBottom: '1rem',
  },
  sectionHeadingRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: space.lg, marginBottom: '0.5rem' },
  sectionHeading: { fontSize: fontSize.lead, color: colors.ink, margin: 0 },
  syncButton: {
    fontSize: fontSize.label,
    padding: '0.4rem 0.85rem',
    borderRadius: radius.md,
    border: border.primary,
    backgroundColor: colors.surface,
    color: colors.ink,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    fontFamily,
  },
  successText: { color: colors.success, fontSize: fontSize.label, margin: '0 0 0.75rem' },
  body: { fontSize: fontSize.body, color: colors.textMuted, lineHeight: 1.5, margin: '0 0 0.75rem' },
  sourceList: { display: 'flex', flexDirection: 'column', gap: space.md },
  sourceRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.lg,
    padding: '0.5rem 0',
    borderBottom: `1px solid ${colors.divider}`,
  },
  sourceInfo: { minWidth: 0 },
  sourceLabel: { fontSize: fontSize.bodyLg, color: colors.inkPlain, margin: 0 },
  typeBadge: {
    fontSize: fontSize.micro,
    color: colors.ink,
    backgroundColor: neutral.sageWash,
    border: border.inkPale,
    borderRadius: radius.sm,
    padding: '0.1rem 0.4rem',
    marginLeft: '0.5rem',
  },
  typeChoiceRow: { display: 'flex', gap: '1.25rem', margin: '0 0 0.75rem' },
  typeChoiceLabel: { display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: fontSize.body, color: colors.inkPlain, cursor: 'pointer' },
  sourceMeta: { fontSize: fontSize.small, color: colors.textFaintest, margin: '0.15rem 0 0' },
  sourceErrorText: { fontSize: fontSize.small, color: colors.danger, margin: '0.15rem 0 0' },
  removeButton: {
    fontSize: fontSize.label,
    padding: '0.4rem 0.75rem',
    borderRadius: radius.md,
    border: border.default,
    backgroundColor: colors.surface,
    color: colors.danger,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    fontFamily,
  },
  formColumn: { display: 'flex', flexDirection: 'column', gap: space.md, maxWidth: '420px' },
  input: {
    fontSize: fontSize.bodyLg,
    padding: '0.6rem 0.75rem',
    borderRadius: radius.md,
    border: border.default,
    fontFamily,
  },
  actionButtonPrimary: {
    fontSize: fontSize.bodyLg,
    padding: '0.6rem 1rem',
    borderRadius: radius.md,
    border: 'none',
    backgroundColor: colors.primary,
    color: colors.onFill,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    fontFamily,
    alignSelf: 'flex-start',
  },
  errorText: { color: colors.danger, fontSize: fontSize.label, margin: '0.5rem 0 0' },
}
