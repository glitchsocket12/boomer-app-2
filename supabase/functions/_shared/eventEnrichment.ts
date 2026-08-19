// The outside-world half of event enrichment: turning an event's date and text into a real game
// (ESPN) and that day's weather (Open-Meteo). Split out of enrich-event/index.ts so it can be
// exercised directly — index.ts calls serve() at module scope, so importing it to test anything
// would start a server.
//
// Both providers are fragile in different ways and both are contained here on purpose:
//   - ESPN publishes no official public API. These endpoints are undocumented and unsupported.
//   - Open-Meteo's free tier is non-commercial only (CC-BY attribution required).
// Swapping either one is an edit to this file alone.

import { leaguesToSearch, type DetectedTeam } from './sportsDetect.ts'
import { LEAGUES, type LeagueId } from './sportsTeams.generated.ts'

export const NOT_FOUND = { status: 'not_found' } as const

/**
 * "Nothing to look up YET" — an event dated in the future. Distinct from NOT_FOUND because it is
 * temporary: the weather archive only covers up to today (it answers a future date with a hard
 * 400), and the score of a game that hasn't been played is 0–0. Storing a sentinel rather than
 * leaving the column null is what stops a future-dated event from re-hitting both providers on
 * every single page view forever; the frontend re-checks it once the date has actually passed.
 */
export const TOO_SOON = { status: 'too_soon' } as const

/** Today in UTC, as YYYY-MM-DD. */
export function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

/** More than this and a picker stops being a choice and starts being a list. */
export const MAX_CANDIDATES = 6

// ---------------------------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------------------------

/** "2025-07-04" -> "20250704", the only date format ESPN's scoreboard accepts. */
export function toEspnDate(isoDate: string): string {
  return isoDate.replace(/-/g, '')
}

