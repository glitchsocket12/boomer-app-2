import { describe, expect, it } from 'vitest'
import { buildProposals, collectCandidates, type Candidate, type CandidateRow } from './tagTrends.ts'

const row = (id: string, names: unknown): CandidateRow => ({ id, suggested_tag_names: names })
const candidate = (name: string, ...ids: string[]): Candidate => ({ name, momentIds: ids })

describe('collectCandidates', () => {
  it('ignores rows with nothing proposed, and non-array junk in the column', () => {
    expect(collectCandidates([])).toEqual([])
    expect(collectCandidates([row('m1', []), row('m2', null), row('m3', 'Concerts')])).toEqual([])
  })

  it('drops blank and whitespace-only names', () => {
    expect(collectCandidates([row('m1', ['', '   ', 'Concerts'])])).toEqual([
      { name: 'Concerts', momentIds: ['m1'] },
    ])
  })

  it('folds spellings that differ only in case, keeping the first one seen', () => {
    const got = collectCandidates([row('m1', ['Concerts']), row('m2', ['concerts']), row('m3', ['CONCERTS'])])
    expect(got).toEqual([{ name: 'Concerts', momentIds: ['m1', 'm2', 'm3'] }])
  })

  it('counts an event once even if it proposed the same name twice', () => {
    expect(collectCandidates([row('m1', ['Concerts', 'concerts'])])).toEqual([
      { name: 'Concerts', momentIds: ['m1'] },
    ])
  })

  it('ranks by how many events proposed it, ties alphabetical', () => {
    const got = collectCandidates([
      row('m1', ['Appointments', 'Concerts']),
      row('m2', ['Concerts']),
      row('m3', ['Concerts', 'Birthdays']),
    ])
    expect(got.map((c) => c.name)).toEqual(['Concerts', 'Appointments', 'Birthdays'])
  })
})

describe('buildProposals', () => {
  it('unions a cluster members events, which is what lifts a scattered idea over the bar', () => {
    const candidates = [candidate('Concert', 'm1', 'm2'), candidate('live music', 'm3'), candidate('show', 'm4')]
    const got = buildProposals(candidates, [{ name: 'Concerts', members: ['Concert', 'live music', 'show'] }], 3)
    expect(got).toEqual([{ name: 'Concerts', existingTagName: null, momentIds: ['m1', 'm2', 'm3', 'm4'] }])
  })

  it('matches cluster members case-insensitively', () => {
    const got = buildProposals([candidate('Concert', 'm1', 'm2', 'm3')], [{ name: 'Concerts', members: ['CONCERT'] }], 3)
    expect(got).toHaveLength(1)
    expect(got[0].momentIds).toEqual(['m1', 'm2', 'm3'])
  })

  it('counts an event once when two members both came from it', () => {
    const candidates = [candidate('Concert', 'm1', 'm2'), candidate('gig', 'm1', 'm3')]
    const got = buildProposals(candidates, [{ name: 'Concerts', members: ['Concert', 'gig'] }], 3)
    expect(got[0].momentIds.sort()).toEqual(['m1', 'm2', 'm3'])
  })

  it('carries an existing tag through, so the card can say "add Vacation to these"', () => {
    const got = buildProposals(
      [candidate('Beach Trip', 'm1', 'm2', 'm3')],
      [{ name: 'Vacation', members: ['Beach Trip'], existing_tag: 'Vacation' }],
      3
    )
    expect(got[0].existingTagName).toBe('Vacation')
  })

  it('drops a cluster that names nothing we collected, without losing the real candidate', () => {
    // "Weddings" is a hallucination — nothing proposed "nuptials" — so it must not become a tag.
    // "Concert" was never claimed by a cluster, so the standalone rule below still carries it.
    const got = buildProposals([candidate('Concert', 'm1', 'm2', 'm3')], [{ name: 'Weddings', members: ['nuptials'] }], 3)
    expect(got).toEqual([{ name: 'Concert', existingTagName: null, momentIds: ['m1', 'm2', 'm3'] }])
  })

  it('keeps a candidate the model left out of every cluster', () => {
    const candidates = [candidate('Concert', 'm1', 'm2', 'm3'), candidate('Funerals', 'm4', 'm5', 'm6')]
    const got = buildProposals(candidates, [{ name: 'Concerts', members: ['Concert'] }], 3)
    expect(got.map((p) => p.name).sort()).toEqual(['Concerts', 'Funerals'])
  })

  it('does not re-propose a candidate a cluster already claimed', () => {
    const got = buildProposals([candidate('Concert', 'm1', 'm2', 'm3')], [{ name: 'Concerts', members: ['Concert'] }], 3)
    expect(got.map((p) => p.name)).toEqual(['Concerts'])
  })

  it('enforces the minimum, so a one-off name never becomes a tag', () => {
    const candidates = [candidate('Concerts', 'm1', 'm2', 'm3'), candidate('Axe Throwing', 'm9')]
    expect(buildProposals(candidates, [], 3).map((p) => p.name)).toEqual(['Concerts'])
  })

  it('merges two clusters that landed on the same wording rather than proposing it twice', () => {
    const candidates = [candidate('Concert', 'm1', 'm2'), candidate('gig', 'm3')]
    const got = buildProposals(
      candidates,
      [
        { name: 'Concerts', members: ['Concert'] },
        { name: 'concerts', members: ['gig'] },
      ],
      3
    )
    expect(got).toHaveLength(1)
    expect(got[0].momentIds.sort()).toEqual(['m1', 'm2', 'm3'])
  })

  it('ranks proposals by size, ties alphabetical', () => {
    const candidates = [
      candidate('Concerts', 'm1', 'm2', 'm3', 'm4'),
      candidate('Funerals', 'm5', 'm6', 'm7'),
      candidate('Appointments', 'm8', 'm9', 'm10'),
    ]
    expect(buildProposals(candidates, [], 3).map((p) => p.name)).toEqual(['Concerts', 'Appointments', 'Funerals'])
  })

  it('ignores a cluster with no name', () => {
    expect(buildProposals([candidate('Concert', 'm1', 'm2', 'm3')], [{ name: '  ', members: ['Concert'] }], 3)).toEqual([
      { name: 'Concert', existingTagName: null, momentIds: ['m1', 'm2', 'm3'] },
    ])
  })
})
