// The two enrichment boxes under an event's date/location line: the game it was, and that day's
// weather. Founder ask, 2026-08-17. Both are filled by the enrich-event Edge Function and cached
// on the moment row, so this component only renders what it is handed — it never fetches.
//
// Kept visually distinct from the description and notes above it on purpose. Everything else on
// this page is the user's own words; this is looked-up outside data, and the app's no-fabrication
// rule means it should never be mistakable for something they said.

import { border, colors, fontFamily, fontSize, radius, shadow, space } from '../lib/theme'
import RefreshButton from './RefreshButton'

export type EnrichmentTeam = {
  id: string
  name: string
  score: number | null
  homeAway: string | null
  winner: boolean
  record: string | null
}

export type EnrichmentGame = {
  // `too_soon` = the event hasn't happened yet. Renders as nothing, same as `not_found`, but the
  // Edge Function treats it as revisitable once the date passes.
  status: 'ok' | 'not_found' | 'too_soon'
  league?: string
  leagueLabel?: string
  espnId?: string
  name?: string
  shortName?: string
  startsAt?: string | null
  statusText?: string | null
  completed?: boolean
  venue?: string | null
  venueCity?: string | null
  venueState?: string | null
  attendance?: number | null
  teams?: EnrichmentTeam[]
  headline?: string | null
  headlineDetail?: string | null
  leaders?: string[]
  espnUrl?: string | null
}

export type EnrichmentWeather = {
  // `too_soon` = the event hasn't happened yet. Renders as nothing, same as `not_found`, but the
  // Edge Function treats it as revisitable once the date passes.
  status: 'ok' | 'not_found' | 'too_soon'
  date?: string
  place?: { name: string; region: string | null }
  highF?: number | null
  lowF?: number | null
  precipInches?: number | null
  windMph?: number | null
  condition?: string | null
  atTimeF?: number
  atTimeLabel?: string
}

const isOk = (v: { status: string } | null | undefined) => Boolean(v && v.status === 'ok')

const round = (n: number | null | undefined) =>
  n === null || n === undefined ? null : Math.round(n)

// ---------------------------------------------------------------------------------------------

