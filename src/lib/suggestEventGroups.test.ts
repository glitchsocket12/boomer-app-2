import { describe, expect, it } from 'vitest'
import { deriveEventGroupSuggestions } from './suggestEventGroups'

const groupNames = new Map([
  ['lpc', 'LPC'],
  ['af', 'Air Force'],
  ['volins', 'The Volins'],
])

const events = [{ id: 'e1', title: "Clare's 30th birthday party" }]

describe('deriveEventGroupSuggestions', () => {
  it('suggests the group every attendee belongs to', () => {
    const out = deriveEventGroupSuggestions(
      events,
      [
        { moment_id: 'e1', person_id: 'p1' },
        { moment_id: 'e1', person_id: 'p2' },
      ],
      [
        { person_id: 'p1', group_id: 'lpc' },
        { person_id: 'p2', group_id: 'lpc' },
      ],
      groupNames
    )
    expect(out).toEqual([
      {
        kind: 'event_group',
        momentId: 'e1',
        momentTitle: "Clare's 30th birthday party",
        groupId: 'lpc',
        groupName: 'LPC',
        reason: 'Everyone who was there is a member.',
      },
    ])
  })

  it('stays quiet when only some attendees are members', () => {
    const out = deriveEventGroupSuggestions(
      events,
      [
        { moment_id: 'e1', person_id: 'p1' },
        { moment_id: 'e1', person_id: 'p2' },
        { moment_id: 'e1', person_id: 'p3' },
      ],
      [
        { person_id: 'p1', group_id: 'lpc' },
        { person_id: 'p2', group_id: 'lpc' },
      ],
      groupNames
    )
    expect(out).toEqual([])
  })

  it('ignores an event with a single attendee, however many groups they are in', () => {
    const out = deriveEventGroupSuggestions(
      events,
      [{ moment_id: 'e1', person_id: 'p1' }],
      [
        { person_id: 'p1', group_id: 'lpc' },
        { person_id: 'p1', group_id: 'af' },
      ],
      groupNames
    )
    expect(out).toEqual([])
  })

  it('ignores an event with no attendees at all', () => {
    const out = deriveEventGroupSuggestions(events, [], [{ person_id: 'p1', group_id: 'lpc' }], groupNames)
    expect(out).toEqual([])
  })

  it('asks separately about each group the whole party shares', () => {
    const out = deriveEventGroupSuggestions(
      [{ id: 'e1', title: 'Dinner at The Brinkerhoff' }],
      [
        { moment_id: 'e1', person_id: 'p1' },
        { moment_id: 'e1', person_id: 'p2' },
      ],
      [
        { person_id: 'p1', group_id: 'lpc' },
        { person_id: 'p1', group_id: 'volins' },
        { person_id: 'p2', group_id: 'lpc' },
        { person_id: 'p2', group_id: 'volins' },
      ],
      groupNames
    )
    expect(out.map((s) => s.groupId).sort()).toEqual(['lpc', 'volins'])
  })

  it('drops a shared group whose name is missing', () => {
    const out = deriveEventGroupSuggestions(
      events,
      [
        { moment_id: 'e1', person_id: 'p1' },
        { moment_id: 'e1', person_id: 'p2' },
      ],
      [
        { person_id: 'p1', group_id: 'deleted' },
        { person_id: 'p2', group_id: 'deleted' },
      ],
      groupNames
    )
    expect(out).toEqual([])
  })

  it('only considers the attendees of the event in question', () => {
    const out = deriveEventGroupSuggestions(
      [
        { id: 'e1', title: 'Vail trip with JB' },
        { id: 'e2', title: 'Dice & Predator night' },
      ],
      [
        { moment_id: 'e1', person_id: 'p1' },
        { moment_id: 'e1', person_id: 'p2' },
        { moment_id: 'e2', person_id: 'p3' },
      ],
      [
        { person_id: 'p1', group_id: 'af' },
        { person_id: 'p2', group_id: 'af' },
        { person_id: 'p3', group_id: 'af' },
      ],
      groupNames
    )
    expect(out.map((s) => s.momentId)).toEqual(['e1'])
  })
})

// --- the window rule (2026-08-23) ---------------------------------------------------------
//
// The founder's own case: a group created for a week-long course in Pensacola, with no members
// yet, and a solo post on its first day. The attendance rule cannot fire on any of this.

const crmGroupNames = new Map([
  ['crm', 'CRM School'],
  ['academy', 'Air Force Academy'],
  ['lpc', 'LPC'],
])

const crmWindows = new Map([
  ['crm', { start_date: '2026-08-23', end_date: '2026-08-27', location: 'Pensacola, FL' }],
])

