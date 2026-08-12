import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { fetchAllRows } from '../lib/pagedSelect'
import { colors, fontSize, radius } from '../lib/theme'

const PLACEHOLDER_COLORS = ['#DCE8DE', '#F6E8C8', '#E8D9D0', '#D9E2EC', '#EBDCEB', '#E4E9D6']

function CameraIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#8A9A8E" strokeWidth="1.6">
      <path d="M4 8h3l1.5-2h7L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z" strokeLinejoin="round" />
      <circle cx="12" cy="13.5" r="3.25" />
    </svg>
  )
}

// Full-screen viewer for a gallery's real photos. The images shown are the same signed URLs the
// thumbnails already use (the ~1600px copy stored at import time — see DOWNLOAD_WIDTH in
// google-photos-picker-session-import/index.ts) — Google's own picker URLs are session-scoped and
// expire, so there's no fuller-quality source left to link out to once the picker session is over.
function PhotoLightbox({
  photos,
  index,
  onIndexChange,
  onClose,
}: {
  photos: { id: string; url: string | null }[]
  index: number
  onIndexChange: (i: number) => void
  onClose: () => void
}) {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowLeft') onIndexChange((index - 1 + photos.length) % photos.length)
      else if (e.key === 'ArrowRight') onIndexChange((index + 1) % photos.length)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [index, photos.length, onIndexChange, onClose])

  const photo = photos[index]

  return (
    <div style={styles.overlay} onClick={onClose}>
      <button onClick={onClose} style={styles.closeButton} aria-label="Close">
        ×
      </button>
      {photos.length > 1 && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            onIndexChange((index - 1 + photos.length) % photos.length)
          }}
          style={{ ...styles.navButton, left: '0.5rem' }}
          aria-label="Previous photo"
        >
          ‹
        </button>
      )}
      {photo?.url && (
        <img src={photo.url} alt="" style={styles.fullImage} onClick={(e) => e.stopPropagation()} />
      )}
      {photos.length > 1 && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            onIndexChange((index + 1) % photos.length)
          }}
          style={{ ...styles.navButton, right: '0.5rem' }}
          aria-label="Next photo"
        >
          ›
        </button>
      )}
    </div>
  )
}

