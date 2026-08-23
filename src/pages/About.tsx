// Placeholder page (backlog item 23) — real copy gets drafted together with the founder
// separately ("I don't want it to be bullshit"); this exists only so the Settings link has
// somewhere real to land, not as invented final content.
import { colors, fontFamily, fontSize, maxWidth } from '../lib/theme'

export default function About({ onBack, backLabel }: { onBack: () => void; backLabel: string }) {
  return (
    <div style={styles.page}>
      <button onClick={onBack} style={styles.backButton}>← Back to {backLabel}</button>

      <h1 style={styles.heading}>About Porch</h1>
      <p style={styles.body}>
        {/* TODO(founder): replace with real About copy — an honest description of what Porch is
            and isn't, drafted together in a follow-up conversation. */}
        Placeholder — About copy goes here once we've written it together.
      </p>
    </div>
  )
}

const styles: { [key: string]: React.CSSProperties } = {
  page: { maxWidth: maxWidth.page, margin: '0 auto', padding: '1rem 1.5rem 2rem', fontFamily },
  backButton: {
    background: 'none',
    border: 'none',
    color: colors.ink,
    fontSize: fontSize.base,
    cursor: 'pointer',
    marginBottom: '1rem',
    padding: 0,
  },
  heading: { fontSize: fontSize.h1, color: colors.ink, margin: '0 0 0.5rem' },
  body: { fontSize: fontSize.bodyLg, color: colors.textMuted, lineHeight: 1.5, margin: '0 0 1.25rem' },
}
