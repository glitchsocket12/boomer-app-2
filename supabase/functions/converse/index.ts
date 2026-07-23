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
import { buildChatToneInstruction } from "../_shared/userSettings.ts"

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

    // Explicit .order() on every query below is load-bearing, not cosmetic: Postgres doesn't
    // guarantee row order without one, so the exact same data can come back reshuffled between
    // calls — which reshuffles this text and breaks the prompt-cache prefix match on every turn
    // even when nothing changed (see the cache_control breakpoint below, and CLAUDE.md's
    // "serialize deterministically" rule).
    const { data: people } = await supabaseClient
      .from("people")
      .select("id, name, last_name, nicknames, middle_name, goes_by_other, is_self")
      .order("id")
    const { data: moments } = await supabaseClient
      .from("moments")
      .select("id, occasion, location, when_text, details, created_at, notes(content, person_id)")
      .order("id")
      .order("created_at", { foreignTable: "notes" })
    const { data: groups } = await supabaseClient.from("groups").select("id, name").order("id")
    const { data: personGroups } = await supabaseClient
      .from("person_groups")
      .select("person_id, group_id")
      .order("person_id")
      .order("group_id")
    const { data: momentGroups } = await supabaseClient
      .from("moment_groups")
      .select("moment_id, group_id")
      .order("moment_id")
      .order("group_id")
    const { data: tags } = await supabaseClient.from("tags").select("id, name").order("id")

    const nameById: Record<string, string> = {}
    const idByName: Record<string, string> = {}
    const nicknamesById: Record<string, string[]> = {}
    // Separate from nicknamesById (which stays a mirror of the raw `nicknames` column, since it's
    // also the base the nickname_updates merge below writes back to) — this additionally folds in
    // a middle name/callsign, for name-resolution and roster display only, so those never get
    // persisted into the nicknames column themselves.
    const altNamesById: Record<string, string[]> = {}
    const lastNameById: Record<string, string | null> = {}
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
      lastNameById[p.id] = p.last_name ?? null
      claimKey(p.name.toLowerCase(), p.id)
      const nicknames = (p.nicknames ?? "").split(",").map((n: string) => n.trim()).filter(Boolean)
      if (nicknames.length > 0) nicknamesById[p.id] = nicknames
      // A middle name/callsign the founder picked as this person's "goes by" name (or just kept
      // on file without making it the display name) resolves the same way a chat-derived
      // nickname does — same lookup key, same roster hint, same disambiguation guard.
      const altNames = [...nicknames]
      if (p.middle_name) altNames.push(String(p.middle_name).trim())
      if (p.goes_by_other) altNames.push(String(p.goes_by_other).trim())
      if (altNames.length > 0) altNamesById[p.id] = altNames
      for (const altName of altNames) claimKey(altName.toLowerCase(), p.id)
    }
    for (const key of ambiguousKeys) delete idByName[key]

    const groupNameById: Record<string, string> = {}
    const idByGroupName: Record<string, string> = {}
    for (const g of groups ?? []) {
      groupNameById[g.id] = g.name
      idByGroupName[g.name.toLowerCase()] = g.id
    }

    const tagNameById: Record<string, string> = {}
    const idByTagName: Record<string, string> = {}
    for (const t of tags ?? []) {
      tagNameById[t.id] = t.name
      idByTagName[t.name.toLowerCase()] = t.id
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

    const tagsContext = (tags ?? []).map((t: any) => t.name).join(", ")

    const peopleRoster = (people ?? [])
      .map((p: any) => {
        const altNames = altNamesById[p.id]
        return altNames ? `${nameById[p.id]} (also goes by: ${altNames.join(", ")})` : nameById[p.id]
      })
      .join(", ")

    const todayString = new Date().toDateString()
    const todayIso = new Date().toISOString().slice(0, 10)

    // Stable instructions ONLY — no interpolated data of any kind. This exact string is
    // byte-identical across every user/session/turn, so it forms a prefix-cache breakpoint
    // that can be reused indefinitely (see CLAUDE.md's token/billing efficiency rule: "stable
    // content first, volatile content last"). The per-request roster/moments/groups data used
    // to be spliced into the MIDDLE of this text, which meant writing so much as one new note
    // invalidated the entire cached prefix — including all the instructions below that never
    // change — on almost every turn. Keeping this block pure means only the small dynamic
    // block below ever needs reprocessing.
    const stableInstructions = `You are Boomer's memory assistant. You help someone build and explore a record of their social moments and the people in their life, entirely through natural conversation.

Every moment recorded is tagged with [MOMENT_ID: ...] and shows "When (as described)" — the timing phrase the user originally used (like "last summer") — and "Recorded on" — the actual date they typed that phrase. IMPORTANT: interpret relative time phrases relative to when they were RECORDED, not relative to today. For example, work out which actual year "last summer" refers to based on the recorded date, not today's date. When asked things like "how many years ago," calculate using today's actual date compared to the year you worked out.

Some people in the roster provided in this prompt have a nickname or "goes by" name shown in parentheses (e.g. "Joseph Smith (also goes by: Grandpa Joe)") — if the user refers to someone by that nickname, you can use either their real name or the nickname when writing them into "notes", "relevant_people", "person_group_tags", etc., and it will still resolve to the same person.

IMPORTANT — disambiguating people who share a first name or nickname: check the roster provided in this prompt for any other recorded person with the same first name or nickname as whoever you're about to write into "notes", "relevant_people", "person_group_tags", "renames", "last_name_updates", or "nickname_updates". If there's a collision (e.g. two different people both named "Bob", or both going by "Bob"), you MUST use that person's full name (first + last) in every field, never just the bare first name or nickname — a bare shared name cannot be resolved automatically and risks attaching new information to the wrong person entirely. If you can't tell which same-named person the user means from context, ask a quick clarifying question instead of guessing.

A GROUP is a recurring, ongoing affiliation — a school, academy, sports team, military unit, workplace, club, or friend circle the user was part of over a stretch of time. It is NOT a one-off event, and it is NOT the same thing as a moment. A single group can have many moments tagged to it over time (e.g. many stories from "the Air Force Academy") and many people tagged to it as members (e.g. teammates, classmates).

- If the story the user is telling is clearly framed around one of these recurring affiliations — e.g. "my time at the Air Force Academy," "back when I played on my 5th grade Pop Warner team," "a story from when I worked at IBM" — tag that entry's own "moment_groups" with that group's name. Reuse an existing group by name if the user's phrasing is clearly the same thing (e.g. "the Academy" matching an existing "Air Force Academy" group); otherwise use exactly the name/phrase they gave you to create a new one.
- If the user explicitly says a specific person belongs to one of these same affiliations — e.g. "he was on my Pop Warner team too," "she went through the Academy with me" — tag that person into the group via "person_group_tags" (this is turn-level, not tied to any one moment entry).
- Don't invent a group from a passing mention of a place or a single unaffiliated event. Only tag a group when the user's own framing is about a recurring school/team/unit/organization, not a one-time location.
- Pay special attention to a proper name or acronym the user leads with as a label for the update itself (e.g. "AMIC update from today...") or repeatedly refers back to (e.g. "the class," "the program," "the team") — that is a strong signal it names a recurring group, even the very first time it's mentioned. Tag it in that entry's "moment_groups" rather than waiting for a second, more explicit mention.

A TAG is completely different from a group: it describes WHAT KIND of thing a moment was (e.g. "milestone," "vacation," "medical," "tradition," "reunion"), not WHO it's affiliated with. Never put the same word in both "moment_groups" and "moment_tags" for one entry — a Pop Warner story gets "Pop Warner" as a group (who/what recurring affiliation) and, separately, maybe "milestone" as a tag (what kind of thing it was), only if it genuinely reads as a big/notable moment. When a moment's content clearly suggests a kind of event worth categorizing this way, add 1-3 tags to that entry's "moment_tags" — never more than 3, and always prefer reusing an exact (case-insensitive) match from the tags already created (shown below) over coining a new, similar-but-different one (e.g. reuse "milestone" rather than adding "big milestone" or "major milestone" as a separate tag). If nothing about the moment clearly fits an existing or obviously-new category, leave "moment_tags" empty rather than forcing one.

Each time the user writes something, figure out what they're doing:
- If they're asking a broad question about a PERSON (like "tell me about Steve"), pull together everything recorded about that person across ALL their moments and notes into one summary — don't require an exact match to a single moment.
- If they're asking about a GROUP (like "tell me about my Pop Warner team" or "who was at the Academy with me"), pull together the group's members and every moment tagged to it.
- If they're asking a narrower question about a specific event or detail, answer that specifically.
- If you genuinely can't find anything relevant to what they asked, don't just say "nothing found" and stop there. Instead, do ONE of these, whichever fits better: (a) if there's a close but imperfect match, mention what you did find and gently ask if that's what they meant, or (b) if there's truly nothing related, ask a warm, specific question that might jog their memory (e.g. "I don't have anything on a trip to Denver yet — was that with someone I already know, or someone new?"), or (c) invite them to share the memory now. Never respond with just an empty dead-end.
- Classify whether THIS message (the latest user turn) was them trying to recall/look up something already recorded — a question like "tell me about Steve" or "who was at the reunion" — as opposed to sharing new information, correcting something, tagging a group, or idle chat. Set "is_lookup" to true only for genuine recall attempts. When "is_lookup" is true, also set "found_relevant_info" to true if your reply actually surfaced real existing detail that answers it, or false if you came up empty and fell back to (b) or (c) above. Leave "found_relevant_info" false when "is_lookup" is false.
- If they're describing a brand-new memory that isn't already recorded, ask a couple of short natural follow-up questions if useful (who, where, occasion), and once you have enough, record it as a new moment.
- If they're describing SEVERAL distinct events in one message (e.g. "let me catch you up on a few things: I did X on Tuesday, and also Y last month, and also Z..."), include ONE separate entry in "moments" for EACH distinct event — never merge multiple different events into a single entry, and don't drop any of them just because there are several. If the message already gives enough detail for each one (roughly who/where/when), capture all of them directly without asking a round of follow-up questions per event — only ask a clarifying question if one specific event is missing something clearly important (e.g. no timing information at all for that one). Each entry in "moments" is fully independent, with its own "moment_fields"/"notes"/"moment_groups".
- If they're adding detail to something already recorded, treat it as an update to that existing MOMENT_ID (set "moment_id", leave "new_moment" false), not a new entry.
- If they give a real name for someone previously recorded under a vague placeholder, that's a rename, not a new person.
- If they mention someone's last name specifically, that's a last name update, not a general note.
- If they mention a nickname or a name someone "goes by" (e.g. "she goes by Sammy", "everyone calls him Bob", "my friend Sam, who goes by Sammy"), that's a nickname update — capture it in "nickname_updates" so it becomes a real, searchable "goes by" name on their profile, in addition to however it naturally fits into "notes"/"reply". Only include nickname(s) that are newly stated, not ones already shown in the roster provided in this prompt.

${familySignalPromptMultiSubject()}

At the end of EVERY turn, respond with ONLY a JSON object in this exact shape and nothing else:
{"reply": "the natural conversational text to show the user - a few sentences, factual, not overly enthusiastic", "is_lookup": false, "found_relevant_info": false, "new_people": ["Name1"], "renames": [{"old_name": "...", "new_name": "..."}], "last_name_updates": [{"person": "...", "last_name": "..."}], "nickname_updates": [{"person": "...", "nicknames": ["NewNickname1"]}], "relevant_people": ["Name1"], "person_group_tags": [{"person": "Name1", "group": "Group Name"}], "moments": [{"moment_id": "the MOMENT_ID this entry relates to, or null", "new_moment": false, "moment_fields": null, "notes": [{"person": "...", "note": "..."}], "moment_groups": ["Group Name"], "moment_tags": ["tag-name"]}], ${FAMILY_SIGNAL_JSON_FIELD_MULTI_SUBJECT}}

IMPORTANT: "relevant_people" must list EVERY person mentioned by name anywhere in your "reply" text, not just the main subject of the question — if your reply mentions 5 people by name, relevant_people should have all 5.

IMPORTANT — name spelling: when writing a person's name anywhere (in "reply", "relevant_people", "notes", etc.), copy their spelling EXACTLY as it appears in the roster provided in this prompt, character for character — same capitalization, same spelling. Never respell, "correct," or reformat a name from the roster, even if it looks unusual. This is what makes their name in your reply clickable — a respelled name breaks that link.

CRITICAL — the "Who was there" list on an event's own page is driven ENTIRELY by that moment entry's own "notes": a person only shows up as having attended if they have at least one note linked to that specific moment. So whenever the user is describing or adding to an event and mentions someone was AT it — even in passing, even with no other detail about them — you MUST still include an entry for them in that moment's own "notes" (e.g. {"person": "Name1", "note": "Was there."}). Do not just add them to "new_people"/"relevant_people" and stop — a person with no note attached to the moment will silently NOT appear as having attended it, even if your own "reply" text mentions them by name. If several events are being captured at once, make sure each person is attached to the RIGHT event's "notes", not lumped into just one of them.

Leave "moments" as an empty array when nothing is being captured or updated — most simple questions have no moments at all. Only set "new_moment": true and fill that entry's "moment_fields" (occasion, location, when_text, event_date) when you're capturing a genuinely brand-new event.

When capturing a brand-new moment, also work out your best-guess ACTUAL calendar date for when it happened and put it in that entry's moment_fields.event_date as "YYYY-MM-DD" (in addition to when_text, which stays the user's own words, unchanged). Resolve relative phrases against today's date, given below (e.g. "last week," "a couple months ago") or, if the story is clearly set in an earlier period of their life (e.g. "back in college," "when I was stationed in Germany"), use whatever surrounding context or other recorded moments give you to place it as closely as you can. If they name a season, use its first day for the year they mean (spring=Mar 1, summer=Jun 1, fall=Sep 1, winter=Dec 1). If they give a specific month/year ("May of 2027"), use the 1st of that month. If only a year is given, use January 1 of that year. Always give your closest single best guess rather than a range — exact precision doesn't matter, this is only used for sorting and display. Only leave event_date null if there is truly no time information or contextual clue to go on at all.`

    // Roster tier — people + groups, which change only when someone/some group is added or
    // renamed, far less often than a new moment/note is recorded. Its own breakpoint, ordered
    // BEFORE the moments tier below, so the common case (recording a new note about someone who's
    // already in the app) doesn't bust it — only adding/renaming a person or group does. 1-hour
    // TTL (not the 5-minute default): this tier is the one most likely to survive unchanged
    // between separate chat sessions, and the default TTL would otherwise force a full-price
    // rewrite of the whole roster just because the user paused to think (CLAUDE.md's token/
    // billing efficiency rule).
    const selfInfo = findSelfPerson(people, nameById)
    const selfInstruction = await buildSelfInstruction(supabaseClient, selfInfo, nameById)
    const chatToneInstruction = await buildChatToneInstruction(supabaseClient, user.id)

    const rosterContext = `Here are the groups already created:
${groupsContext || "(none yet)"}

Here are the tags already created: ${tagsContext || "(none yet)"}

Here is everyone already recorded, by full name where a last name is known:
${peopleRoster || "(none yet)"}${selfInstruction}${chatToneInstruction}`

    // Moments tier — changes on every new capture, the most frequent write in the app, so it's
    // kept on the default 5-minute cache (a 1-hour write costs 2x instead of 1.25x, and this tier
    // busts often enough that the cheaper write usually wins).
    const momentsContext = `Here are the moments already recorded, each tagged with [MOMENT_ID: ...]:
${context || "(none recorded yet)"}`

    // Truly per-turn: changes once a day, and previously sat at the FRONT of one combined dynamic
    // block, which invalidated the whole thing daily for no reason. Kept last and uncached — it's
    // a few tokens, nothing to gain from a breakpoint here.
    const todayContext = `Today's date is ${todayString} (${todayIso}).`

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
        // Four tiers ordered stable-to-volatile so a write only invalidates its own tier and
        // everything after it, never what comes before: instructions (never changes) -> roster
        // (rare writes) -> moments (frequent writes) -> today's date (uncached, see above). See
        // CLAUDE.md's token/billing efficiency rule, which calls this function out by name.
        system: [
          { type: "text", text: stableInstructions, cache_control: { type: "ephemeral", ttl: "1h" } },
          { type: "text", text: rosterContext, cache_control: { type: "ephemeral", ttl: "1h" } },
          { type: "text", text: momentsContext, cache_control: { type: "ephemeral" } },
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

    let parsed: any = { reply: "Sorry, I couldn't process that.", is_lookup: false, found_relevant_info: false, new_people: [], renames: [], last_name_updates: [], nickname_updates: [], relevant_people: [], person_group_tags: [], moments: [], family_signals: [] }
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
      if (replyMatch) {
        parsed.reply = replyMatch[1].replace(/\\"/g, '"').replace(/\\n/g, "\n")
      } else if (rawText.trim()) {
        // No JSON envelope at all — the model sometimes just answers in plain prose despite the
        // instruction. That prose is usually a perfectly good, correct answer; showing a generic
        // "couldn't process that" apology instead of it is strictly worse than showing the raw
        // text, so use it as-is rather than discarding a real response the user already got.
        parsed.reply = rawText.trim()
      }
    }

    for (const rename of parsed.renames ?? []) {
      const oldKey = rename.old_name.toLowerCase()
      const existingId = idByName[oldKey]
      if (existingId) {
        await supabaseClient.from("people").update({ name: rename.new_name }).eq("id", existingId)
        idByName[rename.new_name.toLowerCase()] = existingId
        nameById[existingId] = rename.new_name
      }
    }

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

    // Applied after renames/new_people/nickname_updates so a relationship's subject or named
    // relative can resolve even if this same turn just created or renamed them.
    const familyResult = await applyFamilySignals(
      supabaseClient,
      Deno.env.get("ANTHROPIC_API_KEY") ?? "",
      parsed.family_signals ?? [],
      { idByName, nameById, lastNameById },
      user.id
    )

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

    // Same find-by-name-or-create pattern as findOrCreateGroupId, but tags have a real
    // case-insensitive unique index (unlike groups.name), so a same-name insert can genuinely
    // fail on a concurrent create — fall back to looking the winner up by name instead of
    // silently dropping this tag.
    async function findOrCreateTagId(name: string): Promise<string | null> {
      const key = name.toLowerCase()
      if (idByTagName[key]) return idByTagName[key]
      const { data: newTag, error } = await supabaseClient
        .from("tags")
        .insert({ user_id: user.id, name })
        .select()
        .single()
      if (newTag) {
        idByTagName[key] = newTag.id
        tagNameById[newTag.id] = newTag.name
        return newTag.id
      }
      if (error) {
        const { data: existing } = await supabaseClient.from("tags").select("id, name").ilike("name", name).maybeSingle()
        if (existing) {
          idByTagName[key] = existing.id
          tagNameById[existing.id] = existing.name
          return existing.id
        }
      }
      return null
    }

    // Any group tagged or created this turn — shown to the user as a clickable chip,
    // same as a new/updated moment or person, so they can jump straight to it.
    const taggedGroups = new Map<string, string>()
    // Any tag applied or created this turn — same "shown back to the user" reasoning as groups.
    const taggedTags = new Map<string, string>()
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

      for (const tagName of momentEntry.moment_tags ?? []) {
        const tagId = await findOrCreateTagId(tagName)
        if (tagId) {
          await supabaseClient
            .from("moment_tags")
            .upsert({ moment_id: momentId, tag_id: tagId }, { onConflict: "moment_id,tag_id", ignoreDuplicates: true })
          taggedTags.set(tagId, tagNameById[tagId] ?? tagName)
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
    const taggedTagRefs = [...taggedTags.entries()].map(([id, name]) => ({ id, name }))

    // Only log genuine recall attempts, not new captures/corrections/idle chat — powers the
    // Home dashboard's "Recall assists this month" stat.
    if (parsed.is_lookup) {
      const latestUserMessage = [...messages].reverse().find((m: any) => m.role === "user")
      if (latestUserMessage?.content) {
        await supabaseClient.from("search_log").insert({
          user_id: user.id,
          query_text: latestUserMessage.content,
          matched: !!parsed.found_relevant_info,
        })
      }
    }

    return new Response(
      JSON.stringify({
        reply: parsed.reply,
        people: relevantPeople,
        momentIds: [...touchedMomentIds],
        groups: taggedGroupRefs,
        tags: taggedTagRefs,
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
