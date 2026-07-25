import { serve } from "https://deno.land/std@0.224.0/http/server.ts"
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2"
import { parseIcs, icsDateToIsoDate, icsEndDateToIsoDate, type IcsEvent } from "../_shared/ics.ts"
import { getUserTimeZone } from "../_shared/userSettings.ts"
import { isoDateInTimeZone } from "../_shared/tz.ts"
import { formatEventDateText } from "../_shared/eventDates.ts"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
}

const BATCH_SIZE = 30
const MAX_AGE_YEARS = 3
// Caps how many batches ONE invocation processes, so a big backlog (a fresh calendar connection
// can easily be 1000+ events) can't run the Edge Function past its execution timeout. Whatever's
// left over just gets picked up by the next run — manual "Sync now" or the next scheduled cron —
// since anything already written is in seenUids and won't be reprocessed.
const MAX_BATCHES_PER_RUN = 8

// Stable, zero-interpolation instructions — identical every batch, every user, every run. Its
// own cache_control breakpoint per CLAUDE.md's caching rules.
const stableInstructions = `You are screening raw calendar entries for an app that helps someone keep track of the people and moments in their life. You'll be given a JSON array of calendar events. For EACH one, decide whether it's worth suggesting as something to save, and extract a clean summary.

Favor real gatherings, trips, celebrations, and milestones involving other people. Skip generic solo logistics (a dentist appointment, a flight with no other detail, a work meeting, a reminder) UNLESS it clearly matches one of the founder's preferred categories given separately below — when in doubt on a borderline case, lean toward including it, since a human reviews every suggestion before anything is saved.

Don't guess at dates — the exact start/end date is already known from the calendar itself and is filled in separately; just focus on occasion, location, notes, and the tag/group suggestions below.

"suggested_tags": 1-3 short tags that fit this event. Prefer reusing an existing tag from the roster given separately below (case-insensitive match) over coining a near-duplicate; a genuinely new tag name is fine if nothing existing fits. Empty array if nothing fits.

"suggested_group": at most one group this event clearly belongs to, from the EXISTING groups roster given separately below — copy its name EXACTLY. A group is a recurring, ongoing affiliation (a school, team, workplace, military unit, or friend circle), not a one-off detail. Only set this when the event title/description clearly signals that recurring affiliation (e.g. an event named after a known group). Never invent a new group name here — use null if nothing in the roster clearly fits.

Respond with ONLY a JSON array, one object per input event in the same order, in this exact shape and nothing else — no preamble, no markdown fences:
[{"index": 0, "include": true, "occasion": "short 3-6 word title", "location": "string or null", "notes": "1-2 factual sentences describing what this event is, based on the summary/description given", "suggested_tags": ["tag name"], "suggested_group": "Existing Group Name or null"}]`

type Candidate = {
  user_id: string
  calendar_source_id: string
  ical_uid: string
  status: "pending"
  occasion: string | null
  location: string | null
  when_text: string | null
  event_date: string | null
  event_end_date: string | null
  raw_description: string | null
  suggested_people: { name: string | null; email: string | null; matched_person_id: string | null; confidence: "high" | "none" }[]
  suggested_tags: string[]
  suggested_group_ids: string[]
  source_recurrence_id: string | null
}

async function callExtraction(
  batch: IcsEvent[],
  tagGuidance: string,
  userTimeZone: string
): Promise<
  {
    index: number
    include: boolean
    occasion: string
    location: string | null
    notes: string
    suggested_tags: string[]
    suggested_group: string | null
  }[]
> {
  const batchData = JSON.stringify(
    batch.map((e, i) => ({
      index: i,
      summary: e.summary,
      description: e.description,
      location: e.location,
      when: e.dtstart ? icsDateToIsoDate(e.dtstart, userTimeZone) : null,
      recurring: e.isRecurring,
    }))
  )

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": Deno.env.get("ANTHROPIC_API_KEY") ?? "",
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-5",
      max_tokens: 7000,
      system: [
        { type: "text", text: stableInstructions, cache_control: { type: "ephemeral", ttl: "1h" } },
        { type: "text", text: tagGuidance, cache_control: { type: "ephemeral", ttl: "1h" } },
      ],
      messages: [{ role: "user", content: batchData }],
    }),
  })

  if (!response.ok) {
    console.error("Anthropic extraction call failed", response.status, await response.text())
    return []
  }

  const data = await response.json()
  const textBlock = data.content?.find((b: any) => b.type === "text")
  try {
    const raw = textBlock?.text ?? "[]"
    const start = raw.indexOf("[")
    const end = raw.lastIndexOf("]")
    return JSON.parse(raw.slice(start, end + 1))
  } catch (parseError) {
    console.error("Failed to parse extraction response", String(parseError))
    return []
  }
}