function GameBox({
  game,
  readOnly,
  refreshing,
  onRefresh,
}: {
  game: EnrichmentGame
  readOnly: boolean
  refreshing: boolean
  onRefresh: () => void
}) {
  const teams = game.teams ?? []
  // ESPN lists competitors home-first; reading "away at home" matches how a scoreboard reads.
  const ordered = [...teams].sort((a, b) => (a.homeAway === 'away' ? -1 : 0) - (b.homeAway === 'away' ? -1 : 0))
  // A game that hasn't been played reports 0–0, which renders as a real final score of nil-nil.
  // Show the matchup and the start time instead until ESPN says it's done.
  const played = game.completed === true
  const startLabel =
    !played && game.startsAt
      ? new Date(game.startsAt).toLocaleString('en-US', {
          month: 'short',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
        })
      : null

  return (
    <section style={styles.box} aria-label="Game details">
      <div style={styles.boxHeaderRow}>
        <span style={styles.boxLabel}>{game.leagueLabel ?? 'Game'}</span>
        {!readOnly && <RefreshButton label="Refresh game details" onClick={onRefresh} refreshing={refreshing} />}
      </div>

      <div style={styles.scoreRow}>
        {ordered.map((t) => (
          <div key={t.id} style={styles.scoreLine}>
            <span style={played && t.winner ? styles.teamWon : styles.team}>{t.name}</span>
            {played && t.score !== null && t.score !== undefined && (
              <span style={t.winner ? styles.scoreWon : styles.score}>{t.score}</span>
            )}
          </div>
        ))}
      </div>

      <p style={styles.factLine}>
        {[
          startLabel ?? game.statusText,
          game.venue,
          [game.venueCity, game.venueState].filter(Boolean).join(', ') || null,
          typeof game.attendance === 'number' ? `${game.attendance.toLocaleString()} in attendance` : null,
        ]
          .filter(Boolean)
          .join(' · ')}
      </p>

      {game.headline && <p style={styles.headline}>{game.headline}</p>}

      {(game.leaders ?? []).length > 0 && (
        <ul style={styles.leaderList}>
          {game.leaders!.map((l) => (
            <li key={l} style={styles.leaderItem}>
              {l}
            </li>
          ))}
        </ul>
      )}

      {game.espnUrl && (
        <a href={game.espnUrl} target="_blank" rel="noopener noreferrer" style={styles.link}>
          View the full summary on ESPN →
        </a>
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------------------------

function WeatherBox({
  weather,
  readOnly,
  refreshing,
  onRefresh,
}: {
  weather: EnrichmentWeather
  readOnly: boolean
  refreshing: boolean
  onRefresh: () => void
}) {
  const high = round(weather.highF)
  const low = round(weather.lowF)
  const precip = weather.precipInches ?? 0
  const wind = round(weather.windMph)

  return (
    <section style={styles.box} aria-label="Weather that day">
      <div style={styles.boxHeaderRow}>
        <span style={styles.boxLabel}>That day's weather</span>
        {!readOnly && <RefreshButton label="Refresh weather" onClick={onRefresh} refreshing={refreshing} />}
      </div>

      <p style={styles.weatherHeadline}>
        {high !== null && <span style={styles.temp}>{high}°</span>}
        {low !== null && <span style={styles.tempLow}> / {low}°</span>}
        {weather.condition && <span style={styles.condition}> {weather.condition}</span>}
      </p>

      <p style={styles.factLine}>
        {[
          weather.atTimeF !== undefined && weather.atTimeLabel
            ? `${round(weather.atTimeF)}° at ${weather.atTimeLabel}`
            : null,
          precip > 0 ? `${precip.toFixed(2)} in. precipitation` : 'No precipitation',
          wind !== null ? `wind to ${wind} mph` : null,
        ]
          .filter(Boolean)
          .join(' · ')}
      </p>

      {/* Naming the place and date we actually looked up is the guard against a quietly wrong
          answer: an event with a guessed date or a vague location shows its own evidence. */}
      <p style={styles.caption}>
        {[weather.place?.name, weather.place?.region].filter(Boolean).join(', ')}
        {' · Weather data by '}
        <a href="https://open-meteo.com/" target="_blank" rel="noopener noreferrer" style={styles.captionLink}>
          Open-Meteo
        </a>
      </p>
    </section>
  )
}

// ---------------------------------------------------------------------------------------------

function GamePicker({
  candidates,
  choosing,
  onChoose,
  onDismiss,
}: {
  candidates: EnrichmentGame[]
  choosing: string | null
  onChoose: (game: EnrichmentGame) => void
  onDismiss: () => void
}) {
  return (
    <section style={styles.pickerBox} aria-label="Choose the game">
      <div style={styles.boxHeaderRow}>
        <span style={styles.pickerLabel}>Which game was this?</span>
      </div>
      <p style={styles.pickerHint}>
        More than one game matches what you wrote and the date. Pick the right one and we'll pull in
        the score and the recap.
      </p>
      <div style={styles.pickerList}>
        {candidates.map((c) => (
          <button
            key={`${c.league}-${c.espnId}`}
            onClick={() => onChoose(c)}
            disabled={choosing !== null}
            style={styles.pickerOption}
          >
            <span style={styles.pickerOptionTitle}>{c.name}</span>
            <span style={styles.pickerOptionMeta}>
              {[c.leagueLabel, c.venue, [c.venueCity, c.venueState].filter(Boolean).join(', ') || null]
                .filter(Boolean)
                .join(' · ')}
            </span>
          </button>
        ))}
      </div>
      <button onClick={onDismiss} disabled={choosing !== null} style={styles.dismissButton}>
        × None of these — this wasn't a game
      </button>
    </section>
  )
}

// ---------------------------------------------------------------------------------------------

export default function EventEnrichmentBoxes({
  game,
  gameCandidates,
  weather,
  gameDismissed,
  readOnly = false,
  refreshing = false,
  choosing = null,
  onRefresh,
  onChooseGame,
  onDismissGame,
}: {
  game: EnrichmentGame | null
  gameCandidates: EnrichmentGame[] | null
  weather: EnrichmentWeather | null
  gameDismissed: boolean
  readOnly?: boolean
  refreshing?: boolean
  choosing?: string | null
  onRefresh: () => void
  onChooseGame: (game: EnrichmentGame) => void
  onDismissGame: () => void
}) {
  const showGame = isOk(game)
  const showWeather = isOk(weather)
  const showPicker =
    !readOnly && !gameDismissed && !showGame && (gameCandidates?.length ?? 0) > 0

  if (!showGame && !showWeather && !showPicker) return null

  return (
    <div style={styles.wrap}>
      {showGame && (
        <GameBox game={game!} readOnly={readOnly} refreshing={refreshing} onRefresh={onRefresh} />
      )}
      {showPicker && (
        <GamePicker
          candidates={gameCandidates!}
          choosing={choosing}
          onChoose={onChooseGame}
          onDismiss={onDismissGame}
        />
      )}
      {showWeather && (
        <WeatherBox
          weather={weather!}
          readOnly={readOnly}
          refreshing={refreshing}
          onRefresh={onRefresh}
        />
      )}
    </div>
  )
}

const styles: { [key: string]: React.CSSProperties } = {
  // Side by side when there's room, stacked on a phone — the founder's ask was "next to the
  // date/location", and on a narrow screen that means directly beneath it.
  wrap: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: space.lg,
    marginBottom: space.xxxl,
  },
  box: {
    flex: '1 1 260px',
    minWidth: 0,
    backgroundColor: colors.surface,
    border: border.default,
    borderRadius: radius.lg,
    padding: '0.85rem 1rem',
    boxShadow: shadow.card,
  },
  boxHeaderRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
    marginBottom: space.md,
  },
  boxLabel: {
    fontSize: fontSize.tiny,
    fontWeight: 700,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    color: colors.textMuted,
  },
  scoreRow: { display: 'flex', flexDirection: 'column', gap: space.xxs, marginBottom: space.md },
  scoreLine: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: space.md },
  team: { fontSize: fontSize.bodyLg, color: colors.textBody },
  teamWon: { fontSize: fontSize.bodyLg, color: colors.ink, fontWeight: 700 },
  score: { fontSize: fontSize.lead, color: colors.textBody, fontVariantNumeric: 'tabular-nums' },
  scoreWon: {
    fontSize: fontSize.lead,
    color: colors.ink,
    fontWeight: 700,
    fontVariantNumeric: 'tabular-nums',
  },
  factLine: { margin: `0 0 ${space.md} 0`, fontSize: fontSize.small, color: colors.textMuted },
  headline: { margin: `0 0 ${space.md} 0`, fontSize: fontSize.body, color: colors.textBody },
  leaderList: { margin: `0 0 ${space.md} 0`, padding: '0 0 0 1rem' },
  leaderItem: { fontSize: fontSize.small, color: colors.textMuted, margin: '0.1rem 0' },
  link: { fontSize: fontSize.body, color: colors.primary, textDecoration: 'none', fontWeight: 600 },

  weatherHeadline: { margin: `0 0 ${space.xs} 0` },
  temp: { fontSize: fontSize.h3, color: colors.ink, fontWeight: 700 },
  tempLow: { fontSize: fontSize.lead, color: colors.textFaint },
  condition: { fontSize: fontSize.bodyLg, color: colors.textBody },
  caption: { margin: 0, fontSize: fontSize.tiny, color: colors.textFaint },
  captionLink: { color: colors.textFaint, textDecoration: 'underline' },

  // Gold, matching every other "needs your attention" surface in the app (suggestion chips,
  // pending-review copy) rather than inventing a new colour for this one case.
  pickerBox: {
    flex: '1 1 100%',
    backgroundColor: colors.suggestBg,
    border: border.suggest,
    borderRadius: radius.lg,
    padding: '0.85rem 1rem',
  },
  pickerLabel: { fontSize: fontSize.bodyLg, fontWeight: 700, color: colors.suggestDeep },
  pickerHint: { margin: `0 0 ${space.lg} 0`, fontSize: fontSize.body, color: colors.suggest },
  pickerList: { display: 'flex', flexDirection: 'column', gap: space.md, marginBottom: space.lg },
  pickerOption: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: space.xxs,
    textAlign: 'left',
    width: '100%',
    padding: '0.5rem 0.7rem',
    borderRadius: radius.md,
    border: border.suggest,
    backgroundColor: colors.surface,
    cursor: 'pointer',
    fontFamily,
  },
  pickerOptionTitle: { fontSize: fontSize.body, fontWeight: 600, color: colors.ink },
  pickerOptionMeta: { fontSize: fontSize.small, color: colors.textMuted },
  dismissButton: {
    fontSize: fontSize.label,
    background: 'none',
    border: 'none',
    color: colors.danger,
    cursor: 'pointer',
    padding: 0,
    fontFamily,
  },
}
