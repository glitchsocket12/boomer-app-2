import { serve } from "https://deno.land/std@0.224.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import {
  applyFamilySignals,
  familySignalPromptMultiSubject,
  FAMILY_SIGNAL_JSON_FIELD_MULTI_SUBJECT,
  inferLastNameFromSignals,
} from "../_shared/relationships.ts"
import { withMessageCacheBreakpoint } from "../_shared/promptCache.ts"
import { findSelfPerson, buildSelfInstruction } from "../_shared/selfContext.ts"
import { getUserTimeZone } from "../_shared/userSettings.ts"
import { isoDateInTimeZone } from "../_shared/tz.ts"
import { buildGroupNameIndex } from "../_shared/groupNames.ts"
import { sanitizeIsoDate } from "../_shared/dateValidation.ts"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  try {
    const { momentId, messages } = await req.json()

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: req.headers.get("Authorization")! } } }
    )

    const {
      data: { user },
    } = await supabaseClient.auth.getUser()

    if (!user) {
      // Without a valid user, inserts below would silently fail RLS while the AI still
      // claimed things were saved. Fail loudly instead (same reasoning as converse/index.ts).
      return new Response(
        JSON.stringify({ error: "not_authenticated", reply: "Your session has expired — please log out and log back in, then try again." }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    // Six independent reads, fired together instead of one round-trip at a time (same fix as
    // converse/index.ts's roster reads).
    const [
      { data: moment },
      { data: existingNotes },
      { data: people },
      { data: existingGroups },
      { data: existingMomentGroups },
      { data: otherMoments },
    ] = await Promise.all([
      supabaseClient
        .from("moments")
        .select("occasion, location, when_text, event_date, event_end_date, details")
        .eq("id", momentId)
        .single(),
      supabaseClient.from("notes").select("content, person_id").eq("moment_id", momentId),
      supabaseClient
        .from("people")
        .select("id, name, last_name, nicknames, middle_name, goes_by_other, is_self"),
      supabaseClient.from("groups").select("id, name, parent_group_id"),
      supabaseClient.from("moment_groups").select("group_id").eq("moment_id", momentId),
      supabaseClient.from("moments").select("occasion, when_text").neq("id", momentId),
    ])

    const otherEventsRoster = (otherMoments ?? [])
      .map((m: any) => (m.when_text ? `${m.occasion} (${m.when_text})` : m.occasion))
      .filter(Boolean)
      .join(", ")

    // Qualified "Parent / Child" names so a subgroup can be told apart from a same-named one under
    // a different parent — see _shared/groupNames.ts.
    const groupIndex = buildGroupNameIndex(existingGroups ?? [])
    const groupNameById = groupIndex.nameById
    const taggedGroupIds = new Set((existingMomentGroups ?? []).map((mg: any) => mg.group_id))
    const taggedGroupNames = Array.from(taggedGroupIds)
      .map((id) => groupNameById[id])
      .filter(Boolean)
    const groupsRoster = (existingGroups ?? []).map((g) => groupNameById[g.id]).join(", ")

    const nameById: Record<string, string> = {}
    const idByName: Record<string, string> = {}
    const nicknamesById: Record<string, string[]> = {}
    const lastNameById: Record<string, string | null> = {}
    // A bare first name or nickname only maps to a person if that key is unique — otherwise two
    // different people sharing one would collide and whichever loaded last would win every
    // lookup, silently misattaching a note to the wrong person (see PROJECT_HISTORY.md Section 9,
    // the "two Bobs" bug — same fix ported here from converse/index.ts).
    const ambiguousKeys = new Set<string>()
    function claimKey(key: string, id: string) {
      if (!key) return
      if (idByName[key] && idByName[key] !== id) {
        ambiguousKeys.add(key)
      } else {
        idByName[key] = id
      }
    }
    for (const p of people ?? []) {
      const fullName = p.last_name ? `${p.name} ${p.last_name}` : p.name
      nameById[p.id] = fullName
      idByName[fullName.toLowerCase()] = p.id
      lastNameById[p.id] = p.last_name ?? null
      claimKey(p.name.toLowerCase(), p.id)
      const nicknames = (p.nicknames ?? "").split(",").map((n: string) => n.trim()).filter(Boolean)
      // A middle name/callsign the founder set on the profile resolves the same way a nickname
      // does — read-only lookup here, so folding it straight into the same list is safe.
      if (p.middle_name) nicknames.push(String(p.middle_name).trim())
      if (p.goes_by_other) nicknames.push(String(p.goes_by_other).trim())
      if (nicknames.length > 0) nicknamesById[p.id] = nicknames
      for (const nickname of nicknames) claimKey(nickname.toLowerCase(), p.id)
    }
    for (const key of ambiguousKeys) delete idByName[key]

    const peopleRoster = (people ?? [])
      .map((p: any) => {
        const nicknames = nicknamesById[p.id]
        return nicknames ? `${nameById[p.id]} (also goes by: ${nicknames.join(", ")})` : nameById[p.id]
      })
      .join(", ")

    const existingSummary = `Occasion: ${moment?.occasion ?? "unknown"} | Location: ${moment?.location ?? "unknown"} | When (in the user's words): ${moment?.when_text ?? "unknown"} | Resolved calendar date: ${moment?.event_date ?? "not set"} | Resolved end date: ${moment?.event_end_date ?? "not set"} | Already tagged to groups: ${taggedGroupNames.join(", ") || "none"}. Already recorded notes: ${(existingNotes ?? [])
      .map((n: any) => `${nameById[n.person_id] ?? "someone"}: ${n.content}`)
      .join("; ") || "none"}`

    // Computed in the user's own time zone, not the Edge Function's server UTC clock — see the
    // matching comment in converse/index.ts.
    const userTimeZone = await getUserTimeZone(supabaseClient, user.id)
    const todayIso = isoDateInTimeZone(new Date(), userTimeZone)

    // Stable instructions ONLY — no interpolated data, so this exact string is byte-identical
    // across every moment/user/turn and forms a widely-reusable prefix-cache breakpoint (see
    // CLAUDE.md's token/billing efficiency rule and the matching comment in converse/index.ts).
    const stableInstructions = `You are helping the user add more detail to a memory they already recorded in an app called Boomer.

Some people in the roster provided in this prompt have a nickname or "goes by" name shown in parentheses — if the user refers to someone by that nickname, you can use either their real name or the nickname when writing them into "new_people"/"additional_notes", and it will still resolve to the same person.

IMPORTANT — disambiguating people who share a first name or nickname: check the roster provided in this prompt for any other recorded person with the same first name or nickname as whoever you're about to write into "new_people" or "additional_notes". If there's a collision (e.g. two different people both named "Bob", or both going by "Bob"), you MUST use that person's full name (first + last) instead of just the bare first name or nickname. If you can't tell which same-named person the user means from context, ask a quick clarifying question instead of guessing.

IMPORTANT — a term the user uses might actually be the name of one of the OTHER events listed in this prompt (e.g. a race, trip, or reunion with a distinctive name) rather than what it sounds like literally. Check the other-events roster before assuming a name refers to something else (a medical event, a place, etc). If it's genuinely ambiguous which one they mean — or whether they mean an event at all versus something else entirely — don't guess: ask a short, direct clarifying question in "reply" (e.g. "Just to make sure I've got this right — is 'the triple bypass' the bike race you did a few days ago, or something else?"), set "done": false, and leave the other fields empty for that turn. A clarifying question is still a completely ordinary reply — always wrap it in the same JSON shape as everything else.

When the user shares a new detail, don't finish right away — first ask a short, natural follow-up question like "Anything else you remember about this?" so they have a chance to add more. Only set "done": true once the user indicates they're finished (says something like "no," "that's all," or "nothing else").

${familySignalPromptMultiSubject()}

At the end of EVERY turn (not just the final one), respond with ONLY a JSON object in this exact shape and nothing else — no preamble, no commentary, no markdown code fences, just the raw JSON object starting with { and ending with }:
{"reply": "the natural conversational text to show the user", "done": false, "new_people": ["Name1"], "additional_notes": [{"person": "Name1, or null for a general note about the event itself", "note": "short new fact"}], "moment_field_updates": {"occasion": null, "location": null, "when_text": null, "event_date": null, "event_end_date": null}, "add_groups": ["Group Name"], ${FAMILY_SIGNAL_JSON_FIELD_MULTI_SUBJECT}}
This applies even when the user's message covers a sensitive topic like a health event — stay warm and human in the "reply" text itself, but the message as a whole must still be nothing but that one JSON object.

This is saved immediately after every single turn, so only include in "new_people"/"additional_notes"/"moment_field_updates"/"add_groups" whatever is newly given in the user's latest message — never repeat something already reflected in what's already known about this moment.

IMPORTANT — capture EVERY concrete new detail the user gives, not just who attended. An "additional_notes" entry doesn't have to be about a specific person: anything the user says about the event itself — an activity, food, weather, a gift, how it went — belongs in its own entry with "person" set to null, unless it's naturally about one specific attendee (attach it to that person's own note instead). Never let a real detail disappear just because it wasn't about a named person.

CRITICAL — the "Who was there" list on the event page is driven ENTIRELY by "additional_notes": a person only shows up as having attended if they have at least one note tied to this moment. So whenever the user mentions someone was AT this event — even in passing, even with no other detail about them — you MUST still include an entry for them in "additional_notes" (e.g. {"person": "Name1", "note": "Was there."}) so they get linked. Do not just add them to "new_people" and stop — a person with no note attached will silently NOT appear as having attended, which is the whole point of recording them. But "Was there." is a LAST RESORT for someone named with zero detail — if the user actually described what that person did, said, or brought, capture that in their note instead of flattening it to "Was there.".

"moment_field_updates" is for the moment's own top-level fields, not a person-specific fact. Use it when the user gives new or corrected info about the event itself:
- "when_text": the user's own words describing timing (e.g. "fall of 2025"), only when they give timing info different from what's already known.
- "event_date": your best-guess actual calendar date as "YYYY-MM-DD" matching whatever "when_text" you just set. Resolve relative phrases against today's date, given below — this includes ordinal-day phrasing ("the 4th" = the 4th of the current or most recently-implied month), weekday phrasing ("next Tuesday", "last Saturday" = the nearest matching weekday in that direction from today), and compound phrasing ("two weeks from Saturday", "a week from tomorrow" = do the arithmetic from today's date), not just "last week"/whole-season phrasing. If they name a season, use its first day for the year they mean (spring=Mar 1, summer=Jun 1, fall=Sep 1, winter=Dec 1). If they give a specific month/year, use the 1st of that month. If only a year, use January 1. Always give your single closest best guess rather than a range.
- "event_end_date": your best-guess actual END calendar date as "YYYY-MM-DD", ONLY when the user describes or corrects a genuine date RANGE (e.g. "it ran from the 3rd to the 10th", "we were there through the following weekend"). Leave null for a single day or when no end is given — never invent a range that wasn't stated.
- "location" / "occasion": only set when the user is giving new or corrected info for that specific field.
Leave any of these five keys null when the user didn't touch that field this turn.

"add_groups" is for tagging this MOMENT to a recurring, ongoing affiliation — a school, team, military unit, workplace, or friend circle (the "Associated Groups" section on the event page) — NOT a one-off detail. Only add a group here when the user explicitly says this event belongs with/under that affiliation (e.g. "tag this under my high school friends", "this was a Pop Warner thing", "add this to the Air Force Academy group"), or clearly confirms it after you ask. Reuse an existing group by name from the roster provided in this prompt if it's clearly the same thing (e.g. "my high school friends" matching an existing "High School Friends"); otherwise use exactly the name/phrasing they gave you to create a new one. If the user's own framing strongly suggests a recurring affiliation but doesn't say so explicitly enough to be sure, ask a quick clarifying question ("Want me to tag this under a 'High School Friends' group?") instead of guessing — don't invent a group from a passing mention of a place or a single unaffiliated detail. A group in the roster written "Parent / Child" (e.g. "22 AS / Pilots") is a subgroup of "Parent" — when you mean one already on file, copy its name EXACTLY as listed including that form, since a bare "Pilots" when two are on file can't be resolved and the tag is dropped. If the user's phrasing doesn't make clear which same-named subgroup they mean, ask instead of guessing. Only use the "Parent / Child" form for a new group when you specifically mean a new subgroup under an existing parent.`

    // Roster tier — people/groups/other-events, which barely change while the user is mid-
    // conversation adding detail to just this one moment. Its own breakpoint, ordered BEFORE this
    // moment's own summary below, so an ordinary "add another detail" turn (which only updates
    // this moment's own notes) doesn't bust it. 1-hour TTL — see the matching comment in
    // converse/index.ts.
    const selfInfo = findSelfPerson(people, nameById)
    const selfInstruction = await buildSelfInstruction(supabaseClient, selfInfo, nameById)

    const rosterContext = `Here is everyone already recorded, by full name where a last name is known: ${peopleRoster || "(none yet)"}

Here are the groups already on file: ${groupsRoster || "(none yet)"}

Here are the OTHER events/moments already recorded in the app (not this one), by their name and roughly when they happened: ${otherEventsRoster || "(none yet)"}${selfInstruction}`

    // This moment's own summary — changes on essentially every turn in this chat (that's the
    // point of it), so kept on the default 5-minute cache rather than the pricier 1-hour write.
    const momentContext = `Here's what's already known about this moment: ${existingSummary}`

    // Truly per-turn, uncached — see the matching comment in converse/index.ts.
    const todayContext = `Today's date is ${todayIso}.`

    const DEFAULT_PARSED = {
      reply: "Sorry, I didn't get a response there — please try again.",
      done: false,
      new_people: [],
      additional_notes: [],
      moment_field_updates: null,
      add_groups: [],
      family_signals: [],
    }

    async function callModel(): Promise<{ parsed: any; ok: boolean; errorBody?: string }> {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": Deno.env.get("ANTHROPIC_API_KEY") ?? "",
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-sonnet-5",
          max_tokens: 1500,
          // Four tiers ordered stable-to-volatile — see the matching comment in converse/index.ts.
          system: [
            { type: "text", text: stableInstructions, cache_control: { type: "ephemeral", ttl: "1h" } },
            { type: "text", text: rosterContext, cache_control: { type: "ephemeral", ttl: "1h" } },
            { type: "text", text: momentContext, cache_control: { type: "ephemeral" } },
            { type: "text", text: todayContext },
          ],
          // Own breakpoint on the last message — see _shared/promptCache.ts. This is the 4th and
          // last available breakpoint (max 4 per request), so the whole growing conversation
          // thread gets cached too, not just the archive tiers above.
          messages: withMessageCacheBreakpoint(messages),
        }),
      })

      if (!response.ok) {
        const errorBody = await response.text()
        return { parsed: DEFAULT_PARSED, ok: false, errorBody }
      }

      const data = await response.json()
      const textBlock = data.content?.find((b: any) => b.type === "text")

      let parsed: any = { ...DEFAULT_PARSED }
      let rawText = ""
      try {
        rawText = textBlock?.text ?? ""
        const start = rawText.indexOf("{")
        const end = rawText.lastIndexOf("}")
        const jsonSlice = rawText.slice(start, end + 1)
        parsed = { ...parsed, ...JSON.parse(jsonSlice) }
        return { parsed, ok: true }
      } catch (parseError) {
        console.error("Failed to parse AI reply as JSON", String(parseError), "raw text was:", rawText)
        const replyMatch = rawText.match(/"reply"\s*:\s*"((?:[^"\\]|\\.)*)/)
        if (replyMatch) {
          parsed.reply = replyMatch[1].replace(/\\"/g, '"').replace(/\\n/g, "\n")
          return { parsed, ok: true }
        }
        // Couldn't recover even a reply string — the model didn't follow the JSON format at
        // all (e.g. replied in plain prose). Signal failure so the caller can retry once
        // rather than silently discarding whatever the user just said.
        return { parsed: DEFAULT_PARSED, ok: false }
      }
    }

    let result = await callModel()
    if (!result.ok) {
      // One retry: this format failure is usually a one-off stochastic slip, and retrying
      // costs far less than making the user retype what they just told us.
      result = await callModel()
    }

    if (!result.ok) {
      if (result.errorBody) console.error("Anthropic API error", result.errorBody)
      return new Response(
        JSON.stringify({ reply: "Sorry, I'm having trouble responding right now — please try again in a moment.", done: false, changed: false }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    const parsed = result.parsed

    for (const name of parsed.new_people ?? []) {
      const key = name.toLowerCase()
      if (!idByName[key]) {
        const [first, ...rest] = name.trim().split(" ")
        const lastName =
          rest.length > 0 ? rest.join(" ") : inferLastNameFromSignals(name, parsed.family_signals ?? [], { idByName, nameById, lastNameById })
        const { data: newPerson } = await supabaseClient
          .from("people")
          .insert({ user_id: user.id, name: first, last_name: lastName })
          .select()
          .single()
        if (newPerson) {
          idByName[key] = newPerson.id
          nameById[newPerson.id] = name.trim()
        }
      }
    }

    // Applied after new_people so a relationship's subject or named relative can resolve even
    // if this same turn just created them.
    const familyResult = await applyFamilySignals(
      supabaseClient,
      Deno.env.get("ANTHROPIC_API_KEY") ?? "",
      parsed.family_signals ?? [],
      { idByName, nameById, lastNameById },
      user.id
    )

    let notesAdded = 0
    let notesFailed = 0
    for (const note of parsed.additional_notes ?? []) {
      const rawPerson = note.person?.trim()
      // No person named (or explicitly null) — a general event-level detail, same "notes" table,
      // just person_id: null, same as GroupDetail's own manual notes. Not a resolution failure, so
      // it doesn't count against notesFailed.
      if (!rawPerson) {
        const { error: noteError } = await supabaseClient.from("notes").insert({
          person_id: null,
          moment_id: momentId,
          content: note.note,
        })
        if (noteError) {
          console.error("Failed to save general note", noteError.message, JSON.stringify(note))
        } else {
          notesAdded++
        }
        continue
      }
      const personId = idByName[rawPerson.toLowerCase()]
      if (personId) {
        const { error: noteError } = await supabaseClient.from("notes").insert({
          person_id: personId,
          moment_id: momentId,
          content: note.note,
        })
        if (noteError) {
          console.error("Failed to save note", noteError.message, JSON.stringify(note))
          notesFailed++
        } else {
          notesAdded++
        }
      } else {
        console.error("Could not resolve person for note, skipping", JSON.stringify(note), "known names:", Object.keys(idByName))
        notesFailed++
      }
    }

    const fieldUpdates: Record<string, string> = {}
    const updates = parsed.moment_field_updates
    if (updates?.occasion) fieldUpdates.occasion = updates.occasion
    if (updates?.location) fieldUpdates.location = updates.location
    if (updates?.when_text) fieldUpdates.when_text = updates.when_text
    // Drop a hallucinated/malformed date before it ever reaches the moment row — see dateValidation.ts.
    const sanitizedEventDate = sanitizeIsoDate(updates?.event_date)
    const sanitizedEventEndDate = sanitizeIsoDate(updates?.event_end_date)
    if (sanitizedEventDate) fieldUpdates.event_date = sanitizedEventDate
    if (sanitizedEventEndDate) fieldUpdates.event_end_date = sanitizedEventEndDate
    if (Object.keys(fieldUpdates).length > 0) {
      await supabaseClient.from("moments").update(fieldUpdates).eq("id", momentId)
    }

    let groupsTagged = 0
    for (const groupName of parsed.add_groups ?? []) {
      let groupId = groupIndex.resolve(groupName)
      if (!groupId) {
        // "<existing group> / Something" becomes a real subgroup rather than a group literally
        // named that — same reasoning as converse's findOrCreateGroupId.
        const { parentId, childName } = groupIndex.splitParent(groupName)
        const { data: newGroup } = await supabaseClient
          .from("groups")
          .insert({ user_id: user.id, name: childName, parent_group_id: parentId })
          .select()
          .single()
        if (newGroup) {
          groupIndex.add(newGroup)
          groupId = newGroup.id
        }
      }
      if (groupId && !taggedGroupIds.has(groupId)) {
        await supabaseClient
          .from("moment_groups")
          .upsert({ moment_id: momentId, group_id: groupId }, { onConflict: "moment_id,group_id", ignoreDuplicates: true })
        // The group's cached AI summary (see summarize-group) is now stale since its tagged events changed.
        await supabaseClient.from("groups").update({ summary: null }).eq("id", groupId)
        taggedGroupIds.add(groupId)
        groupsTagged++
      }
    }

    const changed = (parsed.new_people?.length ?? 0) > 0 || notesAdded > 0 || Object.keys(fieldUpdates).length > 0 || groupsTagged > 0

    // If everything the user just said failed to save, don't tell them it's handled —
    // the chat bubble is the only feedback they get.
    const reply =
      notesFailed > 0 && notesAdded === 0
        ? "That didn't save — mind trying again?"
        : parsed.reply

    return new Response(
      JSON.stringify({
        reply,
        done: parsed.done === true,
        changed,
        relationshipSuggestions: familyResult.relationshipSuggestions,
        newPersonSuggestions: familyResult.newPersonSuggestions,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    )
  } catch (error) {
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }
})
