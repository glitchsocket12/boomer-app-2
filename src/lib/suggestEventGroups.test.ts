import { describe, expect, it } from 'vitest'
import { deriveEventGroupSuggestions, mergeEventGroupSuggestions, type EventGroupSuggestion } from './suggestEventGroups'

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
      { kind: 'event_group', momentId: 'e1', momentTitle: "Clare's 30th birthday party", groupId: 'lpc', groupName: 'LPC', reason: 'attendees' },
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

describe('mergeEventGroupSuggestions', () => {
  const titles = new Map([
    ['e1', "Clare's 30th birthday party"],
    ['e2', 'Crew Dogs Christmas Party'],
  ])
  const derived: EventGroupSuggestion[] = [
    { kind: 'event_group', momentId: 'e1', momentTitle: "Clare's 30th birthday party", groupId: 'lpc', groupName: 'LPC', reason: 'attendees' },
  ]

  it('adds an AI pick the attendee pass could never reach', () => {
    const out = mergeEventGroupSuggestions(derived, [{ momentId: 'e2', groupId: 'af' }], titles, groupNames)
    expect(out).toHaveLength(2)
    expect(out[1]).toEqual({
      kind: 'event_group',
      momentId: 'e2',
      momentTitle: 'Crew Dogs Christmas Party',
      groupId: 'af',
      groupName: 'Air Force',
      reason: 'ai',
    })
  })

  it('never asks the same question twice, and keeps the stronger reason when both agree', () => {
    const out = mergeEventGroupSuggestions(derived, [{ momentId: 'e1', groupId: 'lpc' }], titles, groupNames)
    expect(out).toEqual(derived)
  })

  it('drops an AI pick for an event that is no longer in the untagged pool', () => {
    const out = mergeEventGroupSuggestions([], [{ momentId: 'gone', groupId: 'af' }], titles, groupNames)
    expect(out).toEqual([])
  })

  it('drops an AI pick naming a group that no longer exists', () => {
    const out = mergeEventGroupSuggestions([], [{ momentId: 'e2', groupId: 'deleted' }], titles, groupNames)
    expect(out).toEqual([])
  })

  it('collapses a duplicate pair inside the AI picks themselves', () => {
    const out = mergeEventGroupSuggestions(
      [],
      [
        { momentId: 'e2', groupId: 'af' },
        { momentId: 'e2', groupId: 'af' },
      ],
      titles,
      groupNames
    )
    expect(out).toHaveLength(1)
  })

  it('lets one event carry two different groups, since they are separate questions', () => {
    const out = mergeEventGroupSuggestions(
      [],
      [
        { momentId: 'e2', groupId: 'af' },
        { momentId: 'e2', groupId: 'volins' },
      ],
      titles,
      groupNames
    )
    expect(out.map((s) => s.groupName)).toEqual(['Air Force', 'The Volins'])
  })
})
