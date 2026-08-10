// The "we think this imported contact is someone you already have" box, shared by the
// contact and birthday review queues.
//
// It exists because the old version buried the whole claim in one line of small grey text
// ("Adam Brown is already in:") under a generic "Confirm who this belongs to:" heading —
// you couldn't tell at a glance that the app was proposing a specific person, or which of
// the two names on screen was the incoming one. So the claim is now stated as a plain
// question with both names at heading size, and the two answers are real buttons instead
// of an underlined "cancel" link.

import type { ReactNode } from 'react'
import { border, colors, fontFamily, fontSize, radius, space } from '../lib/theme'

export default function MatchCallout({
  candidateName,
  matchName,
  onConfirm,
  onNotSame,
  evidence,
  children,
}: {
  /** The name as it came in from the import (the card's own title). */
  candidateName: string
  /** The existing person the app thinks it matches. */
  matchName: string
  /** "Yes, that's them" — collapses the picker down to the confirmed state. */
  onConfirm: () => void
  /** "No, different person" — clears the match so accepting adds a new person. */
  onNotSame: () => void
  /** Supporting detail for the match, e.g. the groups the existing person is already in. */
  evidence?: ReactNode
  /** The "or link to someone else" search area. */
  children?: ReactNode
}) {
  return (
    <div style={styles.callout}>
      <p style={styles.label}>Possible match</p>
      <p style={styles.question}>
        Is <span style={styles.name}>{candidateName}</span> the same person as{' '}
        <span style={styles.name}>{matchName}</span>?
      </p>
      {evidence}
      <div style={styles.actions}>
        <button type="button" onClick={onConfirm} style={styles.yesButton}>
          Yes — same person
        </button>
        <button type="button" onClick={onNotSame} style={styles.noButton}>
          No — add as new person
        </button>
      </div>
      {children && (
        <div style={styles.otherBlock}>
          <p style={styles.otherLabel}>Or link it to someone else:</p>
          {children}
        </div>
      )}
    </div>
  )
}

const styles: { [key: string]: React.CSSProperties } = {
  callout: {
    backgroundColor: colors.inkWash,
    border: border.primary,
    borderRadius: radius.md,
    padding: '0.85rem 0.9rem',
    marginBottom: '0.5rem',
  },
  label: {
    fontSize: fontSize.small,
    fontWeight: 700,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    color: colors.primary,
    margin: '0 0 0.3rem',
  },
  question: {
    fontSize: fontSize.bodyLg,
    color: colors.ink,
    lineHeight: 1.45,
    margin: '0 0 0.6rem',
  },
  name: { fontWeight: 700 },
  actions: { display: 'flex', flexWrap: 'wrap', gap: space.sm, marginTop: '0.5rem' },
  yesButton: {
    fontSize: fontSize.body,
    padding: '0.45rem 0.95rem',
    borderRadius: radius.md,
    border: 'none',
    backgroundColor: colors.primary,
    color: colors.onFill,
    cursor: 'pointer',
    fontFamily,
  },
  noButton: {
    fontSize: fontSize.body,
    padding: '0.45rem 0.95rem',
    borderRadius: radius.md,
    border: border.default,
    backgroundColor: colors.surface,
    color: colors.textBody,
    cursor: 'pointer',
    fontFamily,
  },
  otherBlock: { marginTop: '0.75rem' },
  otherLabel: { fontSize: fontSize.label, color: colors.textMuted, margin: '0 0 0.35rem' },
}