/** Shifts a plain YYYY-MM-DD by whole days without ever touching local time. */
export function shiftDate(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** Inclusive day count: a single day is 1, not 0. */
export function daysInSpan(startIso: string, endIso: string): number {
  const ms = Date.parse(`${endIso}T00:00:00Z`) - Date.parse(`${startIso}T00:00:00Z`)
  return Math.floor(ms / 86_400_000) + 1
}

/**
 * A trip longer than this is a data-entry error, not a trip. Capping is what stops one mistyped
 * end date from asking the weather archive for a decade and then rendering a day-by-day list
 * nobody could read.
 */
export const MAX_SPAN_DAYS = 31

export type DatedRow = { event_date: string | null; event_end_date?: string | null }

/**
 * The whole stretch of days an event covers, including everything its sub-events cover.
 *
 * Sub-events are what actually pin down a trip's shape (founder ask, 2026-08-17: the parent
 * event's weather should summarize the whole weekend, not just its first day). A parent row
 * routinely carries a start date and no end — "Sid and Kate's Wedding" is stored as one day while
 * its six sub-events between them run Thursday to Sunday — and a calendar-imported parent can
 * carry no date at all while its children are fully dated.
 *
 * MIRRORED at src/lib/eventSpan.ts, because Deno can't import from src/. Keep the two in sync;
 * src/lib/eventSpanParity.test.ts is what stops them drifting.
 */
export function eventSpan(
  moment: DatedRow,
  children: DatedRow[] = [],
): { start: string; end: string } | null {
  let start: string | null = null
  let end: string | null = null

  for (const row of [moment, ...children]) {
    const rowStart = row.event_date
    if (!rowStart) continue
    // An end date BEFORE its start is real in this data (one event is stored 2026-09-12 ->
    // 2026-08-15). Trusting it would invert the span and ask for a negative range, so a backwards
    // end is simply ignored rather than used.
    const rowEnd =
      row.event_end_date && row.event_end_date >= rowStart ? row.event_end_date : rowStart
    if (!start || rowStart < start) start = rowStart
    if (!end || rowEnd > end) end = rowEnd
  }

  if (!start || !end) return null
  return {
    start,
    end: daysInSpan(start, end) > MAX_SPAN_DAYS ? shiftDate(start, MAX_SPAN_DAYS - 1) : end,
  }
}

/** The days the weather archive can actually answer for, or why it can't. */
export type WeatherWindow =
  | { kind: 'none' }
  | { kind: 'too_soon' }
  | { kind: 'ok'; start: string; end: string }

/**
 * An event's span, stopped at today, because the archive answers a future date with a hard 400.
 *
 * A trip that has started but not finished therefore gets a window shorter than the trip. That is
 * on purpose: the stored weather then no longer matches the full window tomorrow, `coversWindow`
 * says so, and the remaining days fill themselves in without anyone touching the refresh button.
 *
 * MIRRORED at src/lib/eventSpan.ts — see eventSpan above.
 */
export function weatherWindow(
  moment: DatedRow,
  children: DatedRow[],
  today: string,
): WeatherWindow {
  const span = eventSpan(moment, children)
  if (!span) return { kind: 'none' }
  if (span.start > today) return { kind: 'too_soon' }
  return { kind: 'ok', start: span.start, end: span.end > today ? today : span.end }
}

/**
 * Whether a stored weather value still covers the whole window. False is what re-fetches, so the
 * `kind !== 'ok'` cases answer true — a stored `too_soon` on a still-future event is handled by
 * its own rule, and re-running a lookup that has nothing to look up would just churn.
 *
 * MIRRORED at src/lib/eventSpan.ts — see eventSpan above.
 */
export function coversWindow(
  weather: { date?: string | null; endDate?: string | null } | null | undefined,
  window: WeatherWindow,
): boolean {
  if (window.kind !== 'ok') return true
  if (!weather?.date) return false
  return weather.date === window.start && (weather.endDate ?? weather.date) === window.end
}

// ---------------------------------------------------------------------------------------------
// ESPN
// ---------------------------------------------------------------------------------------------

export type EspnGame = {
  status: 'ok'
  league: LeagueId
  leagueLabel: string
  espnId: string
  name: string
  shortName: string
  startsAt: string | null
  statusText: string | null
  completed: boolean
  venue: string | null
  /** Kept apart from the venue because the CITY is what the geocoder can actually resolve. */
  venueCity: string | null
  venueState: string | null
  attendance: number | null
  teams: {
    id: string
    name: string
    score: number | null
    homeAway: string | null
    winner: boolean
    record: string | null
  }[]
  headline: string | null
  headlineDetail: string | null
  leaders: string[]
  espnUrl: string | null
}

/**
 * One ESPN game-day slate for one league. Queried a single day at a time on purpose: ESPN's
 * `dates=A-B` range form works, but it collapses the day grouping, and its per-event timestamp is
 * UTC — a 7pm Denver game reports as the following calendar day. Asking for one day at a time lets
 * ESPN do the local-date grouping (which it gets right) instead of reimplementing venue timezones.
 */
export async function fetchScoreboard(league: LeagueId, isoDate: string): Promise<any[]> {
  const url =
    `https://site.api.espn.com/apis/site/v2/sports/${LEAGUES[league].path}/scoreboard` +
    `?dates=${toEspnDate(isoDate)}&limit=400`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`ESPN ${league} ${res.status}`)
  const json = await res.json()
  return Array.isArray(json?.events) ? json.events : []
}

