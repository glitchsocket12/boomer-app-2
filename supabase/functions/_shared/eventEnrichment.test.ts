import { describe, expect, it } from 'vitest'
import { locationAttempts, normalizeRegion, shiftDate, toEspnDate, toGame } from './eventEnrichment.ts'

// Only the network-free helpers are covered here. The provider calls themselves were verified
// against the live APIs during the build (Rockies @ Coors Field, 2025-07-04) but are deliberately
// not in the suite — CI reports rather than blocks, and a flaky third party would make it noise.

describe('locationAttempts', () => {
  it('splits an address into pieces, most specific first', () => {
    // Order is the whole point: the LAST piece of a US address is the state, and searching
    // "Colorado" returns Colorado City, TEXAS — a 700-mile error with no visible failure.
    expect(locationAttempts('Coors Field, Denver, Colorado')).toEqual([
      'Coors Field',
      'Denver',
      'Colorado',
    ])
  })

  it('leaves a single place name alone', () => {
    expect(locationAttempts('Boulder')).toEqual(['Boulder'])
    expect(locationAttempts('  Coors Field  ')).toEqual(['Coors Field'])
  })

  it('drops empty segments and handles junk', () => {
    expect(locationAttempts('Boulder, , CO')).toEqual(['Boulder', 'CO'])
    expect(locationAttempts('')).toEqual([])
    expect(locationAttempts('   ')).toEqual([])
  })
})

describe('normalizeRegion', () => {
  it('treats an abbreviation and a full name as the same place', () => {
    // ESPN sends "Pennsylvania" for MLB but "GA"/"CO"/"MI" for the NFL, NBA, NHL and college
    // feeds. Comparing raw strings would match MLB and silently reject every other league.
    expect(normalizeRegion('CO')).toBe('colorado')
    expect(normalizeRegion('Colorado')).toBe('colorado')
    expect(normalizeRegion('co')).toBe(normalizeRegion('Colorado'))
    expect(normalizeRegion('GA')).toBe('georgia')
  })

  it('handles Canadian provinces, which the NHL and MLB both use', () => {
    expect(normalizeRegion('ON')).toBe('ontario')
    expect(normalizeRegion('Ontario')).toBe('ontario')
    expect(normalizeRegion('MB')).toBe('manitoba')
  })

  it('returns null for anything it does not recognise, meaning "do not guard"', () => {
    // Some international venues report a country instead of a state. Refusing to guard is right;
    // rejecting every result would just delete the weather box.
    expect(normalizeRegion('Ireland')).toBeNull()
    expect(normalizeRegion(null)).toBeNull()
    expect(normalizeRegion(undefined)).toBeNull()
    expect(normalizeRegion('')).toBeNull()
  })
})

describe('date helpers', () => {
  it('formats for ESPN and shifts by whole days', () => {
    expect(toEspnDate('2025-07-04')).toBe('20250704')
    expect(shiftDate('2025-07-04', -1)).toBe('2025-07-03')
    expect(shiftDate('2025-07-04', 1)).toBe('2025-07-05')
  })

  it('shifts across month and year boundaries', () => {
    expect(shiftDate('2025-01-01', -1)).toBe('2024-12-31')
    expect(shiftDate('2025-02-28', 1)).toBe('2025-03-01')
    expect(shiftDate('2024-02-28', 1)).toBe('2024-02-29')
  })
})

describe('toGame', () => {
  // Trimmed from the real 2025-07-04 Rockies response.
  const raw = {
    id: '401696227',
    name: 'Chicago White Sox at Colorado Rockies',
    shortName: 'CHW @ COL',
    date: '2025-07-05T00:10Z',
    status: { type: { description: 'Final', completed: true } },
    links: [
      { rel: ['summary', 'desktop', 'event'], href: 'https://www.espn.com/mlb/game/_/gameId/401696227' },
      { rel: ['boxscore', 'desktop', 'event'], href: 'https://www.espn.com/mlb/boxscore/_/gameId/401696227' },
    ],
    competitions: [
      {
        attendance: 48064,
        venue: { fullName: 'Coors Field', address: { city: 'Denver', state: 'Colorado' } },
        competitors: [
          { homeAway: 'home', winner: false, score: '2', team: { id: '27', displayName: 'Colorado Rockies' }, records: [{ summary: '20-68' }] },
          { homeAway: 'away', winner: true, score: '3', team: { id: '4', displayName: 'Chicago White Sox' }, records: [{ summary: '29-59' }] },
        ],
        headlines: [{ shortLinkText: 'White Sox edge Rockies', description: 'Adrian Houser allowed two hits.' }],
        leaders: [{ leaders: [{ displayValue: '8.0 IP, 0 ER', athlete: { displayName: 'Adrian Houser' } }] }],
      },
    ],
  }

  it('pulls out the fields the box actually renders', () => {
    const g = toGame(raw, 'mlb')!
    expect(g.status).toBe('ok')
    expect(g.attendance).toBe(48064)
    expect(g.venue).toBe('Coors Field')
    expect(g.venueCity).toBe('Denver')
    expect(g.venueState).toBe('Colorado')
    expect(g.completed).toBe(true)
    expect(g.leagueLabel).toBe('MLB')
    expect(g.leaders).toEqual(['Adrian Houser — 8.0 IP, 0 ER'])
    // Scores arrive as strings and must come out as numbers so the UI can compare them.
    expect(g.teams.map((t) => t.score)).toEqual([2, 3])
    expect(g.teams.find((t) => t.winner)?.name).toBe('Chicago White Sox')
  })

  it('prefers the summary link, which is the page the founder asked to link to', () => {
    expect(toGame(raw, 'mlb')!.espnUrl).toBe('https://www.espn.com/mlb/game/_/gameId/401696227')
  })

  it('survives a sparse response rather than throwing', () => {
    // A game that hasn't been played yet has no attendance, no scores and no recap.
    const sparse = { id: '1', competitions: [{ competitors: [] }] }
    const g = toGame(sparse, 'nfl')!
    expect(g.attendance).toBeNull()
    expect(g.venue).toBeNull()
    expect(g.headline).toBeNull()
    expect(g.leaders).toEqual([])
    expect(g.espnUrl).toBeNull()
    expect(toGame({ id: '2' }, 'nfl')).toBeNull()
  })
})
