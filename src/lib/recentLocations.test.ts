import { describe, expect, it } from 'vitest'
import { buildRecentLocations } from './recentLocations'

describe('buildRecentLocations', () => {
  it('keeps the order it was given — callers sort most-recent-first', () => {
    expect(buildRecentLocations(['Denver, CO', 'Carmel Valley, CA', 'Parker, CO'])).toEqual([
      'Denver, CO',
      'Carmel Valley, CA',
      'Parker, CO',
    ])
  })

  it('drops nulls, undefineds and blank strings', () => {
    expect(buildRecentLocations([null, '  ', 'Denver, CO', undefined, ''])).toEqual(['Denver, CO'])
  })

  it('trims surrounding whitespace off the value it keeps', () => {
    expect(buildRecentLocations(['  Denver, CO  '])).toEqual(['Denver, CO'])
  })

  it('dedupes case-insensitively, keeping the first (most recent) spelling', () => {
    expect(buildRecentLocations(['Denver, CO', 'denver, co', 'DENVER, CO'])).toEqual(['Denver, CO'])
  })

  it('treats values differing only by surrounding whitespace as one', () => {
    expect(buildRecentLocations(['Denver, CO', ' Denver, CO'])).toEqual(['Denver, CO'])
  })

  it('keeps genuinely different spellings apart — cleaning those up is ManageLocations\' job', () => {
    expect(buildRecentLocations(['12208 Bandon Dr', '12208 Bandon Drive'])).toEqual([
      '12208 Bandon Dr',
      '12208 Bandon Drive',
    ])
  })

  it('returns an empty list for no rows', () => {
    expect(buildRecentLocations([])).toEqual([])
  })
})
