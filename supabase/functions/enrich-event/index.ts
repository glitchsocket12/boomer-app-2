// Fills the two enrichment boxes on an event page: the game it was (score, attendance, recap, and
// a link to the ESPN summary) and that day's weather. Founder ask, 2026-08-17.
//
// COST: zero Anthropic tokens. "Is this a sports game?" is a dictionary lookup in
// _shared/sportsDetect.ts, not a model call, and both external APIs are free tiers. That is
// deliberate under CLAUDE.md rule 3, and it has a useful side effect — this feature keeps working
// while ANTHROPIC_API_KEY is down, unlike every other enrichment in the app.
//
// CACHING: a past game's final score and a past day's weather never change, so a cache hit stays
// correct forever. This short-circuits on any non-null cached value unless {refresh:true}. See
// 2026-08-17-event-enrichment.sql for why "we looked and found nothing" is a stored value rather
// than a null.
//
// The provider calls all live in _shared/eventEnrichment.ts; this file is only auth, the cache
// decision, and the write-back.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { detectSportsTeams } from "../_shared/sportsDetect.ts"
import {
  coversWindow,
  fetchWeather,
  geocode,
  locationAttempts,
  NOT_FOUND,
  resolveGame,
  todayIso,
  TOO_SOON,
  weatherWindow,
  type DatedRow,
  type EspnGame,
} from "../_shared/eventEnrichment.ts"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  try {
    const { momentId, refresh } = await req.json()

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: req.headers.get("Authorization")! } } },
    )

    const [{ data: moment }, { data: childRows }] = await Promise.all([
      supabaseClient
        .from("moments")
        .select(
          "id, occasion, location, event_date, event_end_date, raw_description, weather, game, game_candidates, game_dismissed, notes(content)",
        )
        .eq("id", momentId)
        .single(),
      // The sub-events that make up this one, if any — they carry the dates and places the parent
      // row doesn't (founder ask, 2026-08-17: a trip's weather should cover the whole weekend).
      // Deliberately its own query rather than folded into the .single() above, for the same
      // reason summarize-moment splits it out: a select naming parent_moment_id 400s the WHOLE
      // moment read if that column isn't migrated on this database, which would take the game box
      // down with it. Failing open here costs only the roll-up.
      supabaseClient
        .from("moments")
        .select("location, event_date, event_end_date")
        .eq("parent_moment_id", momentId)
        .order("event_date", { ascending: true, nullsFirst: false }),
    ])
    const children = (childRows ?? []) as (DatedRow & { location: string | null })[]

    if (!moment) {
      return new Response(JSON.stringify({ error: "Moment not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    // A stored value is normally final — a past game's score and a past day's weather don't
    // change. The exception is a value written BEFORE the event happened: weather parked at
    // `too_soon` (the archive stops at today) and a game caught while still `Scheduled`, whose
    // stored score is a meaningless 0–0. Once the date has passed each is worth exactly one more
    // look. This lives here rather than in the caller so that an automatic re-check can't be
    // confused with the refresh button, which additionally un-dismisses the picker.
    const today = todayIso()
    const window = weatherWindow(moment as DatedRow, children, today)
    const past = moment.event_date ? moment.event_date <= today : false
    const gameStale = past && moment.game?.status === "ok" && moment.game?.completed === false
    // Three ways stored weather stops covering the event. The first is the original one — we
    // looked before it happened. The other two arrive with sub-events: adding a Sunday to a trip
    // that ended Saturday stretches the span past what was already fetched, and a trip still under
    // way was only fetched as far as the archive reached, so it fills in a day at a time.
    const weatherStale =
      (past && moment.weather?.status === "too_soon") ||
      (moment.weather?.status === "ok" && !coversWindow(moment.weather, window))

    const wantGame =
      Boolean(refresh) || (moment.game === null && moment.game_candidates === null) || gameStale
    const wantWeather = Boolean(refresh) || moment.weather === null || weatherStale

    if (!wantGame && !wantWeather) {
      return new Response(
        JSON.stringify({
          weather: moment.weather,
          game: moment.game,
          gameCandidates: moment.game_candidates,
          cached: true,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      )
    }

    const update: Record<string, unknown> = {}
    let game = moment.game as EspnGame | typeof NOT_FOUND | null

    // --- Game -------------------------------------------------------------------------------
    // Wrapped independently of weather below: an ESPN outage must not cost the weather box. A
    // thrown failure deliberately writes nothing, leaving the column null so the next view retries.
    if (wantGame) {
      try {
        const text = [
          moment.occasion,
          moment.raw_description,
          ...((moment.notes ?? []) as { content: string | null }[]).map((n) => n.content),
        ]
          .filter(Boolean)
          .join("\n")

        const resolution = moment.event_date
          ? await resolveGame(detectSportsTeams(text), moment.event_date)
          : ({ kind: "none" } as const)

        if (resolution.kind === "one") {
          game = resolution.game
          update.game = resolution.game
          update.game_candidates = null
        } else if (resolution.kind === "many") {
          // Never guess between real games — that's what the picker is for.
          game = null
          update.game = null
          update.game_candidates = resolution.candidates
        } else {
          game = NOT_FOUND
          update.game = NOT_FOUND
          update.game_candidates = null
        }

        update.game_fetched_at = new Date().toISOString()
        // An explicit refresh is also how you undo a mistaken "not a game".
        if (refresh) update.game_dismissed = false
      } catch (e) {
        console.error("game enrichment failed", momentId, String(e))
      }
    }

    // --- Weather ----------------------------------------------------------------------------
    if (wantWeather) {
      try {
        // A matched game beats free text: ESPN reports the venue's CITY and STATE, which is
        // exactly the shape the geocoder wants, and it comes with a kickoff time. Note the venue
        // NAME is deliberately not used for the lookup — "Oracle Park" resolves to Arizona, and
        // several big stadiums aren't in the gazetteer at all.
        const confirmed = game && game.status === "ok" ? (game as EspnGame) : null
        // A parent event often has no location of its own while every one of its parts does — a
        // trip row called "Mary Alice Visit" whose only address lives on the day inside it. Falling
        // through to the first sub-event that names a place is what gets those a weather box at all.
        const ownLocation = moment.location || children.find((c) => c.location)?.location || null
        const attempts = confirmed?.venueCity
          ? [confirmed.venueCity]
          : ownLocation
            ? locationAttempts(ownLocation)
            : []

        // `window` (computed above) covers this event AND everything underneath it, so a parent
        // stored as a single day still gets the whole weekend it really was.
        if (window.kind === "none" || attempts.length === 0) {
          update.weather = NOT_FOUND
        } else if (window.kind === "too_soon") {
          // The archive answers a future date with a 400. Checking first turns a wasted round
          // trip into a stored sentinel the frontend knows to revisit once the day arrives.
          update.weather = TOO_SOON
        } else {
          const place = await geocode(attempts, confirmed?.venueState ?? null)
          const weather = place
            ? await fetchWeather(place, window.start, window.end, confirmed?.startsAt ?? null)
            : null
          update.weather = weather ?? NOT_FOUND
        }
        update.weather_fetched_at = new Date().toISOString()
      } catch (e) {
        console.error("weather enrichment failed", momentId, String(e))
      }
    }

    if (Object.keys(update).length > 0) {
      const { error } = await supabaseClient.from("moments").update(update).eq("id", momentId)
      if (error) console.error("enrichment save failed", momentId, error.message)
    }

    return new Response(
      JSON.stringify({
        weather: update.weather ?? moment.weather ?? null,
        game: update.game ?? moment.game ?? null,
        gameCandidates: update.game_candidates ?? moment.game_candidates ?? null,
        cached: false,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    )
  } catch (error) {
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }
})
