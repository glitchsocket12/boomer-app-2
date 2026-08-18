// Decides whether an event's text is talking about attending a sports game, and if so which
// team(s). Deliberately a pure dictionary lookup rather than an AI call: it runs on every event
// that hasn't been enriched yet, and CLAUDE.md rule 3 says don't spend tokens on something a
// lookup table answers. It is also why this lives in `_shared` — Deno bundles it into the
// enrich-event function on deploy, and vitest still tests it like any other shared helper.
//
// The job here is only to narrow the search. Detection returns *candidate* teams; the Edge
// Function then asks ESPN which of those actually played on the event's date, and the date is what
// really disambiguates. So a few extra candidates cost nothing (leagues are fetched once each,
// not once per team) while a missed team costs the whole feature. Bias is toward recall, with
// hard guards on the two failure modes that would produce nonsense.

import {
  GENERIC_LOCATIONS,
  LEAGUES,
  SPORTS_TEAMS,
  type LeagueId,
  type SportsTeam,
} from './sportsTeams.generated.ts'

/**
 * Words that turn "Rockies" into the baseball team rather than the mountains. Required for any
 * match weaker than a full team name. Kept specific on purpose — "play", "park", "field" and
 * "season" were tried and are far too common in ordinary event descriptions to carry the weight.
 */
const GAME_WORDS = [
  'game', 'games', 'gameday', 'vs', 'versus', 'beat', 'beats', 'won', 'win', 'lost', 'loss',
  'played', 'ticket', 'tickets', 'stadium', 'ballpark', 'arena', 'rink', 'bleachers', 'dugout',
  'kickoff', 'tipoff', 'tip off', 'first pitch', 'tailgate', 'tailgating', 'inning', 'innings',
  'halftime', 'overtime', 'playoff', 'playoffs', 'finals', 'championship', 'score', 'scored',
  'matchup', 'doubleheader', 'bowl', 'tournament', 'touchdown', 'home run', 'homer', 'watched',
  'sold out', 'box seats', 'season tickets', 'home game', 'away game', 'end zone', 'shutout',
]

/**
 * Mascots that are also ordinary English words. These only ever match as part of a full team name
 * ("Miami Heat", "Utah Jazz"), never bare — otherwise "the heat was brutal", "there was a fever
 * going around" and "we watched the sun set" all become sporting events. Everything here was
 * confirmed present in the generated dictionary; weather-ish names that are unmistakable next to a
 * game word (Avalanche, Lightning, Hurricanes, Cyclones) are deliberately NOT listed.
 */
const AMBIGUOUS_MASCOTS = new Set([
  'heat', 'jazz', 'magic', 'sun', 'suns', 'sky', 'dream', 'fever', 'liberty', 'mercury', 'wings',
  'storm', 'pride', 'orange', 'cardinal', 'thunder', 'wild', 'fire', 'fires', 'blues', 'reds',
  'stars', 'wave', 'waves', 'beach', 'tribe', 'twins', 'bucks', 'crimson', 'gold', 'blue',
  'big red', 'rush', 'flash', 'spirit', 'force', 'union', 'city', 'express', 'tempo', 'norse',
])

export type MatchStrength = 'strong' | 'weak'

export type DetectedTeam = {
  team: SportsTeam
  /**
   * `strong` — the full team name appeared, or both the place and the mascot did. Trusted on its
   * own. `weak` — only a mascot or only a school name, plus a game word somewhere.
   */
  strength: MatchStrength
}

/** Lowercase, drop punctuation, collapse whitespace. "St. John's Red Storm" -> "st john s red storm". */
function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

/** Whole-phrase containment. Padding both sides is what stops "UteS" matching inside "commUTES". */
function containsPhrase(paddedHaystack: string, phrase: string): boolean {
  if (!phrase) return false
  return paddedHaystack.includes(` ${phrase} `)
}

type Index = {
  byName: Map<string, SportsTeam[]>
  byMascot: Map<string, SportsTeam[]>
  byLocation: Map<string, SportsTeam[]>
}

function push(map: Map<string, SportsTeam[]>, key: string, team: SportsTeam) {
  if (!key) return
  const existing = map.get(key)
  if (existing) existing.push(team)
  else map.set(key, [team])
}

// Built once per isolate, not per call — an Edge Function instance enriches many events.
let cachedIndex: Index | null = null

function getIndex(): Index {
  if (cachedIndex) return cachedIndex
  const index: Index = { byName: new Map(), byMascot: new Map(), byLocation: new Map() }
  for (const team of SPORTS_TEAMS) {
    push(index.byName, normalize(team.name), team)
    push(index.byMascot, normalize(team.mascot), team)
    const location = normalize(team.location)
    // Generic city and state names are never a game signal on their own — see GENERIC_LOCATIONS.
    // School names ("LSU", "Gonzaga", "Notre Dame") survive and are genuinely useful.
    if (!GENERIC_LOCATIONS.has(location)) push(index.byLocation, location, team)
  }
  cachedIndex = index
  return index
}

export function hasGameWord(text: string): boolean {
  const haystack = ` ${normalize(text)} `
  return GAME_WORDS.some((word) => containsPhrase(haystack, normalize(word)))
}

/**
 * Finds candidate teams mentioned in an event's text. Returns strong matches alone when there are
 * any, so "Colorado Rockies" never gets diluted by a stray "Buffaloes" elsewhere in the notes.
 */
export function detectSportsTeams(text: string | null | undefined): DetectedTeam[] {
  if (!text) return []
  const haystack = ` ${normalize(text)} `
  if (haystack.trim().length === 0) return []

  const index = getIndex()
  const strong = new Map<string, SportsTeam>()
  const weak = new Map<string, SportsTeam>()

  for (const [name, teams] of index.byName) {
    if (containsPhrase(haystack, name)) for (const t of teams) strong.set(t.league + t.id, t)
  }

  for (const [mascot, teams] of index.byMascot) {
    if (!containsPhrase(haystack, mascot)) continue
    for (const t of teams) {
      // "Colorado ... the Buffaloes were great" — place and mascot both present but not adjacent,
      // which the full-name pass above can't see. As trustworthy as the full name.
      if (containsPhrase(haystack, normalize(t.location))) strong.set(t.league + t.id, t)
      else if (!AMBIGUOUS_MASCOTS.has(mascot)) weak.set(t.league + t.id, t)
    }
  }

  for (const [location, teams] of index.byLocation) {
    if (containsPhrase(haystack, location)) for (const t of teams) weak.set(t.league + t.id, t)
  }

  if (strong.size > 0) return sorted(strong, 'strong')
  if (weak.size > 0 && hasGameWord(text)) return sorted(weak, 'weak')
  return []
}

/**
 * Pro teams first, then alphabetical by league and id for stability. "Broncos game" matches the
 * Denver Broncos and nine college Broncos; when something downstream has to keep only the first
 * few, the pro team is overwhelmingly the one meant.
 */
function sorted(teams: Map<string, SportsTeam>, strength: MatchStrength): DetectedTeam[] {
  return [...teams.values()]
    .sort(
      (a, b) =>
        Number(LEAGUES[b.league].pro) - Number(LEAGUES[a.league].pro) ||
        a.league.localeCompare(b.league) ||
        a.id.localeCompare(b.id),
    )
    .map((team) => ({ team, strength }))
}

/** The distinct leagues to ask ESPN about — one scoreboard fetch each, however many teams matched. */
export function leaguesToSearch(detected: DetectedTeam[]): LeagueId[] {
  return [...new Set(detected.map((d) => d.team.league))].sort()
}
