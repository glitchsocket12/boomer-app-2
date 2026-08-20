import { serve } from "https://deno.land/std@0.224.0/http/server.ts"
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2"
import { parseIcs, icsDateToIsoDate, icsEndDateToIsoDate, type IcsEvent } from "../_shared/ics.ts"
import { getUserTimeZone } from "../_shared/userSettings.ts"
import { isoDateInTimeZone } from "../_shared/tz.ts"
import { formatEventDateText } from "../_shared/eventDates.ts"
import { buildGroupNameIndex } from "../_shared/groupNames.ts"
import { fetchAllRows } from "../_shared/pagedSelect.ts"

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
const stableInstructions = `You are preparing raw calendar entries for review in an app that helps someone keep track of the people and moments in their life. You'll be given a JSON array of calendar events. For EACH one, extract a clean summary.

You are NOT deciding what is worth keeping — that is the person's own call, and they review every entry themselves (founder directive, 2026-08-12). Summarize every event you're given, including ordinary solo logistics like an appointment, an errand, a flight, or a work meeting. Never omit an event because it looks unimportant, and never fold several entries into one. Return exactly one object per input event.

Don't guess at dates — the exact start/end date is already known from the calendar itself and is filled in separately; just focus on occasion, location, notes, and the tag/group suggestions below.

"location": if the calendar entry's own location/description doesn't name a place, but the title names a well-known recurring public event (e.g. "SF Fleet Week", "Burning Man", "Comic-Con"), use your own general knowledge to fill in the typical real-world city/location for that event. Leave it null if you don't recognize the event and no location is given.

"suggested_tags": 1-3 short tags that fit this event. Reusing an existing tag from the roster given separately below is strongly preferred — check whether a word right in the event's own title (e.g. "wedding", "reunion", "graduation", "birthday") matches or is a close synonym of an existing tag name (case-insensitive) before proposing anything new. Only coin a genuinely new tag name when nothing existing is even a close fit — don't create a near-duplicate of a tag that already covers the same idea (e.g. don't add "grad party" if "graduation" already exists). Empty array if nothing fits.

"suggested_group": at most one group this event clearly belongs to, from the EXISTING groups roster given separately below — copy its name EXACTLY. A group is a recurring, ongoing affiliation (a school, team, workplace, military unit, or friend circle), not a one-off detail. Only set this when the event title/description clearly signals that recurring affiliation (e.g. an event named after a known group). Never invent a new group name here — use null if nothing in the roster clearly fits. A roster entry written "Parent / Child" (e.g. "22 AS / Pilots") is a subgroup of "Parent"; copy that whole form exactly, since a bare "Pilots" when two are on file resolves to nothing and the suggestion is dropped. If you can't tell which same-named subgroup an event belongs to, use null.

"mentioned_people": specific individuals named directly in the title or description (e.g. "Sid and Kate's wedding" → ["Sid", "Kate"]; "Catching up with Connor Chavez" → ["Connor Chavez"]) — first name alone is fine if that's all the title gives. Don't include the calendar owner, generic roles ("the team", "family"), or places/things that aren't a person's name. These get cross-checked separately against the founder's own people — you don't need the roster for this field, just pull out whatever names are actually written in the text. Empty array if no one is named.

"mentioned_family_names": surnames referenced as a family/household unit, distinct from "mentioned_people" above (e.g. "Meal train for the Mojica family" → ["Mojica"]; "Dinner with the Andersons" → ["Anderson"], singular form). Only when the text clearly frames it as a family/household ("the X family", "the Xs", "X family reunion") — not just any capitalized word or business name that happens to look like a surname (e.g. "Mojica's Bakery" is a place, not a family reference). Empty array if none.

Respond with ONLY a JSON array, one object per input event in the same order, in this exact shape and nothing else — no preamble, no markdown fences:
[{"index": 0, "occasion": "short 3-6 word title", "location": "string or null", "notes": "1-2 factual sentences describing what this event is, based on the summary/description given", "suggested_tags": ["tag name"], "suggested_group": "Existing Group Name or null", "mentioned_people": ["name"], "mentioned_family_names": ["Surname"]}]`

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

