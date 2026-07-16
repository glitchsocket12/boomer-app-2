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
    const { messages } = await req.json()

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: req.headers.get("Authorization")! } } }
    )

    const {
      data: { user },
    } = await supabaseClient.auth.getUser()

    if (!user) {
      // Without a valid user, every insert below would silently fail RLS (no error surfaced to the caller)
      // and the AI would still cheerfully claim it saved things that were never written. Fail loudly instead.
      return new Response(
        JSON.stringify({ error: "not_authenticated", reply: "Your session has expired — please log out and log back in, then try again." }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    const { data: people } = await supabaseClient.from("people").select("id, name, last_name")
    const { data: moments } = await supabaseClient
      .from("moments")
      .select("id, occasion, location, when_text, details, created_at, notes(content, person_id)")
    const { data: groups } = await supabaseClient.from("groups").select("id, name")
    const { data: personGroups } = await supabaseClient.from("person_groups").select("person_id, group_id")
    const { data: momentGroups } = await supabaseClient.from("moment_groups").select("moment_id, group_id")

    const nameById: Record<string, string> = {}
    const idByName: Record<string, string> = {}
    for (const p of people ?? []) {
      const fullName = p.last_name ? `${p.name} ${p.last_name}` : p.name
      nameById[p.id] = fullName
      idByName[fullName.toLowerCase()] = p.id
      idByName[p.name.toLowerCase()] = p.id
    }

    const groupNameById: Record<string, string> = {}
    const idByGroupName: Record<string, string> = {}
    for (const g of groups ?? []) {
      groupNameById[g.id] = g.name
      idByGroupName[g.name.toLowerCase()] = g.id
    }

    const groupMemberNamesById: Record<string, string[]> = {}
    for (const pg of personGroups ?? []) {
      const personName = nameById[pg.person_id]
      if (!personName) continue
      ;(groupMemberNamesById[pg.group_id] ??= []).push(personName)
    }

    const momentGroupNamesById: Record<string, string[]> = {}
    for (const mg of momentGroups ?? []) {
      const groupName = groupNameById[mg.group_id]
      if (!groupName) continue
      ;(momentGroupNamesById[mg.moment_id] ??= []).push(groupName)
    }

    const context = (moments ?? [])
      .map((m: any) => {
        const notePeople = (m.notes ?? []).map((n: any) => nameById[n.person_id] ?? "someone")
        const noteLines = (m.notes ?? [])
          .map((n: any) => `${nameById[n.person_id] ?? "someone"}: ${n.content}`)
          .join("; ")
        const recordedOn = new Date(m.created_at).toDateString()
        const momentGroupNames = momentGroupNamesById[m.id] ?? []
        return `[MOMENT_ID: ${m.id}] Occasion: ${m.occasion ?? "unknown"} | Location: ${m.location ?? "unknown"} | When (as described): ${m.when_text ?? "unknown"} | Recorded on: ${recordedOn} | People: ${[...new Set(notePeople)].join(", ")} | Groups: ${momentGroupNames.join(", ") || "none"} | Notes: ${noteLines}`
      })
      .join("\n")

    const groupsContext = (groups ?? [])
      .map((g: any) => `${g.name} (members: ${(groupMemberNamesById[g.id] ?? []).join(", ") || "none yet"})`)
      .join("\n")

    const todayString = new Date().toDateString()
    const todayIso = new Date().toISOString().slice(0, 10)

    const systemPrompt = `You are Boomer's memory assistant. You help someone build and explore a record of their social moments and the people in their life, entirely through natural conversation.

Today's date is ${todayString}.

Here are the moments already recorded, each tagged with [MOMENT_ID: ...]. Each one shows "When (as described)" — the timing phrase the user originally used (like "last summer") — and "Recorded on" — the actual date they typed that phrase. IMPORTANT: interpret relative time phrases relative to when they were RECORDED, not relative to today. For example, work out which actual year "last summer" refers to based on the recorded date, not today's date. When asked things like "how many years ago," calculate using today's actual date compared to the year you worked out.
${context || "(none recorded yet)"}

Here are the groups already created:
${groupsContext || "(none yet)"}

A GROUP is a recurring, ongoing affiliation — a school, academy, sports team, military unit, workplace, club, or friend circle the user was part of over a stretch of time. It is NOT a one-off event, and it is NOT the same thing as a moment. A single group can have many moments tagged to it over time (e.g. many stories from "the Air Force Academy") and many people tagged to it as members (e.g. teammates, classmates).

- If the story the user is telling is clearly framed around one of these recurring affiliations — e.g. "my time at the Air Force Academy," "back when I played on my 5th grade Pop Warner team," "a story from when I worked at IBM" — tag the moment you're recording or updating with that group's name in "moment_groups". Reuse an existing group by name if the user's phrasing is clearly the same thing (e.g. "the Academy" matching an existing "Air Force Academy" group); otherwise use exactly the name/phrase they gave you to create a new one.
- If the user explicitly says a specific person belongs to one of these same affiliations — e.g. "he was on my Pop Warner team too," "she went through the Academy with me" — tag that person into the group via "person_group_tags".
- Don't invent a group from a passing mention of a place or a single unaffiliated event. Only tag a group when the user's own framing is about a recurring school/team/unit/organization, not a one-time location.

Each time the user writes something, figure out what they're doing:
- If they're asking a broad question about a PERSON (like "tell me about Steve"), pull together everything recorded about that person across ALL their moments and notes into one summary — don't require an exact match to a single moment.
- If they're asking about a GROUP (like "tell me about my Pop Warner team" or "who was at the Academy with me"), pull together the group's members and every moment tagged to it.
- If they're asking a narrower question about a specific event or detail, answer that specifically.
- If you genuinely can't find anything relevant to what they asked, don't just say "nothing found" and stop there. Instead, do ONE of these, whichever fits better: (a) if there's a close but imperfect match, mention what you did find and gently ask if that's what they meant, or (b) if there's truly nothing related, ask a warm, specific question that might jog their memory (e.g. "I don't have anything on a trip to Denver yet — was that with someone I already know, or someone new?"), or (c) invite them to share the memory now. Never respond with just an empty dead-end.
- If they're describing a brand-new memory that isn't already recorded, ask a couple of short natural follow-up questions if useful (who, where, occasion), and once you have enough, record it as a new moment.
- If they're adding detail to something already recorded, treat it as an update to that existing MOMENT_ID, not a new one.
- If they give a real name for someone previously recorded under a vague placeholder, that's a rename, not a new person.
- If they mention someone's last name specifically, that's a last name update, not a general note.

At the end of EVERY turn, respond with ONLY a JSON object in this exact shape and nothing else:
{"reply": "the natural conversational text to show the user - a few sentences, factual, not overly enthusiastic", "new_people": ["Name1"], "renames": [{"old_name": "...", "new_name": "..."}], "last_name_updates": [{"person": "...", "last_name": "..."}], "notes": [{"person": "...", "note": "..."}], "moment_id": "the MOMENT_ID this turn relates to, or null", "new_moment": false, "moment_fields": null, "relevant_people": ["Name1"], "moment_groups": ["Group Name"], "person_group_tags": [{"person": "Name1", "group": "Group Name"}]}

IMPORTANT: "relevant_people" must list EVERY person mentioned by name anywhere in your "reply" text, not just the main subject of the question — if your reply mentions 5 people by name, relevant_people should have all 5.

Leave arrays empty and fields null when they don't apply — most simple questions will have empty arrays. Only set "new_moment": true and fill "moment_fields" (occasion, location, when_text, event_date) when you're capturing a genuinely brand-new event.

When capturing a brand-new moment, also work out your best-guess ACTUAL calendar date for when it happened and put it in moment_fields.event_date as "YYYY-MM-DD" (in addition to when_text, which stays the user's own words, unchanged). Today's date is ${todayIso}. Resolve relative phrases against today (e.g. "last week," "a couple months ago") or, if the story is clearly set in an earlier period of their life (e.g. "back in college," "when I was stationed in Germany"), use whatever surrounding context or other recorded moments give you to place it as closely as you can. If they give a specific month/year ("May of 2027"), use the 1st of that month. If only a year is given, use January 1 of that year. Always give your closest single best guess rather than a range — exact precision doesn't matter, this is only used for sorting and display. Only leave event_date null if there is truly no time information or contextual clue to go on at all.`

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": Deno.env.get("ANTHROPIC_API_KEY") ?? "",
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-5",
        max_tokens: 700,
        system: systemPrompt,
        messages: messages,
      }),
    })

    const data = await response.json()
    const textBlock = data.content?.find((b: any) => b.type === "text")

    let parsed: any = { reply: "Sorry, I couldn't process that.", new_people: [], renames: [], last_name_updates: [], notes: [], moment_id: null, new_moment: false, moment_fields: null, relevant_people: [], moment_groups: [], person_group_tags: [] }
    let rawText = ""
    try {
      rawText = textBlock?.text ?? ""
      // Pull out just the JSON object, even if there's stray text before/after it
      const start = rawText.indexOf("{")
      const end = rawText.lastIndexOf("}")
      const jsonSlice = rawText.slice(start, end + 1)
      parsed = { ...parsed, ...JSON.parse(jsonSlice) }
    } catch {
      parsed.reply = rawText || parsed.reply
    }

    for (const rename of parsed.renames ?? []) {
      const oldKey = rename.old_name.toLowerCase()
      const existingId = idByName[oldKey]
      if (existingId) {
        await supabaseClient.from("people").update({ name: rename.new_name }).eq("id", existingId)
        idByName[rename.new_name.toLowerCase()] = existingId
      }
    }

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

    for (const update of parsed.last_name_updates ?? []) {
      const id = idByName[update.person.toLowerCase()]
      if (id) await supabaseClient.from("people").update({ last_name: update.last_name }).eq("id", id)
    }

    let momentId: string | null = parsed.moment_id ?? null
    if (parsed.new_moment) {
      const { data: newMoment } = await supabaseClient
        .from("moments")
        .insert({
          user_id: user.id,
          raw_description: messages.map((m: any) => m.content).join("\n"),
          occasion: parsed.moment_fields?.occasion ?? null,
          location: parsed.moment_fields?.location ?? null,
          when_text: parsed.moment_fields?.when_text ?? null,
          event_date: parsed.moment_fields?.event_date ?? null,
        })
        .select()
        .single()
      if (newMoment) momentId = newMoment.id
    }

    for (const note of parsed.notes ?? []) {
      const personId = idByName[note.person.toLowerCase()]
      if (personId) {
        await supabaseClient.from("notes").insert({
          person_id: personId,
          moment_id: momentId,
          content: note.note,
        })
      }
    }

    async function findOrCreateGroupId(name: string): Promise<string | null> {
      const key = name.toLowerCase()
      if (idByGroupName[key]) return idByGroupName[key]
      const { data: newGroup } = await supabaseClient
        .from("groups")
        .insert({ user_id: user.id, name })
        .select()
        .single()
      if (newGroup) {
        idByGroupName[key] = newGroup.id
        return newGroup.id
      }
      return null
    }

    for (const groupName of parsed.moment_groups ?? []) {
      const groupId = await findOrCreateGroupId(groupName)
      if (groupId && momentId) {
        await supabaseClient
          .from("moment_groups")
          .upsert({ moment_id: momentId, group_id: groupId }, { onConflict: "moment_id,group_id", ignoreDuplicates: true })
      }
    }

    for (const tag of parsed.person_group_tags ?? []) {
      const personId = idByName[tag.person?.toLowerCase()]
      const groupId = tag.group ? await findOrCreateGroupId(tag.group) : null
      if (personId && groupId) {
        await supabaseClient
          .from("person_groups")
          .upsert({ person_id: personId, group_id: groupId }, { onConflict: "person_id,group_id", ignoreDuplicates: true })
      }
    }

    const relevantPeople = (parsed.relevant_people ?? [])
      .map((name: string) => {
        const id = idByName[name.toLowerCase()]
        return id ? { id, name } : null
      })
      .filter(Boolean)

    return new Response(JSON.stringify({ reply: parsed.reply, people: relevantPeople, momentId }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  } catch (error) {
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }
})