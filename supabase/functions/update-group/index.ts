import { serve } from "https://deno.land/std@0.224.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import {
  applyFamilySignals,
  familySignalPromptMultiSubject,
  FAMILY_SIGNAL_JSON_FIELD_MULTI_SUBJECT,
  inferLastNameFromSignals,
} from "../_shared/relationships.ts"
import { withMessageCacheBreakpoint } from "../_shared/promptCache.ts"
import { fetchAllRows } from "../_shared/pagedSelect.ts"
import { findSelfPerson, buildSelfInstruction } from "../_shared/selfContext.ts"

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

    // Paged + ordered, same reasoning as update-moment's roster read (see _shared/pagedSelect.ts).
    const { data: allPeople } = await fetchAllRows((from, to) =>
      supabaseClient
        .from("people")
        .select("id, name, last_name, nicknames, middle_name, goes_by_other, is_self")
        .order("id")
        .range(from, to)
    )
    const { data: allMoments } = await supabaseClient.from("moments").select("id, occasion, raw_description")

    const fullName = (p: { name: string; last_name: string | null }) =>
      p.last_name ? `${p.name} ${p.last_name}` : p.name

    // A bare first name or nickname only maps to a person if that key is unique — otherwise two
    // different people sharing one would collide (see PROJECT_HISTORY.md Section 9, the "two
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
      // A middle name/callsign the founder set on the profile resolves the same way a nickname
      // does — read-only lookup here, so folding it straight into the same list is safe.
      if (p.middle_name) nicknames.push(String(p.middle_name).trim())
      if (p.goes_by_other) nicknames.push(String(p.goes_by_other).trim())
      if (nicknames.length > 0) nicknamesById[p.id] = nicknames
      for (const nickname of nicknames) claimKey(nickname.toLowerCase(), p.id)
    }
    for (const key of ambiguousKeys) delete idByName[key]

    // Members = explicit person_groups roster ONLY. Attending an event tagged to this group
    // doesn't make someone a member (the same event can be tagged to multiple groups), so
    // event attendees are intentionally not folded into this set — matches the system prompt
    // below, which already tells the AI membership is independent of tagged events.
    // `as unknown as` here is the standing PostgREST workaround, not sloppiness: a many-to-one
    // embed is a single object at runtime while the generated types call it an array. See
    // PROJECT_CONTEXT §12 ("Nested-join TS types lie about cardinality — trust the schema").
    const currentMemberIds = new Set<string>()
    const currentMembers = new Set<string>()
    for (const pg of group?.person_groups ?? []) {
      const person = pg.people as unknown as { name: string; last_name: string | null } | null
      if (person) {
        currentMemberIds.add(pg.person_id)
        currentMembers.add(fullName(person))
      }
    }

    const taggedMomentIds = new Set((group?.moment_groups ?? []).map((mg) => mg.moment_id).filter(Boolean))

    const taggedEvents = (group?.moment_groups ?? [])
      .map((mg) => mg.moments as unknown as { id: string; occasion: string | null; raw_description: string } | null)
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

IMPORTANT — disambiguating people who share a first name or nickname: if the user names someone who shares a first name or nickname with another recorded person, use that person's full name (first + last) instead of just the bare first name or nickname. If you can't tell which same-named person they mean from context, set "needs_clarification": true and ask in "reply" instead of guessing.

The user may want to: rename the group, add or remove members (this can be a whole list of names at once, e.g. several relatives), tag/untag events, or mention a plain fact about a member that isn't a membership/event change (e.g. "oh, and Bob mentioned he's retiring this fall") — capture that as a note on that person's own profile via "notes" below, using their exact name from the roster provided in this prompt. Each call covers exactly one thing the user just said — there's no back-and-forth to keep open, so don't ask a follow-up like "anything else?". Only set "needs_clarification": true for a genuine ambiguity you can't resolve without asking; otherwise leave it false and give a brief, natural acknowledgement in "reply".

