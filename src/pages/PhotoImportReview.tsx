import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { startGooglePhotosAuth } from '../lib/googlePhotosAuth'
import { startGooglePhotosImport } from '../lib/googlePhotosImport'
import { formatDateRange } from '../lib/dates'
import SearchAddPicker from '../components/SearchAddPicker'

type MomentOption = { id: string; occasion: string | null; event_date: string | null; event_end_date: string | null }

type ClusterPhoto = { id: string; url: string | null }

type ClusterView = {
  id: string
  dateRangeStart: string | null
  dateRangeEnd: string | null
  matchedMomentId: string | null
  photos: ClusterPhoto[]
}

function momentLabel(m: MomentOption): string {
  return m.occasion || (m.event_date ? formatDateRange(m.event_date, m.event_end_date) : 'Untitled event')
}

// The general Google Photos import flow (see EventDetail.tsx's own "Add photos" button for the
// simpler quick-add-to-this-event path, which skips all of this). Reached from Settings.
// PROJECT_CONTEXT.md §2/§10 has the Google Cloud/OAuth setup this depends on.
export default function PhotoImportReview({
  onBack,
  backLabel,
  onSelectEvent,
}: {
  onBack: () => void
  backLabel: string
  onSelectEvent: (event: { id: string; summary: string }) => void
}) {
  const [connectedEmail, setConnectedEmail] = useState<string | null | undefined>(undefined)
  const [importing, setImporting] = useState(false)
  const [importStatus, setImportStatus] = useState<string | null>(null)
  const [importError, setImportError] = useState<string | null>(null)

  const [clusters, setClusters] = useState<ClusterView[] | null>(null)
  const [moments, setMoments] = useState<MomentOption[]>([])
  const [selectedMomentId, setSelectedMomentId] = useState<Record<string, string | null>>({})
  const [resolvingId, setResolvingId] = useState<string | null>(null)
  const [justAdded, setJustAdded] = useState<{ id: string; label: string } | null>(null)

  const importHandle = useRef<{ cancel: () => void } | null>(null)

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      setConnectedEmail((user?.user_metadata as any)?.google_photos_email ?? null)
    })
    loadMoments()
    loadClusters()
    return () => {
      importHandle.current?.cancel()
    }
  }, [])

  async function loadMoments() {
    const { data } = await supabase.from('moments').select('id, occasion, event_date, event_end_date')
    setMoments(data ?? [])
  }

  async function loadClusters() {
    const { data: clusterRows } = await supabase
      .from('photo_clusters')
      .select('id, date_range_start, date_range_end, matched_moment_id')
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
    const rows = clusterRows ?? []
    if (rows.length === 0) {
      setClusters([])
      return
    }

    const { data: photoRows } = await supabase
      .from('photos')
      .select('id, storage_path, photo_cluster_id')
      .in(
        'photo_cluster_id',
        rows.map((r) => r.id)
      )
    const paths = (photoRows ?? []).map((p) => p.storage_path)
    let urlByPath = new Map<string, string>()
    if (paths.length > 0) {
      const { data: signed } = await supabase.storage.from('photos').createSignedUrls(paths, 3600)
      urlByPath = new Map((signed ?? []).filter((s) => s.signedUrl).map((s) => [s.path!, s.signedUrl!]))
    }

    const built: ClusterView[] = rows.map((r) => ({
      id: r.id,
      dateRangeStart: r.date_range_start,
      dateRangeEnd: r.date_range_end,
      matchedMomentId: r.matched_moment_id,
      photos: (photoRows ?? [])
        .filter((p) => p.photo_cluster_id === r.id)
        .map((p) => ({ id: p.id, url: urlByPath.get(p.storage_path) ?? null })),
    }))
    setClusters(built)
    setSelectedMomentId((prev) => {
      const next = { ...prev }
      for (const c of built) {
        if (!(c.id in next)) next[c.id] = c.matchedMomentId
      }
      return next
    })
  }

  function handleImport() {
    setImporting(true)
    setImportError(null)
    setImportStatus('Starting…')
    importHandle.current = startGooglePhotosImport(undefined, {
      onNeedsConnect: () => {
        setImporting(false)
        setImportStatus(null)
        startGooglePhotosAuth()
      },
      onStatus: (message) => setImportStatus(message),
      onError: (message) => {
        setImporting(false)
        setImportStatus(null)
        setImportError(message)
      },
      onDone: (result) => {
        setImporting(false)
        setImportStatus(
          result.imported > 0 ? `Imported ${result.imported} photo${result.imported === 1 ? '' : 's'} — review below.` : 'No new photos found to import.'
        )
        loadClusters()
      },
    })
  }

  async function handleDisconnect() {
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return
    await supabase.from('photo_connections').delete().eq('user_id', user.id)
    await supabase.auth.updateUser({ data: { google_photos_email: null } })
    setConnectedEmail(null)
  }

  async function handleAccept(cluster: ClusterView) {
    setResolvingId(cluster.id)
    setJustAdded(null)
    let momentId = selectedMomentId[cluster.id] ?? null
    let label = momentId ? momentItemsLabel(momentId) : null

    if (!momentId) {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      const dateLabel = cluster.dateRangeStart ? formatDateRange(cluster.dateRangeStart, cluster.dateRangeEnd) : null
      const { data: newMoment, error } = await supabase
        .from('moments')
        .insert({
          user_id: user?.id,
          raw_description: '',
          occasion: null,
          location: null,
          when_text: dateLabel,
          event_date: cluster.dateRangeStart,
          event_end_date: cluster.dateRangeEnd && cluster.dateRangeEnd !== cluster.dateRangeStart ? cluster.dateRangeEnd : null,
        })
        .select()
        .single()
      if (error || !newMoment) {
        setResolvingId(null)
        setImportError("Couldn't create that event — please try again.")
        return
      }
      momentId = newMoment.id
      label = dateLabel ?? 'New event'
    }

    await supabase.from('photos').update({ moment_id: momentId, photo_cluster_id: null }).eq('photo_cluster_id', cluster.id)
    await supabase.from('photo_clusters').update({ status: 'accepted', reviewed_at: new Date().toISOString() }).eq('id', cluster.id)
    setResolvingId(null)
    setJustAdded({ id: momentId!, label: label ?? 'that event' })
    setClusters((prev) => (prev ?? []).filter((c) => c.id !== cluster.id))
  }

  function momentItemsLabel(id: string): string {
    return momentItems.find((m) => m.id === id)?.label ?? 'that event'
  }

  async function handleReject(cluster: ClusterView) {
    setResolvingId(cluster.id)
    await supabase.from('photo_clusters').update({ status: 'rejected', reviewed_at: new Date().toISOString() }).eq('id', cluster.id)
    setResolvingId(null)
    setClusters((prev) => (prev ?? []).filter((c) => c.id !== cluster.id))
  }

  const momentItems = moments
    .map((m) => ({ id: m.id, label: momentLabel(m) }))
    .sort((a, b) => a.label.localeCompare(b.label))

  return (
    <div style={styles.page}>
      <button onClick={onBack} style={styles.backButton}>
        ← Back to {backLabel}
      </button>

      <h1 style={styles.heading}>Import photos</h1>
      <p style={styles.intro}>
        Connect Google Photos, pick some photos in Google's own picker, and Boomer will suggest which event they
        belong to (or a new one) — nothing here scans your whole library, only what you pick each time.
      </p>

      <section style={styles.section}>
        <h2 style={styles.sectionHeading}>Google Photos</h2>
        {connectedEmail === undefined ? (
          <p style={styles.body}>Loading…</p>
        ) : connectedEmail ? (
          <p style={styles.body}>
            Connected as {connectedEmail}. <button onClick={handleDisconnect} style={styles.inlineLink}>Disconnect</button>
          </p>
        ) : (
          <p style={styles.body}>Not connected yet.</p>
        )}
        <button onClick={handleImport} style={styles.actionButtonPrimary} disabled={importing}>
          {importing ? 'Working…' : connectedEmail ? 'Import photos' : 'Connect & import photos'}
        </button>
        {importStatus && <p style={styles.successText}>{importStatus}</p>}
        {importError && <p style={styles.errorText}>{importError}</p>}
      </section>

      <section style={styles.section}>
        <h2 style={styles.sectionHeading}>Ready to review</h2>
        {justAdded && (
          <p style={styles.successText}>
            Added to {justAdded.label} —{' '}
            <button onClick={() => onSelectEvent({ id: justAdded.id, summary: justAdded.label })} style={styles.inlineLink}>
              View event →
            </button>
          </p>
        )}
        {clusters === null ? (
          <p style={styles.body}>Loading…</p>
        ) : clusters.length === 0 ? (
          <p style={styles.body}>Nothing waiting on review right now.</p>
        ) : (
          <div style={styles.clusterList}>
            {clusters.map((cluster) => {
              const dateLabel = cluster.dateRangeStart ? formatDateRange(cluster.dateRangeStart, cluster.dateRangeEnd) : 'Undated photos'
              const isNew = !selectedMomentId[cluster.id]
              return (
                <div key={cluster.id} style={styles.clusterCard}>
                  <div style={styles.thumbRow}>
                    {cluster.photos.slice(0, 6).map((p) =>
                      p.url ? (
                        <img key={p.id} src={p.url} alt="" style={styles.thumb} />
                      ) : (
                        <div key={p.id} style={styles.thumbPlaceholder} />
                      )
                    )}
                    {cluster.photos.length > 6 && <div style={styles.thumbMore}>+{cluster.photos.length - 6}</div>}
                  </div>
                  <p style={styles.clusterDate}>{dateLabel} · {cluster.photos.length} photo{cluster.photos.length === 1 ? '' : 's'}</p>
                  <p style={styles.clusterChoice}>
                    {isNew ? 'Will create a new event' : `Will add to: ${momentItems.find((m) => m.id === selectedMomentId[cluster.id])?.label ?? 'that event'}`}
                  </p>
                  <div style={styles.clusterActions}>
                    <button
                      onClick={() => setSelectedMomentId((prev) => ({ ...prev, [cluster.id]: null }))}
                      style={isNew ? styles.choiceButtonActive : styles.choiceButton}
                      disabled={resolvingId === cluster.id}
                    >
                      New event
                    </button>
                    <div style={styles.pickerWrap}>
                      <SearchAddPicker
                        items={momentItems}
                        placeholder="…or search an existing event"
                        onSelect={(item) => setSelectedMomentId((prev) => ({ ...prev, [cluster.id]: item.id }))}
                      />
                    </div>
                  </div>
                  <div style={styles.clusterActions}>
                    <button onClick={() => handleAccept(cluster)} style={styles.actionButtonPrimary} disabled={resolvingId === cluster.id}>
                      {resolvingId === cluster.id ? 'Working…' : 'Accept'}
                    </button>
                    <button onClick={() => handleReject(cluster)} style={styles.rejectButton} disabled={resolvingId === cluster.id}>
                      Not now
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}

const styles: { [key: string]: React.CSSProperties } = {
  page: { maxWidth: '840px', margin: '0 auto', padding: '1rem 1.5rem 2rem', fontFamily: 'Georgia, serif' },
  backButton: { background: 'none', border: 'none', color: '#2E4034', fontSize: '1rem', cursor: 'pointer', marginBottom: '1rem', padding: 0 },
  heading: { fontSize: '2rem', color: '#2E4034', margin: '0 0 0.5rem' },
  intro: { fontSize: '0.95rem', color: '#666', lineHeight: 1.5, margin: '0 0 1.25rem' },
  section: { backgroundColor: '#FFF', border: '1px solid #CFE0D6', borderRadius: '10px', padding: '1rem 1.1rem', marginBottom: '1rem' },
  sectionHeading: { fontSize: '1.1rem', color: '#2E4034', margin: '0 0 0.5rem' },
  body: { fontSize: '0.9rem', color: '#666', lineHeight: 1.5, margin: '0 0 0.75rem' },
  inlineLink: { background: 'none', border: 'none', color: '#2E4034', textDecoration: 'underline', cursor: 'pointer', fontFamily: 'Georgia, serif', fontSize: '0.9rem', padding: 0 },
  successText: { color: '#3A7A4A', fontSize: '0.85rem', margin: '0.5rem 0 0' },
  errorText: { color: '#B04A3B', fontSize: '0.85rem', margin: '0.5rem 0 0' },
  actionButtonPrimary: {
    fontSize: '0.95rem',
    padding: '0.6rem 1rem',
    borderRadius: '8px',
    border: 'none',
    backgroundColor: '#2E4034',
    color: '#FFF',
    cursor: 'pointer',
    fontFamily: 'Georgia, serif',
  },
  rejectButton: {
    fontSize: '0.85rem',
    padding: '0.6rem 1rem',
    borderRadius: '8px',
    border: '1px solid #CCC',
    backgroundColor: '#FFF',
    color: '#999',
    cursor: 'pointer',
    fontFamily: 'Georgia, serif',
  },
  clusterList: { display: 'flex', flexDirection: 'column', gap: '1rem' },
  clusterCard: { border: '1px solid #F0EEE8', borderRadius: '10px', padding: '0.85rem' },
  thumbRow: { display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '0.5rem' },
  thumb: { width: '64px', height: '64px', objectFit: 'cover', borderRadius: '8px', border: '1px solid #EEE' },
  thumbPlaceholder: { width: '64px', height: '64px', borderRadius: '8px', backgroundColor: '#F0EEE8' },
  thumbMore: { width: '64px', height: '64px', borderRadius: '8px', backgroundColor: '#EAF1EC', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.85rem', color: '#2E4034' },
  clusterDate: { fontSize: '0.9rem', color: '#2E2E2E', margin: '0 0 0.25rem', fontWeight: 'bold' },
  clusterChoice: { fontSize: '0.85rem', color: '#666', margin: '0 0 0.5rem' },
  clusterActions: { display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem', flexWrap: 'wrap' },
  choiceButton: { fontSize: '0.85rem', padding: '0.4rem 0.75rem', borderRadius: '8px', border: '1px solid #CCC', backgroundColor: '#FFF', color: '#2E2E2E', cursor: 'pointer', fontFamily: 'Georgia, serif' },
  choiceButtonActive: { fontSize: '0.85rem', padding: '0.4rem 0.75rem', borderRadius: '8px', border: '1px solid #2E4034', backgroundColor: '#EAF1EC', color: '#2E4034', cursor: 'pointer', fontFamily: 'Georgia, serif' },
  pickerWrap: { flex: 1, minWidth: '220px' },
}