export function toGame(event: any, league: LeagueId): EspnGame | null {
  const competition = event?.competitions?.[0]
  if (!competition) return null

  const headline = competition.headlines?.[0] ?? null
  const linkFor = (rel: string) =>
    (event.links ?? []).find((l: any) => Array.isArray(l.rel) && l.rel.includes(rel))?.href ?? null

  return {
    status: 'ok',
    league,
    leagueLabel: LEAGUES[league].label,
    espnId: String(event.id),
    name: event.name ?? '',
    shortName: event.shortName ?? '',
    startsAt: event.date ?? null,
    statusText: event.status?.type?.description ?? null,
    completed: Boolean(event.status?.type?.completed),
    venue: competition.venue?.fullName ?? null,
    venueCity: competition.venue?.address?.city ?? null,
    venueState: competition.venue?.address?.state ?? null,
    attendance: typeof competition.attendance === 'number' ? competition.attendance : null,
    teams: (competition.competitors ?? []).map((c: any) => ({
      id: String(c.team?.id ?? ''),
      name: c.team?.displayName ?? '',
      score: c.score === undefined || c.score === null ? null : Number(c.score),
      homeAway: c.homeAway ?? null,
      winner: Boolean(c.winner),
      record: c.records?.[0]?.summary ?? null,
    })),
    headline: headline?.shortLinkText ?? headline?.description ?? null,
    headlineDetail: headline?.description ?? null,
    // "Adrian Houser — 8.0 IP, 0 ER, 4 H, 6 K" — the closest thing ESPN gives to a fun fact.
    leaders: (competition.leaders ?? [])
      .map((l: any) => {
        const top = l.leaders?.[0]
        if (!top?.displayValue || !top?.athlete?.displayName) return null
        return `${top.athlete.displayName} — ${top.displayValue}`
      })
      .filter(Boolean) as string[],
    // The "summary" rel is exactly the page the founder asked to link to.
    espnUrl: linkFor('summary') ?? linkFor('recap') ?? linkFor('boxscore'),
  }
}

/**
 * Finds the real games matching any detected team on a given day. Detection is intentionally
 * loose ("Broncos" is Denver plus nine colleges); this is the step that makes it precise, because
 * only one of those teams actually played on the event's date.
 */
export async function findGames(detected: DetectedTeam[], isoDate: string): Promise<EspnGame[]> {
  const wanted = new Map<string, DetectedTeam>()
  for (const d of detected) wanted.set(`${d.team.league}:${d.team.id}`, d)

  const found: { game: EspnGame; strong: boolean }[] = []

  // One fetch per league, not per team, and failures are per-league so a single bad response
  // can't sink the others.
  const slates = await Promise.all(
    leaguesToSearch(detected).map(async (league) => {
      try {
        return { league, events: await fetchScoreboard(league, isoDate) }
      } catch (e) {
        console.error('scoreboard fetch failed', league, isoDate, String(e))
        return { league, events: [] as any[] }
      }
    }),
  )

  for (const { league, events } of slates) {
    for (const event of events) {
      const competitors = event?.competitions?.[0]?.competitors ?? []
      const hit = competitors
        .map((c: any) => wanted.get(`${league}:${String(c.team?.id ?? '')}`))
        .find(Boolean) as DetectedTeam | undefined
      if (!hit) continue
      const game = toGame(event, league)
      if (game) found.push({ game, strong: hit.strength === 'strong' })
    }
  }

  // Strong name matches first, then pro leagues — the same reasoning as the detector's own sort,
  // so that trimming to MAX_CANDIDATES keeps the game the user most likely meant.
  found.sort(
    (a, b) =>
      Number(b.strong) - Number(a.strong) ||
      Number(LEAGUES[b.game.league].pro) - Number(LEAGUES[a.game.league].pro) ||
      a.game.espnId.localeCompare(b.game.espnId),
  )
  return found.map((f) => f.game)
}

export type GameResolution =
  | { kind: 'none' }
  | { kind: 'one'; game: EspnGame }
  | { kind: 'many'; candidates: EspnGame[] }

/**
 * Exact date first — the overwhelmingly common case, and one fetch per league. Only if that finds
 * nothing do we widen by a day, which covers both a timezone edge and the AI-guessed dates some
 * imported events carry. More than one hit is never resolved by guessing; it becomes the picker.
 */
