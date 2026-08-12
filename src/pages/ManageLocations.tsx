import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { fetchAllRows } from '../lib/pagedSelect'
import { findLocationClusters, tallyLocations, type LocationCluster, type LocationRow } from '../lib/locationGroups'
import { border, colors, fontFamily, fontSize, maxWidth, radius, space } from '../lib/theme'

// Backlog item 66. `moments.location` is free text with no id behind it, so the same real place
// typed three ways is three unrelated values — and once they exist, nothing in the app can tell
// they're the same. This is the one screen that sees them all at once and can rewrite them,
// modelled on ManageTags.tsx (the same "here is the whole vocabulary, fix it here" idea).
//
// Everything here is a plain UPDATE over `moments.location`; there is no locations table to keep
// in sync. AddressSuggestInput's "previously typed" dropdown reads the same column, so cleaning up
// here is also what stops a bad variant being offered back on the next event.
export default function ManageLocations({
  onBack,
  backLabel,
}: {
  onBack: () => void
  backLabel: string
}) {
  const [locations, setLocations] = useState<LocationRow[] | null>(null)
  const [clusters, setClusters] = useState<LocationCluster[]>([])
  const [editingValue, setEditingValue] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const [mergingKey, setMergingKey] = useState<string | null>(null)
  const [mergeTarget, setMergeTarget] = useState('')

  useEffect(() => {
    load()
  }, [])

  async function load() {
    // Paged: `moments` is account-sized, and a location past row 1000 would silently look like it
    // doesn't exist — which on THIS screen would mean a merge that quietly skipped some events.
    const { data, error: loadError } = await fetchAllRows((from, to) =>
      supabase.from('moments').select('id, location').order('id').range(from, to)
    )
    if (loadError) {
      setError("Couldn't load your locations — please try again.")
      setLocations([])
      return
    }
    const rows = tallyLocations(((data as { location: string | null }[] | null) ?? []).map((m) => m.location))
    setLocations(rows)
    setClusters(findLocationClusters(rows))
  }

  // The single write this screen makes. `oldValues` is a list so a whole cluster collapses in one
  // pass; renaming one value is just the one-element case.
  async function rewrite(oldValues: string[], newValue: string): Promise<boolean> {
    setSaving(true)
    setError(null)
    setDone(null)
    const trimmed = newValue.trim()
    const { error: updateError } = await supabase
      .from('moments')
      .update({ location: trimmed || null })
      .in('location', oldValues)
    setSaving(false)
    if (updateError) {
      setError("Couldn't save that change — nothing was altered. Please try again.")
      return false
    }
    setDone(trimmed ? `Saved — those events now say "${trimmed}".` : 'Saved — the location was cleared.')
    await load()
    return true
  }

  function startEditing(value: string) {
    setEditingValue(value)
    setEditText(value)
    setMergingKey(null)
    setError(null)
    setDone(null)
  }

  async function handleSaveEdit(e: FormEvent) {
    e.preventDefault()
    if (editingValue === null) return
    if (editText.trim() === editingValue) {
      setEditingValue(null)
      return
    }
    if (await rewrite([editingValue], editText)) setEditingValue(null)
  }

  function startMerge(cluster: LocationCluster) {
    setMergingKey(cluster.suggested)
    setMergeTarget(cluster.suggested)
    setEditingValue(null)
    setError(null)
    setDone(null)
  }

  async function handleMerge(cluster: LocationCluster, e: FormEvent) {
    e.preventDefault()
    if (!mergeTarget.trim()) return
    const members = cluster.members.map((m) => m.value)
    if (await rewrite(members, mergeTarget)) setMergingKey(null)
  }

  const totalEvents = (locations ?? []).reduce((n, l) => n + l.count, 0)

  return (
    <div style={styles.page}>
      <button onClick={onBack} style={styles.backButton}>← Back to {backLabel}</button>

      <h1 style={styles.heading}>Manage Locations</h1>
      <p style={styles.body}>
        Every place written on an event, with how many events use it. Editing one here rewrites it on all of them at
        once — handy when the same address got typed a few different ways before the app started suggesting what you'd
        used before.
      </p>

      {error && <p style={styles.errorText}>{error}</p>}
      {done && <p style={styles.doneText}>{done}</p>}

      {locations === null ? (
        <p style={styles.loading}>Loading…</p>
      ) : locations.length === 0 ? (
        <p style={styles.loading}>No locations on any events yet.</p>
      ) : (
        <>
          {clusters.length > 0 && (
            <section style={styles.clusterSection}>
              <h2 style={styles.sectionHeading}>Look like the same place</h2>
              <p style={styles.sectionBody}>
                These are spelled differently but point at the same address. Pick the version to keep — the rest get
                rewritten to match.
              </p>
              {clusters.map((cluster) => (
                <div key={cluster.suggested} style={styles.clusterCard}>
                  <ul style={styles.clusterList}>
                    {cluster.members.map((m) => (
                      <li key={m.value} style={styles.clusterItem}>
                        <span>{m.value}</span>
                        <span style={styles.usageCount}>
                          {m.count} event{m.count === 1 ? '' : 's'}
                        </span>
                      </li>
                    ))}
                  </ul>
                  {mergingKey === cluster.suggested ? (
                    <form onSubmit={(e) => handleMerge(cluster, e)} style={styles.mergeForm}>
                      <label style={styles.mergeLabel}>Keep this version:</label>
                      {cluster.members.map((m) => (
                        <label key={m.value} style={styles.radioRow}>
                          <input
                            type="radio"
                            name={`merge-${cluster.suggested}`}
                            checked={mergeTarget === m.value}
                            onChange={() => setMergeTarget(m.value)}
                            disabled={saving}
                          />
                          <span>{m.value}</span>
                        </label>
                      ))}
                      {/* Free text as well as the radios: often the RIGHT spelling is none of the
                          three that got typed, and forcing a pick would just bake in a bad one. */}
                      <input
                        type="text"
                        value={mergeTarget}
                        onChange={(e) => setMergeTarget(e.target.value)}
                        style={styles.editInput}
                        disabled={saving}
                        aria-label="Version to keep"
                      />
                      <div style={styles.buttonRow}>
                        <button type="submit" style={styles.saveButton} disabled={saving || !mergeTarget.trim()}>
                          {saving ? '…' : 'Merge them'}
                        </button>
                        <button type="button" onClick={() => setMergingKey(null)} style={styles.cancelButton} disabled={saving}>
                          Cancel
                        </button>
                      </div>
                    </form>
                  ) : (
                    <button type="button" onClick={() => startMerge(cluster)} style={styles.actionButton}>
                      Merge these {cluster.members.length}
                    </button>
                  )}
                </div>
              ))}
            </section>
          )}

          <h2 style={styles.sectionHeading}>
            All locations ({locations.length} across {totalEvents} event{totalEvents === 1 ? '' : 's'})
          </h2>
          <div style={styles.list}>
            {locations.map((row) => (
              <div key={row.value} style={styles.row}>
                {editingValue === row.value ? (
                  <form onSubmit={handleSaveEdit} style={styles.editForm}>
                    <input
                      type="text"
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                      style={styles.editInput}
                      autoFocus
                      disabled={saving}
                      aria-label="Location"
                    />
                    <div style={styles.buttonRow}>
                      <button type="submit" style={styles.saveButton} disabled={saving}>
                        {saving ? '…' : 'Save'}
                      </button>
                      <button type="button" onClick={() => setEditingValue(null)} style={styles.cancelButton} disabled={saving}>
                        Cancel
                      </button>
                    </div>
                    <p style={styles.editHint}>
                      Typing an existing location here merges this one into it. Clearing the box removes the location
                      from {row.count} event{row.count === 1 ? '' : 's'} — the events themselves are untouched.
                    </p>
                  </form>
                ) : (
                  <>
                    <div style={styles.rowMain}>
                      <span style={styles.locationName}>{row.value}</span>
                      <span style={styles.usageCount}>
                        {row.count} event{row.count === 1 ? '' : 's'}
                      </span>
                    </div>
                    <button onClick={() => startEditing(row.value)} style={styles.actionButton}>
                      Edit
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>
        </>
      )}
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
    marginBottom: space.xl,
    padding: 0,
  },
  heading: { fontSize: fontSize.h1, color: colors.ink, margin: '0 0 0.5rem' },
  body: { fontSize: fontSize.bodyLg, color: colors.textMuted, lineHeight: 1.5, margin: '0 0 1.25rem' },
  sectionHeading: { fontSize: fontSize.base, color: colors.inkPlain, margin: '1.5rem 0 0.4rem' },
  sectionBody: { fontSize: fontSize.body, color: colors.textMuted, lineHeight: 1.5, margin: '0 0 0.75rem' },
  clusterSection: { marginBottom: space.xxl },
  clusterCard: {
    border: border.inkPale,
    borderRadius: radius.lg,
    padding: '0.9rem 1rem',
    marginBottom: space.md,
    backgroundColor: colors.surface,
  },
  clusterList: { listStyle: 'none', margin: '0 0 0.7rem', padding: 0, display: 'flex', flexDirection: 'column', gap: '0.3rem' },
  clusterItem: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: space.md,
    fontSize: fontSize.body,
    color: colors.inkPlain,
    flexWrap: 'wrap',
  },
  mergeForm: { display: 'flex', flexDirection: 'column', gap: '0.4rem' },
  mergeLabel: { fontSize: fontSize.small, color: colors.textFaintest },
  radioRow: { display: 'flex', alignItems: 'center', gap: space.sm, fontSize: fontSize.body, color: colors.textBody, minHeight: '32px' },
  errorText: { color: colors.danger, fontSize: fontSize.label, margin: '0 0 1rem' },
  doneText: { color: colors.tree, fontSize: fontSize.label, margin: '0 0 1rem' },
  loading: { color: colors.textSubtle },
  list: {
    backgroundColor: colors.surface,
    border: border.inkPale,
    borderRadius: radius.lg,
    padding: '0.25rem 1.1rem',
  },
  row: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '100%',
    padding: '0.75rem 0',
    borderTop: '1px solid #F0EEE8',
    flexWrap: 'wrap',
    gap: space.md,
  },
  rowMain: { display: 'flex', flexDirection: 'column', gap: '0.15rem', minWidth: 0, flex: '1 1 0' },
  locationName: { fontSize: fontSize.base, color: colors.inkPlain, overflowWrap: 'anywhere' },
  usageCount: { fontSize: fontSize.small, color: colors.textFaintest, whiteSpace: 'nowrap' },
  actionButton: {
    minHeight: '44px',
    fontSize: fontSize.label,
    padding: '0.4rem 0.9rem',
    borderRadius: radius.sm,
    border: '1px solid #999',
    backgroundColor: 'transparent',
    color: colors.textBody,
    cursor: 'pointer',
    fontFamily,
  },
  editForm: { display: 'flex', flexDirection: 'column', gap: space.sm, width: '100%' },
  editInput: {
    width: '100%',
    boxSizing: 'border-box',
    fontSize: fontSize.bodyLg,
    padding: '0.5rem 0.6rem',
    borderRadius: radius.sm,
    border: border.default,
    fontFamily,
  },
  editHint: { fontSize: fontSize.small, color: colors.textFaintest, lineHeight: 1.4, margin: 0 },
  buttonRow: { display: 'flex', gap: space.md },
  saveButton: {
    minHeight: '44px',
    fontSize: fontSize.label,
    padding: '0.4rem 1rem',
    borderRadius: radius.sm,
    border: 'none',
    backgroundColor: colors.primary,
    color: colors.surface,
    cursor: 'pointer',
    fontFamily,
  },
  cancelButton: {
    minHeight: '44px',
    fontSize: fontSize.label,
    padding: '0.4rem 1rem',
    borderRadius: radius.sm,
    border: border.default,
    backgroundColor: colors.surface,
    color: colors.textBody,
    cursor: 'pointer',
    fontFamily,
  },
}