type ExtractionResult = {
  index: number
  occasion: string
  location: string | null
  notes: string
  suggested_tags: string[]
  suggested_group: string | null
  mentioned_people: string[]
  mentioned_family_names: string[]
}

/**
 * Returns the batch's extractions AND whether the call actually worked. The two used to be the
 * same thing — a failed call returned `[]`, which is byte-identical to "the AI read these events
 * and had nothing to suggest." That is what let the 2026-08-12 API-key expiry run for days behind
 * a green "All synced — nothing new found" (PROJECT_CONTEXT.md §10). Anything that can fail
 * silently here has to say so out loud instead.
 */
async function callExtraction(
  batch: IcsEvent[],
  tagGuidance: string,
  userTimeZone: string
): Promise<{ items: ExtractionResult[]; failed: boolean }> {
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
    return { items: [], failed: true }
  }

  const data = await response.json()
  const textBlock = data.content?.find((b: any) => b.type === "text")
  try {
    const raw = textBlock?.text ?? "[]"
    const start = raw.indexOf("[")
    const end = raw.lastIndexOf("]")
    return { items: JSON.parse(raw.slice(start, end + 1)), failed: false }
  } catch (parseError) {
    console.error("Failed to parse extraction response", String(parseError))
    return { items: [], failed: true }
  }
}

// A calendar attendee with no display name set often comes through with CN equal to their own
// email address (Google's fallback) rather than a real name — using that as a person's "name"
// would create a junk contact literally named "someone@example.com". Detected and excluded from
// suggested_people entirely rather than offered as a low-quality "add as new person."
function isEmailLike(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
}