export async function resolveGame(detected: DetectedTeam[], isoDate: string): Promise<GameResolution> {
  if (detected.length === 0) return { kind: 'none' }

  let hits = await findGames(detected, isoDate)
  if (hits.length === 0) {
    const neighbours = await Promise.all([
      findGames(detected, shiftDate(isoDate, -1)),
      findGames(detected, shiftDate(isoDate, 1)),
    ])
    hits = neighbours.flat()
  }

  if (hits.length === 0) return { kind: 'none' }
  if (hits.length === 1) return { kind: 'one', game: hits[0] }
  return { kind: 'many', candidates: hits.slice(0, MAX_CANDIDATES) }
}

// ---------------------------------------------------------------------------------------------
// Open-Meteo
// ---------------------------------------------------------------------------------------------

export type Place = {
  name: string
  latitude: number
  longitude: number
  timezone: string
  region: string | null
}

/**
 * Splits a free-text location into geocoder attempts, most specific first.
 *
 * Left to right matters. Open-Meteo's gazetteer takes a single place name, not an address —
 * "Coors Field, Denver, Colorado" returns nothing at all — so a multi-part string has to be tried
 * a piece at a time. Taking the LAST piece looks equally reasonable and is actively harmful: the
 * tail of a US address is the state, and searching "Colorado" returns Colorado City, *Texas*.
 * Real addresses put the specific part first, so that is the order we try.
 */
export function locationAttempts(location: string): string[] {
  const parts = location
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  return parts.length > 1 ? parts : [location.trim()].filter(Boolean)
}

/**
 * ESPN is not consistent about how it writes a venue's state, and the difference is invisible
 * until the weather box quietly stops appearing: MLB sends full names ("Pennsylvania", "Ontario")
 * while the NFL, NBA, NHL and college feeds all send two-letter codes ("GA", "CO", "MB"). Since
 * Open-Meteo always answers with the full name, a raw string comparison would match MLB games and
 * silently reject every other league. Anything unrecognised (an occasional international venue
 * reports a country, e.g. "Ireland") returns null, which callers treat as "don't guard" rather
 * than "reject everything".
 */
const REGION_BY_CODE: Record<string, string> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado',
  CT: 'Connecticut', DE: 'Delaware', DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia',
  HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas',
  KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts',
  MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana',
  NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico',
  NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma',
  OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota',
  TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington',
  WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
  ON: 'Ontario', QC: 'Quebec', BC: 'British Columbia', AB: 'Alberta', MB: 'Manitoba',
  SK: 'Saskatchewan', NS: 'Nova Scotia', NB: 'New Brunswick', NL: 'Newfoundland and Labrador',
  PE: 'Prince Edward Island', YT: 'Yukon', NT: 'Northwest Territories', NU: 'Nunavut',
}

const REGION_NAMES = new Set(Object.values(REGION_BY_CODE).map((n) => n.toLowerCase()))

/** "CO" and "Colorado" both -> "colorado". Unknown values -> null (meaning: don't guard on this). */
export function normalizeRegion(region: string | null | undefined): string | null {
  if (!region) return null
  const trimmed = region.trim()
  const byCode = REGION_BY_CODE[trimmed.toUpperCase()]
  if (byCode) return byCode.toLowerCase()
  const lower = trimmed.toLowerCase()
  return REGION_NAMES.has(lower) ? lower : null
}

/**
 * Place name(s) -> coordinates, taking the first attempt that resolves.
 *
 * `expectedRegion` (a state/province name) is the guard against confidently-wrong hits, and it is
 * needed more than you would think: "Oracle Park" resolves to Oracle, *Arizona*, nowhere near the
 * San Francisco ballpark. When the caller knows the region — which it does for any matched game,
 * because ESPN reports the venue's city and state — a result in the wrong one is skipped rather
 * than trusted. Several major venues ("MetLife Stadium", "Empower Field at Mile High") are absent
 * from the gazetteer entirely, which is the other reason callers should pass a city, not a venue.
 */
