import { describe, expect, it } from 'vitest'
import {
  buildPersonIndex,
  findBestPersonMatch,
  nameMatchStrength,
  personNameKeys,
  type MatchablePerson,
} from './nameMatch.ts'
import {
  nameMatchStrength as appNameMatchStrength,
  personNameKeys as appPersonNameKeys,
} from '../../../src/lib/nameMatchStrength'

// This file exists because the old matcher scored names by word overlap over the shorter name, so
// every "Alex <anything>" in an imported address book was proposed as the account's one Alex Lesar.
// The cases below are the shape of that bug plus the good matches it must not cost us.
//
// Like kinship.test.ts, it also guards a hand-maintained mirror: nameMatchStrength lives in both
// supabase/functions/_shared/ (for the import) and src/lib/ (for the review screen re-check),
// because Deno can't import from src/. Every case runs through both copies.

function strength(
  contactName: string,
  personName: string,
  lastName: string | null,
  aliases: string[] = [],
  formerLastNames: string[] = []
) {
  const edge = nameMatchStrength(contactName, personNameKeys(personName, lastName, aliases, formerLastNames))
  const app = appNameMatchStrength(contactName, appPersonNameKeys(personName, lastName, aliases, formerLastNames))
  expect(app, `mirror drift for "${contactName}" vs "${personName} ${lastName ?? ''}"`).toBe(edge)
  return edge
}

