import { describe, expect, it } from 'vitest'
import { rankSiblingAttendees } from './siblingAttendees'

type Person = { id: string; name: string; last_name: string | null }

const p = (id: string, name: string, last_name: string | null = null): Person => ({ id, name, last_name })

const day = (...people: Person[]) => ({ notes: people.map((person) => ({ people: person })) })

const ada = p('1', 'Ada', 'Zimmer')
const ben = p('2', 'Ben', 'Alvarez')
const cleo = p('3', 'Cleo', 'Marsh')

const names = (people: Person[]) => people.map((x) => x.name)

describe('rankSiblingAttendees', () => {
  it('suggests everyone from the other sub-events', () => {
    const result = rankSiblingAttendees([day(ada), day(ben)], new Set())
    expect(names(result)).toEqual(['Ben', 'Ada'])
  })

  it('ranks people who came to more of the other sub-events first', () => {
    // Ada was at all three days, Ben at one — Ada is the better bet for the day being added.
    const result = rankSiblingAttendees([day(ada, ben), day(ada), day(ada)], new Set())
    expect(names(result)).toEqual(['Ada', 'Ben'])
  })

  it('breaks ties on last name, like every other chip row', () => {
    const result = rankSiblingAttendees([day(ada, ben, cleo)], new Set())
    expect(names(result)).toEqual(['Ben', 'Cleo', 'Ada'])
  })

  it('counts a sub-event once per person however many notes they have on it', () => {
    // Ben has three notes on one day; Ada actually turned up to two. Ada should still win.
    const chattyDay = { notes: [{ people: ben }, { people: ben }, { people: ben }, { people: ada }] }
    const result = rankSiblingAttendees([chattyDay, day(ada)], new Set())
    expect(names(result)).toEqual(['Ada', 'Ben'])
  })

  it('leaves out people already tagged here, and dismissed ones', () => {
    const result = rankSiblingAttendees([day(ada, ben, cleo)], new Set([ada.id, cleo.id]))
    expect(names(result)).toEqual(['Ben'])
  })

  it('ignores notes with no person attached', () => {
    const result = rankSiblingAttendees([{ notes: [{ people: null }, { people: ada }] }], new Set())
    expect(names(result)).toEqual(['Ada'])
  })

  it('copes with a sub-event that has no notes at all', () => {
    expect(rankSiblingAttendees<Person>([{ notes: null }, {}], new Set())).toEqual([])
    expect(rankSiblingAttendees<Person>([], new Set())).toEqual([])
  })
})