// A Birthdays-calendar entry's title is usually just the contact's name, but some calendar
// clients (and manually-created "Mom's Birthday"-style entries) append a suffix — strip it so the
// remaining text is a plain name for matching/display.
function stripBirthdaySuffix(summary: string): string {
  return summary.replace(/[’']s\s+birthday$/i, "").replace(/\s+birthday$/i, "").trim()
}

// DTSTART for an all-day birthday entry is a bare YYYYMMDD (no time/Z component) — reuse
// icsDateToIsoDate for the parsing but read year/month/day directly rather than round-tripping
// through a Date, and sanity-check the year (some calendar exports use a sentinel like 1604 or
// 1904 for "birth year unknown") so an obviously-fake year isn't stored as if it were real.
function parseBirthdayDate(dtstart: string, timeZone: string): { month: number; day: number; year: number | null } | null {
  const iso = icsDateToIsoDate(dtstart, timeZone)
  if (!iso) return null
  const [yearStr, monthStr, dayStr] = iso.split("-")
  const year = Number(yearStr)
  const month = Number(monthStr)
  const day = Number(dayStr)
  if (!month || !day) return null
  const currentYear = new Date().getFullYear()
  const plausibleYear = year >= 1900 && year <= currentYear
  return { month, day, year: plausibleYear ? year : null }
}

async function processBirthdaySource(
  supabase: SupabaseClient,
  source: { id: string; ical_url: string },
  userId: string,
  userTimeZone: string,
  seenBirthdayUids: Set<string>,
  idByName: Record<string, string>
): Promise<number> {
  const response = await fetch(source.ical_url)
  if (!response.ok) {
    await supabase.from("calendar_sources").update({ last_sync_error: `Couldn't fetch calendar (status ${response.status}).` }).eq("id", source.id)
    return 0
  }
  const text = await response.text()
  const parsedEvents = parseIcs(text)

  const byUid = new Map<string, IcsEvent>()
  for (const e of parsedEvents) byUid.set(e.uid, e)

  const rows: {
    user_id: string
    calendar_source_id: string
    ical_uid: string
    status: "pending"
    full_name: string | null
    birthday_month: number | null
    birthday_day: number | null
    birthday_year: number | null
    matched_person_id: string | null
    match_confidence: "high" | "none"
  }[] = []

  for (const event of byUid.values()) {
    if (event.status === "CANCELLED") continue
    if (seenBirthdayUids.has(event.uid)) continue
    if (!event.dtstart || !event.summary) continue
    const parsedDate = parseBirthdayDate(event.dtstart, userTimeZone)
    if (!parsedDate) continue

    const fullName = stripBirthdaySuffix(event.summary)
    if (!fullName) continue
    const matchId = idByName[fullName.toLowerCase()] ?? null

    rows.push({
      user_id: userId,
      calendar_source_id: source.id,
      ical_uid: event.uid,
      status: "pending",
      full_name: fullName,
      birthday_month: parsedDate.month,
      birthday_day: parsedDate.day,
      birthday_year: parsedDate.year,
      matched_person_id: matchId,
      match_confidence: matchId ? "high" : "none",
    })
  }

  if (rows.length === 0) return 0

  const { error } = await supabase
    .from("birthday_import_candidates")
    .upsert(rows, { onConflict: "user_id,ical_uid", ignoreDuplicates: true })
  if (error) {
    console.error("Failed to upsert birthday candidates", error.message)
    return 0
  }
  return rows.length
}

async function scanUser(
  supabase: SupabaseClient,
  userId: string,
  accountEmail: string | null
): Promise<{ sourcesScanned: number; candidatesAdded: number; birthdayCandidatesAdded: number; extractionFailures: number }> {
  const [sourcesRes, peopleRes, tagsRes, groupsRes, existingRes, existingBirthdayRes] = await Promise.all([
    // Least-recently-synced first (never-synced sorts first of all). The batch budget below is
    // per-invocation and shared across sources, so an unordered list let whichever source happened
    // to come back first spend it every single run — the founder's third calendar had never once
    // been reached, and so had never even reported that its URL was broken. Oldest-first makes the
    // budget rotate: whoever missed out last time goes first next time.
    supabase
      .from("calendar_sources")
      .select("id, ical_url, label, source_type")
      .eq("user_id", userId)
      .order("last_synced_at", { ascending: true, nullsFirst: true }),
    // Paged: 700 people on the founder's account already, and attendee matching silently getting
    // worse for everyone past the 1000th person is exactly the failure this sweep was chasing.
    fetchAllRows((from, to) =>
      supabase
        .from("people")
        .select("id, name, last_name, nicknames, middle_name, goes_by_other, is_self")
        .eq("user_id", userId)
        .order("id")
        .range(from, to)
    ),
    supabase.from("tags").select("name").eq("user_id", userId),
    supabase.from("groups").select("id, name, parent_group_id").eq("user_id", userId),
    supabase.from("moment_import_candidates").select("id, ical_uid, status, event_date, event_end_date").eq("user_id", userId),
    supabase.from("birthday_import_candidates").select("ical_uid").eq("user_id", userId),
  ])

  const sources = sourcesRes.data ?? []
  if (sources.length === 0) return { sourcesScanned: 0, candidatesAdded: 0, birthdayCandidatesAdded: 0, extractionFailures: 0 }

  const userTimeZone = await getUserTimeZone(supabase, userId)

  const seenUids = new Set((existingRes.data ?? []).map((r: any) => r.ical_uid))
  const seenBirthdayUids = new Set((existingBirthdayRes.data ?? []).map((r: any) => r.ical_uid))

  // Repair map for a historical bug: candidates synced before this account's user_settings.time_zone
  // was populated got event_date computed against the fallback 'UTC' zone instead of the founder's
  // real one — a UTC-stamped evening event lands a calendar day late in any zone west of UTC (see
  // PROJECT_HISTORY.md's calendar-date-bug entry, e.g. a 5-11pm Denver Dec 24 gathering stored as
  // Dec 25). Only 'pending' rows are eligible — accepted/rejected candidates are reviewed history and
  // never touched. Checked below, per source, once userTimeZone is confirmed correct.
  const pendingByUid = new Map<string, { id: string; event_date: string | null; event_end_date: string | null }>()
  for (const r of existingRes.data ?? []) {
    if (r.status === "pending") pendingByUid.set(r.ical_uid, { id: r.id, event_date: r.event_date, event_end_date: r.event_end_date })
  }

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

  // Surname lookup for "mentioned_family_names" below — a family/household reference resolves
  // to EVERY person on file sharing that last name (a family invite plausibly means the whole
  // household), unlike idByName's single-person resolution above.
  const personIdsByLastName: Record<string, string[]> = {}
  const personById: Record<string, { name: string; last_name: string | null }> = {}
  for (const p of peopleRes.data ?? []) {
    personById[p.id] = { name: p.name, last_name: p.last_name ?? null }
    const lastNameKey = p.last_name ? String(p.last_name).trim().toLowerCase() : ""
    if (lastNameKey) (personIdsByLastName[lastNameKey] ??= []).push(p.id)
  }

  const selfPersonId = (peopleRes.data ?? []).find((p: any) => p.is_self)?.id ?? null

  const tagNames = (tagsRes.data ?? []).map((t: any) => t.name)
  // Qualified "Parent / Child" names so a subgroup can be told apart from a same-named one under
  // a different parent — see _shared/groupNames.ts. This function only ever resolves to an
  // existing group (it never creates one), so an unresolvable name simply suggests nothing.
  const groupIndex = buildGroupNameIndex((groupsRes.data ?? []) as any)
  const groupNames = (groupsRes.data ?? []).map((g: any) => groupIndex.nameById[g.id])

  // Group affiliation, for the "two+ resolved attendees share a group" inference below (e.g. a
  // wedding whose bride and groom both trace to "East High" gets that group suggested even
  // though nothing in the event's own text names it). Two signals, unioned per person: formal
  // person_groups roster membership, AND having attended even one past event tagged to that
  // group — confirmed live that founders don't always formally roster every regular (Kate
  // Mitchell had attended an "East High School"-tagged wedding without ever being added to that
  // group's roster), so roster-only would've missed exactly the case this is meant to catch.
  // Both queries are scoped via this user's own GROUP ids (from groupsRes, already `.eq("user_id",
  // userId)`-filtered) rather than via `.in("person_id", <every person>)` — with 400+ people on a
  // real account that IN-list got long enough to silently misbehave through the Edge Function's
  // outbound fetch (no error surfaced, just empty data) even though the identical query worked
  // fine from a browser; filtering by the founder's own (far smaller) group roster instead sidesteps
  // that and is equally correct, since person_groups/moment_groups rows are meaningless without a
  // group_id that traces back to this user anyway.
  const allGroupIds = (groupsRes.data ?? []).map((g: any) => g.id)
  const [personGroupsRes, momentGroupsRes] = await Promise.all([
    // Paged: this spans EVERY group the user owns, so it's the whole person_groups table for this
    // account (1183 rows when this was written) and the unpaged version was silently returning the
    // first 1000 — which quietly dropped ~15% of the memberships this function infers group tags
    // from. See _shared/pagedSelect.ts.
    allGroupIds.length > 0
      ? fetchAllRows<{ person_id: string; group_id: string }>((from, to) =>
          supabase
            .from("person_groups")
            .select("person_id, group_id")
            .in("group_id", allGroupIds)
            .order("person_id")
            .order("group_id")
            .range(from, to)
        )
      : Promise.resolve({ data: [] as { person_id: string; group_id: string }[], error: null }),
    supabase.from("moment_groups").select("moment_id, group_id, moments!inner(user_id)").eq("moments.user_id", userId),
  ])
  if (personGroupsRes.error) console.error("Failed to load person_groups", personGroupsRes.error.message)
  if (momentGroupsRes.error) console.error("Failed to load moment_groups", momentGroupsRes.error.message)
  const groupIdsByPerson: Record<string, Set<string>> = {}
  for (const pg of personGroupsRes.data ?? []) {
    ;(groupIdsByPerson[pg.person_id] ??= new Set()).add(pg.group_id)
  }
  const groupIdsByMoment: Record<string, string[]> = {}
  for (const mg of momentGroupsRes.data ?? []) {
    ;(groupIdsByMoment[mg.moment_id] ??= []).push(mg.group_id)
  }
  const groupTaggedMomentIds = Object.keys(groupIdsByMoment)
  const attendanceRes =
    // Paged: spans every group-tagged moment, so it approaches "all event-attached notes" — 796 of
    // the 1000 cap already on the founder's account.
    groupTaggedMomentIds.length > 0
      ? await fetchAllRows<{ person_id: string; moment_id: string }>((from, to) =>
          supabase
            .from("notes")
            .select("person_id, moment_id")
            .in("moment_id", groupTaggedMomentIds)
            .not("person_id", "is", null)
            .order("moment_id")
            .order("person_id")
            .range(from, to)
        )
      : { data: [] as { person_id: string; moment_id: string }[], error: null }
  if (attendanceRes.error) console.error("Failed to load notes for group-attendance inference", attendanceRes.error.message)
  for (const n of attendanceRes.data ?? []) {
    for (const gid of groupIdsByMoment[n.moment_id!] ?? []) {
      ;(groupIdsByPerson[n.person_id] ??= new Set()).add(gid)
    }
  }

  // Requires 2+ resolved people in common (not just 1) so a group doesn't get suggested purely
  // because one attendee happens to belong to it — the signal is that multiple people ALREADY
  // known to be attending also share a recurring affiliation, same bar a human would use.
  function groupsSharedByMultiple(candidatePersonIds: string[]): string[] {
    const counts = new Map<string, number>()
    for (const pid of candidatePersonIds) {
      for (const gid of groupIdsByPerson[pid] ?? []) {
        counts.set(gid, (counts.get(gid) ?? 0) + 1)
      }
    }
    return [...counts.entries()].filter(([, count]) => count >= 2).map(([gid]) => gid)
  }

  // Bare first names are routinely ambiguous (e.g. three different "Kate"s on file) and get
  // dropped from idByName entirely (see ambiguousKeys above) rather than risk tagging the wrong
  // person. This recovers exactly the case a human would resolve instantly: if the event ALSO
  // resolved a different person (e.g. "Sid", uniquely), and that person has a `relationships` row
  // (spouse/partner/etc.) to exactly one of the ambiguous same-name candidates, that's who's
  // meant — confirmed live (Sid Torrigino + Kate Mitchell are on file as spouses).
  const ambiguousNameToIds: Record<string, string[]> = {}
  for (const p of peopleRes.data ?? []) {
    const first = String(p.name).trim().toLowerCase()
    if (!first) continue
    ;(ambiguousNameToIds[first] ??= []).push(p.id)
  }
  for (const name of Object.keys(ambiguousNameToIds)) {
    if (ambiguousNameToIds[name].length < 2) delete ambiguousNameToIds[name]
  }
  const relatedIds: Record<string, Set<string>> = {}
  if (Object.keys(ambiguousNameToIds).length > 0) {
    const { data: relRows } = await supabase.from("relationships").select("person_a_id, person_b_id").eq("user_id", userId)
    for (const r of relRows ?? []) {
      ;(relatedIds[r.person_a_id] ??= new Set()).add(r.person_b_id)
      ;(relatedIds[r.person_b_id] ??= new Set()).add(r.person_a_id)
    }
  }
  function resolveAmbiguousName(name: string, alreadyResolvedIds: Iterable<string>): string | null {
    const candidates = ambiguousNameToIds[name]
    if (!candidates) return null
    const matches = candidates.filter((cid) => [...alreadyResolvedIds].some((rid) => relatedIds[cid]?.has(rid)))
    return matches.length === 1 ? matches[0] : null
  }

  const tagGuidance =
    (tagNames.length > 0
      ? `Here is the founder's existing tag roster, for "suggested_tags" — reuse one of these by name where it fits: ${tagNames.join(", ")}. An event that matches none of them is still summarized and returned as normal, just with an empty "suggested_tags"; the roster shapes the tag, never whether the event is included.`
      : `The founder has no tags on file yet, so "suggested_tags" can propose new short tag names where they clearly fit, and an empty array is fine.`) +
    ` Here are the founder's existing recurring groups, for "suggested_group" — reuse one of these by EXACT name only if this event is clearly part of it, never invent a new one: ${groupNames.join(", ") || "(none yet)"}.`

  const cutoff = new Date()
  cutoff.setFullYear(cutoff.getFullYear() - MAX_AGE_YEARS)
  const cutoffIso = isoDateInTimeZone(cutoff, userTimeZone)

  let candidatesAdded = 0
  let birthdayCandidatesAdded = 0
  let sourcesScanned = 0
  let batchesProcessed = 0
  // Batches whose AI call errored or came back unparseable. Reported so a run that read nothing
  // because the API was down can never again be worded as a run that found nothing.
  let extractionFailures = 0

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

      if (source.source_type === "birthdays") {
        // No AI call for birthday sources — pure ICS parsing + the same idByName matcher already
        // built above, so this costs nothing per CLAUDE.md's caching/cost rules. Not subject to
        // MAX_AGE_YEARS/MAX_BATCHES_PER_RUN (those exist to bound AI batch cost, which doesn't
        // apply here) — a single Birthdays calendar is at most a few hundred entries, cheap to
        // parse in one pass.
        const added = await processBirthdaySource(supabase, source, userId, userTimeZone, seenBirthdayUids, idByName)
        birthdayCandidatesAdded += added
        await supabase.from("calendar_sources").update({ last_synced_at: new Date().toISOString(), last_sync_error: null }).eq("id", source.id)
        sourcesScanned++
        continue
      }

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

      // Cheap, no-AI-cost repair pass (see pendingByUid comment above): recompute each still-pending
      // candidate's date fields against the now-correct userTimeZone and fix in place if they drifted.
      // Runs on every sync so the backlog self-heals once, rather than staying frozen forever behind
      // the ignoreDuplicates upsert below (which only ever inserts brand-new uids).
      const dateRepairs: { id: string; event_date: string | null; event_end_date: string | null; when_text: string | null }[] = []
      for (const e of byUid.values()) {
        const existing = pendingByUid.get(e.uid)
        if (!existing) continue
        const correctStart = e.dtstart ? icsDateToIsoDate(e.dtstart, userTimeZone) : null
        let correctEnd = e.dtend ? icsEndDateToIsoDate(e.dtend, e.dtendIsDateOnly, userTimeZone) : null
        if (correctStart && correctEnd && correctEnd < correctStart) correctEnd = null
        if (correctStart !== existing.event_date || correctEnd !== existing.event_end_date) {
          dateRepairs.push({
            id: existing.id,
            event_date: correctStart,
            event_end_date: correctEnd,
            when_text: correctStart ? formatEventDateText(correctStart, correctEnd) : null,
          })
        }
      }
      if (dateRepairs.length > 0) {
        await Promise.all(
          dateRepairs.map((r) =>
            supabase
              .from("moment_import_candidates")
              .update({ event_date: r.event_date, event_end_date: r.event_end_date, when_text: r.when_text })
              .eq("id", r.id)
          )
        )
        console.log(`Repaired ${dateRepairs.length} stale candidate date(s) for user ${userId}, source ${source.id}`)
      }

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
      const failedBatches = batchResultSets.filter((r) => r.failed).length
      extractionFailures += failedBatches

      const rows: Candidate[] = []
      for (let bi = 0; bi < batchChunks.length; bi++) {
        const batch = batchChunks[bi]
        const results = batchResultSets[bi].items
        for (const r of results) {
          // Every event the AI returns an extraction for becomes a pending suggestion — the model
          // no longer decides what is "worth" keeping (founder directive, 2026-08-12: "just simply
          // sync all new events, and let the person decide themselves"). It was rejecting ~88% of
          // what it saw. An event the AI returned NO result for (a failed or partial API response)
          // deliberately gets no row, so it is retried on the next run rather than silently lost.
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

          // Personal calendars routinely name the people IN the title ("Sid and Kate's wedding")
          // rather than listing them as formal ICS attendees (Jake is the only "attendee" of his
          // own calendar entry) — this is what actually surfaces those people. Only ever ADDS
          // already-known people (never proposes a brand-new "unmatched" person from title text
          // alone, unlike real ICS attendees which carry an email as corroborating signal) — a
          // misheard/ambiguous name from free text is much likelier to be a false positive than a
          // formal calendar invite is.
          const alreadyIncluded = new Set(suggestedPeople.map((p) => p.matched_person_id).filter(Boolean))
          const ambiguousMentions: string[] = []
          for (const mentioned of r.mentioned_people ?? []) {
            const key = mentioned.toLowerCase()
            const matchId = idByName[key]
            if (matchId) {
              if (matchId === selfPersonId || alreadyIncluded.has(matchId)) continue
              alreadyIncluded.add(matchId)
              suggestedPeople.push({ name: mentioned, email: null, matched_person_id: matchId, confidence: "high" as const })
            } else if (ambiguousNameToIds[key]) {
              // Deferred to a second pass below, run only after every unambiguous name in this
              // same event has resolved — so "Kate" can be disambiguated via "Sid" regardless of
              // which order the model happened to list them in.
              ambiguousMentions.push(mentioned)
            }
          }
          for (const mentioned of ambiguousMentions) {
            const matchId = resolveAmbiguousName(mentioned.toLowerCase(), alreadyIncluded)
            if (!matchId || matchId === selfPersonId || alreadyIncluded.has(matchId)) continue
            alreadyIncluded.add(matchId)
            suggestedPeople.push({ name: mentioned, email: null, matched_person_id: matchId, confidence: "high" as const })
          }

          // "Meal train for the Mojica family" — a surname mentioned as a family/household
          // reference resolves to EVERY person on file sharing that last name (tracked separately
          // from the single-person mentioned_people/ambiguousMentions matches above, since one
          // surname can legitimately match several people). Feeds the group-suggestion step below.
          const familyMatchedPersonIds: string[] = []
          for (const familyName of r.mentioned_family_names ?? []) {
            const key = familyName.trim().toLowerCase()
            if (!key) continue
            for (const personId of personIdsByLastName[key] ?? []) {
              if (personId === selfPersonId || alreadyIncluded.has(personId)) continue
              alreadyIncluded.add(personId)
              familyMatchedPersonIds.push(personId)
              const p = personById[personId]
              suggestedPeople.push({
                name: p ? `${p.name}${p.last_name ? ` ${p.last_name}` : ""}` : familyName,
                email: null,
                matched_person_id: personId,
                confidence: "high" as const,
              })
            }
          }

          const groupIdFromTitle = r.suggested_group ? groupIndex.resolve(r.suggested_group) : null
          const resolvedPersonIds = suggestedPeople.map((p) => p.matched_person_id).filter((id): id is string => Boolean(id))
          const groupIdsFromSharedMembership = groupsSharedByMultiple(resolvedPersonIds)
          // A family-name match is already a strong, explicit per-person signal (the text named
          // their household directly) — suggest THEIR groups outright rather than requiring a
          // second independently-resolved attendee to also share it, unlike groupsSharedByMultiple's
          // general 2+ bar (e.g. Patrick Mojica alone, matched via "the Mojica family", is enough to
          // suggest his "98th" group even though he's the only resolved attendee).
          const groupIdsFromFamilyMembers = familyMatchedPersonIds.flatMap((pid) => [...(groupIdsByPerson[pid] ?? [])])
          const suggestedGroupIds = [
            ...new Set([groupIdFromTitle, ...groupIdsFromSharedMembership, ...groupIdsFromFamilyMembers].filter((id): id is string => Boolean(id))),
          ]

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
            suggested_group_ids: suggestedGroupIds,
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

      // Nothing is auto-skipped any more, so the re-judging loop this used to guard against is gone
      // by construction: every event now becomes a row on the run it is first seen, which is exactly
      // what keeps it out of the next run's candidate list.
      for (const r of rows) seenUids.add(r.ical_uid)

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

  return { sourcesScanned, candidatesAdded, birthdayCandidatesAdded, extractionFailures }
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
      let totalBirthdayCandidates = 0
      let totalExtractionFailures = 0
      for (const userId of userIds) {
        const { data: userData } = await serviceClient.auth.admin.getUserById(userId)
        const result = await scanUser(serviceClient, userId, userData?.user?.email ?? null)
        totalSources += result.sourcesScanned
        totalCandidates += result.candidatesAdded
        totalBirthdayCandidates += result.birthdayCandidatesAdded
        totalExtractionFailures += result.extractionFailures
      }
      // The scheduled run has no UI to report into, so its only channel is the log — and this line
      // is the difference between "nothing new today" and "nothing was read today."
      if (totalExtractionFailures > 0) {
        console.error(`Scheduled scan: ${totalExtractionFailures} extraction batch(es) FAILED — those events were not read this run`)
      }
      return new Response(
        JSON.stringify({
          usersScanned: userIds.length,
          sourcesScanned: totalSources,
          candidatesAdded: totalCandidates,
          birthdayCandidatesAdded: totalBirthdayCandidates,
          extractionFailures: totalExtractionFailures,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
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