describe('nameMatchStrength', () => {
  it('rejects a shared first name with different surnames', () => {
    expect(strength('Alex Smith', 'Alex', 'Lesar')).toBe('none')
    expect(strength('Alex Rodriguez', 'Alex', 'Lesar')).toBe('none')
    expect(strength('Alexandra Chen', 'Alex', 'Lesar')).toBe('none')
  })

  it('accepts the same first and last name', () => {
    expect(strength('Alex Lesar', 'Alex', 'Lesar')).toBe('strong')
    expect(strength('ALEX  LESAR', 'Alex', 'Lesar')).toBe('strong')
    expect(strength("Sinead O'Brien", 'Sinead', "O'Brien")).toBe('strong')
  })

  it('ignores middle names, titles and suffixes', () => {
    expect(strength('Alex J. Lesar', 'Alex', 'Lesar')).toBe('strong')
    expect(strength('Dr. Alex Lesar Jr.', 'Alex', 'Lesar')).toBe('strong')
    // The shared "J" must not be mistaken for a shared surname.
    expect(strength('Alex J. Smith', 'Alex', 'Lesar')).toBe('none')
  })

  it('matches a nickname against the surname on file, but never lets it overrule one', () => {
    expect(strength('Bobby Lesar', 'Robert', 'Lesar', ['Bobby'])).toBe('strong')
    expect(strength('Bobby Smith', 'Robert', 'Lesar', ['Bobby'])).toBe('none')
    expect(strength('Robert Lesar', 'Robert', 'Lesar', ['Bobby'])).toBe('strong')
  })

  it('treats a first-name-only side as a question, not an answer', () => {
    expect(strength('Alex Lesar', 'Alex', null)).toBe('weak')
    expect(strength('Alex', 'Alex', 'Lesar')).toBe('weak')
    expect(strength('Alex', 'Alex', null)).toBe('strong')
  })

  it('reads a whole name stored in the name column when last_name is empty', () => {
    expect(strength('Alex Lesar', 'Alex Lesar', null)).toBe('strong')
    expect(strength('Alex Smith', 'Alex Lesar', null)).toBe('none')
  })

  it('allows an initial only when the surname agrees', () => {
    expect(strength('A. Lesar', 'Alex', 'Lesar')).toBe('weak')
    expect(strength('A. Smith', 'Alex', 'Lesar')).toBe('none')
    expect(strength('A.', 'Alex', 'Lesar')).toBe('none')
  })

  it('handles hyphenated and multi-word surnames', () => {
    expect(strength('Jane Smith-Doe', 'Jane', 'Doe')).toBe('strong')
    expect(strength('Jane Doe', 'Jane', 'Smith-Doe')).toBe('strong')
    expect(strength('Alex Van Der Berg', 'Alex', 'Van Der Berg')).toBe('strong')
  })

  it('forgives a one-character typo in a long surname, but only as a question', () => {
    expect(strength('Sean Baerman', 'Sean', 'Baermann')).toBe('weak')
    expect(strength('Kate Smyth', 'Kate', 'Smith')).toBe('weak')
    // Short surnames are too easy to collide by accident to allow any slack.
    expect(strength('Ben Kim', 'Ben', 'Kip')).toBe('none')
    expect(strength('Ben Lee', 'Ben', 'Lea')).toBe('none')
    // A near-miss surname on top of an initial is two guesses stacked.
    expect(strength('S. Baerman', 'Sean', 'Baermann')).toBe('none')
  })

  it('rejects unrelated people outright', () => {
    expect(strength('Maria Lesar', 'Alex', 'Lesar')).toBe('none')
    expect(strength('Alex Lesar', 'Jordan', 'Park')).toBe('none')
  })

  // A former name is the one alias that counts as a SURNAME. Without it, a maiden/married pair is
  // a surname conflict, which is a hard 'none' — the import queue doesn't even ask, and the same
  // miss is what makes chat open a second profile for someone already on file.
  it('matches a former surname against the current one', () => {
    expect(strength('Sarah Jenkins', 'Sarah', 'Mitchell', [], ['Jenkins'])).toBe('strong')
    expect(strength('Sarah Mitchell', 'Sarah', 'Mitchell', [], ['Jenkins'])).toBe('strong')
    // Unchanged when nothing is recorded: the app only knows a name changed if it was told.
    expect(strength('Sarah Jenkins', 'Sarah', 'Mitchell')).toBe('none')
  })

  it('carries more than one former surname, for a remarriage', () => {
    expect(strength('Sarah Okafor', 'Sarah', 'Mitchell', [], ['Jenkins', 'Okafor'])).toBe('strong')
    expect(strength('Sarah Jenkins', 'Sarah', 'Mitchell', [], ['Jenkins', 'Okafor'])).toBe('strong')
  })

  it('never lets a former surname act as a given name', () => {
    // The whole failure mode this column exists to avoid: "Jenkins" filed as a first name.
    expect(strength('Jenkins Mitchell', 'Sarah', 'Mitchell', [], ['Jenkins'])).toBe('none')
    expect(strength('Jenkins', 'Sarah', 'Mitchell', [], ['Jenkins'])).toBe('none')
    // Her sister-in-law is not her.
    expect(strength('Emily Jenkins', 'Sarah', 'Mitchell', [], ['Jenkins'])).toBe('none')
  })

  it('combines a nickname with a former surname, and still holds initials to the same bar', () => {
    expect(strength('Sadie Jenkins', 'Sarah', 'Mitchell', ['Sadie'], ['Jenkins'])).toBe('strong')
    expect(strength('S. Jenkins', 'Sarah', 'Mitchell', [], ['Jenkins'])).toBe('weak')
  })
})

const PEOPLE: MatchablePerson[] = [
  { id: 'alex-lesar', name: 'Alex', last_name: 'Lesar', nicknames: null, emails: [{ label: 'home', value: 'alex@lesar.com' }], phones: [] },
  { id: 'robert', name: 'Robert', last_name: 'Smith', nicknames: 'Bob', emails: [{ label: 'home', value: 'house@smith.com' }], phones: [{ label: 'home', value: '(555) 123-4567' }] },
  { id: 'jane', name: 'Jane', last_name: 'Smith', nicknames: null, emails: [{ label: 'home', value: 'house@smith.com' }], phones: [{ label: 'home', value: '555-123-4567' }] },
]

