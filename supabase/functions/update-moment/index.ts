import { serve } from "https://deno.land/std@0.224.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

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

    const { data: moment } = await supabaseClient
      .from("moments")
      .select("occasion, location, when_text, event_date, details")
      .eq("id", momentId)
      .single()
    const { data: existingNotes } = await supabaseClient
      .from("notes")
      .select("content, person_id")
      .eq("moment_id", momentId)
    const { data: people } = await supabaseClient.from("people").select("id, name, last_name, nicknames")
    const { data: existingGroups } = await supabaseClient.from("groups").select("id, name")
    const { data: existingMomentGroups } = await supabaseClient
      .from("moment_groups")
      .select("group_id")
      .eq("moment_id", momentId)
    const { data: otherMoments } = await supabaseClient
      .from("moments")
      .select("occasion, when_text")
      .neq("id", momentId)

    const otherEventsRoster = (otherMoments ?? [])
      .map((m: any) => (m.when_text ? `${m.occasion} (${m.when_text})` : m.occasion))
      .filter(Boolean)
      .join(", ")

    const groupNameById: Record<string, string> = {}
    const idByGroupName: Record<string, string> = {}
    for (const g of existingGroups ?? []) {
      groupNameById[g.id] = g.name
      idByGroupName[g.name.toLowerCase()] = g.id
    }
    const taggedGroupIds = new Set((existingMomentGroups ?? []).map((mg: any) => mg.group_id))
    const taggedGroupNames = Array.from(taggedGroupIds)
      .map((id) => groupNameById[id])
      .filter(Boolean)
    const groupsRoster = (existingGroups ?? []).map((g) => g.name).join(", ")

    const nameById: Record<string, string> = {}
    const idByName: Record<string, string> = {}
    const nicknamesById: Record<string, string[]> = {}
    // A bare first name or nickname only maps to a person if that key is unique — otherwise two
    // different people sharing one would collide and whichever loaded last would win every
    // lookup, silently misattaching a note to the wrong person (see PROJECT_CONTEXT.md Section 9,
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
      claimKey(p.name.toLowerCase(), p.id)
      const nicknames = (p.nicknames ?? "").split(",").map((n: string) => n.trim()).filter(Boolean)
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

    const existingSummary = `Occasion: ${moment?.occasion ?? "unknown"} | Location: ${moment?.location ?? "unknown"} | When (in the user's words): ${moment?.when_text ?? "unknown"} | Resolved calendar date: ${moment?.event_date ?? "not set"} | Already tagged to groups: ${taggedGroupNames.join(", ") || "none"}. Already recorded notes: ${(existingNotes ?? [])
      .map((n: any) => `${nameById[n.person_id] ?? "someone"}: ${n.content}`)
      .join("; ") || "none"}`

    const todayIso = new Date().toISOString().slice(0, 10)

    const systemPrompt = `You are helping the user add more detail to a memory they already recorded in an app called Boomer. Today's date is ${todayIso}.

Here's what's already known about this moment: ${existingSummary}

Here is everyone already recorded, by full name where a last name is known: ${peopleRoster || "(none yet)"}

Here are the groups already on file: ${groupsRoster || "(none yet)"}

Here are the OTHER events/moments already recorded in the app (not this one), by their name and roughly when they happened: ${otherEventsRoster || "(none yet)"}

Some people in the roster above have a nickname or "goes by" name shown in parentheses — if the user refers to someone by that nickname, you can use either their real name or the nickname when writing them into "new_people"/"additional_notes", and it will still resolve to the same person.

IMPORTANT — disambiguating people who share a first name or nickname: check the roster above for any other recorded person with the same first name or nickname as whoever you're about to write into "new_people" or "additional_notes". If there's a collision (e.g. two different people both named "Bob", or both going by "Bob"), you MUST use that person's full name (first + last) instead of just the bare first name or nickname. If you can't tell which same-named person the user means from context, ask a quick clarifying question instead of guessing.

IMPORTANT — a term the user uses might actually be the name of one of the OTHER events listed above (e.g. a race, trip, or reunion with a distinctive name) rather than what it sounds like literally. Check the other-events roster before assuming a name refers to something else (a medical event, a place, etc). If it's genuinely ambiguous which one they mean — or whether they mean an event at all versus something else entirely — don't guess: ask a short, direct clarifying question in "reply" (e.g. "Just to make sure I've got this right — is 'the triple bypass' the bike race you did a few days ago, or something else?"), set "done": false, and leave the other fields empty for that turn. A clarifying question is still a completely ordinary reply — always wrap it in the same JSON shape as everything else.

When the user shares a new detail, don't finish right away — first ask a short, natural follow-up question like "Anything else you remember about this?" so they have a chance to add more. Only set "done": true once the user indicates they're finished (says something like "no," "that's all," or "nothing else").

At the end of EVERY turn (not just the final one), respond with ONLY a JSON object in this exact shape and nothing else — no preamble, no commentary, no markdown code fences, just the raw JSON object starting with { and ending with }:
{"reply": "the natural conversational text to show the user", "done": false, "new_people": ["Name1"], "additional_notes": [{"person": "Name1", "note": "short new fact"}], "moment_field_updates": {"occasion": null, "location": null, "when_text": null, "event_date": null}, "add_groups": ["Group Name"]}
This applies even when the user's message covers a sensitive topic like a health event — stay warm and human in the "reply" text itself, but the message as a whole must still be nothing but that one JSON object.

This is saved immediately after every single turn, so only include in "new_people"/"additional_notes"/"moment_field_updates"/"add_groups" whatever is newly given in the user's latest message — never repeat something already reflected in what's already known above.

CRITICAL — the "Who was there" list on the event page is driven ENTIRELY by "additional_notes": a person only shows up as having attended if they have at least one note tied to this moment. So whenever the user mentions someone was AT this event — even in passing, even with no other detail about them — you MUST still include an entry for them in "additional_notes" (e.g. {"person": "Name1", "note": "Was there."}) so they get linked. Do not just add them to "new_people" and stop — a person with no note attached will silently NOT appear as having attended, which is the whole point of recording them.

"moment_field_updates" is for the moment's own top-level fields, not a person-specific fact. Use it when the user gives new or corrected info about the event itself:
- "when_text": the user's own words describing timing (e.g. "fall of 2025"), only when they give timing info different from what's already known.
- "event_date": your best-guess actual calendar date as "YYYY-MM-DD" matching whatever "when_text" you just set. Resolve relative phrases against today's date (${todayIso}). If they name a season, use its first day for the year they mean (spring=Mar 1, summer=Jun 1, fall=Sep 1, winter=Dec 1). If they give a specific month/year, use the 1st of that month. If only a year, use January 1. Always give your single closest best guess rather than a range.
- "location" / "occasion": only set when the user is giving new or corrected info for that specific field.
Leave any of these four keys null when the user didn't touch that field this turn.

"add_groups" is for tagging this MOMENT to a recurring, ongoing affiliation — a school, team, military unit, workplace, or friend circle (the "Affiliated Groups" section on the event page) — NOT a one-off detail. Only add a group here when the user explicitly says this event belongs with/under that affiliation (e.g. "tag this under my high school friends", "this was a Pop Warner thing", "add this to the Air Force Academy group"), or clearly confirms it after you ask. Reuse an existing group by name from the roster above if it's clearly the same thing (e.g. "my high school friends" matching an existing "High School Friends"); otherwise use exactly the name/phrasing they gave you to create a new one. If the user's own framing strongly suggests a recurring affiliation but doesn't say so explicitly enough to be sure, ask a quick clarifying question ("Want me to tag this under a 'High School Friends' group?") instead of guessing — don't invent a group from a passing mention of a place or a single unaffiliated detail.`

    const DEFAULT_PARSED = {
      reply: "Sorry, I didn't get a response there — please try again.",
      done: false,
      new_people: [],
      additional_notes: [],
      moment_field_updates: null,
      add_groups: [],
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
          system: systemPrompt,
          messages,
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
        const lastName = rest.length > 0 ? rest.join(" ") : null
        const { data: newPerson } = await supabaseClient
          .from("people")
          .insert({ user_id: user.id, name: first, last_name: lastName })
          .select()
          .single()
        if (newPerson) idByName[key] = newPerson.id
      }
    }

    let notesAdded = 0
    let notesFailed = 0
    for (const note of parsed.additional_notes ?? []) {
      const personId = idByName[note.person?.toLowerCase()]
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
    if (updates?.event_date) fieldUpdates.event_date = updates.event_date
    if (Object.keys(fieldUpdates).length > 0) {
      await supabaseClient.from("moments").update(fieldUpdates).eq("id", momentId)
    }

    let groupsTagged = 0
    for (const groupName of parsed.add_groups ?? []) {
      const key = groupName.toLowerCase()
      let groupId = idByGroupName[key]
      if (!groupId) {
        const { data: newGroup } = await supabaseClient
          .from("groups")
          .insert({ user_id: user.id, name: groupName })
          .select()
          .single()
        if (newGroup) {
          groupId = newGroup.id
          idByGroupName[key] = groupId
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

    return new Response(JSON.stringify({ reply, done: parsed.done === true, changed }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  } catch (error) {
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }
})
