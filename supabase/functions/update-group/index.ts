import { serve } from "https://deno.land/std@0.224.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import {
  applyFamilySignals,
  familySignalPromptMultiSubject,
  FAMILY_SIGNAL_JSON_FIELD_MULTI_SUBJECT,
  inferLastNameFromSignals,
} from "../_shared/relationships.ts"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  try {
    const { groupId, messages } = await req.json()

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: req.headers.get("Authorization")! } } }
    )

    const {
      data: { user },
    } = await supabaseClient.auth.getUser()

    if (!user) {
      // Without a valid user, writes below would silently fail RLS while the AI still
      // claimed things were saved. Fail loudly instead (same reasoning as converse/index.ts).
      return new Response(
        JSON.stringify({ error: "not_authenticated", reply: "Your session has expired — please log out and log back in, then try again." }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    const { data: group } = await supabaseClient
      .from("groups")
      .select(
        "id, name, person_groups(person_id, people(id, name, last_name)), moment_groups(moment_id, moments(id, occasion, raw_description))"
      )
      .eq("id", groupId)
      .single()

    const { data: allPeople } = await supabaseClient.from("people").select("id, name, last_name, nicknames")
    const { data: allMoments } = await supabaseClient.from("moments").select("id, occasion, raw_description")

    const fullName = (p: { name: string; last_name: string | null }) =>
      p.last_name ? `${p.name} ${p.last_name}` : p.name

    // A bare first name or nickname only maps to a person if that key is unique — otherwise two
    // different people sharing one would collide (see PROJECT_CONTEXT.md Section 9, the "two
    // Bobs" bug — same fix ported here from converse/update-moment).
    const idByName: Record<string, string> = {}
    const nameById: Record<string, string> = {}
    const nicknamesById: Record<string, string[]> = {}
    const lastNameById: Record<string, string | null> = {}
    const ambiguousKeys = new Set<string>()
    function claimKey(key: string, id: string) {
      if (!key) return
      if (idByName[key] && idByName[key] !== id) {
        ambiguousKeys.add(key)
      } else {
        idByName[key] = id
      }
    }
    for (const p of allPeople ?? []) {
      const name = fullName(p)
      nameById[p.id] = name
      idByName[name.toLowerCase()] = p.id
      lastNameById[p.id] = p.last_name ?? null
      claimKey(p.name.toLowerCase(), p.id)
      const nicknames = (p.nicknames ?? "").split(",").map((n: string) => n.trim()).filter(Boolean)
      if (nicknames.length > 0) nicknamesById[p.id] = nicknames
      for (const nickname of nicknames) claimKey(nickname.toLowerCase(), p.id)
    }
    for (const key of ambiguousKeys) delete idByName[key]

    // Members = explicit person_groups roster ONLY. Attending an event tagged to this group
    // doesn't make someone a member (the same event can be tagged to multiple groups), so
    // event attendees are intentionally not folded into this set — matches the system prompt
    // below, which already tells the AI membership is independent of tagged events.
    const currentMemberIds = new Set<string>()
    const currentMembers = new Set<string>()
    for (const pg of group?.person_groups ?? []) {
      if (pg.people) {
        currentMemberIds.add(pg.person_id)
        currentMembers.add(fullName(pg.people))
      }
    }

    const taggedMomentIds = new Set((group?.moment_groups ?? []).map((mg) => mg.moment_id).filter(Boolean))

    const taggedEvents = (group?.moment_groups ?? [])
      .map((mg) => mg.moments)
      .filter((m): m is { id: string; occasion: string | null; raw_description: string } => m !== null)
      .map((m) => `[MOMENT_ID: ${m.id}] ${m.occasion || m.raw_description}`)
      .join("\n")

    const otherEvents = (allMoments ?? [])
      .filter((m) => !taggedMomentIds.has(m.id))
      .map((m) => `[MOMENT_ID: ${m.id}] ${m.occasion || m.raw_description}`)
      .join("\n")

    const knownPeople = (allPeople ?? [])
      .map((p) => {
        const nicknames = nicknamesById[p.id]
        return nicknames ? `${fullName(p)} (also goes by: ${nicknames.join(", ")})` : fullName(p)
      })
      .join(", ")

    // Stable instructions ONLY — no interpolated data, so this exact string is byte-identical
    // across every group/user/turn and forms a widely-reusable prefix-cache breakpoint (see
    // CLAUDE.md's token/billing efficiency rule and the matching comment in converse/index.ts).
    const stableInstructions = `You are helping the user edit a group in an app called Boomer. Groups tag together people and events that share a recurring affiliation (a team, a school, a workplace, a family branch, etc.). A group's membership (who belongs to the group) is intentionally independent from which events are tagged to it — someone can be a member without having attended every, or any, tagged event.

Some people in the roster provided in this prompt have a nickname or "goes by" name shown in parentheses — if the user refers to someone by that nickname, you can use either their real name or the nickname, and it will still resolve to the same person.

IMPORTANT — disambiguating people who share a first name or nickname: if the user names someone who shares a first name or nickname with another recorded person, use that person's full name (first + last) instead of just the bare first name or nickname. If you can't tell which same-named person they mean from context, ask instead of guessing.

The user may want to: rename the group, add or remove members (this can be a whole list of names at once, e.g. several relatives), tag/untag events, or mention a plain fact about a member that isn't a membership/event change (e.g. "oh, and Bob mentioned he's retiring this fall") — capture that as a note on that person's own profile via "notes" below, using their exact name from the roster provided in this prompt. Don't finish right away — first ask a short, natural follow-up like "Anything else you'd like to change?" so they have a chance to make more edits in one go. Only set "done": true once the user indicates they're finished (says something like "no," "that's all," or "nothing else").

${familySignalPromptMultiSubject()}

At the end of EVERY turn (not just the final one), respond with ONLY a JSON object in this exact shape and nothing else:
{"reply": "the natural conversational text to show the user", "done": false, "rename": "New Name or null if not renamed this turn", "add_people": ["Name1"], "remove_people": ["Name2"], "add_event_ids": ["exact MOMENT_ID from the list of other events"], "remove_event_ids": ["exact MOMENT_ID of an already-tagged event"], "notes": [{"person": "exact name from the roster provided in this prompt", "content": "the fact, written as a short standalone sentence"}], ${FAMILY_SIGNAL_JSON_FIELD_MULTI_SUBJECT}}

This is saved immediately after every single turn, so only include in "rename"/"add_people"/"remove_people"/"add_event_ids"/"remove_event_ids"/"notes" whatever is newly given in the user's latest message — never repeat something already reflected in what's already known about this group.`

    // Per-request volatile data ONLY — this group's current members/events plus the full
    // people/events roster, which changes as soon as the user edits the group. Its own
    // trailing block (own breakpoint) so a write between turns only invalidates this, not
    // the much larger stable instructions above.
    const dynamicContext = `Group being edited: "${group?.name ?? "Unknown"}"

Current members: ${currentMembers.size > 0 ? [...currentMembers].join(", ") : "(none recorded)"}
Events already tagged to this group:
${taggedEvents || "(none)"}
Other events NOT tagged to this group (reference these by their exact MOMENT_ID if the user wants to add one):
${otherEvents || "(none)"}
All people already in the app (match against these before assuming someone is new): ${knownPeople || "(none)"}`

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
        // Two breakpoints — see the matching comment in converse/index.ts.
        system: [
          { type: "text", text: stableInstructions, cache_control: { type: "ephemeral" } },
          { type: "text", text: dynamicContext, cache_control: { type: "ephemeral" } },
        ],
        messages,
      }),
    })

    if (!response.ok) {
      const errorBody = await response.text()
      console.error("Anthropic API error", response.status, errorBody)
      return new Response(
        JSON.stringify({ reply: "Sorry, I'm having trouble responding right now — please try again in a moment.", done: false, changed: false }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    const data = await response.json()
    const textBlock = data.content?.find((b: any) => b.type === "text")

    let parsed: any = {
      reply: "Sorry, I didn't get a response there — please try again.",
      done: false,
      rename: null,
      add_people: [],
      remove_people: [],
      add_event_ids: [],
      remove_event_ids: [],
      notes: [],
      family_signals: [],
    }
    let rawText = ""
    try {
      rawText = textBlock?.text ?? ""
      const start = rawText.indexOf("{")
      const end = rawText.lastIndexOf("}")
      const jsonSlice = rawText.slice(start, end + 1)
      parsed = { ...parsed, ...JSON.parse(jsonSlice) }
    } catch (parseError) {
      console.error("Failed to parse AI reply as JSON", String(parseError), "raw text was:", rawText)
      const replyMatch = rawText.match(/"reply"\s*:\s*"((?:[^"\\]|\\.)*)/)
      parsed.reply = replyMatch ? replyMatch[1].replace(/\\"/g, '"').replace(/\\n/g, "\n") : parsed.reply
    }

    let changed = false
    let appliedRename: string | null = null

    if (parsed.rename && parsed.rename.trim()) {
      appliedRename = parsed.rename.trim()
      await supabaseClient.from("groups").update({ name: appliedRename }).eq("id", groupId)
      changed = true
    }

    for (const name of parsed.add_people ?? []) {
      const key = name.trim().toLowerCase()
      if (!key) continue
      let personId = idByName[key]
      if (!personId) {
        const [first, ...rest] = name.trim().split(" ")
        const lastName =
          rest.length > 0 ? rest.join(" ") : inferLastNameFromSignals(name, parsed.family_signals ?? [], { idByName, nameById, lastNameById })
        const { data: newPerson } = await supabaseClient
          .from("people")
          .insert({ user_id: user.id, name: first, last_name: lastName })
          .select()
          .single()
        if (newPerson) {
          personId = newPerson.id
          idByName[key] = personId
          nameById[personId] = name.trim()
        }
      }
      if (personId && !currentMemberIds.has(personId)) {
        await supabaseClient
          .from("person_groups")
          .upsert({ person_id: personId, group_id: groupId }, { onConflict: "person_id,group_id", ignoreDuplicates: true })
        currentMemberIds.add(personId)
        changed = true
      }
    }

    for (const name of parsed.remove_people ?? []) {
      const personId = idByName[name.trim().toLowerCase()]
      if (personId) {
        await supabaseClient.from("person_groups").delete().eq("person_id", personId).eq("group_id", groupId)
        currentMemberIds.delete(personId)
        changed = true
      }
    }

    for (const momentId of parsed.add_event_ids ?? []) {
      if (!taggedMomentIds.has(momentId)) {
        await supabaseClient
          .from("moment_groups")
          .upsert({ moment_id: momentId, group_id: groupId }, { onConflict: "moment_id,group_id", ignoreDuplicates: true })
        taggedMomentIds.add(momentId)
        changed = true
      }
    }

    for (const momentId of parsed.remove_event_ids ?? []) {
      await supabaseClient.from("moment_groups").delete().eq("moment_id", momentId).eq("group_id", groupId)
      taggedMomentIds.delete(momentId)
      changed = true
    }

    for (const note of parsed.notes ?? []) {
      const personId = idByName[note.person?.trim().toLowerCase()]
      if (personId && note.content?.trim()) {
        await supabaseClient.from("notes").insert({
          person_id: personId,
          moment_id: null,
          content: note.content.trim(),
          source_group_id: groupId,
        })
        changed = true
      }
    }

    // Applied after add_people so a relationship's subject or named relative can resolve even
    // if this same turn just added them as a member.
    const familyResult = await applyFamilySignals(
      supabaseClient,
      Deno.env.get("ANTHROPIC_API_KEY") ?? "",
      parsed.family_signals ?? [],
      { idByName, nameById, lastNameById }
    )

    if (changed) {
      // Membership/events changed — the cached AI summary is now stale, so clear and regenerate it.
      await supabaseClient.from("groups").update({ summary: null }).eq("id", groupId)
      await supabaseClient.functions.invoke("summarize-group", { body: { groupId } })
    }

    return new Response(
      JSON.stringify({
        reply: parsed.reply,
        done: parsed.done === true,
        changed,
        rename: appliedRename,
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
