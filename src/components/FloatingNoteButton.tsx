// Floating "add a note" bubble (2026-08-07 redesign, founder-requested) — the note-taking chat
// used to sit inline in the Notes section, meaning you had to scroll all the way down to find it.
// This keeps it one tap away from anywhere on the page instead: a circular button fixed at the
// bottom-right (mirrors FeedbackWidget.tsx's own fixed-position pattern, opposite corner so the
// two never overlap) that expands into a full panel holding whatever's passed as `children` (the
// page's own NoteWithDetection instance — this component only owns the open/closed chrome around
// it, not the note-taking logic itself). Click to open, click the × or the backdrop to close.
import { useEffect, useState } from 'react'
import { border, colors, fontFamily, fontSize, radius, shadow, space } from '../lib/theme'

export default function FloatingNoteButton({ label, children }: { label: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open])

  return (
    <div style={styles.root}>
      {open && (
        <div style={styles.panel}>
          <div style={styles.panelHeaderRow}>
            <span style={styles.panelLabel}>{label}</span>
            <button type="button" onClick={() => setOpen(false)} style={styles.closeButton} aria-label="Close">
              ×
            </button>
          </div>
          {children}
        </div>
      )}
      {!open && (
        <button type="button" onClick={() => setOpen(true)} style={styles.fab} aria-label={label} title={label}>
          💬
        </button>
      )}
    </div>
  )
}

const styles: { [key: string]: React.CSSProperties } = {
  root: { position: 'fixed', bottom: '1.25rem', right: '1.25rem', zIndex: 500, fontFamily },
  fab: {
    width: '52px',
    height: '52px',
    borderRadius: radius.circle,
    border: 'none',
    backgroundColor: colors.primary,
    color: colors.onFill,
    fontSize: '1.4rem',
    cursor: 'pointer',
    boxShadow: shadow.raised,
  },
  panel: {
    width: 'min(360px, calc(100vw - 2.5rem))',
    maxHeight: '70vh',
    display: 'flex',
    flexDirection: 'column',
    gap: space.sm,
    backgroundColor: colors.surface,
    border: border.light,
    borderRadius: radius.xl,
    padding: space.lg,
    boxShadow: shadow.modal,
    boxSizing: 'border-box',
    overflowY: 'auto',
  },
  panelHeaderRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  panelLabel: { fontSize: fontSize.label, fontWeight: 'bold', color: colors.ink },
  closeButton: {
    background: 'none',
    border: 'none',
    fontSize: fontSize.h3,
    lineHeight: 1,
    color: colors.textMuted,
    cursor: 'pointer',
    padding: '0.1rem 0.3rem',
  },
}
