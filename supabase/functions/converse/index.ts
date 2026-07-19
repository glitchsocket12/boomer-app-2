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

    const { data: people } = await supabaseClient.from("people").select("id, name, last_name, nicknames")
    const { data: moments } = await supabaseClient
      .from("moments")
      .select("id, occasion, location, when_text, details, created_at, notes(content, person_id)")
    const { data: groups } = await supabaseClient.from("groups").select("id, name")
    const { data: personGroups } = await supabaseClient.from("person_groups").select("person_id, group_id")
    const { data: momentGroups } = await supabaseClient.from("moment_groups").select("moment_id, group_id")

    const nameById: Record<string, string> = {}
    const idByName: Record<string, string> = {}
    const nicknamesById: Record<string, string[]> = {}
    // A bare first name or nickname only maps to a person if that key is unique — otherwise two
    // different people sharing one (e.g. two "Bob"s, or two people who both go by "Bob") would
    // silently collide and whichever was processed last would win every lookup, misattributing
    // notes/group tags to the wrong one.
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

    const peopleRoster = (people ?? [])
      .map((p: any) => {
        const nicknames = nicknamesById[p.id]
        return nicknames ? `${nameById[p.id]} (also goes by: ${nicknames.join(", ")})` : nameById[p.id]
      })
      .join(", ")

    const todayString = new Date().toDateString()
    const todayIso = new Date().toISOString().slice(0, 10)

    const systemPrompt = `You are Boomer's memory assistant. You help someone build and explore a record of their social moments and the people in their life, entirely through natural conversation.

Today's date is ${todayString}.

Here are the moments already recorded, each tagged with [MOMENT_ID: ...]. Each one shows "When (as described)" — the timing phrase the user originally used (like "last summer") — and "Recorded on" — the actual date they typed that phrase. IMPORTANT: interpret relative time phrases relative to when they were RECORDED, not relative to today. For example, work out which actual year "last summer" refers to based on the recorded date, not today's date. When asked things like "how many years ago," calculate using today's actual date compared to the year you worked out.
${context || "(none recorded yet)"}

Here are the groups already created:
${groupsContext || "(none yet)"}

Here is everyone already recorded, by full name where a last name is known:
${peopleRoster || "(none yet)"}

Some people in the roster above have a nickname or "goes by" name shown in parentheses (e.g. "Joseph Smith (also goes by: Grandpa Joe)") — if the user refers to someone by that nickname, you can use either their real name or the nickname when writing them into "notes", "relevant_people", "person_group_tags", etc., and it will still resolve to the same person.

IMPORTANT — disambiguating people who share a first name or nickname: check the roster above for any other recorded person with the same first name or nickname as whoever you're about to write into "notes", "relevant_people", "person_group_tags", "renames", "last_name_updates", or "nickname_updates". If there's a collision (e.g. two different people both named "Bob", or both going by "Bob"), you MUST use that person's full name (first + last) in every field, never just the bare first name or nickname — a bare shared name cannot be resolved automatically and risks attaching new information to the wrong person entirely. If you can't tell which same-named person the user means from context, ask a quick clarifying question instead of guessing.

A GROUP is a recurring, ongoing affiliation — a school, academy, sports team, military unit, workplace, club, or friend circle the user was part of over a stretch of time. It is NOT a one-off event, and it is NOT the same thing as a moment. A single group can have many moments tagged to it over time (e.g. many stories from "the Air Force Academy") and many people tagged to it as members (e.g. teammates, classmates).

- If the story the user is telling is clearly framed around one of these recurring affiliations — e.g. "my time at the Air Force Academy," "back when I played on my 5th grade Pop Warner team," "a story from when I worked at IBM" — tag that entry's own "moment_groups" with that group's name. Reuse an existing group by name if the user's phrasing is clearly the same thing (e.g. "the Academy" matching an existing "Air Force Academy" group); otherwise use exactly the name/phrase they gave you to create a new one.
- If the user explicitly says a specific person belongs to one of these same affiliations — e.g. "he was on my Pop Warner team too," "she went through the Academy with me" — tag that person into the group via "person_group_tags" (this is turn-level, not tied to any one moment entry).
- Don't invent a group from a passing mention of a place or a single unaffiliated event. Only tag a group when the user's own framing is about a recurring school/team/unit/organization, not a one-time location.
- Pay special attention to a proper name or acronym the user leads with as a label for the update itself (e.g. "AMIC update from today...") or repeatedly refers back to (e.g. "the class," "the program," "the team") — that is a strong signal it names a recurring group, even the very first time it's mentioned. Tag it in that entry's "moment_groups" rather than waiting for a second, more explicit mention.

Each time the user writes something, figure out what they're doing:
- If they're asking a broad question about a PERSON (like "tell me about Steve"), pull together everything recorded about that person across ALL their moments and notes into one summary — don't require an exact match to a single moment.
- If they're asking about a GROUP (like "tell me about my Pop Warner team" or "who was at the Academy with me"), pull together the group's members and every moment tagged to it.
- If they're asking a narrower question about a specific event or detail, answer that specifically.
- If you genuinely can't find anything relevant to what they asked, don't just say "nothing found" and stop there. Instead, do ONE of these, whichever fits better: (a) if there's a close but imperfect match, mention what you did find and gently ask if that's what they meant, or (b) if there's truly nothing related, ask a warm, specific question that might jog their memory (e.g. "I don't have anything on a trip to Denver yet — was that with someone I already know, or someone new?"), or (c) invite them to share the memory now. Never respond with just an empty dead-end.
- If they're describing a brand-new memory that isn't already recorded, ask a couple of short natural follow-up questions if useful (who, where, occasion), and once you have enough, record it as a new moment.
- If they're describing SEVERAL distinct events in one message (e.g. "let me catch you up on a few things: I did X on Tuesday, and also Y last month, and also Z..."), include ONE separate entry in "moments" for EACH distinct event — never merge multiple different events into a single entry, and don't drop any of them just because there are several. If the message already gives enough detail for each one (roughly who/where/when), capture all of them directly without asking a round of follow-up questions per event — only ask a clarifying question if one specific event is missing something clearly important (e.g. no timing information at all for that one). Each entry in "moments" is fully independent, with its own "moment_fields"/"notes"/"moment_groups".
- If they're adding detail to something already recorded, treat it as an update to that existing MOMENT_ID (set "moment_id", leave "new_moment" false), not a new entry.
- If they give a real name for someone previously recorded under a vague placeholder, that's a rename, not a new person.
- If they mention someone's last name specifically, that's a last name update, not a general note.
- If they mention a nickname or a name someone "goes by" (e.g. "she goes by Sammy", "everyone calls him Bob", "my friend Sam, who goes by Sammy"), that's a nickname update — capture it in "nickname_updates" so it becomes a real, searchable "goes by" name on their profile, in addition to however it naturally fits into "notes"/"reply". Only include nickname(s) that are newly stated, not ones already shown in the roster above.

At the end of EVERY turn, respond with ONLY a JSON object in this exact shape and nothing else:
{"reply": "the natural conversational text to show the user - a few sentences, factual, not overly enthusiastic", "new_people": ["Name1"], "renames": [{"old_name": "...", "new_name": "..."}], "last_name_updates": [{"person": "...", "last_name": "..."}], "nickname_updates": [{"person": "...", "nicknames": ["NewNickname1"]}], "relevant_people": ["Name1"], "person_group_tags": [{"person": "Name1", "group": "Group Name"}], "moments": [{"moment_id": "the MOMENT_ID this entry relates to, or null", "new_moment": false, "moment_fields": null, "notes": [{"person": "...", "note": "..."}], "moment_groups": ["Group Name"]}]}

IMPORTANT: "relevant_people" must list EVERY person mentioned by name anywhere in your "reply" text, not just the main subject of the question — if your reply mentions 5 people by name, relevant_people should have all 5.

IMPORTANT — name spelling: when writing a person's name anywhere (in "reply", "relevant_people", "notes", etc.), copy their spelling EXACTLY as it appears in the roster above, character for character — same capitalization, same spelling. Never respell, "correct," or reformat a name from the roster, even if it looks unusual. This is what makes their name in your reply clickable — a respelled name breaks that link.

CRITICAL — the "Who was there" list on an event's own page is driven ENTIRELY by that moment entry's own "notes": a person only shows up as having attended if they have at least one note linked to that specific moment. So whenever the user is describing or adding to an event and mentions someone was AT it — even in passing, even with no other detail about them — you MUST still include an entry for them in that moment's own "notes" (e.g. {"person": "Name1", "note": "Was there."}). Do not just add them to "new_people"/"relevant_people" and stop — a person with no note attached to the moment will silently NOT appear as having attended it, even if your own "reply" text mentions them by name. If several events are being captured at once, make sure each person is attached to the RIGHT event's "notes", not lumped into just one of them.

Leave "moments" as an empty array when nothing is being captured or updated — most simple questions have no moments at all. Only set "new_moment": true and fill that entry's "moment_fields" (occasion, location, when_text, event_date) when you're capturing a genuinely brand-new event.

When capturing a brand-new moment, also work out your best-guess ACTUAL calendar date for when it happened and put it in that entry's moment_fields.event_date as "YYYY-MM-DD" (in addition to when_text, which stays the user's own words, unchanged). Today's date is ${todayIso}. Resolve relative phrases against today (e.g. "last week," "a couple months ago") or, if the story is clearly set in an earlier period of their life (e.g. "back in college," "when I was stationed in Germany"), use whatever surrounding context or other recorded moments give you to place it as closely as you can. If they give a specific month/year ("May of 2027"), use the 1st of that month. If only a year is given, use January 1 of that year. Always give your closest single best guess rather than a range — exact precision doesn't matter, this is only used for sorting and display. Only leave event_date null if there is truly no time information or contextual clue to go on at all.`

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
        system: systemPrompt,
        messages: messages,
      }),
    })

    if (!response.ok) {
      const errorBody = await response.text()
      console.error("Anthropic API error", response.status, errorBody)
      return new Response(
        JSON.stringify({
          reply: `The AI service had trouble responding just now (error ${response.status}). Please try again in a moment.`,
          people: [],
          momentIds: [],
          groups: [],
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    const data = await response.json()
    const textBlock = data.content?.find((b: any) => b.type === "text")

    if (!textBlock) {
      console.error("Anthropic response had no text block", JSON.stringify(data))
    }

    let parsed: any = { reply: "Sorry, I couldn't process that.", new_people: [], renames: [], last_name_updates: [], nickname_updates: [], relevant_people: [], person_group_tags: [], moments: [] }
    let rawText = ""
    try {
      rawText = textBlock?.text ?? ""
      // Pull out just the JSON object, even if there's stray text before/after it
      const start = rawText.indexOf("{")
      const end = rawText.lastIndexOf("}")
      const jsonSlice = rawText.slice(start, end + 1)
      parsed = { ...parsed, ...JSON.parse(jsonSlice) }
    } catch (parseError) {
      console.error("Failed to parse AI reply as JSON", String(parseError), "raw text was:", rawText)
      // The JSON was likely truncated mid-generation (hit max_tokens) — pull just the "reply" text
      // out with a regex so the user sees a normal sentence instead of a raw JSON fragment.
      const replyMatch = rawText.match(/"reply"\s*:\s*"((?:[^"\\]|\\.)*)/)
      parsed.reply = replyMatch ? replyMatch[1].replace(/\\"/g, '"').replace(/\\n/g, "\n") : parsed.reply
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

    for (const update of parsed.nickname_updates ?? []) {
      const id = idByName[update.person?.trim().toLowerCase()]
      const newNicknames = Array.isArray(update.nicknames) ? update.nicknames : []
      if (!id || newNicknames.length === 0) continue
      // Additive merge, same dedupe-by-lowercase behavior as add-fact's name_update handling —
      // a nickname mentioned mid-conversation should land in the same searchable field a
      // profile-page edit would, not just in the note text.
      const existing = nicknamesById[id] ?? []
      const merged = [...existing]
      for (const nickname of newNicknames) {
        const trimmed = String(nickname).trim()
        if (trimmed && !merged.some((n) => n.toLowerCase() === trimmed.toLowerCase())) merged.push(trimmed)
      }
      if (merged.length > existing.length) {
        await supabaseClient.from("people").update({ nicknames: merged.join(", ") }).eq("id", id)
        nicknamesById[id] = merged
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

    // Any group tagged or created this turn — shown to the user as a clickable chip,
    // same as a new/updated moment or person, so they can jump straight to it.
    const taggedGroups = new Map<string, string>()
    // Every moment touched this turn (created or updated) — a single message can now describe
    // several distinct events at once, so this is a list rather than one moment ID.
    const touchedMomentIds = new Set<string>()
    const rawDescription = messages.filter((m: any) => m.role === "user").map((m: any) => m.content).join("\n")

    for (const momentEntry of parsed.moments ?? []) {
      let momentId: string | null = momentEntry.moment_id ?? null

      if (momentEntry.new_moment) {
        const { data: newMoment } = await supabaseClient
          .from("moments")
          .insert({
            user_id: user.id,
            raw_description: rawDescription,
            occasion: momentEntry.moment_fields?.occasion ?? null,
            location: momentEntry.moment_fields?.location ?? null,
            when_text: momentEntry.moment_fields?.when_text ?? null,
            event_date: momentEntry.moment_fields?.event_date ?? null,
          })
          .select()
          .single()
        if (newMoment) momentId = newMoment.id
      }

      if (!momentId) continue
      touchedMomentIds.add(momentId)

      for (const note of momentEntry.notes ?? []) {
        const personId = idByName[note.person?.trim().toLowerCase()]
        if (personId) {
          await supabaseClient.from("notes").insert({
            person_id: personId,
            moment_id: momentId,
            content: note.note,
            source: "home",
          })
        }
      }

      for (const groupName of momentEntry.moment_groups ?? []) {
        const groupId = await findOrCreateGroupId(groupName)
        if (groupId) {
          await supabaseClient
            .from("moment_groups")
            .upsert({ moment_id: momentId, group_id: groupId }, { onConflict: "moment_id,group_id", ignoreDuplicates: true })
          taggedGroups.set(groupId, groupNameById[groupId] ?? groupName)
        }
      }
    }

    for (const tag of parsed.person_group_tags ?? []) {
      const personId = idByName[tag.person?.trim().toLowerCase()]
      const groupId = tag.group ? await findOrCreateGroupId(tag.group) : null
      if (personId && groupId) {
        await supabaseClient
          .from("person_groups")
          .upsert({ person_id: personId, group_id: groupId }, { onConflict: "person_id,group_id", ignoreDuplicates: true })
        taggedGroups.set(groupId, groupNameById[groupId] ?? tag.group)
      }
    }

    const relevantPeople = (parsed.relevant_people ?? [])
      .map((name: string) => {
        const id = idByName[name.trim().toLowerCase()]
        // Always render the canonical profile spelling on the button, never whatever the AI
        // typed — guarantees the button is spelled correctly even if the reply prose isn't.
        return id ? { id, name: nameById[id] } : null
      })
      .filter(Boolean)

    const taggedGroupRefs = [...taggedGroups.entries()].map(([id, name]) => ({ id, name }))

    return new Response(
      JSON.stringify({ reply: parsed.reply, people: relevantPeople, momentIds: [...touchedMomentIds], groups: taggedGroupRefs }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    )
  } catch (error) {
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }
})