function match(fullName: string, emails: string[] = [], phones: string[] = [], people = PEOPLE) {
  return findBestPersonMatch(fullName, emails, phones, buildPersonIndex(people))
}

describe('findBestPersonMatch', () => {
  it('does not propose Alex Lesar for every other Alex', () => {
    expect(match('Alex Smith')).toBeNull()
    expect(match('Alex Chen')).toBeNull()
    expect(match('Alexandra Lopez')).toBeNull()
  })

  it('matches the same full name with high confidence', () => {
    expect(match('Alex Lesar')).toEqual({ personId: 'alex-lesar', confidence: 'high' })
  })

  it('matches on a nickname, and reads a phone number through its formatting', () => {
    expect(match('Bob Smith', ['house@smith.com'])).toEqual({ personId: 'robert', confidence: 'high' })
    expect(match('Bob Smith', [], ['+1 (555) 123-4567'])).toEqual({ personId: 'robert', confidence: 'high' })
  })

  it('stays quiet when a household number cannot tell two people apart', () => {
    // "Bobby" isn't recorded as Robert's nickname, so the only evidence is a phone the whole
    // Smith household shares — which points at Robert and Jane equally.
    expect(match('Bobby Smith', [], ['555-123-4567'])).toBeNull()
  })

  it('does not match a spouse just because the household email or phone is shared', () => {
    expect(match('Danielle Nguyen', ['house@smith.com'])).toBeNull()
    expect(match('Danielle Nguyen', [], ['555-123-4567'])).toBeNull()
  })

  it('asks rather than asserts when a first name alone is the only evidence', () => {
    const people: MatchablePerson[] = [{ id: 'alex', name: 'Alex', last_name: null, nicknames: null }]
    expect(match('Alex Lesar', [], [], people)).toEqual({ personId: 'alex', confidence: 'none' })
  })

  it('gives up when two people are equally plausible', () => {
    const twoAlexes: MatchablePerson[] = [
      { id: 'a1', name: 'Alex', last_name: null, nicknames: null },
      { id: 'a2', name: 'Alex', last_name: null, nicknames: null },
    ]
    expect(match('Alex Lesar', [], [], twoAlexes)).toBeNull()
  })

  it('downgrades to a question when the account holds two people with the same name', () => {
    const twins: MatchablePerson[] = [
      { id: 'a1', name: 'Alex', last_name: 'Lesar', nicknames: null },
      { id: 'a2', name: 'Alex', last_name: 'Lesar', nicknames: null },
    ]
    expect(match('Alex Lesar', [], [], twins)).toEqual({ personId: 'a1', confidence: 'none' })
  })

  it('returns nothing for someone genuinely new', () => {
    expect(match('Priya Raghunathan', ['priya@example.com'])).toBeNull()
  })

  it('finds someone imported under the name they used to have', () => {
    const remarried: MatchablePerson[] = [
      { id: 'sarah', name: 'Sarah', last_name: 'Mitchell', nicknames: null, former_last_names: 'Jenkins' },
    ]
    expect(match('Sarah Jenkins', [], [], remarried)).toEqual({ personId: 'sarah', confidence: 'high' })
    expect(match('Sarah Mitchell', [], [], remarried)).toEqual({ personId: 'sarah', confidence: 'high' })
  })

  it('asks rather than asserts when a former name collides with someone real', () => {
    // A genuine Sarah Jenkins on file, and a Sarah Mitchell who used to be one. Both score the
    // same, so the existing tie guard drops the confident tier to a question instead of picking.
    const collision: MatchablePerson[] = [
      { id: 'real-jenkins', name: 'Sarah', last_name: 'Jenkins', nicknames: null },
      { id: 'was-jenkins', name: 'Sarah', last_name: 'Mitchell', nicknames: null, former_last_names: 'Jenkins' },
    ]
    expect(match('Sarah Jenkins', [], [], collision)).toEqual({ personId: 'real-jenkins', confidence: 'none' })
  })
})