describe('deriveEventGroupSuggestions — group windows', () => {
  it('suggests a dated group for a solo post with no attendees at all', () => {
    const out = deriveEventGroupSuggestions(
      [{ id: 'e1', title: 'Landed in Pensacola', event_date: '2026-08-23', location: 'Pensacola' }],
      [],
      [],
      crmGroupNames,
      crmWindows
    )
    expect(out).toEqual([
      {
        kind: 'event_group',
        momentId: 'e1',
        momentTitle: 'Landed in Pensacola',
        groupId: 'crm',
        groupName: 'CRM School',
        reason: "It matches that group's dates and place (August 23–27, 2026, Pensacola, FL).",
      },
    ])
  })

  it('still suggests on dates alone when the event has no location', () => {
    const out = deriveEventGroupSuggestions(
      [{ id: 'e1', title: 'Dinner with the class', event_date: '2026-08-25' }],
      [],
      [],
      crmGroupNames,
      crmWindows
    )
    expect(out.map((s) => s.reason)).toEqual(["It falls inside that group's dates (August 23–27, 2026)."])
  })

  it('stays quiet for an event outside the window', () => {
    const out = deriveEventGroupSuggestions(
      [{ id: 'e1', title: 'Flew home', event_date: '2026-08-29', location: 'Pensacola' }],
      [],
      [],
      crmGroupNames,
      crmWindows
    )
    expect(out).toEqual([])
  })

  it('stays quiet for an undated event', () => {
    const out = deriveEventGroupSuggestions(
      [{ id: 'e1', title: 'Some time in Pensacola', location: 'Pensacola' }],
      [],
      [],
      crmGroupNames,
      crmWindows
    )
    expect(out).toEqual([])
  })

  it('does not let a multi-year group claim an event on dates alone', () => {
    const out = deriveEventGroupSuggestions(
      [{ id: 'e1', title: 'A Tuesday in 2012', event_date: '2012-03-04', location: 'Boston, MA' }],
      [],
      [],
      crmGroupNames,
      new Map([['academy', { start_date: '2010-06-24', end_date: '2014-05-28', location: 'Colorado Springs, CO' }]])
    )
    expect(out).toEqual([])
  })

  it("uses a trip's sub-event days when the parent row has no end date", () => {
    const out = deriveEventGroupSuggestions(
      [
        {
          id: 'e1',
          title: 'Pensacola trip',
          event_date: '2026-08-21',
          children: [{ event_date: '2026-08-24', event_end_date: null }],
        },
      ],
      [],
      [],
      crmGroupNames,
      crmWindows
    )
    // The parent alone (Aug 21) misses the window; the day under it reaches into it.
    expect(out.map((s) => s.groupId)).toEqual(['crm'])
  })

  it('asks once when both signals agree, keeping the attendance reason', () => {
    const out = deriveEventGroupSuggestions(
      [{ id: 'e1', title: 'Dinner with the class', event_date: '2026-08-25', location: 'Pensacola' }],
      [
        { moment_id: 'e1', person_id: 'p1' },
        { moment_id: 'e1', person_id: 'p2' },
      ],
      [
        { person_id: 'p1', group_id: 'crm' },
        { person_id: 'p2', group_id: 'crm' },
      ],
      crmGroupNames,
      crmWindows
    )
    expect(out).toHaveLength(1)
    expect(out[0].reason).toBe('Everyone who was there is a member.')
  })

  it('caps how many groups one event is asked about, strongest first', () => {
    const windows = new Map([
      ['a', { start_date: '2026-08-20', end_date: '2026-08-30', location: null }],
      ['b', { start_date: '2026-08-22', end_date: '2026-08-28', location: null }],
      ['c', { start_date: '2026-08-23', end_date: '2026-08-27', location: 'Pensacola, FL' }],
    ])
    const names = new Map([
      ['a', 'Group A'],
      ['b', 'Group B'],
      ['c', 'Group C'],
    ])
    const out = deriveEventGroupSuggestions(
      [{ id: 'e1', title: 'Landed in Pensacola', event_date: '2026-08-25', location: 'Pensacola' }],
      [],
      [],
      names,
      windows
    )
    expect(out).toHaveLength(2)
    // The place-matching group must be one of them, and must come first.
    expect(out[0].groupId).toBe('c')
  })

  it('is unchanged when no windows are supplied at all', () => {
    const out = deriveEventGroupSuggestions(
      [{ id: 'e1', title: 'Landed in Pensacola', event_date: '2026-08-23', location: 'Pensacola' }],
      [],
      [],
      crmGroupNames
    )
    expect(out).toEqual([])
  })
})

describe('deriveEventGroupSuggestions — the scan\'s own picks', () => {
  it('suggests a group off the AI pick alone, with no attendees and no window', () => {
    const out = deriveEventGroupSuggestions(
      [{ id: 'e1', title: 'Squadron Christmas party' }],
      [],
      [],
      groupNames,
      new Map(),
      new Map([['e1', ['af']]])
    )
    expect(out).toEqual([
      {
        kind: 'event_group',
        momentId: 'e1',
        momentTitle: 'Squadron Christmas party',
        groupId: 'af',
        groupName: 'Air Force',
        reason: 'Its name and notes point to that group.',
      },
    ])
  })

  it('yields to the attendance reason when both land on the same pair', () => {
    const out = deriveEventGroupSuggestions(
      events,
      [
        { moment_id: 'e1', person_id: 'p1' },
        { moment_id: 'e1', person_id: 'p2' },
      ],
      [
        { person_id: 'p1', group_id: 'lpc' },
        { person_id: 'p2', group_id: 'lpc' },
      ],
      groupNames,
      new Map(),
      new Map([['e1', ['lpc']]])
    )
    expect(out).toHaveLength(1)
    expect(out[0].reason).toBe('Everyone who was there is a member.')
  })

  it('drops a pick naming a group that no longer exists', () => {
    const out = deriveEventGroupSuggestions(
      events,
      [],
      [],
      groupNames,
      new Map(),
      new Map([['e1', ['deleted-group']]])
    )
    expect(out).toEqual([])
  })

  it('ignores picks for an event that is not in the untagged pool', () => {
    const out = deriveEventGroupSuggestions(
      events,
      [],
      [],
      groupNames,
      new Map(),
      new Map([['some-other-event', ['af']]])
    )
    expect(out).toEqual([])
  })

  it('asks about each group when the scan picked more than one', () => {
    const out = deriveEventGroupSuggestions(
      events,
      [],
      [],
      groupNames,
      new Map(),
      new Map([['e1', ['af', 'lpc']]])
    )
    expect(out.map((s) => s.groupId)).toEqual(['af', 'lpc'])
  })
})
