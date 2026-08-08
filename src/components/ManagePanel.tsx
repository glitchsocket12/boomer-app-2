// Generic centered popup for a "⋯ Manage" button to open — consolidates a record's rename/type/
// merge/delete controls into one place instead of a pencil icon up top and a separate always-
// visible "danger zone" at the bottom (2026-08-07 redesign, founder-approved). Modeled on
// FilterPanel.tsx's overlay (scrim, click-outside-to-close, Escape-key handling); unlike
// FilterPanel there's no baked-in footer, since Manage's content — merge search, delete confirm —
// already carries its own buttons and doesn't fit a fixed "Clear all / Done" shape.

import { useEffect } from 'react'
import { colors, fontFamily, fontSize, maxWidth, radius, shadow, space } from '../lib/theme'

export default function ManagePanel({
  open,
  onClose,
  title,
  subtitle,
  children,
}: {
  open: boolean
  onClose: () => void
  title: string
  subtitle?: string
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
      <div style={styles.sheet} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={title}>
        <div style={styles.headerRow}>
          <div>
            <h2 style={styles.title}>{title}</h2>
            {subtitle && <p style={styles.subtitle}>{subtitle}</p>}
          </div>
          <button type="button" onClick={onClose} style={styles.closeButton} aria-label="Close">
            ×
          </button>
        </div>
        <div style={styles.body}>{children}</div>
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
  headerRow: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: space.lg, flexShrink: 0 },
  title: { fontSize: fontSize.h3, color: colors.ink, margin: 0 },
  subtitle: { fontSize: fontSize.body, color: colors.textMuted, margin: `${space.xxs} 0 0` },
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
    gap: space.lg,
    paddingTop: space.xl,
  },
}