// A calendar attendee with no display name set often comes through with CN equal to their own
// email address (Google's fallback) rather than a real name — using that as a person's "name"
// would create a junk contact literally named "someone@example.com". Detected and excluded from
// suggested_people entirely rather than offered as a low-quality "add as new person."
function isEmailLike(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
}

async function scanUser(
  supabase: SupabaseClient,
  userId: string,
  accountEmail: string | null
): Promise<{ sourcesScanned: number; candidatesAdded: number }> {
  const [sourcesRes, peopleRes, tagsRes, groupsRes, existingRes] = await Promise.all([
    supabase.from("calendar_sources").select("id, ical_url, label").eq("user_id", userId),
    supabase.from("people").select("id, name, last_name, nicknames, middle_name, goes_by_other").eq("user_id", userId),
    supabase.from("tags").select("name").eq("user_id", userId),
    supabase.from("groups").select("id, name").eq("user_id", userId),
    supabase.from("moment_import_candidates").select("ical_uid").eq("user_id", userId),
  ])

  const sources = sourcesRes.data ?? []
  if (sources.length === 0) return { sourcesScanned: 0, candidatesAdded: 0 }

  const userTimeZone = await getUserTimeZone(supabase, userId)

  const seenUids = new Set((existingRes.data ?? []).map((r: any) => r.ical_uid))

  // Same name/nickname-matching approach as update-moment/index.ts — ambiguous keys (two people
  // sharing a first name/nickname) are excluded so a collision resolves to "no match" rather than
  // silently picking whichever person happened to load last.
  const idByName: Record<string, string> = {}
  const ambiguousKeys = new Set<string>()
  function claimKey(key: string, id: string) {
    if (!key) return
    if (idByName[key] && idByName[key] !== id) ambiguousKeys.add(key)
    else idByName[key] = id
  }
  for (const p of peopleRes.data ?? []) {
    const fullName = p.last_name ? `${p.name} ${p.last_name}` : p.name
    claimKey(fullName.toLowerCase(), p.id)
    claimKey(p.name.toLowerCase(), p.id)
    const nicknames = (p.nicknames ?? "").split(",").map((n: string) => n.trim()).filter(Boolean)
    if (p.middle_name) nicknames.push(String(p.middle_name).trim())
    if (p.goes_by_other) nicknames.push(String(p.goes_by_other).trim())
    for (const n of nicknames) claimKey(n.toLowerCase(), p.id)
  }
  for (const key of ambiguousKeys) delete idByName[key]

  const tagNames = (tagsRes.data ?? []).map((t: any) => t.name)
  const idByGroupName: Record<string, string> = {}
  for (const g of groupsRes.data ?? []) idByGroupName[String(g.name).toLowerCase()] = g.id
  const groupNames = (groupsRes.data ?? []).map((g: any) => g.name)

  const tagGuidance =
    (tagNames.length > 0
      ? `The founder is especially interested in events that look like: ${tagNames.join(", ")}. Lean toward including anything that clearly matches one of these; skip generic logistics that don't. Here is the founder's existing tag roster, for "suggested_tags" — reuse one of these by name where it fits: ${tagNames.join(", ")}.`
      : `The founder hasn't set any specific categories yet, so use your general judgement about what's worth remembering (gatherings, trips, celebrations, milestones). The founder has no tags on file yet, so "suggested_tags" can propose new short tag names where they clearly fit.`) +
    ` Here are the founder's existing recurring groups, for "suggested_group" — reuse one of these by EXACT name only if this event is clearly part of it, never invent a new one: ${groupNames.join(", ") || "(none yet)"}.`

  const cutoff = new Date()
  cutoff.setFullYear(cutoff.getFullYear() - MAX_AGE_YEARS)
  const cutoffIso = isoDateInTimeZone(cutoff, userTimeZone)

  let candidatesAdded = 0
  let sourcesScanned = 0
  let batchesProcessed = 0

  for (const source of sources) {
    if (batchesProcessed >= MAX_BATCHES_PER_RUN) break
    try {
      const response = await fetch(source.ical_url)
      if (!response.ok) {
        await supabase.from("calendar_sources").update({ last_sync_error: `Couldn't fetch calendar (status ${response.status}).` }).eq("id", source.id)
        continue
      }
      const text = await response.text()
      const parsedEvents = parseIcs(text)

      // Dedupe within this feed by UID (a recurring series' override instances share the master's
      // UID) and apply only the cheap, UNAMBIGUOUS pre-AI filters: skip cancelled, skip anything
      // older than the cutoff, skip already-seen. Deliberately NOT filtering on attendee count or
      // recurrence anymore — that first cut assumed people use Google's formal guest/RSVP feature
      // for social events, but most personal calendars don't (a live test against a real 1,060-
      // event calendar showed real gatherings like "Camping Trip w/ Liam and Ben" or "Harris'
      // Friendsgiving" have zero formal ATTENDEE lines and no RRULE, so they were being dropped
      // before the AI ever saw them). Classifying "is this worth suggesting" is exactly what the
      // AI step below is for; a cheap keyword-shaped pre-filter can't do that job reliably, so
      // let every non-cancelled, in-range event through and let the batched Claude call decide.
      const byUid = new Map<string, IcsEvent>()
      for (const e of parsedEvents) byUid.set(e.uid, e)

      const candidates: IcsEvent[] = []
      for (const e of byUid.values()) {
        if (e.status === "CANCELLED") continue
        if (seenUids.has(e.uid)) continue
        const isoDate = e.dtstart ? icsDateToIsoDate(e.dtstart, userTimeZone) : null
        if (isoDate && isoDate < cutoffIso) continue
        candidates.push(e)
      }

      // Chunk into batches first, capped by however many batches this run has left, then fire
      // them at Claude CONCURRENTLY (not one at a time) — a real backlog can be 30+ batches, and
      // running them sequentially was slow enough to blow past the Edge Function's execution
      // timeout partway through (confirmed live: an 8-batch sequential run still timed out).
      // Concurrent calls still benefit from the cache_control breakpoints once the first response
      // has written the cache entry for this run's stable/tag-guidance prefix.
      const batchChunks: IcsEvent[][] = []
      for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
        if (batchesProcessed + batchChunks.length >= MAX_BATCHES_PER_RUN) break
        batchChunks.push(candidates.slice(i, i + BATCH_SIZE))
      }
      const fullyProcessed = batchChunks.length >= Math.ceil(candidates.length / BATCH_SIZE) || candidates.length === 0
      batchesProcessed += batchChunks.length

      const batchResultSets = await Promise.all(batchChunks.map((batch) => callExtraction(batch, tagGuidance, userTimeZone)))

      const rows: Candidate[] = []
      for (let bi = 0; bi < batchChunks.length; bi++) {
        const batch = batchChunks[bi]
        const results = batchResultSets[bi]
        for (const r of results) {
          if (!r.include) continue
          const event = batch[r.index]
          if (!event) continue

          const suggestedPeople = event.attendees
            // Drop the account owner themselves (every event on their own calendar lists them) and
            // any attendee with no usable human name (CN missing, or CN that's just their email).
            .filter((a) => !(accountEmail && a.email?.toLowerCase() === accountEmail.toLowerCase()))
            .filter((a) => a.name && !isEmailLike(a.name))
            .map((a) => {
              const matchId = idByName[a.name!.toLowerCase()]
              return { name: a.name, email: a.email, matched_person_id: matchId ?? null, confidence: matchId ? ("high" as const) : ("none" as const) }
            })

          const startDate = event.dtstart ? icsDateToIsoDate(event.dtstart, userTimeZone) : null
          let endDate = event.dtend ? icsEndDateToIsoDate(event.dtend, event.dtendIsDateOnly, userTimeZone) : null
          // Defensive guard against a malformed feed producing an end before the start — never
          // store a negative-length range.
          if (startDate && endDate && endDate < startDate) endDate = null

          rows.push({
            user_id: userId,
            calendar_source_id: source.id,
            ical_uid: event.uid,
            status: "pending",
            occasion: r.occasion ?? null,
            location: r.location ?? event.location ?? null,
            // Dates come straight from the calendar's own DTSTART/DTEND, never AI-guessed — the
            // AI extraction call above no longer produces a "when_text" at all. when_text is a
            // deterministic rendering of these exact dates, kept in the DB for other flows that
            // still fall back to it (e.g. an event with no resolvable date), but not shown/edited
            // as a separate field in the review UI.
            when_text: startDate ? formatEventDateText(startDate, endDate) : null,
            event_date: startDate,
            event_end_date: endDate,
            raw_description: r.notes ?? event.description ?? null,
            suggested_people: suggestedPeople,
            suggested_tags: Array.isArray(r.suggested_tags) ? r.suggested_tags.slice(0, 3) : [],
            suggested_group_ids: r.suggested_group ? [idByGroupName[r.suggested_group.toLowerCase()]].filter((id): id is string => Boolean(id)) : [],
            source_recurrence_id: event.isRecurring ? event.uid : null,
          })
        }
      }

      if (rows.length > 0) {
        const { error } = await supabase
          .from("moment_import_candidates")
          .upsert(rows, { onConflict: "user_id,ical_uid", ignoreDuplicates: true })
        if (!error) candidatesAdded += rows.length
        else console.error("Failed to upsert candidates", error.message)
      }

      // Only mark this source fully synced (and clear the timestamp's staleness) once every
      // candidate batch for it actually ran — an incomplete pass (hit MAX_BATCHES_PER_RUN)
      // deliberately leaves last_synced_at alone so the next run keeps going, not skips ahead.
      if (fullyProcessed) {
        await supabase.from("calendar_sources").update({ last_synced_at: new Date().toISOString(), last_sync_error: null }).eq("id", source.id)
      }
      sourcesScanned++
    } catch (error) {
      console.error("Error scanning calendar source", source.id, String(error))
      await supabase.from("calendar_sources").update({ last_sync_error: "Something went wrong checking this calendar." }).eq("id", source.id)
    }
  }

  return { sourcesScanned, candidatesAdded }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  try {
    const cronSecret = req.headers.get("x-cron-secret")
    const isCron = !!cronSecret && cronSecret === Deno.env.get("CRON_SCAN_SECRET")

    if (isCron) {
      // Scheduled run — service-role client (no user session to relay), scans every account that
      // has at least one connected calendar.
      const serviceClient = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "")
      const { data: userRows } = await serviceClient.from("calendar_sources").select("user_id")
      const userIds = [...new Set((userRows ?? []).map((r: any) => r.user_id))]

      let totalSources = 0
      let totalCandidates = 0
      for (const userId of userIds) {
        const { data: userData } = await serviceClient.auth.admin.getUserById(userId)
        const result = await scanUser(serviceClient, userId, userData?.user?.email ?? null)
        totalSources += result.sourcesScanned
        totalCandidates += result.candidatesAdded
      }
      return new Response(JSON.stringify({ usersScanned: userIds.length, sourcesScanned: totalSources, candidatesAdded: totalCandidates }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    // Manual "Sync now" — relay the caller's own JWT so RLS scopes everything to just them.
    const supabaseClient = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_ANON_KEY") ?? "", {
      global: { headers: { Authorization: req.headers.get("Authorization")! } },
    })
    const {
      data: { user },
    } = await supabaseClient.auth.getUser()
    if (!user) {
      return new Response(JSON.stringify({ error: "not_authenticated" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    const result = await scanUser(supabaseClient, user.id, user.email ?? null)
    return new Response(JSON.stringify(result), { headers: { ...corsHeaders, "Content-Type": "application/json" } })
  } catch (error) {
    console.error("scan-calendar-sources error", String(error))
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }
})
