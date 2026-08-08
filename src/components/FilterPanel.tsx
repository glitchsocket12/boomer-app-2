// Generic centered popup/modal for a "Filters"-style button to open. Modeled on PhotoGallery.tsx's
// PhotoLightbox (the app's one existing full-screen overlay: scrim, click-outside-to-close,
// Escape-key handling).
//
// Deliberately generic (children-based) so it isn't Events-specific — this is the first instance
// of a pattern the founder wants used more broadly across the app (2026-08-03): a button opening
// a focused popup of options/details, instead of controls embedded inline on the page.

import { useEffect } from 'react'
import { colors, fontFamily, fontSize, maxWidth, radius, shadow, space } from '../lib/theme'

export default function FilterPanel({
  open,
  onClose,
  title,
  activeCount,
  onClearAll,
  children,
}: {
  open: boolean
  onClose: () => void
  title: string
  activeCount: number
  onClearAll: () => void
  children: React.ReactNode
}) {
  useEffect(() => {
    if (!open) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  if (!open) return null

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.sheet} onClick={(e) => e.stopPropagation()}>
        <div style={styles.headerRow}>
          <h2 style={styles.title}>{title}</h2>
          <button type="button" onClick={onClose} style={styles.closeButton} aria-label="Close filters">
            ×
          </button>
        </div>
        <div style={styles.body}>{children}</div>
        <div style={styles.footerRow}>
          <button
            type="button"
            onClick={onClearAll}
            disabled={activeCount === 0}
            style={{
              ...styles.clearButton,
              opacity: activeCount === 0 ? 0.4 : 1,
              cursor: activeCount === 0 ? 'default' : 'pointer',
            }}
          >
            Clear all
          </button>
          <button type="button" onClick={onClose} style={styles.doneButton}>
            Done
          </button>
        </div>
      </div>
    </div>
  )
}

const styles: { [key: string]: React.CSSProperties } = {
  overlay: {
    position: 'fixed',
    inset: 0,
    backgroundColor: 'rgba(0,0,0,0.4)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.xl,
    boxSizing: 'border-box',
    zIndex: 1000,
  },
  sheet: {
    width: '100%',
    maxWidth: maxWidth.dialog,
    maxHeight: '85vh',
    display: 'flex',
    flexDirection: 'column',
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    boxShadow: shadow.modal,
    padding: space.xl,
    boxSizing: 'border-box',
    fontFamily,
  },
  headerRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 },
  title: { fontSize: fontSize.h3, color: colors.ink, margin: 0 },
  closeButton: {
    background: 'none',
    border: 'none',
    fontSize: fontSize.h2,
    lineHeight: 1,
    color: colors.textMuted,
    cursor: 'pointer',
    padding: '0.25rem 0.4rem',
  },
  body: {
    flex: 1,
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: space.xl,
    padding: `${space.xl} 0`,
  },
  footerRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.lg,
    paddingTop: space.lg,
    borderTop: `1px solid ${colors.divider}`,
    flexShrink: 0,
  },
  clearButton: {
    background: 'none',
    border: 'none',
    color: colors.danger,
    fontSize: fontSize.body,
    fontFamily,
    padding: '0.5rem 0.25rem',
  },
  doneButton: {
    backgroundColor: colors.primary,
    color: colors.onFill,
    border: 'none',
    borderRadius: radius.md,
    padding: '0.6rem 1.3rem',
    fontSize: fontSize.base,
    fontFamily,
    cursor: 'pointer',
  },
}