// Renders real photos for `momentId` once any exist (see PROJECT_CONTEXT.md §2/§6 — the Google
// Photos import feature), falling back to the original placeholder tiles otherwise.
//
// `personId` (2026-08-07) rolls up photos from every event that person is tagged to attending —
// a person has no photos of their own, only ones inherited from moments. Group pages still don't
// pass either prop and keep the placeholder unchanged; a group rollup is a later pass, not this
// one. Real thumbnails open a full-screen lightbox on click.
//
// `subEventIds` (2026-08-10) is the third roll-up: a parent event's gallery shows its own photos
// plus every sub-event's, since on a multi-day event the photos are attached to the individual
// days. The caller passes the ids because EventDetail has already loaded them — no extra query.
export default function PhotoGallery({
  momentId,
  personId,
  subEventIds,
  count = 4,
}: {
  momentId?: string
  personId?: string
  subEventIds?: string[]
  count?: number
}) {
  const [photos, setPhotos] = useState<{ id: string; url: string | null }[] | null>(null)
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null)

  // Joined rather than the array itself, so a parent re-render handing over a fresh array of the
  // same ids doesn't refetch the whole gallery.
  const subEventIdsKey = (subEventIds ?? []).join(',')

  useEffect(() => {
    if (!momentId && !personId) {
      setPhotos(null)
      return
    }
    let cancelled = false

    async function run() {
      let momentIds: string[]
      if (momentId) {
        momentIds = [momentId, ...(subEventIdsKey ? subEventIdsKey.split(',') : [])]
      } else {
        // Same "who was there" signal EventDetail.tsx uses for attendance, read the other way —
        // every moment this person has a note tagging them to.
        const { data: noteRows } = await supabase
          .from('notes')
          .select('moment_id')
          .eq('person_id', personId)
          .not('moment_id', 'is', null)
        momentIds = [...new Set((noteRows ?? []).map((r) => r.moment_id as string))]
      }

      if (momentIds.length === 0) {
        if (!cancelled) setPhotos([])
        return
      }

      // Ordered by when the photo was taken: once a gallery merges several moments (a parent's
      // sub-events, or a person's whole history) the default arbitrary order interleaves days.
      const { data, error } = await fetchAllRows((from, to) =>
        supabase
          .from('photos')
          .select('id, storage_path')
          .in('moment_id', momentIds)
          .order('taken_at', { ascending: true, nullsFirst: false })
          .order('created_at', { ascending: true })
          .order('id')
          .range(from, to)
      )
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
      if (cancelled) return
      const urlByPath = new Map((signed ?? []).filter((s) => s.signedUrl).map((s) => [s.path!, s.signedUrl!]))
      setPhotos(data.map((p) => ({ id: p.id, url: urlByPath.get(p.storage_path) ?? null })))
    }

    run()
    return () => {
      cancelled = true
    }
  }, [momentId, personId, subEventIdsKey])

  if (photos && photos.length > 0) {
    return (
      <div style={styles.wrap}>
        <h2 style={styles.heading}>Gallery</h2>
        <div style={styles.row}>
          {photos.map((p, i) =>
            p.url ? (
              <img
                key={p.id}
                src={p.url}
                alt=""
                style={{ ...styles.photoTile, cursor: 'pointer' }}
                onClick={() => setLightboxIndex(i)}
              />
            ) : (
              <div key={p.id} style={{ ...styles.tile, backgroundColor: PLACEHOLDER_COLORS[0] }} />
            )
          )}
        </div>
        {lightboxIndex !== null && (
          <PhotoLightbox
            photos={photos}
            index={lightboxIndex}
            onIndexChange={setLightboxIndex}
            onClose={() => setLightboxIndex(null)}
          />
        )}
      </div>
    )
  }

  return (
    <div style={styles.wrap}>
      <h2 style={styles.heading}>Gallery</h2>
      <p style={styles.caption}>
        {momentId
          ? 'No photos on this event yet.'
          : personId
          ? "No photos yet — they'll show up here once you add photos to events this person is tagged to."
          : 'Preview of an upcoming feature — these are placeholders, not real photos yet.'}
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
  heading: { fontSize: '1.2rem', color: colors.ink, margin: '0 0 0.25rem 0' },
  caption: { margin: '0 0 0.75rem 0', fontSize: fontSize.label, color: colors.textFaintest, fontStyle: 'italic' },
  row: { display: 'flex', gap: '0.6rem', flexWrap: 'wrap' },
  tile: {
    width: '84px',
    height: '84px',
    borderRadius: radius.lg,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: '1px solid rgba(0,0,0,0.06)',
  },
  photoTile: {
    width: '84px',
    height: '84px',
    borderRadius: radius.lg,
    objectFit: 'cover',
    border: '1px solid rgba(0,0,0,0.06)',
  },
  overlay: {
    position: 'fixed',
    inset: 0,
    backgroundColor: 'rgba(0,0,0,0.88)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
  fullImage: {
    maxWidth: '92vw',
    maxHeight: '90vh',
    objectFit: 'contain',
    borderRadius: radius.sm,
  },
  closeButton: {
    position: 'absolute',
    top: '1rem',
    right: '1.25rem',
    background: 'none',
    border: 'none',
    color: colors.onFill,
    fontSize: '2.25rem',
    lineHeight: 1,
    cursor: 'pointer',
    padding: '0.25rem 0.5rem',
  },
  navButton: {
    position: 'absolute',
    top: '50%',
    transform: 'translateY(-50%)',
    background: 'rgba(255,255,255,0.12)',
    border: 'none',
    color: colors.onFill,
    fontSize: '2.5rem',
    lineHeight: 1,
    cursor: 'pointer',
    padding: '0.25rem 0.9rem',
    borderRadius: radius.md,
  },
}
