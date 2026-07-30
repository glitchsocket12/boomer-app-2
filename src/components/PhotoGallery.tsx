import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

const PLACEHOLDER_COLORS = ['#DCE8DE', '#F6E8C8', '#E8D9D0', '#D9E2EC', '#EBDCEB', '#E4E9D6']

function CameraIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#8A9A8E" strokeWidth="1.6">
      <path d="M4 8h3l1.5-2h7L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z" strokeLinejoin="round" />
      <circle cx="12" cy="13.5" r="3.25" />
    </svg>
  )
}

// Renders real photos for `momentId` once any exist (see PROJECT_CONTEXT.md §2/§6 — the Google
// Photos import feature), falling back to the original placeholder tiles otherwise. Person/Group
// pages don't pass momentId and keep the placeholder unchanged — a per-person/group rollup across
// their moments is a later pass, not this one.
export default function PhotoGallery({ momentId, count = 4 }: { momentId?: string; count?: number }) {
  const [photos, setPhotos] = useState<{ id: string; url: string | null }[] | null>(null)

  useEffect(() => {
    if (!momentId) {
      setPhotos(null)
      return
    }
    let cancelled = false
    supabase
      .from('photos')
      .select('id, storage_path')
      .eq('moment_id', momentId)
      .then(async ({ data, error }) => {
        if (cancelled) return
        if (error || !data || data.length === 0) {
          setPhotos([])
          return
        }
        const { data: signed } = await supabase.storage
          .from('photos')
          .createSignedUrls(
            data.map((p) => p.storage_path),
            3600
          )
        const urlByPath = new Map((signed ?? []).filter((s) => s.signedUrl).map((s) => [s.path!, s.signedUrl!]))
        setPhotos(data.map((p) => ({ id: p.id, url: urlByPath.get(p.storage_path) ?? null })))
      })
    return () => {
      cancelled = true
    }
  }, [momentId])

  if (photos && photos.length > 0) {
    return (
      <div style={styles.wrap}>
        <h2 style={styles.heading}>Gallery</h2>
        <div style={styles.row}>
          {photos.map((p) =>
            p.url ? (
              <img key={p.id} src={p.url} alt="" style={styles.photoTile} />
            ) : (
              <div key={p.id} style={{ ...styles.tile, backgroundColor: PLACEHOLDER_COLORS[0] }} />
            )
          )}
        </div>
      </div>
    )
  }

  return (
    <div style={styles.wrap}>
      <h2 style={styles.heading}>Gallery</h2>
      <p style={styles.caption}>
        {momentId ? 'No photos on this event yet.' : 'Preview of an upcoming feature — these are placeholders, not real photos yet.'}
      </p>
      <div style={styles.row}>
        {Array.from({ length: count }).map((_, i) => (
          <div key={i} style={{ ...styles.tile, backgroundColor: PLACEHOLDER_COLORS[i % PLACEHOLDER_COLORS.length] }}>
            <CameraIcon />
          </div>
        ))}
      </div>
    </div>
  )
}

const styles: { [key: string]: React.CSSProperties } = {
  wrap: { margin: '1.5rem 0' },
  heading: { fontSize: '1.2rem', color: '#2E4034', margin: '0 0 0.25rem 0' },
  caption: { margin: '0 0 0.75rem 0', fontSize: '0.85rem', color: '#999', fontStyle: 'italic' },
  row: { display: 'flex', gap: '0.6rem', flexWrap: 'wrap' },
  tile: {
    width: '84px',
    height: '84px',
    borderRadius: '10px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: '1px solid rgba(0,0,0,0.06)',
  },
  photoTile: {
    width: '84px',
    height: '84px',
    borderRadius: '10px',
    objectFit: 'cover',
    border: '1px solid rgba(0,0,0,0.06)',
  },
}
