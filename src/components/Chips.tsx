// Small color/shape-coded "chips" used throughout the app so a person can tell at a
// glance what kind of thing they're about to jump to: a person (green pill), a group
// (gold badge), or an event (blue card). Every chip here is always clickable — it's a
// navigation affordance, not just a label.

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
    fontSize: '0.9rem',
    padding: '0.35rem 0.8rem',
    borderRadius: '999px',
    border: '1px solid #2E4034',
    backgroundColor: 'transparent',
    color: '#2E4034',
    cursor: 'pointer',
    fontFamily: 'Georgia, serif',
  },
  group: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.45rem',
    fontSize: '0.88rem',
    fontWeight: 700,
    padding: '0.35rem 0.85rem 0.35rem 0.7rem',
    borderRadius: '8px',
    border: '1px solid #B08B2E',
    backgroundColor: '#FBF3E0',
    color: '#8A6A1F',
    cursor: 'pointer',
    fontFamily: 'Georgia, serif',
    letterSpacing: '0.02em',
  },
  groupDot: {
    width: '7px',
    height: '7px',
    borderRadius: '50%',
    backgroundColor: '#B08B2E',
    flexShrink: 0,
  },
  event: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.35rem',
    fontSize: '0.9rem',
    fontStyle: 'italic',
    padding: '0.4rem 0.8rem',
    borderRadius: '6px',
    border: '1px solid #3B6EA5',
    backgroundColor: '#EAF1FA',
    color: '#2C5079',
    cursor: 'pointer',
    fontFamily: 'Georgia, serif',
    textAlign: 'left',
  },
  eventArrow: { fontWeight: 'bold', fontSize: '1rem', fontStyle: 'normal' },
}
