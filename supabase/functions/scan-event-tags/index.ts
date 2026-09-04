// Reads events the app ALREADY has and tags them (founder ask, 2026-08-23). Everything else in
// the app tags on the way IN — scan-calendar-sources for calendar imports, converse for moments
// you speak. Nothing had ever gone back over the library, so anything imported before that existed
// stays bare forever: 78 of 151 events had no group at all when item 85 measured it.
//
// WHAT IT WRITES AND WHAT IT ONLY PROPOSES, because the three are deliberately different:
//   - a tag already on the roster -> applied immediately (founder's call: "auto-apply tags")
//   - a tag name NOT on the roster -> recorded in moments.suggested_tag_names, applied to nothing.
//     suggest-tag-trends later asks "11 events look like Concerts, make that a tag?" so a new word
//     gets coined ONCE, deliberately, with its whole event list visible, instead of appearing
//     across hundreds of rows one event at a time.
//   - a group -> recorded in moments.suggested_group_ids and asked about on Home's existing
//     "Tag this event as X?" card (founder's call: "ask for groups").
//
// COST (CLAUDE.md rule 3). moments.tag_scan_at is the whole guarantee: an event is sent to the API
// exactly once, ever, and the column is stamped LAST so a crash re-does work rather than skipping
// it. The prompt is tiered the way scan-calendar-sources tiers it — static instructions, then the
// roster, each with its own 1-hour cache breakpoint, and only the batch itself uncached.
// effort:"low" is deliberate: this is short-form extraction, and Sonnet 5 thinks (and bills for
// thinking) by default. `usage` is returned to the caller so a zero cache_read is visible rather
// than silently costing full price.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts"
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2"
import { buildGroupNameIndex } from "../_shared/groupNames.ts"
import { fetchAllRows } from "../_shared/pagedSelect.ts"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
}

const BATCH_SIZE = 30
// Same cap and same reason as scan-calendar-sources: one invocation must not run past the Edge
// Function execution timeout. 240 events a run, and whatever is left is picked up by the next
// click — nothing is lost, because tag_scan_at is only stamped on what actually got processed.
const MAX_BATCHES_PER_RUN = 8

// The attendance marker every attendee gets (attendance IS a note in this schema, §6). One line
// per person, identical text, carrying nothing about what KIND of event this was — so it is
// stripped before anything is sent. On a twenty-person event that is most of the payload.
const ATTENDANCE_NOTE = "was there."

// Fully static. Zero interpolation, byte-identical on every batch, every user, every run — which
// is the only thing that makes the cache breakpoint below worth anything.
const stableInstructions = `You are helping someone keep track of the events in their own life. You'll be given a JSON array of events they have already saved. For EACH one, say what KIND of event it was and whether it belongs to one of their recurring groups.

A tag answers "what kind of thing was this?" — birthday, wedding, funeral, vacation, concert, graduation, appointment. It is NOT a summary of the event, not who was there, and not where it happened.

You return tags in TWO separate lists, and the difference between them matters:

"roster_tags": tags from the roster given below that fit this event. Copy the name EXACTLY as it appears there — anything not on the roster, or spelled differently, is thrown away. These are applied to the event immediately with nobody reviewing them first, so only include one you would stand behind. At most 3. An empty array is a perfectly good answer.

"new_tags": short names for kinds of event that fit but AREN'T on the roster yet. Check the roster first, including for close synonyms — if "Vacation" is on the roster, a week at the beach is roster_tags ["Vacation"], never a new tag called "Beach Trip". These are applied to NOTHING; they are collected across every event, and the person is later asked whether to create the ones that keep coming up. So name the general KIND of thing, in the words you would want to see on a filter menu, not a description of this one event. At most 2.

Right: "Clare's 30th birthday party", with "Birthday" on the roster -> {"roster_tags": ["Birthday"], "new_tags": []}
Wrong: {"roster_tags": [], "new_tags": ["30th Birthday Party"]} — the roster already covers it, and that name describes one event rather than a kind of event.

Right: "Dave Matthews Band at Red Rocks", with nothing concert-ish on the roster -> {"roster_tags": [], "new_tags": ["Concerts"]}
Wrong: {"roster_tags": [], "new_tags": ["Dave Matthews Band", "Red Rocks"]} — that is a band and a venue, not a kind of event.

Right: "Dentist" -> {"roster_tags": [], "new_tags": ["Appointments"]}
Wrong: {"roster_tags": [], "new_tags": ["Dentist Visit For Cleaning"]} — too specific to ever fit a second event.

Right: "Hold", "Busy", "Call", or any title that says nothing about what happened -> {"roster_tags": [], "new_tags": []}
Wrong: guessing. Two empty arrays is better than a tag that turns out to be wrong, because these get applied without review.

Some rosters contain a tag that is somebody's NAME — a person, a pet, a place. Those are not kinds of event, and a name appearing in an event's notes is not a reason to use it.
Right: "BBQ at the Berzins'", where the roster holds both "Parties" and "Federico", and the notes mention Federico -> {"roster_tags": ["Parties"], "new_tags": []}
Wrong: {"roster_tags": ["Federico"], "new_tags": []} — Federico is a name, and a barbecue is a party.

Each event may list "already_tagged". Never repeat one of those in either list.

"suggested_group": at most one group from the EXISTING groups roster below, copied EXACTLY, and only when the event clearly belongs to that recurring affiliation — a school, a team, a workplace, a military unit, a friend circle. A group is an ongoing thing people belong to, not a one-off detail of this event. Never invent a group name; use null when nothing in the roster clearly fits. A roster entry written "Parent / Child" is a subgroup of "Parent" — copy that whole form exactly, because a bare "Child" resolves to nothing when two groups share that name. If you cannot tell which same-named subgroup is meant, use null.

Respond with ONLY a JSON array, one object per input event in the same order, in this exact shape and nothing else — no preamble, no markdown fences:
[{"index": 0, "roster_tags": ["Tag Name"], "new_tags": ["Tag Name"], "suggested_group": "Existing Group Name or null"}]`