export async function geocode(
  attempts: string[],
  expectedRegion?: string | null,
): Promise<Place | null> {
  for (const attempt of attempts) {
    if (!attempt) continue
    const url =
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(attempt)}` +
      // Ten rather than one so a region mismatch can be corrected within the same response
      // instead of costing another request.
      `&count=10&language=en&format=json`
    const res = await fetch(url)
    if (!res.ok) continue
    const json = await res.json()
    const results: any[] = Array.isArray(json?.results) ? json.results : []
    if (results.length === 0) continue

    const wanted = normalizeRegion(expectedRegion)
    const hit = wanted
      ? results.find((r) => normalizeRegion(r.admin1) === wanted)
      : results[0]
    // A hit in the wrong region is worse than no hit — fall through to the next attempt.
    if (!hit) continue

    return {
      name: hit.name,
      latitude: hit.latitude,
      longitude: hit.longitude,
      timezone: hit.timezone ?? 'auto',
      region: [hit.admin1, hit.country].filter(Boolean).join(', ') || null,
    }
  }
  return null
}

// WMO weather interpretation codes. Open-Meteo returns the number; this is the whole reason the
// weather box can say "Overcast" instead of "3".
export const WEATHER_CODES: Record<number, string> = {
  0: 'Clear',
  1: 'Mainly clear',
  2: 'Partly cloudy',
  3: 'Overcast',
  45: 'Foggy',
  48: 'Freezing fog',
  51: 'Light drizzle',
  53: 'Drizzle',
  55: 'Heavy drizzle',
  56: 'Freezing drizzle',
  57: 'Freezing drizzle',
  61: 'Light rain',
  63: 'Rain',
  65: 'Heavy rain',
  66: 'Freezing rain',
  67: 'Freezing rain',
  71: 'Light snow',
  73: 'Snow',
  75: 'Heavy snow',
  77: 'Snow grains',
  80: 'Rain showers',
  81: 'Rain showers',
  82: 'Heavy rain showers',
  85: 'Snow showers',
  86: 'Heavy snow showers',
  95: 'Thunderstorm',
  96: 'Thunderstorm with hail',
  99: 'Thunderstorm with hail',
}

/** One day of a multi-day span. Absent entirely when the event was a single day. */
export type WeatherDay = {
  date: string
  highF: number | null
  lowF: number | null
  precipInches: number | null
  windMph: number | null
  condition: string | null
}

export type Weather = {
  status: 'ok'
  /** First day of the span that was actually requested. */
  date: string
  /**
   * Last day requested, set only when the span ran longer than a day. Stored even though it is
   * derivable from `days`, because it is what the app compares against to notice that a new
   * sub-event has stretched the trip and the cached weather no longer covers all of it.
   */
  endDate?: string
  place: Place
  /** Across the whole span: warmest high, coldest low, total rain, strongest wind. */
  highF: number | null
  lowF: number | null
  precipInches: number | null
  windMph: number | null
  condition: string | null
  /** Day by day, only for a multi-day span — a single-day event stays exactly as it was. */
  days?: WeatherDay[]
  /** Temperature at the game's start time — the one place in the app with a real time of day. */
  atTimeF?: number
  atTimeLabel?: string
}

/**
 * Rolls a run of days into the one line the box leads with.
 *
 * The headline condition is the one that covered the MOST days, not the worst one: an afternoon of
 * drizzle in the middle of a clear four-day weekend should not retitle the trip "Drizzle". Nothing
 * is hidden by preferring the typical day to the dramatic one, because every day is still listed
 * underneath. Ties go to whichever condition showed up first, which keeps the answer deterministic
 * (and therefore keeps a re-fetch from silently rewriting a summary that didn't change).
 */
export function summarizeWeatherDays(days: WeatherDay[]): {
  highF: number | null
  lowF: number | null
  precipInches: number | null
  windMph: number | null
  condition: string | null
} {
  const highs = days.map((d) => d.highF).filter((v): v is number => v !== null)
  const lows = days.map((d) => d.lowF).filter((v): v is number => v !== null)
  const precip = days.map((d) => d.precipInches).filter((v): v is number => v !== null)
  const winds = days.map((d) => d.windMph).filter((v): v is number => v !== null)

  const tally = new Map<string, number>()
  for (const d of days) if (d.condition) tally.set(d.condition, (tally.get(d.condition) ?? 0) + 1)
  let condition: string | null = null
  let best = 0
  // Insertion order is chronological, so the first-seen tie-break falls out of iterating the map.
  for (const [label, count] of tally) {
    if (count > best) {
      condition = label
      best = count
    }
  }

  return {
    highF: highs.length ? Math.max(...highs) : null,
    lowF: lows.length ? Math.min(...lows) : null,
    precipInches: precip.length ? precip.reduce((a, b) => a + b, 0) : null,
    windMph: winds.length ? Math.max(...winds) : null,
    condition,
  }
}

/**
 * One archive call covering the event's whole span. Open-Meteo returns a parallel array per day,
 * so a four-day trip costs exactly what one day used to — the range is free, only the geocode and
 * the round trip are not.
 */
export async function fetchWeather(
  place: Place,
  startIso: string,
  endIso: string,
  startsAt: string | null,
): Promise<Weather | null> {
  const params = new URLSearchParams({
    latitude: String(place.latitude),
    longitude: String(place.longitude),
    start_date: startIso,
    end_date: endIso,
    daily: 'temperature_2m_max,temperature_2m_min,precipitation_sum,weather_code,wind_speed_10m_max',
    temperature_unit: 'fahrenheit',
    wind_speed_unit: 'mph',
    precipitation_unit: 'inch',
    timezone: place.timezone,
  })
  // Only pay for the hourly series when there's a real clock time to look up.
  if (startsAt) params.set('hourly', 'temperature_2m')

  const res = await fetch(`https://archive-api.open-meteo.com/v1/archive?${params}`)
  if (!res.ok) throw new Error(`Open-Meteo ${res.status}`)
  const json = await res.json()
  const daily = json?.daily
  if (!daily?.time?.length) return null

  const all: WeatherDay[] = daily.time.map((date: string, i: number) => {
    const code = daily.weather_code?.[i]
    return {
      date,
      highF: daily.temperature_2m_max?.[i] ?? null,
      lowF: daily.temperature_2m_min?.[i] ?? null,
      precipInches: daily.precipitation_sum?.[i] ?? null,
      windMph: daily.wind_speed_10m_max?.[i] ?? null,
      condition: typeof code === 'number' ? (WEATHER_CODES[code] ?? null) : null,
    }
  })

  // A response can be shaped correctly and still carry nothing for a given day (a gap in the
  // record for that place). Those days are dropped rather than rendered as a bare "°"; if every
  // day is a gap there is no weather to show at all.
  const days = all.filter((d) => d.highF !== null || d.lowF !== null)
  if (days.length === 0) return null

  const weather: Weather = {
    status: 'ok',
    // The REQUESTED span, not the days that came back — this pair is what the app compares against
    // to decide the cache still covers the event, and a dropped gap-day must not make it re-fetch
    // the same missing data forever.
    date: startIso,
    place,
    ...summarizeWeatherDays(days),
  }

  if (endIso !== startIso) {
    weather.endDate = endIso
    weather.days = days
  }

  if (startsAt && json?.hourly?.time?.length) {
    // Open-Meteo returns hours local to the venue because we passed the place's timezone, so the
    // game's UTC kickoff has to be converted into that same zone before we can index into it.
    // "sv-SE" is the trick that gets a sortable "YYYY-MM-DD HH:mm:ss" back out of toLocaleString.
    const local = new Date(startsAt).toLocaleString('sv-SE', { timeZone: place.timezone })
    const index = json.hourly.time.indexOf(`${local.slice(0, 10)}T${local.slice(11, 13)}:00`)
    if (index >= 0 && json.hourly.temperature_2m?.[index] != null) {
      weather.atTimeF = json.hourly.temperature_2m[index]
      weather.atTimeLabel = new Date(startsAt).toLocaleTimeString('en-US', {
        timeZone: place.timezone,
        hour: 'numeric',
        minute: '2-digit',
      })
    }
  }

  return weather
}
