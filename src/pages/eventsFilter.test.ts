import { describe, expect, it } from 'vitest'
import { DEFAULT_EVENT_FILTERS, decorateMoments, filterMoments, type Moment } from './Events'

// Covers the "No group yet" option specifically (the manual sweep for events Home's suggestion
// card can't reach — see the comment on the groupFilter branch), plus enough of its neighbours to
// prove the new 'none' sentinel didn't change how a real group id filters.

const moment = (id: string, groups: { id: string; name: string }[]): Moment =>
  ({
    id,
    occasion: `Event ${id}`,
    raw_description: null,
    when_text: null,
    event_date: null,
    event_end_date: null,
    location: null,
    parent_moment_id: null,
    notes: [],
    moment_groups: groups.map((g) => ({ groups: g })),
    moment_tags: [],
  }) as unknown as Moment

const volins = { id: 'g1', name: 'The Volins' }
const airForce = { id: 'g2', name: 'Air Force' }

const decorated = decorateMoments([
  moment('tagged-volins', [volins]),
  moment('tagged-both', [volins, airForce]),
  moment('untagged', []),
])

const idsFor = (groupFilter: string) =>
  filterMoments(decorated, { ...DEFAULT_EVENT_FILTERS, groupFilter }).map((d) => d.moment.id)

describe('filterMoments — group filter', () => {
  it('returns everything by default', () => {
    expect(idsFor('all')).toEqual(['tagged-volins', 'tagged-both', 'untagged'])
  })

  it('narrows to events carrying a specific group', () => {
    expect(idsFor('g1')).toEqual(['tagged-volins', 'tagged-both'])
    expect(idsFor('g2')).toEqual(['tagged-both'])
  })

  it('"none" returns only the events with no group on them at all', () => {
    expect(idsFor('none')).toEqual(['untagged'])
  })

  it('a group id that no longer exists matches nothing rather than everything', () => {
    expect(idsFor('deleted-group')).toEqual([])
  })
})