type MomentRow = {
  id: string
  occasion: string | null
  location: string | null
  event_date: string | null
  event_end_date: string | null
  raw_description: string | null
}

type EventPayload = {
  index: number
  title: string | null
  location: string | null
  when: string | null
  description: string | null
  who_was_there: string[]
  notes: string[]
  already_tagged: string[]
}

type ExtractionResult = {
  index: number
  roster_tags: string[]
  new_tags: string[]
  suggested_group: string | null
}

type Usage = Record<string, unknown> | null

/**
 * Returns the batch's extractions AND whether the call actually worked. Same contract as
 * scan-calendar-sources' callExtraction, for the same hard-won reason: a failed call returning []
 * is byte-identical to "the AI read these and had nothing to suggest", which is what let an
 * expired API key run for days behind a green "nothing new found" (PROJECT_CONTEXT.md §10/§12).
 * Anything that can fail silently here has to say so out loud instead.
 */
async function callExtraction(
  payload: EventPayload[],
  rosterGuidance: string
): Promise<{ items: ExtractionResult[]; failed: boolean; usage: Usage }> {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": Deno.env.get("ANTHROPIC_API_KEY") ?? "",
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-5",
      max_tokens: 8000,
      // Short-form extraction against a fixed output shape — there is nothing here worth a deep
      // reasoning pass, and this model thinks (and charges for thinking) by default.
      output_config: { effort: "low" },
      system: [
        { type: "text", text: stableInstructions, cache_control: { type: "ephemeral", ttl: "1h" } },
        { type: "text", text: rosterGuidance, cache_control: { type: "ephemeral", ttl: "1h" } },
      ],
      messages: [{ role: "user", content: JSON.stringify(payload) }],
    }),
  })

  if (!response.ok) {
    console.error("Anthropic extraction call failed", response.status, await response.text())
    return { items: [], failed: true, usage: null }
  }

  const data = await response.json()
  const usage = (data.usage ?? null) as Usage
  console.log("scan-event-tags usage", JSON.stringify(usage))

  const textBlock = data.content?.find((b: any) => b.type === "text")
  // Thinking spends the same budget as the answer, so a truncated turn can come back with no text
  // block at all — the converse bug of 2026-08-10. Name which failure this was.
  if (!textBlock && data.stop_reason === "max_tokens") {
    console.error("scan-event-tags hit max_tokens with no text block — batch not read")
    return { items: [], failed: true, usage }
  }
  try {
    const raw = textBlock?.text ?? "[]"
    const start = raw.indexOf("[")
    const end = raw.lastIndexOf("]")
    return { items: JSON.parse(raw.slice(start, end + 1)), failed: false, usage }
  } catch (parseError) {
    console.error("Failed to parse extraction response", String(parseError))
    return { items: [], failed: true, usage }
  }
}

