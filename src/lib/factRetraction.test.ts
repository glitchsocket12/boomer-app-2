import { describe, expect, it } from 'vitest'
import { findAssertingNotes, nameVariants, noteMentionsName, relationshipKindsForCategory } from './factRetraction'

describe('nameVariants', () => {
  it('offers the full name and the first name, since notes usually only write the first', () => {
    expect(nameVariants('Olivia Gillingham')).toEqual(['Olivia Gillingham', 'Olivia'])
  })

  it('does not duplicate a one-word name', () => {
    expect(nameVariants('Olivia')).toEqual(['Olivia'])
  })

  it('ignores an empty name rather than matching everything', () => {
    expect(nameVariants('')).toEqual([])
    expect(nameVariants('   ')).toEqual([])
  })
})

describe('noteMentionsName', () => {
  // The two real notes on Gus Reynolds's profile that this whole feature exists to catch together.
  it('catches both wordings of the same fact', () => {
    expect(noteMentionsName('Is dating a girl named Olivia', 'Olivia Gillingham')).toBe(true)
    expect(noteMentionsName('Has a girlfriend named Olivia.', 'Olivia Gillingham')).toBe(true)
  })

  it('does not match a longer name that merely starts the same', () => {
    expect(noteMentionsName('Oliviana came too.', 'Olivia')).toBe(false)
    expect(noteMentionsName('Talked to Olivias sister', 'Olivia')).toBe(false)
  })

  it('matches regardless of case and around punctuation', () => {
    expect(noteMentionsName('married to OLIVIA.', 'Olivia')).toBe(true)
    expect(noteMentionsName('(Olivia was there)', 'Olivia')).toBe(true)
    expect(noteMentionsName('Olivia', 'Olivia')).toBe(true)
  })

  it('is not fooled by a name appearing only as part of another word', () => {
    expect(noteMentionsName('Went to Olivia-Rose Bakery', 'Olivia Gillingham')).toBe(true)
    expect(noteMentionsName('Bought olives.', 'Olivia')).toBe(false)
  })
})

describe('findAssertingNotes', () => {
  const subjectNotes = [
    { id: 'a', content: 'Is dating a girl named Olivia', person_id: 'gus' },
    { id: 'b', content: 'Has a girlfriend named Olivia.', person_id: 'gus' },
    { id: 'c', content: 'Was there.', person_id: 'gus' },
  ]

  it('gathers every note asserting the fact and leaves the unrelated ones alone', () => {
    const found = findAssertingNotes({
      subjectName: 'Gus Reynolds',
      subjectNotes,
      linkedNames: ['Olivia'],
      mirrorNotes: [],
    })
    expect(found.subject.map((n) => n.id)).toEqual(['a', 'b'])
    expect(found.mirror).toEqual([])
  })

  // Deleting only the side you are standing on leaves the fact half-standing, and Key Facts
  // regenerates it from the other profile's copy.
  it('gathers the mirror note on the other person, matched on the subject name', () => {
    const found = findAssertingNotes({
      subjectName: 'Julia Lacy',
      subjectNotes: [{ id: 'a', content: 'Married to Jalen Lacy.', person_id: 'julia' }],
      linkedNames: ['Jalen Lacy'],
      mirrorNotes: [
        { id: 'm1', content: 'Married to Julia Lacy.', person_id: 'jalen' },
        { id: 'm2', content: 'Was there.', person_id: 'jalen' },
      ],
    })
    expect(found.subject.map((n) => n.id)).toEqual(['a'])
    expect(found.mirror.map((n) => n.id)).toEqual(['m1'])
  })

  it('finds nothing when the fact names nobody, rather than proposing every note for deletion', () => {
    const found = findAssertingNotes({
      subjectName: 'Gus Reynolds',
      subjectNotes,
      linkedNames: ['', '   '],
      mirrorNotes: [],
    })
    expect(found.subject).toEqual([])
  })
})

describe('relationshipKindsForCategory', () => {
  // A dating fact lands under either category depending on wording, so clearing one kind alone
  // would leave the other row behind to re-inject itself into Key Facts.
  it('clears both spouse and partner for either romantic category', () => {
    expect(relationshipKindsForCategory('spouse')).toEqual(['spouse', 'partner'])
    expect(relationshipKindsForCategory('partner')).toEqual(['spouse', 'partner'])
  })

  it('maps the family categories to their directional kinds', () => {
    expect(relationshipKindsForCategory('siblings')).toEqual(['sibling'])
    expect(relationshipKindsForCategory('parents')).toEqual(['parent-of-subject'])
    expect(relationshipKindsForCategory('kids')).toEqual(['subject-is-parent'])
  })

  it('has nothing to unlink for a category with no relationship row behind it', () => {
    expect(relationshipKindsForCategory('location')).toEqual([])
    expect(relationshipKindsForCategory('other')).toEqual([])
  })
})
