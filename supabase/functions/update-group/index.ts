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
        "id, name, person_groups(person_id, people(id, name, last_name)), moment_groups(moment_id, moments(id, occasion, raw_description, notes(people(id, name, last_name))))"
      )
      .eq("id", groupId)
      .single()

    const { data: allPeople } = await supabaseClient.from("people").select("id, name, last_name")
    const { data: allMoments } = await supabaseClient.from("moments").select("id, occasion, raw_description")

    const fullName = (p: { name: string; last_name: string | null }) =>
      p.last_name ? `${p.name} ${p.last_name}` : p.name

    // A bare first name only maps to a person if that first name is unique — otherwise two
    // different people sharing a first name would collide (see PROJECT_CONTEXT.md Section 9,
    // the "two Bobs" bug — same fix ported here from converse/update-moment).
    const idByName: Record<string, string> = {}
    const ambiguousFirstNames = new Set<string>()
    for (const p of allPeople ?? []) {
      const name = fullName(p)
      idByName[name.toLowerCase()] = p.id
      const firstKey = p.name.toLowerCase()
      if (idByName[firstKey] && idByName[firstKey] !== p.id) {
        ambiguousFirstNames.add(firstKey)
      } else {
        idByName[firstKey] = p.id
      }
    }
    for (const key of ambiguousFirstNames) delete idByName[key]

    const currentMemberIds = new Set<string>()
    const currentMembers = new Set<string>()
    for (const pg of group?.person_groups ?? []) {
      if (pg.people) {
        currentMemberIds.add(pg.person_id)
        currentMembers.add(fullName(pg.people))
      }
    }
    for (const mg of group?.moment_groups ?? []) {
      for (const n of mg.moments?.notes ?? []) {
        if (n.people) currentMembers.add(fullName(n.people))
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

    const knownPeople = (allPeople ?? []).map((p) => fullName(p)).join(", ")

    const systemPrompt = `You are helping the user edit a group called "${group?.name ?? "Unknown"}" in an app called Boomer. Groups tag together people and events that share a recurring affiliation (a team, a school, a workplace, a family branch, etc.). A group's membership (who belongs to the group) is intentionally independent from which events are tagged to it — someone can be a member without having attended every, or any, tagged event.

Current members: ${currentMembers.size > 0 ? [...currentMembers].join(", ") : "(none recorded)"}
Events already tagged to this group:
${taggedEvents || "(none)"}
Other events NOT tagged to this group (reference these by their exact MOMENT_ID if the user wants to add one):
${otherEvents || "(none)"}
All people already in the app (match against these before assuming someone is new): ${knownPeople || "(none)"}

IMPORTANT — disambiguating people who share a first name: if the user names someone who shares a first name with another recorded person, use that person's full name (first + last) instead of just the bare first name. If you can't tell which same-named person they mean from context, ask instead of guessing.

The user may want to: rename the group, add or remove members (this can be a whole list of names at once, e.g. several relatives), or tag/untag events. Don't finish right away — first ask a short, natural follow-up like "Anything else you'd like to change?" so they have a chance to make more edits in one go. Only set "done": true once the user indicates they're finished (says something like "no," "that's all," or "nothing else").

At the end of EVERY turn (not just the final one), respond with ONLY a JSON object in this exact shape and nothing else:
{"reply": "the natural conversational text to show the user", "done": false, "rename": "New Name or null if not renamed this turn", "add_people": ["Name1"], "remove_people": ["Name2"], "add_event_ids": ["exact MOMENT_ID from the list above"], "remove_event_ids": ["exact MOMENT_ID of an already-tagged event"]}

This is saved immediately after every single turn, so only include in "rename"/"add_people"/"remove_people"/"add_event_ids"/"remove_event_ids" whatever is newly given in the user's latest message — never repeat something already reflected in "Current members" or the tagged-events lists above.`

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
        const lastName = rest.length > 0 ? rest.join(" ") : null
        const { data: newPerson } = await supabaseClient
          .from("people")
          .insert({ user_id: user.id, name: first, last_name: lastName })
          .select()
          .single()
        if (newPerson) {
          personId = newPerson.id
          idByName[key] = personId
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

    if (changed) {
      // Membership/events changed — the cached AI summary is now stale, so clear and regenerate it.
      await supabaseClient.from("groups").update({ summary: null }).eq("id", groupId)
      await supabaseClient.functions.invoke("summarize-group", { body: { groupId } })
    }

    return new Response(JSON.stringify({ reply: parsed.reply, done: parsed.done === true, changed, rename: appliedRename }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  } catch (error) {
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }
})