export type ScanResult = {
  scanned: number
  tagsApplied: number
  candidateNames: number
  groupsSuggested: number
  remaining: number
  extractionFailures: number
  usage: Usage
  preview?: { momentId: string; title: string | null; result: ExtractionResult }[]
}

async function scanUser(supabase: SupabaseClient, userId: string, preview: boolean): Promise<ScanResult> {
  const empty: ScanResult = {
    scanned: 0,
    tagsApplied: 0,
    candidateNames: 0,
    groupsSuggested: 0,
    remaining: 0,
    extractionFailures: 0,
    usage: null,
  }

  const limit = preview ? BATCH_SIZE : BATCH_SIZE * MAX_BATCHES_PER_RUN

  const [unscannedRes, tagsRes, groupsRes, peopleRes] = await Promise.all([
    // Newest first: if the backlog needs several runs, the events the founder is most likely to
    // look at get done first. `id` breaks ties so two same-dated events can't shuffle.
    supabase
      .from("moments")
      .select("id, occasion, location, event_date, event_end_date, raw_description")
      .eq("user_id", userId)
      .is("tag_scan_at", null)
      .order("event_date", { ascending: false, nullsFirst: false })
      .order("id")
      .limit(limit),
    supabase.from("tags").select("id, name").eq("user_id", userId).order("id"),
    supabase.from("groups").select("id, name, parent_group_id").eq("user_id", userId).order("id"),
    fetchAllRows<{ id: string; name: string }>((from, to) =>
      supabase.from("people").select("id, name").eq("user_id", userId).order("id").range(from, to)
    ),
  ])

  if (unscannedRes.error) {
    console.error("Failed to read unscanned moments", unscannedRes.error.message)
    return empty
  }
  const moments = (unscannedRes.data ?? []) as MomentRow[]

  async function countRemaining(): Promise<number> {
    const { count } = await supabase
      .from("moments")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .is("tag_scan_at", null)
    return count ?? 0
  }

  if (moments.length === 0) return { ...empty, remaining: 0 }

  const knownTagIds = new Map<string, string>()
  const rosterNames: string[] = []
  for (const t of (tagsRes.data ?? []) as { id: string; name: string }[]) {
    knownTagIds.set(t.name.toLowerCase(), t.id)
    rosterNames.push(t.name)
  }
  rosterNames.sort((a, b) => a.localeCompare(b))

  const groupRows = (groupsRes.data ?? []) as { id: string; name: string; parent_group_id: string | null }[]
  const groupIndex = buildGroupNameIndex(groupRows)
  const groupNames = groupRows.map((g) => groupIndex.nameById[g.id]).sort((a, b) => a.localeCompare(b))

  const nameById = new Map<string, string>()
  for (const p of peopleRes.data ?? []) nameById.set(p.id, p.name)

  // Sorted rosters above and a fixed sentence order here: this whole string has to come out
  // byte-identical run to run or its cache breakpoint buys nothing.
  const rosterGuidance =
    (rosterNames.length > 0
      ? `The person's existing tag roster, for "roster_tags" — these are the only names you may put in that list: ${rosterNames.join(", ")}.`
      : `The person has no tags on file yet, so "roster_tags" is always empty and everything that fits goes in "new_tags".`) +
    ` The person's existing recurring groups, for "suggested_group" — reuse one of these by EXACT name only if the event is clearly part of it, and never invent one: ${groupNames.join(", ") || "(none yet)"}.`

  const chunks: MomentRow[][] = []
  for (let i = 0; i < moments.length; i += BATCH_SIZE) chunks.push(moments.slice(i, i + BATCH_SIZE))

  let tagsApplied = 0
  let candidateNames = 0
  let groupsSuggested = 0
  let extractionFailures = 0
  let scanned = 0
  let lastUsage: Usage = null
  const previewRows: { momentId: string; title: string | null; result: ExtractionResult }[] = []

  // Concurrent, like scan-calendar-sources: sequential batches blew past the execution timeout on
  // a real backlog. Each chunk fetches its OWN tags/notes rather than one big .in() over all 240
  // ids — a long IN-list is the exact shape that silently returned empty data from a deployed Edge
  // Function in 2026-07-25 (§2). Thirty ids is nowhere near that.
  const results = await Promise.all(
    chunks.map(async (chunk) => {
      const ids = chunk.map((m) => m.id)
      const [tagRowsRes, noteRowsRes] = await Promise.all([
        supabase.from("moment_tags").select("moment_id, tags(name)").in("moment_id", ids),
        supabase.from("notes").select("moment_id, person_id, content").in("moment_id", ids),
      ])
      if (tagRowsRes.error) console.error("Failed to read existing moment tags", tagRowsRes.error.message)
      if (noteRowsRes.error) console.error("Failed to read moment notes", noteRowsRes.error.message)

      const existingTags = new Map<string, string[]>()
      for (const row of (tagRowsRes.data ?? []) as { moment_id: string; tags: { name: string } | null }[]) {
        const name = row.tags?.name
        if (!name) continue
        const list = existingTags.get(row.moment_id) ?? []
        list.push(name)
        existingTags.set(row.moment_id, list)
      }

      const attendees = new Map<string, string[]>()
      const noteText = new Map<string, string[]>()
      for (const row of (noteRowsRes.data ?? []) as {
        moment_id: string
        person_id: string | null
        content: string | null
      }[]) {
        if (row.person_id) {
          const name = nameById.get(row.person_id)
          if (name) {
            const list = attendees.get(row.moment_id) ?? []
            if (!list.includes(name)) list.push(name)
            attendees.set(row.moment_id, list)
          }
        }
        const content = row.content?.trim()
        if (!content || content.toLowerCase() === ATTENDANCE_NOTE) continue
        const list = noteText.get(row.moment_id) ?? []
        // Two notes is plenty to tell a wedding from a dentist appointment; the rest is cost.
        if (list.length < 2) list.push(content)
        noteText.set(row.moment_id, list)
      }

      const payload: EventPayload[] = chunk.map((m, index) => ({
        index,
        title: m.occasion,
        location: m.location,
        when: m.event_date
          ? m.event_end_date && m.event_end_date !== m.event_date
            ? `${m.event_date} to ${m.event_end_date}`
            : m.event_date
          : null,
        description: m.raw_description?.slice(0, 600) ?? null,
        who_was_there: (attendees.get(m.id) ?? []).slice(0, 8),
        notes: noteText.get(m.id) ?? [],
        already_tagged: existingTags.get(m.id) ?? [],
      }))

      const { items, failed, usage } = await callExtraction(payload, rosterGuidance)
      return { chunk, items, failed, usage, existingTags }
    })
  )

  for (const { chunk, items, failed, usage, existingTags } of results) {
    if (usage) lastUsage = usage
    if (failed) {
      extractionFailures++
      // Deliberately does NOT stamp tag_scan_at — a batch nobody read stays unread and is retried.
      continue
    }

    const byIndex = new Map<number, ExtractionResult>()
    for (const item of items) byIndex.set(item.index, item)

    const momentTagRows: { moment_id: string; tag_id: string; source: string }[] = []
    const momentUpdates: { id: string; suggested_tag_names: string[]; suggested_group_ids: string[] }[] = []

    for (let i = 0; i < chunk.length; i++) {
      const moment = chunk[i]
      const result = byIndex.get(i)
      if (!result) continue

      if (preview) {
        previewRows.push({ momentId: moment.id, title: moment.occasion, result })
        continue
      }

      // Only names genuinely on the roster. The model is told to copy them exactly; this lookup is
      // what enforces it, so an invented tag can never be auto-applied to a real event.
      //
      // The `alreadyOn` filter is not belt-and-braces. The prompt says never to repeat a tag the
      // event already carries, and the first live preview (2026-08-23, 30 real events) showed it
      // doing so twice anyway — "Wedding ceremony and cocktail hour" came back with Weddings, which
      // it already had. The upsert would ignore the duplicate, so nothing breaks; what breaks is
      // the COUNT, and a Settings screen reporting "added 47 tags" when it added 41 is the same
      // class of quiet lie as the failures §12 is about. Deterministic beats a prompt rule here.
      const alreadyOn = new Set((existingTags.get(moment.id) ?? []).map((n) => n.toLowerCase()))
      const rosterHits: string[] = []
      for (const name of (result.roster_tags ?? []).slice(0, 3)) {
        const key = String(name).trim().toLowerCase()
        if (alreadyOn.has(key)) continue
        const id = knownTagIds.get(key)
        if (id && !rosterHits.includes(id)) rosterHits.push(id)
      }

      const newNames = (result.new_tags ?? [])
        .slice(0, 2)
        .map((n) => String(n).trim())
        .filter((n) => n.length > 0 && !knownTagIds.has(n.toLowerCase()))

      const groupId = result.suggested_group ? groupIndex.resolve(result.suggested_group) : null

      for (const tagId of rosterHits) momentTagRows.push({ moment_id: moment.id, tag_id: tagId, source: "ai_scan" })
      momentUpdates.push({
        id: moment.id,
        suggested_tag_names: newNames,
        suggested_group_ids: groupId ? [groupId] : [],
      })
      candidateNames += newNames.length
      if (groupId) groupsSuggested++
    }

    if (preview) continue

    if (momentTagRows.length > 0) {
      // ignoreDuplicates is what keeps a tag the founder applied by hand from being rewritten as
      // 'ai_scan' — the undo must never take away something they did themselves.
      // .select() so the count is what actually LANDED, not what was attempted — with
      // ignoreDuplicates a row that was already there comes back absent rather than as an error,
      // and the Settings report and the undo count both have to match reality.
      const { data: inserted, error } = await supabase
        .from("moment_tags")
        .upsert(momentTagRows, { onConflict: "moment_id,tag_id", ignoreDuplicates: true })
        .select("moment_id")
      if (error) console.error("Failed to apply tags", error.message)
      else tagsApplied += (inserted ?? []).length
    }

    // Suggestions first, tag_scan_at last and separately: if this crashes halfway the events keep
    // a null tag_scan_at and get re-read next run, which costs one more call. Stamping first and
    // then crashing would lose them silently, which costs the feature.
    await Promise.all(
      momentUpdates
        .filter((u) => u.suggested_tag_names.length > 0 || u.suggested_group_ids.length > 0)
        .map((u) =>
          supabase
            .from("moments")
            .update({ suggested_tag_names: u.suggested_tag_names, suggested_group_ids: u.suggested_group_ids })
            .eq("id", u.id)
        )
    )

    const stampIds = chunk.map((m) => m.id)
    const { error: stampError } = await supabase
      .from("moments")
      .update({ tag_scan_at: new Date().toISOString() })
      .in("id", stampIds)
    if (stampError) console.error("Failed to stamp tag_scan_at", stampError.message)
    else scanned += stampIds.length
  }

  return {
    scanned,
    tagsApplied,
    candidateNames,
    groupsSuggested,
    remaining: await countRemaining(),
    extractionFailures,
    usage: lastUsage,
    ...(preview ? { preview: previewRows } : {}),
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  try {
    const body = await req.json().catch(() => ({}))
    const preview = Boolean(body?.preview)

    const cronSecret = req.headers.get("x-cron-secret")
    const isCron = !!cronSecret && cronSecret === Deno.env.get("CRON_SCAN_SECRET")

    if (isCron) {
      // Scheduled run — service role, every account that still has an unscanned event.
      const serviceClient = createClient(
        Deno.env.get("SUPABASE_URL") ?? "",
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
      )
      const { data: userRows } = await serviceClient.from("moments").select("user_id").is("tag_scan_at", null).limit(1000)
      const userIds = [...new Set((userRows ?? []).map((r: { user_id: string }) => r.user_id))]

      let scanned = 0
      let tagsApplied = 0
      let failures = 0
      for (const userId of userIds) {
        const result = await scanUser(serviceClient, userId, false)
        scanned += result.scanned
        tagsApplied += result.tagsApplied
        failures += result.extractionFailures
      }
      // A scheduled run has no UI to report into, so the log is its only channel — and this line is
      // the difference between "nothing to tag today" and "nothing was read today."
      if (failures > 0) {
        console.error(`Scheduled tag scan: ${failures} batch(es) FAILED — those events were not read`)
      }
      return new Response(
        JSON.stringify({ usersScanned: userIds.length, scanned, tagsApplied, extractionFailures: failures }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

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

    const result = await scanUser(supabaseClient, user.id, preview)
    return new Response(JSON.stringify(result), { headers: { ...corsHeaders, "Content-Type": "application/json" } })
  } catch (error) {
    console.error("scan-event-tags error", String(error))
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }
})
