import { describe, expect, it } from 'vitest'
import { clusterKey, findLocationClusters, normalizeLocation, tallyLocations } from './locationGroups'

describe('normalizeLocation', () => {
  it('lowercases, drops punctuation and collapses whitespace', () => {
    expect(normalizeLocation('  12208 Bandon Dr.,  Parker,  CO ')).toBe('12208 bandon dr parker co')
  })

  it('returns empty for whitespace-only input', () => {
    expect(normalizeLocation('   ')).toBe('')
  })
})

describe('clusterKey', () => {
  it('keys a street address on house number + street name, ignoring everything after', () => {
    expect(clusterKey('12208 Bandon Dr')).toBe('12208 bandon')
    expect(clusterKey('12208 Bandon Drive, Parker CO')).toBe('12208 bandon')
    expect(clusterKey('12208 bandon dr, Parker, CO 80134')).toBe('12208 bandon')
  })

  it('expands street-word abbreviations so Dr and Drive agree', () => {
    expect(clusterKey('40 Oak Rd')).toBe(clusterKey('40 Oak Road'))
    expect(clusterKey('7 Elm Ave')).toBe(clusterKey('7 Elm Avenue'))
  })

  it('keys a non-address on the normalized string, so only spelling noise clusters', () => {
    expect(clusterKey('Denver, CO')).toBe('denver co')
    expect(clusterKey('denver co')).toBe('denver co')
  })

  it('refuses to cluster two different places in the same city', () => {
    expect(clusterKey('Denver Zoo')).not.toBe(clusterKey('Denver, CO'))
  })

  it('declines a lone house number or a second numeric token', () => {
    expect(clusterKey('12208')).toBeNull()
    expect(clusterKey('12208 80134 something')).toBeNull()
  })

  it('declines an empty value', () => {
    expect(clusterKey('   ')).toBeNull()
  })
})

describe('findLocationClusters', () => {
  const rows = [
    { value: '12208 Bandon Dr', count: 3 },
    { value: '12208 Bandon Drive, Parker CO', count: 1 },
    { value: '12208 bandon dr, Parker, CO 80134', count: 2 },
    { value: 'Denver Zoo', count: 4 },
  ]

  it('groups the three spellings of one address and leaves the unrelated one out', () => {
    const clusters = findLocationClusters(rows)
    expect(clusters).toHaveLength(1)
    expect(clusters[0].members.map((m) => m.value).sort()).toEqual([
      '12208 Bandon Dr',
      '12208 Bandon Drive, Parker CO',
      '12208 bandon dr, Parker, CO 80134',
    ])
  })

  it('suggests the most-used spelling', () => {
    expect(findLocationClusters(rows)[0].suggested).toBe('12208 Bandon Dr')
  })

  it('breaks a count tie on the longer (fuller) spelling', () => {
    const tied = [
      { value: '9 Oak St', count: 2 },
      { value: '9 Oak Street, Boulder, CO', count: 2 },
    ]
    expect(findLocationClusters(tied)[0].suggested).toBe('9 Oak Street, Boulder, CO')
  })

  it('returns nothing when every location is distinct', () => {
    expect(findLocationClusters([{ value: 'Denver Zoo', count: 1 }, { value: 'Red Rocks', count: 2 }])).toEqual([])
  })

  it('orders clusters by total events behind them', () => {
    const many = [
      { value: '1 A St', count: 1 },
      { value: '1 A Street', count: 1 },
      { value: '2 B St', count: 5 },
      { value: '2 B Street', count: 5 },
    ]
    // Both pairs tie on count internally, so each cluster's suggestion is its longer spelling.
    expect(findLocationClusters(many).map((c) => c.suggested)).toEqual(['2 B Street', '1 A Street'])
  })
})

describe('tallyLocations', () => {
  it('counts distinct values alphabetically and drops blanks', () => {
    expect(tallyLocations(['Denver', null, '  ', 'Aspen', 'Denver', undefined])).toEqual([
      { value: 'Aspen', count: 1 },
      { value: 'Denver', count: 2 },
    ])
  })

  it('trims before counting, so trailing whitespace is not a second location', () => {
    expect(tallyLocations(['Denver', 'Denver '])).toEqual([{ value: 'Denver', count: 2 }])
  })
})
