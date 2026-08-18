import { describe, expect, it } from 'vitest'
import { detectSportsTeams, hasGameWord, leaguesToSearch } from './sportsDetect.ts'

const names = (text: string) => detectSportsTeams(text).map((d) => `${d.team.league}:${d.team.name}`)
const leagues = (text: string) => leaguesToSearch(detectSportsTeams(text))

describe('detectSportsTeams', () => {
  it('returns nothing for empty or contentless input', () => {
    expect(detectSportsTeams(null)).toEqual([])
    expect(detectSportsTeams(undefined)).toEqual([])
    expect(detectSportsTeams('')).toEqual([])
    expect(detectSportsTeams('   ')).toEqual([])
  })

  it('matches a full team name on its own, with no game word needed', () => {
    const got = detectSportsTeams('Took Dad to see the Colorado Rockies for his birthday')
    expect(got.map((d) => d.team.name)).toContain('Colorado Rockies')
    expect(got.every((d) => d.strength === 'strong')).toBe(true)
  })

  it('matches a bare mascot when a game word is present', () => {
    const got = detectSportsTeams('Rockies game with the whole family')
    expect(got.map((d) => d.team.name)).toContain('Colorado Rockies')
    expect(got.every((d) => d.strength === 'weak')).toBe(true)
  })

  it('ignores a bare mascot with no game word at all', () => {
    expect(detectSportsTeams('Drove through the Rockies on the way to Aspen')).toEqual([])
  })

  it('treats a place and a mascot mentioned separately as a strong match', () => {
    const got = detectSportsTeams('Flew to Colorado in July. The Buffaloes were unbeatable that day.')
    const buffs = got.filter((d) => d.team.name === 'Colorado Buffaloes')
    expect(buffs.length).toBeGreaterThan(0)
    expect(buffs.every((d) => d.strength === 'strong')).toBe(true)
  })

  it('prefers strong matches and drops weak ones entirely when both exist', () => {
    const got = detectSportsTeams('Denver Broncos game — the Bulldogs fan next to us was loud')
    expect(got.every((d) => d.strength === 'strong')).toBe(true)
    expect(got.map((d) => d.team.name)).toContain('Denver Broncos')
    expect(got.map((d) => d.team.mascot)).not.toContain('Bulldogs')
  })
})

describe('guards against false positives', () => {
  it('never matches a generic city or state on its own', () => {
    // Would otherwise turn every trip in a Denver-based account into a sporting event.
    expect(detectSportsTeams('Weekend in Denver, great tickets to the symphony')).toEqual([])
    expect(detectSportsTeams('Drove across Colorado. Beat the traffic.')).toEqual([])
    expect(detectSportsTeams('Trip to Utah, watched the sunset')).toEqual([])
  })

  it('matches a school name, which is never a generic place', () => {
    const got = names('Went to the LSU game with Bob')
    expect(got.some((n) => n.includes('LSU Tigers'))).toBe(true)
    expect(names('Gonzaga game in March')).toContain('ncaam:Gonzaga Bulldogs')
  })

  it('will not match a mascot that is an ordinary English word', () => {
    // "heat", "fever", "sun", "storm" all have a game word nearby here and must still be ignored.
    expect(detectSportsTeams('The heat was brutal — worst game of tennis I have played')).toEqual([])
    expect(detectSportsTeams('Kids had a fever, we watched a movie')).toEqual([])
    expect(detectSportsTeams('Watched the sun go down over the stadium')).toEqual([])
    expect(detectSportsTeams('Storm rolled in and they called the game')).toEqual([])
  })

  it('still matches those teams by their full name', () => {
    expect(names('Miami Heat game')).toContain('nba:Miami Heat')
    expect(names('Utah Jazz vs the Nuggets')).toContain('nba:Utah Jazz')
  })

  it('respects word boundaries', () => {
    // "Utes" must not match inside "commutes", nor "Reds" inside "hundreds".
    expect(detectSportsTeams('Long commutes to the game every week')).toEqual([])
    expect(detectSportsTeams('Hundreds of people at the game')).toEqual([])
  })
})

describe('nickname collisions across leagues', () => {
  // The 6 nicknames shared by two pro leagues. Detection deliberately returns BOTH — the event's
  // date is what resolves it, once ESPN says which of them actually played that day.
  it('returns both leagues for a shared pro nickname', () => {
    expect(leagues('Giants game')).toEqual(expect.arrayContaining(['mlb', 'nfl']))
    expect(leagues('Rangers game')).toEqual(expect.arrayContaining(['mlb', 'nhl']))
    expect(leagues('Kings game')).toEqual(expect.arrayContaining(['nba', 'nhl']))
  })

  it('collapses to one league once the city is named too', () => {
    const got = detectSportsTeams('San Francisco Giants game')
    expect(got.map((d) => d.team.name)).toEqual(['San Francisco Giants'])
    expect(leaguesToSearch(got)).toEqual(['mlb'])
  })

  it('puts the pro team first when a mascot is shared with colleges', () => {
    // "Broncos" is Denver plus nine colleges. Anything downstream that keeps only the first few
    // candidates must not drop the one the user almost certainly meant.
    expect(names('Broncos game with Steve')[0]).toBe('nfl:Denver Broncos')
    expect(names('Tigers game on Saturday')[0]).toBe('mlb:Detroit Tigers')
  })

  it('groups a shared college mascot into few enough leagues to be worth searching', () => {
    // "Tigers" is ~49 teams, but only a handful of distinct leagues — and leagues, not teams,
    // are what cost an HTTP fetch. This is the case that makes over-detection cheap.
    const got = leagues('Tigers game on Saturday')
    expect(got.length).toBeLessThanOrEqual(5)
    expect(got).toEqual(expect.arrayContaining(['mlb']))
  })
})

describe('hasGameWord', () => {
  it('recognises the obvious ones', () => {
    expect(hasGameWord('we had great seats, first pitch was at 7')).toBe(true)
    expect(hasGameWord('bought tickets')).toBe(true)
    expect(hasGameWord('sold out stadium')).toBe(true)
  })

  it('does not fire on ordinary event text', () => {
    expect(hasGameWord('Dinner at the Italian place with Mom and Dad')).toBe(false)
    expect(hasGameWord('Anniversary trip to the coast')).toBe(false)
  })
})
