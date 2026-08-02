import { describe, expect, it } from 'vitest'
import { formatPetDates, formatPetLine, isMemorial, petEmoji, PET_FALLBACK_EMOJI } from './pets'

describe('petEmoji', () => {
  it('matches the obvious species', () => {
    expect(petEmoji({ species: 'dog', breed: null })).toBe('🐕')
    expect(petEmoji({ species: 'cat', breed: null })).toBe('🐈')
    expect(petEmoji({ species: 'fish', breed: null })).toBe('🐟')
    expect(petEmoji({ species: 'horse', breed: null })).toBe('🐴')
  })

  it('matches informal words the founder is likely to actually type', () => {
    expect(petEmoji({ species: 'pup', breed: null })).toBe('🐕')
    expect(petEmoji({ species: 'kitty', breed: null })).toBe('🐈')
  })

  it('falls back to the breed when no species was filled in', () => {
    expect(petEmoji({ species: null, breed: 'goldendoodle' })).toBe('🐕')
    expect(petEmoji({ species: null, breed: 'black lab' })).toBe('🐕')
  })

  // Ordering regressions: each of these contains an EARLIER-looking entry's keyword as a substring.
  it('does not let a substring of another species win', () => {
    expect(petEmoji({ species: 'catfish', breed: null })).toBe('🐟') // not cat
    expect(petEmoji({ species: 'dog', breed: 'bulldog' })).toBe('🐕') // not cow ("bull")
    expect(petEmoji({ species: 'rattlesnake', breed: null })).toBe('🐍') // not rat
    expect(petEmoji({ species: 'guinea pig', breed: null })).toBe('🐹') // not pig
    expect(petEmoji({ species: 'bearded dragon', breed: null })).toBe('🦎')
  })

  // "wallaby" contains "lab" and read as a dog under plain substring matching.
  it('does not match a keyword buried mid-word', () => {
    expect(petEmoji({ species: 'wallaby', breed: null })).toBe(PET_FALLBACK_EMOJI)
    expect(petEmoji({ species: 'boar', breed: null })).not.toBe('🐍')
    expect(petEmoji({ species: 'fox', breed: null })).not.toBe('🐄')
  })

  it('still matches a keyword that ends a compound word', () => {
    expect(petEmoji({ species: 'dog', breed: 'bulldog' })).toBe('🐕')
    expect(petEmoji({ species: null, breed: 'black lab' })).toBe('🐕')
  })

  it('falls back to a paw for anything unrecognized or blank', () => {
    expect(petEmoji({ species: 'wallaby', breed: null })).toBe(PET_FALLBACK_EMOJI)
    expect(petEmoji({ species: null, breed: null })).toBe(PET_FALLBACK_EMOJI)
    expect(petEmoji({ species: '   ', breed: '' })).toBe(PET_FALLBACK_EMOJI)
  })
})

describe('formatPetLine', () => {
  it('shows breed and species together', () => {
    expect(formatPetLine({ name: 'Biscuit', species: 'dog', breed: 'golden retriever' })).toBe(
      'Biscuit — golden retriever (dog)'
    )
  })

  it('falls back to species alone when there is no breed (a fish has none)', () => {
    expect(formatPetLine({ name: 'Mochi', species: 'cat', breed: null })).toBe('Mochi — cat')
  })

  it('falls back to breed alone when species was never filled in', () => {
    expect(formatPetLine({ name: 'Rex', species: null, breed: 'lab mix' })).toBe('Rex — lab mix')
  })

  it('degrades to just the name when nothing else is known', () => {
    expect(formatPetLine({ name: 'Nemo', species: null, breed: null })).toBe('Nemo')
  })

  it('ignores whitespace-only species/breed rather than rendering a stray dash', () => {
    expect(formatPetLine({ name: 'Nemo', species: '  ', breed: '' })).toBe('Nemo')
  })
})

describe('formatPetDates', () => {
  it('reads as a lifespan once the pet has passed away', () => {
    expect(formatPetDates({ birth_date: '2019-06-03', adopted_date: '2019-08-12', deceased_date: '2024-03-02' })).toBe(
      '2019–2024'
    )
  })

  it('says so plainly when a pet passed away but no birth date is on file', () => {
    expect(formatPetDates({ birth_date: null, adopted_date: null, deceased_date: '2024-03-02' })).toBe(
      'Passed away March 2, 2024'
    )
  })

  it('joins born and adopted for a living pet', () => {
    expect(formatPetDates({ birth_date: '2019-06-03', adopted_date: '2019-08-12', deceased_date: null })).toBe(
      'Born June 3, 2019 · Adopted August 12, 2019'
    )
  })

  it('handles a rescue with only a gotcha day', () => {
    expect(formatPetDates({ birth_date: null, adopted_date: '2019-08-12', deceased_date: null })).toBe(
      'Adopted August 12, 2019'
    )
  })

  it('returns null when no dates are known, so the caller renders no line at all', () => {
    expect(formatPetDates({ birth_date: null, adopted_date: null, deceased_date: null })).toBeNull()
  })

  // Regression guard: a bare "YYYY-MM-DD" through new Date() is UTC midnight, which renders as the
  // previous day anywhere west of Greenwich. formatPetDates must append T00:00:00.
  it('does not shift the day backwards in a negative-offset time zone', () => {
    expect(formatPetDates({ birth_date: '2019-01-01', adopted_date: null, deceased_date: null })).toBe(
      'Born January 1, 2019'
    )
  })
})

describe('isMemorial', () => {
  it('is true only once a deceased date is recorded', () => {
    expect(isMemorial({ deceased_date: '2024-03-02' })).toBe(true)
    expect(isMemorial({ deceased_date: null })).toBe(false)
  })
})
