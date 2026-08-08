// Generic "what do you want to do with this?" popup — a title, an optional subtitle, and a stack
// of full-width choice buttons. Second instance of the pattern FilterPanel.tsx describes (a
// focused popup of options instead of controls embedded inline on the page); FilterPanel itself
// isn't reusable here because its "Clear all / Done" footer is baked in and required.
//
// Unlike FilterPanel this carries role="dialog" and moves focus into the sheet on open — a
// chooser is a decision point, so landing outside it strands keyboard and VoiceOver users.

import { useEffect, useRef } from 'react'
import { border, colors, fontFamily, fontSize, maxWidth, radius, shadow, space } from '../lib/theme'

export type Choice = {
  label: string
  onClick: () => void
  /** Exactly one choice should be primary — it gets the filled treatment. */
  primary?: boolean
}

export default function ChoiceSheet({
  open,
  onClose,
  title,
  subtitle,
  actions,
}: {
  open: boolean
  onClose: () => void
  title: string
  subtitle?: string
  actions: Choice[]
}) {
  const firstActionRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    if (!open) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  useEffect(() => {
    if (open) firstActionRef.current?.focus()
  }, [open])

  if (!open) return null

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div
        style={styles.sheet}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div style={styles.headerRow}>
          <div>
            <h2 style={styles.title}>{title}</h2>
            {subtitle && <p style={styles.subtitle}>{subtitle}</p>}
          </div>
          <button type="button" onClick={onClose} style={styles.closeButton} aria-label="Close">
            ×
          </button>
        </div>
        <div style={styles.actions}>
          {actions.map((a, i) => (
            <button
              key={a.label}
              type="button"
              ref={i === 0 ? firstActionRef : undefined}
              onClick={a.onClick}
              style={a.primary ? { ...styles.action, ...styles.actionPrimary } : styles.action}
            >
              {a.label}
            </button>
          ))}
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
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    boxShadow: shadow.modal,
    padding: space.xl,
    boxSizing: 'border-box',
    fontFamily,
  },
  headerRow: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: space.lg },
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
  actions: { display: 'flex', flexDirection: 'column', gap: space.md, paddingTop: space.xl },
  action: {
    width: '100%',
    minHeight: '44px',
    padding: '0.7rem 1rem',
    backgroundColor: 'transparent',
    color: colors.ink,
    border: border.default,
    borderRadius: radius.md,
    fontSize: fontSize.base,
    fontFamily,
    textAlign: 'center',
    cursor: 'pointer',
  },
  actionPrimary: {
    backgroundColor: colors.primary,
    color: colors.onFill,
    border: 'none',
  },
}
