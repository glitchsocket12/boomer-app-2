import { describe, expect, it } from 'vitest'
import { findLikelyMatch, titleOverlapRatio } from './likelyDuplicate'

const target = (occasion: string | null, event_date: string | null, event_end_date: string | null = null) => ({
  id: occasion ?? 'x',
  occasion,
  event_date,
  event_end_date,
  raw_description: '',
})

describe('titleOverlapRatio', () => {
  it('ignores stopwords, case and punctuation', () => {
    expect(titleOverlapRatio('Dinner with the Harrises', 'dinner, Harrises')).toBe(1)
  })

  it('is 0 when nothing meaningful is shared', () => {
    expect(titleOverlapRatio('Dentist', 'Wedding')).toBe(0)
  })

  it('divides by the shorter title, so a short exact name still scores full', () => {
    expect(titleOverlapRatio('Camping', 'Camping Trip With Ben')).toBe(1)
  })
})

describe('findLikelyMatch', () => {
  it('matches a near-identical title on a nearby date', () => {
    const candidate = { occasion: "Harris' Friendsgiving", event_date: '2026-11-21', event_end_date: null }
    const found = findLikelyMatch(candidate, [target('Harris Friendsgiving', '2026-11-22')])
    expect(found?.occasion).toBe('Harris Friendsgiving')
  })

  it('matches on title alone when it is essentially the same words', () => {
    // No date corroboration at all — a high enough overlap stands on its own.
    const candidate = { occasion: 'Wesley Baptism', event_date: null, event_end_date: null }
    expect(findLikelyMatch(candidate, [target('Wesley Baptism', '2020-01-01')])).not.toBeNull()
  })

  it('does NOT match a half-shared title on a far-away date', () => {
    // This is the case that matters for Quick Add: two different dinners a year apart must not
    // collapse into one, or the fast pass becomes the fastest way to lose an event.
    const candidate = { occasion: 'Dinner with Ben', event_date: '2026-01-10', event_end_date: null }
    expect(findLikelyMatch(candidate, [target('Dinner with Clare', '2025-01-10')])).toBeNull()
  })

  it('returns null for an untitled candidate rather than guessing from dates', () => {
    const candidate = { occasion: null, event_date: '2026-05-05', event_end_date: null }
    expect(findLikelyMatch(candidate, [target('Something', '2026-05-05')])).toBeNull()
  })

  it('picks the strongest match when several are on file', () => {
    const candidate = { occasion: 'Camping Trip Yosemite', event_date: '2026-07-04', event_end_date: null }
    const found = findLikelyMatch(candidate, [
      target('Beach Day', '2026-07-04'),
      target('Camping Trip Yosemite', '2026-07-04'),
    ])
    expect(found?.occasion).toBe('Camping Trip Yosemite')
  })

  it('scores a fully-contained shorter title as high as an exact one, and keeps the first', () => {
    // Pinning real behaviour, not endorsing it: the ratio divides by the SHORTER title, so
    // "Camping Trip" inside "Camping Trip Yosemite" is 1.0 — same as the exact match — and the
    // strictly-greater comparison keeps whichever came first. Fine for what this drives: both are
    // plausible duplicates, and all the caller needs is that SOMETHING got flagged so Quick Add
    // steps aside and the founder chooses.
    const candidate = { occasion: 'Camping Trip Yosemite', event_date: '2026-07-04', event_end_date: null }
    const found = findLikelyMatch(candidate, [
      target('Camping Trip', '2026-07-04'),
      target('Camping Trip Yosemite', '2026-07-04'),
    ])
    expect(found?.occasion).toBe('Camping Trip')
  })

  it('treats overlapping date ranges as close', () => {
    const candidate = { occasion: 'Defenders of Freedom', event_date: '2026-09-01', event_end_date: '2026-09-05' }
    expect(findLikelyMatch(candidate, [target('Defenders Freedom Show', '2026-09-03', '2026-09-04')])).not.toBeNull()
  })
})
