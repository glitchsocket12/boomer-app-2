import { describe, expect, it } from 'vitest'
import { ATTENDEE_PLACEHOLDER, hasSomethingToSummarize } from './moments'

// The gate these cover decides whether a paid summarize-moment call fires. Getting it wrong in one
// direction leaves a manually-created event stuck on "Nothing written yet" forever; getting it
// wrong in the other burns an AI call on every page view of every empty event shell.
describe('hasSomethingToSummarize', () => {
  it('is false for a freshly-created shell holding only the auto self-attendee note', () => {
    expect(
      hasSomethingToSummarize({ raw_description: '', notes: [{ content: ATTENDEE_PLACEHOLDER }] })
    ).toBe(false)
  })

  it('is true once that shell has one real note', () => {
    expect(
      hasSomethingToSummarize({
        raw_description: '',
        notes: [{ content: ATTENDEE_PLACEHOLDER }, { content: 'Sarah brought her new puppy.' }],
      })
    ).toBe(true)
  })

  it('is false for an empty description and no notes at all', () => {
    expect(hasSomethingToSummarize({ raw_description: '', notes: [] })).toBe(false)
    expect(hasSomethingToSummarize({ raw_description: '   ', notes: null })).toBe(false)
    expect(hasSomethingToSummarize({ raw_description: '' })).toBe(false)
  })

  it('is true for a real description even with no notes', () => {
    expect(hasSomethingToSummarize({ raw_description: 'We went to the lake.', notes: [] })).toBe(true)
  })

  it('ignores whitespace-only notes', () => {
    expect(hasSomethingToSummarize({ raw_description: '', notes: [{ content: '   ' }] })).toBe(false)
  })

  // A parent event is usually a pure container — the real content lives on its sub-events, which
  // summarize-moment now reads. Without these, the "Defenders of Freedom Demo" event (empty
  // description, nothing but attendee placeholders, six full sub-events) stays on "Nothing written
  // yet" forever.
  it('is true for a placeholder-only parent whose sub-events have summaries', () => {
    expect(
      hasSomethingToSummarize({ raw_description: '', notes: [{ content: ATTENDEE_PLACEHOLDER }] }, [
        { summary: 'Day 1 of the demo — flew with Nick.', raw_description: '' },
      ])
    ).toBe(true)
  })

  it('is true when a sub-event has only a raw description, not a summary yet', () => {
    expect(
      hasSomethingToSummarize({ raw_description: '', notes: [] }, [
        { summary: null, raw_description: 'The day we drove up.' },
      ])
    ).toBe(true)
  })

  it('is false when every sub-event is itself an empty shell', () => {
    expect(
      hasSomethingToSummarize({ raw_description: '', notes: [{ content: ATTENDEE_PLACEHOLDER }] }, [
        { summary: null, raw_description: '' },
        { summary: '   ', raw_description: '  ' },
      ])
    ).toBe(false)
  })

  it('behaves exactly as before when no sub-events are passed', () => {
    expect(hasSomethingToSummarize({ raw_description: '', notes: [] }, [])).toBe(false)
    expect(hasSomethingToSummarize({ raw_description: '', notes: [] }, null)).toBe(false)
  })
})
