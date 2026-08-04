import { colors, fontFamily, fontSize, radius, space } from '../lib/theme'

// The "that wasn't what I meant" escape hatch for actions that commit instantly with no confirm
// step — currently adding someone to a group, where a mistyped name can either tag the wrong
// existing person or create a brand-new duplicate profile. Same shape as the inline confirm +
// "Undo" link ContactImportReview and PersonDetail already use; pulled into its own component so
// the pages sharing that pattern don't each restyle it.
//
// Deliberately sticks around until it's replaced or dismissed rather than fading on a timer:
// the founder's read speed shouldn't decide whether a mistake stays fixable.
export default function UndoBanner({
  message,
  onUndo,
  busy = false,
}: {
  message: string
  onUndo: () => void
  busy?: boolean
}) {
  return (
    <p style={styles.banner} role="status">
      {message}{' '}
      <button type="button" onClick={onUndo} disabled={busy} style={styles.link}>
        {busy ? '…' : 'Undo'}
      </button>
    </p>
  )
}

const styles: { [key: string]: React.CSSProperties } = {
  banner: {
    display: 'flex',
    alignItems: 'center',
    gap: space.sm,
    margin: `-${space.md} 0 ${space.xl}`,
    padding: `${space.sm} ${space.md}`,
    borderRadius: radius.sm,
    backgroundColor: colors.inkWash,
    color: colors.ink,
    fontSize: fontSize.label,
    fontFamily,
  },
  link: {
    background: 'none',
    border: 'none',
    padding: 0,
    color: colors.ink,
    fontSize: fontSize.label,
    fontWeight: 600,
    textDecoration: 'underline',
    cursor: 'pointer',
    fontFamily,
  },
}
