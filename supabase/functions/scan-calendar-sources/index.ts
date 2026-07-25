import { serve } from "https://deno.land/std@0.224.0/http/server.ts"
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2"
import { parseIcs, icsDateToIsoDate, type IcsEvent } from "../_shared/ics.ts"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
}

const BATCH_SIZE = 30
const MAX_AGE_YEARS = 3

// Stable, zero-interpolation instructions — identical every batch, every user, every run. Its
// own cache_control breakpoint per CLAUDE.md's caching rules.
const stableInstructions = `You are screening raw calendar entries for an app that helps someone keep track of the people and moments in their life. You'll be given a JSON array of calendar events. For EACH one, decide whether it's worth suggesting as something to save, and extract a clean summary.

Favor real gatherings, trips, celebrations, and milestones involving other people. Skip generic solo logistics (a dentist appointment, a flight with no other detail, a work meeting, a reminder) UNLESS it clearly matches one of the founder's preferred categories given separately below — when in doubt on a borderline case, lean toward including it, since a human reviews every suggestion before anything is saved.

Respond with ONLY a JSON array, one object per input event in the same order, in this exact shape and nothing else — no preamble, no markdown fences:
[{"index": 0, "include": true, "occasion": "short 3-6 word title", "location": "string or null", "when_text": "natural language timing, e.g. August 2026", "notes": "1-2 factual sentences describing what this event is, based on the summary/description given"}]`

type Candidate = {
  user_id: string
  calendar_source_id: string
  ical_uid: string
  status: "pending"
  occasion: string | null
  location: string | null
  when_text: string | null
  event_date: string | null
  raw_description: string | null
  suggested_people: { name: string | null; email: string | null; matched_person_id: string | null; confidence: "high" | "none" }[]
  source_recurrence_id: string | null
}

async function callExtraction(
  batch: IcsEvent[],
  tagGuidance: string
): Promise<{ index: number; include: boolean; occasion: string; location: string | null; when_text: string; notes: string }[]> {
  const batchData = JSON.stringify(
    batch.map((e, i) => ({
      index: i,
      summary: e.summary,
      description: e.description,
      location: e.location,
      when: e.dtstart ? (e.dtstartIsDateOnly ? icsDateToIsoDate(e.dtstart) : e.dtstart) : null,
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
      max_tokens: 4096,
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

async function scanUser(supabase: SupabaseClient, userId: string): Promise<{ sourcesScanned: number; candidatesAdded: number }> {
  const [sourcesRes, peopleRes, tagsRes, existingRes] = await Promise.all([
    supabase.from("calendar_sources").select("id, ical_url, label").eq("user_id", userId),
    supabase.from("people").select("id, name, last_name, nicknames, middle_name, goes_by_other").eq("user_id", userId),
    supabase.from("tags").select("name").eq("user_id", userId),
    supabase.from("moment_import_candidates").select("ical_uid").eq("user_id", userId),
  ])

  const sources = sourcesRes.data ?? []
  if (sources.length === 0) return { sourcesScanned: 0, candidatesAdded: 0 }

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
  const tagGuidance =
    tagNames.length > 0
      ? `The founder is especially interested in events that look like: ${tagNames.join(", ")}. Lean toward including anything that clearly matches one of these; skip generic logistics that don't.`
      : `The founder hasn't set any specific categories yet, so use your general judgement about what's worth remembering (gatherings, trips, celebrations, milestones).`

  const cutoff = new Date()
  cutoff.setFullYear(cutoff.getFullYear() - MAX_AGE_YEARS)
  const cutoffIso = cutoff.toISOString().slice(0, 10)

  let candidatesAdded = 0
  let sourcesScanned = 0

  for (const source of sources) {
    try {
      const response = await fetch(source.ical_url)
      if (!response.ok) {
        await supabase.from("calendar_sources").update({ last_sync_error: `Couldn't fetch calendar (status ${response.status}).` }).eq("id", source.id)
        continue
      }
      const text = await response.text()
      const parsedEvents = parseIcs(text)

      // Dedupe within this feed by UID (a recurring series' override instances share the master's
      // UID) and apply the cheap pre-AI filters from the gameplan: skip cancelled, skip anything
      // older than the cutoff, skip already-seen, skip solo/no-recurrence logistics.
      const byUid = new Map<string, IcsEvent>()
      for (const e of parsedEvents) byUid.set(e.uid, e)

      const candidates: IcsEvent[] = []
      for (const e of byUid.values()) {
        if (e.status === "CANCELLED") continue
        if (seenUids.has(e.uid)) continue
        const isoDate = e.dtstart ? icsDateToIsoDate(e.dtstart) : null
        if (isoDate && isoDate < cutoffIso) continue
        const hasOtherAttendees = e.attendees.length > 1
        if (!hasOtherAttendees && !e.isRecurring) continue
        candidates.push(e)
      }

      for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
        const batch = candidates.slice(i, i + BATCH_SIZE)
        const results = await callExtraction(batch, tagGuidance)

        const rows: Candidate[] = []
        for (const r of results) {
          if (!r.include) continue
          const event = batch[r.index]
          if (!event) continue

          const suggestedPeople = event.attendees
            .filter((a) => a.name || a.email)
            .map((a) => {
              const matchId = a.name ? idByName[a.name.toLowerCase()] : undefined
              return { name: a.name, email: a.email, matched_person_id: matchId ?? null, confidence: matchId ? ("high" as const) : ("none" as const) }
            })

          rows.push({
            user_id: userId,
            calendar_source_id: source.id,
            ical_uid: event.uid,
            status: "pending",
            occasion: r.occasion ?? null,
            location: r.location ?? event.location ?? null,
            when_text: r.when_text ?? null,
            event_date: event.dtstart ? icsDateToIsoDate(event.dtstart) : null,
            raw_description: r.notes ?? event.description ?? null,
            suggested_people: suggestedPeople,
            source_recurrence_id: event.isRecurring ? event.uid : null,
          })
        }

        if (rows.length > 0) {
          const { error } = await supabase
            .from("moment_import_candidates")
            .upsert(rows, { onConflict: "user_id,ical_uid", ignoreDuplicates: true })
          if (!error) candidatesAdded += rows.length
          else console.error("Failed to upsert candidates", error.message)
        }
      }

      await supabase.from("calendar_sources").update({ last_synced_at: new Date().toISOString(), last_sync_error: null }).eq("id", source.id)
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
        const result = await scanUser(serviceClient, userId)
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

    const result = await scanUser(supabaseClient, user.id)
    return new Response(JSON.stringify(result), { headers: { ...corsHeaders, "Content-Type": "application/json" } })
  } catch (error) {
    console.error("scan-calendar-sources error", String(error))
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }
})
