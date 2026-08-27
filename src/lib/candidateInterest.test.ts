import { describe, expect, it } from 'vitest'
import {
  KIND_LABEL,
  RECOMMENDED_KINDS,
  SIGNIFICANCE_KINDS,
  compareCandidates,
  interestScore,
} from './candidateInterest'

describe('RECOMMENDED_KINDS', () => {
  it('is everything except routine', () => {
    expect(RECOMMENDED_KINDS).toEqual(['trip', 'celebration', 'milestone', 'holiday', 'gathering'])
    expect(RECOMMENDED_KINDS).not.toContain('routine')
  })

  it('has a label for every kind, so no row can render a bare enum value', () => {
    for (const kind of SIGNIFICANCE_KINDS) expect(KIND_LABEL[kind]).toBeTruthy()
  })
})

describe('interestScore', () => {
  it('is 0 for a candidate with nothing attached', () => {
    expect(interestScore({})).toBe(0)
    expect(interestScore({ suggested_people: [], suggested_group_ids: [], event_date: '2026-03-04' })).toBe(0)
  })

  it('counts only people who actually matched someone on file', () => {
    // An unmatched attendee is a name off a calendar invite, not evidence this mattered.
    expect(interestScore({ suggested_people: [{ matched_person_id: null }, { matched_person_id: null }] })).toBe(0)
    expect(interestScore({ suggested_people: [{ matched_person_id: 'p1' }] })).toBe(3)
  })

  it('stops counting extra known people after the first one', () => {
    const two = interestScore({ suggested_people: [{ matched_person_id: 'p1' }, { matched_person_id: 'p2' }] })
    const five = interestScore({
      suggested_people: [1, 2, 3, 4, 5].map((n) => ({ matched_person_id: `p${n}` })),
    })
    // A fifteenth attendee isn't fifteen times a first — a big invite list would otherwise
    // outrank every quiet evening that actually meant something.
    expect(two).toBe(4)
    expect(five).toBe(4)
  })

  it('credits a real group and a multi-day span', () => {
    expect(interestScore({ suggested_group_ids: ['g1'] })).toBe(2)
    expect(interestScore({ event_date: '2026-03-04', event_end_date: '2026-03-09' })).toBe(2)
  })

  it("doesn't credit a same-day 'span'", () => {
    expect(interestScore({ event_date: '2026-03-04', event_end_date: '2026-03-04' })).toBe(0)
    expect(interestScore({ event_date: '2026-03-04', event_end_date: null })).toBe(0)
  })

  it('makes a known person the strongest SINGLE signal', () => {
    // The case this ordering exists for: "Dinner" means nothing until you see it was dinner with
    // someone already in their life.
    const person = interestScore({ suggested_people: [{ matched_person_id: 'p1' }] })
    expect(person).toBeGreaterThan(interestScore({ suggested_group_ids: ['g1'] }))
    expect(person).toBeGreaterThan(interestScore({ event_date: '2026-03-04', event_end_date: '2026-03-09' }))
  })

  it('lets two other signals together outweigh one known person', () => {
    // Deliberate, not an accident of the weights: a group-tagged event spanning several days is a
    // trip with people, and pretending one named attendee always beats that would be inventing a
    // hierarchy of what matters in someone else's life.
    const person = interestScore({ suggested_people: [{ matched_person_id: 'p1' }] })
    const groupAndSpan = interestScore({
      suggested_group_ids: ['g1'],
      event_date: '2026-03-04',
      event_end_date: '2026-03-09',
    })
    expect(groupAndSpan).toBeGreaterThan(person)
  })
})

describe('compareCandidates', () => {
  it('sorts higher interest first', () => {
    const plain = { event_date: '2026-05-01' }
    const withPerson = { event_date: '2026-01-01', suggested_people: [{ matched_person_id: 'p1' }] }
    expect([plain, withPerson].sort(compareCandidates)[0]).toBe(withPerson)
  })

  it('falls back to newest-first when interest is equal', () => {
    const older = { event_date: '2026-01-01' }
    const newer = { event_date: '2026-05-01' }
    expect([older, newer].sort(compareCandidates)[0]).toBe(newer)
  })

  it('puts a dateless candidate last among equals rather than first', () => {
    const dated = { event_date: '2026-01-01' }
    const undated = { event_date: null }
    expect([undated, dated].sort(compareCandidates)[0]).toBe(dated)
  })
})
