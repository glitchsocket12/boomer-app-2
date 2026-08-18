import { colors, fontSize, space } from '../lib/theme'
import { parseSummaryBlocks, hasSubEventBlocks, hasBulletBlocks } from '../lib/summaryFormat'

/**
 * Renders an event summary with light formatting instead of one flat block of text.
 *
 * Founder ask 2026-08-10: on a multi-day event (the Defenders of Freedom demo) the per-sub-event
 * lines "don't read well" — every line looked the same, so the dates and titles disappeared into
 * the prose. `summaryFormat.ts` recognises the `<date> · <title> — <sentence>` shape the
 * summarize-moment prompt already emits, and this component gives each part its own weight: the
 * date set apart in muted italic, the title bold, the sentence in ordinary body text.
 *
 * Founder ask 2026-08-17: ordinary events are now summarized as bullets rather than prose, so a
 * `- ` line renders as a real list item with a hanging indent instead of showing the raw marker.
 * A trailing non-bullet line is kept as a paragraph — that's the "nothing else was recorded" note
 * the prompt adds when an event has almost nothing on it.
 *
 * A summary with neither shape (every event summarized before 2026-08-17, until it's regenerated)
 * renders exactly as it always did — one pre-wrap paragraph.
 */
export default function SummaryText({ text, style }: { text: string; style?: React.CSSProperties }) {
  const blocks = parseSummaryBlocks(text)

  if (hasBulletBlocks(blocks)) {
    return (
      <div style={{ ...styles.container, ...style }}>
        <ul style={styles.bulletList}>
          {blocks.map((block, i) =>
            block.kind === 'bullet' ? (
              <li key={i} style={styles.bullet}>
                {block.text}
              </li>
            ) : null
          )}
        </ul>
        {blocks.map((block, i) =>
          block.kind === 'paragraph' ? (
            <p key={i} style={styles.thinNote}>
              {block.text}
            </p>
          ) : null
        )}
      </div>
    )
  }

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
        ) : block.kind === 'subEvent' ? (
          <div key={i} style={styles.subEvent}>
            <p style={styles.subEventHead}>
              <span style={styles.subEventDate}>{block.date}</span>
              <strong style={styles.subEventTitle}>{block.title}</strong>
            </p>
            <p style={styles.subEventBody}>{block.body}</p>
          </div>
        ) : null
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
  // A real list rather than text starting with "- ": the marker is drawn by the browser, and a long
  // fact wraps under itself instead of back under the bullet.
  bulletList: { margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: space.md },
  bullet: {
    position: 'relative',
    paddingLeft: space.xl,
    fontSize: fontSize.bodyLg,
    // The dot, drawn with the same pale-blue accent the rest of the resting-card family uses.
    backgroundImage: `radial-gradient(circle, ${colors.primary} 2.5px, transparent 2.5px)`,
    backgroundPosition: `0 0.55em`,
    backgroundSize: '10px 10px',
    backgroundRepeat: 'no-repeat',
  },
  // The "nothing else was recorded" line the prompt adds to a thin event — set apart from the facts
  // above it, since it's a note about the record rather than part of the memory.
  thinNote: {
    margin: `${space.lg} 0 0 0`,
    fontSize: fontSize.label,
    fontStyle: 'italic',
    color: colors.textMuted,
  },
}
