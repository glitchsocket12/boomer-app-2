import { useEffect, useState, type ReactNode } from 'react'
import { border, colors, fontFamily, fontSize, radius, space } from '../lib/theme'

// A finish line for an import queue.
//
// The problem this exists for: a real calendar import is ~230 candidates, and the review page's
// answer to that was 20 cards and a button reading "Show 20 more (210 still to review)". There was
// no session, no progress, and no moment where stopping felt like finishing something — just a
// number that went down slower than the scrolling went on.
//
// So the queue is served in decks of DECK_SIZE. You see how far through THIS deck you are, and
// when it's done you get an explicit choice: another one, or stop. Stopping is a real answer here,
// not an abandonment — which is the whole point for someone who will be doing this for years.
//
// Deliberately generic (renderItem, itemKey, nouns) even though only ImportReview.tsx uses it
// today: birthdays, contacts and photos have the same shape of queue and are meant to get this
// same treatment next, and a component that already has no idea what a candidate is will drop
// into them without a rewrite.
export const DECK_SIZE = 10

export type ReviewDeckItemApi = {
  /**
   * Called by a card when it writes (or un-writes) a decision — accept, reject, "not now", undo.
   * Distinct from the card leaving the list: cards here collapse into a confirmation and stay put
   * until "Done" is pressed, so "decided" and "gone" are two different moments and the progress
   * count has to track the first one.
   */
  setDecided: (decided: boolean) => void
}

export default function ReviewDeck<T>({
  items,
  itemKey,
  renderItem,
  remaining,
  deckSize = DECK_SIZE,
  nounSingular,
  nounPlural,
  onAdvance,
  onDone,
}: {
  /** Everything still on screen — the parent drops an item when its card is dismissed. */
  items: T[]
  itemKey: (item: T) => string
  renderItem: (item: T, api: ReviewDeckItemApi) => ReactNode
  /** How many rows across the WHOLE queue still await a decision, this deck included. */
  remaining: number
  deckSize?: number
  nounSingular: string
  nounPlural: string
  /** Moving on clears the finished deck's leftover confirmations — the parent drops these ids. */
  onAdvance: (finishedIds: string[]) => void
  onDone: () => void
}) {
  // Membership is captured once and then held, rather than recomputed as `items.slice(0, deckSize)`
  // — otherwise dismissing a card would pull the next one up into the deck and the batch of ten
  // would never end.
  const [deckIds, setDeckIds] = useState<string[] | null>(null)
  const [decided, setDecided] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (deckIds === null && items.length > 0) {
      setDeckIds(items.slice(0, deckSize).map(itemKey))
      setDecided(new Set())
    }
  }, [deckIds, items, deckSize, itemKey])

  function markDecided(id: string, isDecided: boolean) {
    setDecided((prev) => {
      if (prev.has(id) === isDecided) return prev
      const next = new Set(prev)
      if (isDecided) next.add(id)
      else next.delete(id)
      return next
    })
  }

  const ids = deckIds ?? []
  // Looked up rather than sliced, so a dismissed card leaves the screen while still counting
  // toward the deck it belonged to.
  const byKey = new Map(items.map((item) => [itemKey(item), item]))
  const visible = ids.map((id) => byKey.get(id)).filter((item): item is T => item !== undefined)
  const doneInDeck = ids.filter((id) => decided.has(id)).length
  const deckComplete = ids.length > 0 && doneInDeck === ids.length
  // Everything still undecided that ISN'T in this batch. Computed rather than `remaining - deck
  // size` so it holds still while you work through the batch — `remaining` counts the deck's own
  // undecided cards too, so subtracting a fixed ten would make this tick down twice per decision.
  const afterThisBatch = remaining - (ids.length - doneInDeck)

  function advance() {
    onAdvance(ids)
    setDeckIds(null)
    setDecided(new Set())
    // The finished batch's cards are about to be removed from above this panel, so staying put
    // would leave the reviewer looking at whitespace where the next batch isn't.
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  if (items.length === 0 && !deckComplete) return null

  return (
    <>
      {ids.length > 1 && !deckComplete && (
        <p style={styles.progress}>
          <strong>
            {doneInDeck} of {ids.length}
          </strong>{' '}
          done in this batch
          {afterThisBatch > 0 && <> · {afterThisBatch.toLocaleString()} more after it</>}
        </p>
      )}

      {visible.map((item) => (
        <div key={itemKey(item)}>{renderItem(item, { setDecided: (d) => markDecided(itemKey(item), d) })}</div>
      ))}

      {deckComplete && (
        <div style={styles.finishPanel}>
          {remaining === 0 ? (
            <>
              <p style={styles.finishHeading}>That's all of them.</p>
              <p style={styles.finishBody}>
                Nothing left to review — new {nounPlural} will show up here whenever they turn up.
              </p>
              <div style={styles.finishButtons}>
                <button type="button" onClick={onDone} style={styles.primaryButton}>
                  Done
                </button>
              </div>
            </>
          ) : (
            <>
              <p style={styles.finishHeading}>
                Nice — {ids.length} {ids.length === 1 ? nounSingular : nounPlural} reviewed.
              </p>
              <p style={styles.finishBody}>
                {remaining.toLocaleString()} {remaining === 1 ? nounSingular : nounPlural} to go. No rush — they'll wait
                for you.
              </p>
              <div style={styles.finishButtons}>
                <button type="button" onClick={advance} style={styles.primaryButton}>
                  Review {Math.min(deckSize, remaining)} more
                </button>
                <button type="button" onClick={onDone} style={styles.secondaryButton}>
                  I'm done for now
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </>
  )
}

const styles: { [key: string]: React.CSSProperties } = {
  progress: {
    fontSize: fontSize.label,
    color: colors.textMuted,
    margin: '0 0 0.75rem',
  },
  finishPanel: {
    backgroundColor: colors.surface,
    border: border.primary,
    borderRadius: radius.lg,
    padding: '1.1rem 1.25rem',
    margin: '1rem 0 0',
    textAlign: 'center',
  },
  finishHeading: { fontSize: fontSize.lead, color: colors.ink, margin: '0 0 0.35rem' },
  finishBody: { fontSize: fontSize.body, color: colors.textMuted, lineHeight: 1.5, margin: '0 0 1rem' },
  finishButtons: { display: 'flex', flexWrap: 'wrap', gap: space.md, justifyContent: 'center' },
  primaryButton: {
    fontSize: fontSize.body,
    padding: '0.55rem 1.1rem',
    borderRadius: radius.md,
    border: 'none',
    backgroundColor: colors.primary,
    color: colors.onFill,
    cursor: 'pointer',
    fontFamily,
  },
  secondaryButton: {
    fontSize: fontSize.body,
    padding: '0.55rem 1.1rem',
    borderRadius: radius.md,
    border: border.default,
    backgroundColor: colors.surface,
    color: colors.textBody,
    cursor: 'pointer',
    fontFamily,
  },
}
