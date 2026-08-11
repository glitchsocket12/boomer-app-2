import { colors, fontSize, space } from '../lib/theme'
import { parseSummaryBlocks, hasSubEventBlocks } from '../lib/summaryFormat'

/**
 * Renders an event summary with light formatting instead of one flat block of text.
 *
 * Founder ask 2026-08-10: on a multi-day event (the Defenders of Freedom demo) the per-sub-event
 * lines "don't read well" — every line looked the same, so the dates and titles disappeared into
 * the prose. `summaryFormat.ts` recognises the `<date> · <title> — <sentence>` shape the
 * summarize-moment prompt already emits, and this component gives each part its own weight: the
 * date set apart in muted italic, the title bold, the sentence in ordinary body text.
 *
 * An ordinary summary (no sub-events) renders exactly as it did before — one pre-wrap paragraph —
 * so this only changes the pages that actually have the structure.
 */
export default function SummaryText({ text, style }: { text: string; style?: React.CSSProperties }) {
  const blocks = parseSummaryBlocks(text)

  if (!hasSubEventBlocks(blocks)) {
    return <p style={{ ...styles.paragraph, ...style }}>{text}</p>
  }

  return (
    <div style={{ ...styles.container, ...style }}>
      {blocks.map((block, i) =>
        block.kind === 'paragraph' ? (
          <p key={i} style={styles.overview}>
            {block.text}
          </p>
        ) : (
          <div key={i} style={styles.subEvent}>
            <p style={styles.subEventHead}>
              <span style={styles.subEventDate}>{block.date}</span>
              <strong style={styles.subEventTitle}>{block.title}</strong>
            </p>
            <p style={styles.subEventBody}>{block.body}</p>
          </div>
        )
      )}
    </div>
  )
}

const styles: { [key: string]: React.CSSProperties } = {
  // Matches the old inline `description` style exactly, so a summary with no sub-events is
  // pixel-identical to what shipped before.
  paragraph: { fontSize: '1.05rem', color: colors.inkPlain, lineHeight: 1.6, margin: 0, whiteSpace: 'pre-wrap' },
  container: { fontSize: '1.05rem', color: colors.inkPlain, lineHeight: 1.6 },
  overview: { margin: `0 0 ${space.lg} 0`, whiteSpace: 'pre-wrap' },
  // The rows read as a list without bullet characters: a hairline rail down the left groups them
  // and separates them from the overview above.
  subEvent: {
    borderLeft: `2px solid ${colors.inkPale}`,
    paddingLeft: space.lg,
    margin: `0 0 ${space.lg} 0`,
  },
  subEventHead: { margin: 0, display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '0.5rem' },
  subEventDate: { fontSize: fontSize.label, fontStyle: 'italic', color: colors.textMuted, whiteSpace: 'nowrap' },
  subEventTitle: { fontSize: fontSize.base, fontWeight: 700, color: colors.ink },
  subEventBody: { margin: '0.15rem 0 0 0', fontSize: fontSize.bodyLg },
}
