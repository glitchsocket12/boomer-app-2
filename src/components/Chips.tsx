// Small color/shape-coded "chips" used throughout the app so a person can tell at a
// glance what kind of thing they're about to jump to: a person (green pill), a group
// (gold badge), or an event (blue card). Every chip here is always clickable — it's a
// navigation affordance, not just a label.

import { border, colors, fontFamily, fontSize, radius } from '../lib/theme'

export function PersonChip({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} style={styles.person}>
      {label}
    </button>
  )
}

export function GroupChip({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} style={styles.group}>
      <span style={styles.groupDot} />
      {label}
    </button>
  )
}

export function EventChip({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} style={styles.event}>
      {label}
      <span style={styles.eventArrow}>›</span>
    </button>
  )
}

const styles: { [key: string]: React.CSSProperties } = {
  person: {
    fontSize: fontSize.body,
    padding: '0.35rem 0.8rem',
    borderRadius: radius.pill,
    border: border.primary,
    backgroundColor: 'transparent',
    color: colors.ink,
    cursor: 'pointer',
    fontFamily,
  },
  group: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.45rem',
    // Deliberately 0.88rem, a hair smaller than fontSize.body, because this chip is bold.
    fontSize: '0.88rem',
    fontWeight: 700,
    padding: '0.35rem 0.85rem 0.35rem 0.7rem',
    borderRadius: radius.md,
    border: border.suggestFill,
    backgroundColor: colors.suggestBg,
    color: colors.suggest,
    cursor: 'pointer',
    fontFamily,
    letterSpacing: '0.02em',
  },
  groupDot: {
    width: '7px',
    height: '7px',
    borderRadius: radius.circle,
    backgroundColor: colors.suggestFill,
    flexShrink: 0,
  },
  event: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.35rem',
    fontSize: fontSize.body,
    fontStyle: 'italic',
    padding: '0.4rem 0.8rem',
    borderRadius: radius.sm,
    border: border.event,
    backgroundColor: colors.eventBg,
    color: colors.event,
    cursor: 'pointer',
    fontFamily,
    textAlign: 'left',
  },
  eventArrow: { fontWeight: 'bold', fontSize: fontSize.base, fontStyle: 'normal' },
}