CRITICAL — never invent, assume, or add a concrete detail the user did not actually say. If they don't state how something happened or how someone felt, don't supply a plausible-sounding guess for it — leave it out entirely. And a "notes" entry only belongs to the member it names when THAT PERSON is the one who did, said, or experienced the thing described — not merely because the sentence is about them (e.g. "we found out Bob's daughter is having a girl" is Bob's note, since he's the one who told the user — it is not a note on the daughter even though she's named).

${familySignalPromptMultiSubject()}

At the end of EVERY turn (not just the final one), respond with ONLY a JSON object in this exact shape and nothing else:
{"reply": "the natural conversational text to show the user", "needs_clarification": false, "rename": "New Name or null if not renamed this turn", "add_people": ["Name1"], "remove_people": ["Name2"], "add_event_ids": ["exact MOMENT_ID from the list of other events"], "remove_event_ids": ["exact MOMENT_ID of an already-tagged event"], "notes": [{"person": "exact name from the roster provided in this prompt", "content": "the fact, written as a short standalone sentence"}], ${FAMILY_SIGNAL_JSON_FIELD_MULTI_SUBJECT}}

This is saved immediately after every single turn, so only include in "rename"/"add_people"/"remove_people"/"add_event_ids"/"remove_event_ids"/"notes" whatever is newly given in the user's latest message — never repeat something already reflected in what's already known about this group.

A PET IS NOT A PERSON. If the user mentions someone's animal, never put the animal's name in "add_people" — that would create a fake human profile in their People list and Dunbar count, and make it a member of this group. Record it as ordinary note text instead. Pets have their own place in the app, recorded from the Home chat or a profile's Pets section, not here.`

    // People roster — changes only when someone new is added/renamed elsewhere in the app, much
    // less often than this group's own membership/events change while the user is actively
    // editing it. Its own breakpoint, ordered first. 1-hour TTL — see the matching comment in
    // converse/index.ts.
    const selfInfo = findSelfPerson(allPeople, nameById)
    const selfInstruction = await buildSelfInstruction(supabaseClient, selfInfo, nameById)

    const peopleContext = `All people already in the app (match against these before assuming someone is new): ${knownPeople || "(none)"}${selfInstruction}`

    // This group's own editable state — changes on essentially every turn in this chat (renaming,
    // adding/removing members, tagging events IS the point of this chat), so kept on the default
    // 5-minute cache rather than the pricier 1-hour write.
    const groupStateContext = `Group being edited: "${group?.name ?? "Unknown"}"

Current members: ${currentMembers.size > 0 ? [...currentMembers].join(", ") : "(none recorded)"}
Events already tagged to this group:
${taggedEvents || "(none)"}
Other events NOT tagged to this group (reference these by their exact MOMENT_ID if the user wants to add one):
${otherEvents || "(none)"}`

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
        // Three tiers ordered stable-to-volatile — see the matching comment in converse/index.ts.
        system: [
          { type: "text", text: stableInstructions, cache_control: { type: "ephemeral", ttl: "1h" } },
          { type: "text", text: peopleContext, cache_control: { type: "ephemeral", ttl: "1h" } },
          { type: "text", text: groupStateContext, cache_control: { type: "ephemeral" } },
        ],
        // Own breakpoint on the last message — see _shared/promptCache.ts. This is the 4th and
        // last available breakpoint (max 4 per request), so the whole growing conversation
        // thread gets cached too, not just the archive tiers above.
        messages: withMessageCacheBreakpoint(messages),
      }),
    })

    if (!response.ok) {
      const errorBody = await response.text()
      console.error("Anthropic API error", response.status, errorBody)
      return new Response(
        JSON.stringify({ reply: "Sorry, I'm having trouble responding right now — please try again in a moment.", needsClarification: false, changed: false }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    const data = await response.json()
    const textBlock = data.content?.find((b: any) => b.type === "text")

    let parsed: any = {
      reply: "Sorry, I didn't get a response there — please try again.",
      needs_clarification: false,
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

    // What actually landed, for the progress checklist the frontend shows after a note (see
    // NoteWithDetection.tsx). Same purpose as update-moment's `applied`, group-shaped.
    const peopleCreated: string[] = []
    const peopleAdded: string[] = []
    const peopleRemoved: string[] = []
    let eventsTagged = 0
    let eventsUntagged = 0
    let notesAdded = 0

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
          peopleCreated.push(name.trim())
        }
      }
      if (personId && !currentMemberIds.has(personId)) {
        await supabaseClient
          .from("person_groups")
          .upsert({ person_id: personId, group_id: groupId }, { onConflict: "person_id,group_id", ignoreDuplicates: true })
        currentMemberIds.add(personId)
        changed = true
        peopleAdded.push(nameById[personId] ?? name.trim())
      }
    }

    for (const name of parsed.remove_people ?? []) {
      const personId = idByName[name.trim().toLowerCase()]
      if (personId) {
        await supabaseClient.from("person_groups").delete().eq("person_id", personId).eq("group_id", groupId)
        currentMemberIds.delete(personId)
        changed = true
        peopleRemoved.push(nameById[personId] ?? name.trim())
      }
    }

    for (const momentId of parsed.add_event_ids ?? []) {
      if (!taggedMomentIds.has(momentId)) {
        await supabaseClient
          .from("moment_groups")
          .upsert({ moment_id: momentId, group_id: groupId }, { onConflict: "moment_id,group_id", ignoreDuplicates: true })
        taggedMomentIds.add(momentId)
        changed = true
        eventsTagged++
      }
    }

    for (const momentId of parsed.remove_event_ids ?? []) {
      await supabaseClient.from("moment_groups").delete().eq("moment_id", momentId).eq("group_id", groupId)
      taggedMomentIds.delete(momentId)
      changed = true
      eventsUntagged++
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
        notesAdded++
      }
    }

    // Applied after add_people so a relationship's subject or named relative can resolve even
    // if this same turn just added them as a member.
    const familyResult = await applyFamilySignals(
      supabaseClient,
      Deno.env.get("ANTHROPIC_API_KEY") ?? "",
      parsed.family_signals ?? [],
      { idByName, nameById, lastNameById },
      user.id
    )

    if (changed) {
      // Membership/events changed — the cached AI summary is now stale, so clear and regenerate it.
      await supabaseClient.from("groups").update({ summary: null }).eq("id", groupId)
      await supabaseClient.functions.invoke("summarize-group", { body: { groupId } })
    }

    return new Response(
      JSON.stringify({
        reply: parsed.reply,
        needsClarification: parsed.needs_clarification === true,
        changed,
        rename: appliedRename,
        // Itemised so the frontend can tick off what actually happened — see update-moment's
        // matching `applied` and NoteWithDetection.tsx.
        applied: { renamed: appliedRename, peopleCreated, peopleAdded, peopleRemoved, eventsTagged, eventsUntagged, notesAdded },
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
