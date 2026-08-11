import { serve } from "https://deno.land/std@0.224.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import {
  applyFamilySignals,
  familySignalPromptMultiSubject,
  FAMILY_SIGNAL_JSON_FIELD_MULTI_SUBJECT,
  inferLastNameFromSignals,
} from "../_shared/relationships.ts"
import { withMessageCacheBreakpoint } from "../_shared/promptCache.ts"
import { findSelfPerson, buildSelfInstruction, buildKinInstruction } from "../_shared/selfContext.ts"
import { fetchAllRelationshipRows } from "../_shared/relationshipsTable.ts"
import { buildFamilyRoster } from "../_shared/familyRoster.ts"
import { buildChatToneInstruction, getUserTimeZone } from "../_shared/userSettings.ts"
import { isoDateInTimeZone, fullDateInTimeZone } from "../_shared/tz.ts"
import { sanitizeIsoDate } from "../_shared/dateValidation.ts"
import { buildGroupNameIndex } from "../_shared/groupNames.ts"
import { rollUpGroupMemberIds } from "../_shared/groupRollup.ts"
import { fetchAllRows } from "../_shared/pagedSelect.ts"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

// PostgREST caps any single response at 1000 rows and says nothing about having done it, so an
// unpaged select just stops early and looks successful. person_groups is the one table here big
// enough to hit that (1183 rows on the founder's account when this was written, 2026-08-10) —
// which meant the model was being handed a roster with ~15% of its group memberships missing and
// would confidently answer "who's in X?" from an incomplete list. Every page keeps the same
// .order() so the serialized roster stays byte-identical between turns and the 1h prompt cache
// still matches.
function fetchAllPersonGroups(client: { from: (t: string) => any }) {
  return fetchAllRows<{ person_id: string; group_id: string }>((from, to) =>
    client.from("person_groups").select("person_id, group_id").order("person_id").order("group_id").range(from, to)
  )
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
    // "serialize deterministically" rule). Fired together with Promise.all — the eight queries are
    // independent of each other, so there's no reason to pay for them one round-trip at a time.
    //
    // pets/person_pets are two SEPARATE top-level queries, deliberately never an embed on the
    // people select: a `.select()` naming a table that doesn't exist yet fails the WHOLE query, so
    // an embed would take the entire people roster — and with it this function — down on any
    // database where the pets migration hasn't been run. Separate queries fail independently.
    const [
      { data: people },
      { data: moments },
      { data: groups },
      { data: personGroups },
      { data: momentGroups },
      { data: tags },
      { data: pets },
      { data: personPets },
    ] = await Promise.all([
      // Paged for the same reason person_groups is (see fetchAllPersonGroups): 700 people already,
      // and the 1000th person onward would just stop existing as far as the model is concerned.
      fetchAllRows((from, to) =>
        supabaseClient
          .from("people")
          .select("id, name, last_name, nicknames, middle_name, goes_by_other, is_self, deceased_date")
          .order("id")
          .range(from, to)
      ),
      supabaseClient
        .from("moments")
        .select("id, occasion, location, when_text, details, created_at, notes(content, person_id)")
        .order("id")
        .order("created_at", { foreignTable: "notes" }),
      supabaseClient.from("groups").select("id, name, parent_group_id").order("id"),
      fetchAllPersonGroups(supabaseClient),
      supabaseClient
        .from("moment_groups")
        .select("moment_id, group_id")
        .order("moment_id")
        .order("group_id"),
      supabaseClient.from("tags").select("id, name").order("id"),
      supabaseClient
        .from("pets")
        .select("id, name, species, breed, birth_date, adopted_date, deceased_date, notes, attributes")
        .order("id"),
      supabaseClient.from("person_pets").select("person_id, pet_id").order("person_id").order("pet_id"),
    ])

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
    // Presence of deceased_date is the whole signal (there's no separate flag). Feeds the family
    // roster below so the model speaks about someone's late father in the past tense and never
    // asks a follow-up that assumes he's alive — the same care the pets roster already takes with
    // its "PASSED AWAY" marker.
    const deceasedIds = new Set<string>()
    for (const p of people ?? []) {
      const fullName = p.last_name ? `${p.name} ${p.last_name}` : p.name
      nameById[p.id] = fullName
      if (p.deceased_date) deceasedIds.add(p.id)
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

    // Qualified "Parent / Child" names throughout — the model sees them in the roster below and
    // hands them back, and groupIndex.resolve maps them to a real id. A bare name shared by two
    // subgroups deliberately resolves to nothing rather than to whichever was indexed last.
    const groupIndex = buildGroupNameIndex(groups ?? [])
    const groupNameById = groupIndex.nameById

    const tagNameById: Record<string, string> = {}
    const idByTagName: Record<string, string> = {}
    for (const t of tags ?? []) {
      tagNameById[t.id] = t.name
      idByTagName[t.name.toLowerCase()] = t.id
    }

    // Anyone in a subgroup is a member of every group above it, at any depth (founder,
    // 2026-08-10) — the same rule the app's own group pages render. Without it the model answers
    // "who's in Air Force?" from that group's own rows only and leaves out people the screen is
    // visibly counting. Derived, exactly as it is in the app: nothing is written back.
    const memberIdsByGroup = rollUpGroupMemberIds(groups ?? [], personGroups ?? [], (id) => !!nameById[id])
    const groupMemberNamesById: Record<string, string[]> = {}
    for (const [groupId, memberIds] of Object.entries(memberIdsByGroup)) {
      groupMemberNamesById[groupId] = memberIds.map((personId) => nameById[personId])
    }

    // Pets are their own records joined to people via person_pets, so a household dog is one row
    // owned by both spouses. That's what makes "Braden's dog" answerable here without walking the
    // relationships graph at all — the pet is already linked to both of them.
    const petOwnerNamesById: Record<string, string[]> = {}
    const petOwnerIdsById: Record<string, string[]> = {}
    for (const pp of personPets ?? []) {
      const personName = nameById[pp.person_id]
      if (!personName) continue
      ;(petOwnerNamesById[pp.pet_id] ??= []).push(personName)
      ;(petOwnerIdsById[pp.pet_id] ??= []).push(pp.person_id)
    }

    // Pet names are NOT unique account-wide (deliberately no unique index — two people can each
    // have a dog named Bella), so this mirrors the people `ambiguousKeys` guard exactly: a bare
    // name with two owners resolves to nothing rather than to whichever was indexed last.
    const petNameById: Record<string, string> = {}
    const idByPetName: Record<string, string> = {}
    const idByOwnerAndPetName: Record<string, string> = {}
    const ambiguousPetKeys = new Set<string>()
    for (const p of pets ?? []) {
      const key = p.name.toLowerCase()
      petNameById[p.id] = p.name
      if (idByPetName[key] && idByPetName[key] !== p.id) {
        ambiguousPetKeys.add(key)
      } else {
        idByPetName[key] = p.id
      }
      for (const ownerId of petOwnerIdsById[p.id] ?? []) {
        idByOwnerAndPetName[`${ownerId}|${key}`] = p.id
      }
    }
    for (const key of ambiguousPetKeys) delete idByPetName[key]

    const momentGroupNamesById: Record<string, string[]> = {}
    for (const mg of momentGroups ?? []) {
      const groupName = groupNameById[mg.group_id]
      if (!groupName) continue
      ;(momentGroupNamesById[mg.moment_id] ??= []).push(groupName)
    }

    const context = (moments ?? [])
      .map((m: any) => {
        // A note with no person_id is a general detail about the event itself, not an attendee —
        // it must not show up in "People" as a phantom guest called "someone", and its text reads
        // as a plain fact rather than as a quote attributed to a mystery person. This matters most
        // for the notes recording someone the founder deliberately DIDN'T create a profile for
        // (see mentioned_names below): those are person_id-less by design, and "someone: met a
        // couple, Rachel and Matt" would otherwise imply a recorded person named "someone".
        const notePeople = (m.notes ?? [])
          .filter((n: any) => n.person_id && nameById[n.person_id])
          .map((n: any) => nameById[n.person_id])
        const noteLines = (m.notes ?? [])
          .map((n: any) => {
            const personName = n.person_id ? nameById[n.person_id] : null
            return personName ? `${personName}: ${n.content}` : n.content
          })
          .join("; ")
        const recordedOn = new Date(m.created_at).toDateString()
        const momentGroupNames = momentGroupNamesById[m.id] ?? []
        return `[MOMENT_ID: ${m.id}] Occasion: ${m.occasion ?? "unknown"} | Location: ${m.location ?? "unknown"} | When (as described): ${m.when_text ?? "unknown"} | Recorded on: ${recordedOn} | People: ${[...new Set(notePeople)].join(", ")} | Groups: ${momentGroupNames.join(", ") || "none"} | Notes: ${noteLines}`
      })
      .join("\n")

    const groupsContext = (groups ?? [])
      .map((g: any) => `${groupNameById[g.id]} (members: ${(groupMemberNamesById[g.id] ?? []).join(", ") || "none yet"})`)
      .join("\n")

    const tagsContext = (tags ?? []).map((t: any) => t.name).join(", ")

    const petsRoster = (pets ?? [])
      .map((p: any) => {
        const owners = (petOwnerNamesById[p.id] ?? []).join(", ") || "no one on file"
        const kind = [p.species, p.breed].filter(Boolean).join(", ")
        const dates = [
          p.birth_date ? `born ${p.birth_date}` : null,
          p.adopted_date ? `adopted ${p.adopted_date}` : null,
          p.deceased_date ? `PASSED AWAY ${p.deceased_date}` : null,
        ]
          .filter(Boolean)
          .join("; ")
        const attrs = (Array.isArray(p.attributes) ? p.attributes : [])
          .map((a: any) => `${a.label}: ${a.value}`)
          .join("; ")
        return `${p.name}${kind ? ` (${kind})` : ""} — belongs to: ${owners}${dates ? ` | ${dates}` : ""}${attrs ? ` | ${attrs}` : ""}${p.notes ? ` | ${p.notes}` : ""}`
      })
      .join("\n")

    const peopleRoster = (people ?? [])
      .map((p: any) => {
        const altNames = altNamesById[p.id]
        return altNames ? `${nameById[p.id]} (also goes by: ${altNames.join(", ")})` : nameById[p.id]
      })
      .join(", ")

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

The "[MOMENT_ID: ...]" tag is for YOUR bookkeeping only, so you can reference the right moment_id in your structured output. NEVER include "[MOMENT_ID: ...]" or any similar internal tag in the user-facing "reply" text — the reply should read as natural conversation with no trace of these tags.

Some people in the roster provided in this prompt have a nickname or "goes by" name shown in parentheses (e.g. "Joseph Smith (also goes by: Grandpa Joe)") — if the user refers to someone by that nickname, you can use either their real name or the nickname when writing them into "notes", "relevant_people", "person_group_tags", etc., and it will still resolve to the same person.

IMPORTANT — disambiguating people who share a first name or nickname: check the roster provided in this prompt for any other recorded person with the same first name or nickname as whoever you're about to write into "notes", "relevant_people", "person_group_tags", "renames", "last_name_updates", or "nickname_updates". If there's a collision (e.g. two different people both named "Bob", or both going by "Bob"), you MUST use that person's full name (first + last) in every field, never just the bare first name or nickname — a bare shared name cannot be resolved automatically and risks attaching new information to the wrong person entirely. If you can't tell which same-named person the user means from context, ask a quick clarifying question instead of guessing.

A GROUP is a recurring, ongoing affiliation — a school, academy, sports team, military unit, workplace, club, or friend circle the user was part of over a stretch of time. It is NOT a one-off event, and it is NOT the same thing as a moment. A single group can have many moments tagged to it over time (e.g. many stories from "the Air Force Academy") and many people tagged to it as members (e.g. teammates, classmates).

- If the story the user is telling is clearly framed around one of these recurring affiliations — e.g. "my time at the Air Force Academy," "back when I played on my 5th grade Pop Warner team," "a story from when I worked at IBM" — tag that entry's own "moment_groups" with that group's name. Reuse an existing group by name if the user's phrasing is clearly the same thing (e.g. "the Academy" matching an existing "Air Force Academy" group); otherwise use exactly the name/phrase they gave you to create a new one.
- If the user explicitly says a specific person belongs to one of these same affiliations — e.g. "he was on my Pop Warner team too," "she went through the Academy with me" — tag that person into the group via "person_group_tags" (this is turn-level, not tied to any one moment entry).
- Don't invent a group from a passing mention of a place or a single unaffiliated event. Only tag a group when the user's own framing is about a recurring school/team/unit/organization, not a one-time location.
- Pay special attention to a proper name or acronym the user leads with as a label for the update itself (e.g. "AMIC update from today...") or repeatedly refers back to (e.g. "the class," "the program," "the team") — that is a strong signal it names a recurring group, even the very first time it's mentioned. Tag it in that entry's "moment_groups" rather than waiting for a second, more explicit mention.
- SUBGROUPS: a group in the roster written "Parent / Child" (e.g. "22 AS / Pilots") is a subgroup of "22 AS". When you mean an existing group, copy its name from the roster EXACTLY, including the "Parent / Child" form — a bare "Pilots" when the roster has two of them cannot be resolved and the tag will be dropped. Two different parents can each have a subgroup with the same short name, so if the user's phrasing doesn't make clear which one they mean, ask a quick clarifying question instead of guessing. When you're deliberately creating a NEW subgroup under an existing parent, write it in that same "Parent / Child" form; for any other new group, just give its plain name with no prefix. Membership rolls UPWARD: a parent group's member list in the roster already includes everyone from its subgroups, so answer "who's in the parent?" straight from that list and never add the subgroups up yourself. It does not roll downward — being in the parent does not put someone in any particular subgroup, so to record that someone is in a subgroup you must tag the subgroup by name.

A PET is an animal belonging to one or more people — a dog, cat, horse, fish, bird, reptile, anything. Pets are recorded in their own "pets" field, and the roster provided in this prompt lists every pet already on file with its owner(s).

- CRITICAL — A PET IS NOT A PERSON. Never put a pet's name in "new_people", "mentioned_names", "notes", "relevant_people", "person_group_tags", "renames", "last_name_updates", "nickname_updates", or "family_signals". A pet's name belongs in the "pets" field and nowhere else. Writing a pet into "new_people" creates a fake human profile that pollutes the user's People list and their Dunbar count, which is a real and annoying mess to clean up.
- Record a pet only when the user states one exists (e.g. "Sarah got a puppy named Biscuit", "our cat Mochi", "Tom's horse Willow"). A passing mention of an animal that isn't someone's pet is NOT a pet — "we went to the dog park", "we saw a deer", "the neighbor's dog barked all night" record nothing.
- Every pet you record MUST have at least one owner in its "owners" list, named exactly as they appear in the people roster (or a person being created this same turn via "new_people"). A pet with no resolvable owner can't be shown on anyone's profile, so it would be silently lost — never emit one.
- Reuse an existing pet rather than coining a near-duplicate: if the roster already lists "Biscuit", don't record "Biscuits". To attach an existing pet to an ADDITIONAL owner (e.g. "Biscuit is Tom's dog too"), emit the same pet name with the extra person in "owners" — that adds the link, it doesn't create a second pet.
- If two pets in the roster share a name, you must identify which by its owner. If the user's phrasing doesn't make clear which one they mean, ask a quick clarifying question instead of guessing — same rule as two people named Bob.
- Only fill in "species"/"breed" when the user actually says so. Leave them null rather than guessing — "puppy" tells you it's a dog, not what breed it is.
- If the user says a pet died, set "deceased_date" (resolve the date the same way as event_date). Any pet the roster marks "PASSED AWAY" must be spoken about in the past tense, and never ask a follow-up question that assumes it's still alive.
- Answering questions about pets ("what's Sarah's dog called?", "how old is Biscuit?") comes straight from the roster — match on the owner and the kind of animal. If the person has no pet on file, say so rather than inventing one.

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

THE FAMILY TREE — the roster provided in this prompt includes a family tree section. This is the same tree the user built on the app's family tree screen, and it is the authoritative answer to any question about who someone is related to. Each line is ONE FAMILY, not one person, in one of three shapes:

- "Anamaria Sucre + Manuel Sucre Sr. — children: Ale Sucre, Fede Sucre, Manuel Sucre" — the names BEFORE the dash are the parents; the names AFTER it are their children. So Anamaria and Manuel Sr. are the parents of all three, AND those three children are siblings of each other. A line with a single name before the dash means only one parent is on file, not that the child has one parent.
- "Ale Sucre + Molly Sucre — couple" — a marriage or partnership with no children recorded.
- "siblings: Ale Sucre, Fede Sucre" — people known to be siblings whose parents aren't on file.

How to use it:

- When asked about ANYONE's family ("tell me about Manuel's family", "who are Sarah's parents", "does Tom have siblings"), find every line that person appears on and read their relationships off it. Someone usually appears on two lines — once as a child in the family they grew up in, once as a parent in the family they made. Do NOT fall back to hunting through moment notes for family mentions and reporting only what you find there — the tree is more complete, and a relative who has never come up in a story is still their relative.
- This section is EXHAUSTIVE for parents, spouses/partners, siblings, and children: if a relationship isn't shown on any line, it is not recorded. Never invent or assume one. If a person appears on no line at all, they have no family on file — say so plainly rather than guessing from a shared last name.
- Relationships further out — grandparents, aunts/uncles, cousins, nieces/nephews, in-laws — are NOT written out anywhere, but you can work them out by chaining ACROSS lines. Emi Sucre is a child on the "Clare Sucre + Manuel Sucre" line; Manuel is a child on the "Anamaria Sucre + Manuel Sucre Sr." line; therefore Anamaria and Manuel Sr. are Emi's grandparents, and Ale and Fede are Emi's aunt/uncle. Do that chaining rather than saying you don't know — but only state a relationship the lines actually support.
- A name marked "(deceased)" is someone who has died: speak about them in the past tense, and never ask a follow-up question that assumes they're alive. "(divorced)" after a couple marks a marriage or partnership that has ended — they're still the parents of any children on that line, but don't describe them as currently married.
- This section is about who is RELATED to whom. It says nothing about what anyone is like or what they've done — that still comes from the moments and notes. A good answer about someone's family usually combines both: who they are related to, plus whatever the moments actually say about those people.

VOICE — in your "reply" text, always address the user directly as "you"/"your". Never refer to the user by their own recorded name or as "the user"/"User" in the reply — that third-person phrasing is reserved for how OTHER people are described. Stay consistent within a single reply: don't mix "I did X for you" with "...and then Name went to the store" when "Name" is the user themselves.

At the end of EVERY turn, respond with ONLY a JSON object in this exact shape and nothing else:
{"reply": "the natural conversational text to show the user - a few sentences, factual, not overly enthusiastic", "is_lookup": false, "found_relevant_info": false, "new_people": ["Name1"], "renames": [{"old_name": "...", "new_name": "..."}], "last_name_updates": [{"person": "...", "last_name": "..."}], "nickname_updates": [{"person": "...", "nicknames": ["NewNickname1"]}], "relevant_people": ["Name1"], "person_group_tags": [{"person": "Name1", "group": "Group Name"}], "mentioned_names": [{"name": "Name1", "note": "who they are / how they came up"}], "pets": [{"name": "Biscuit", "owners": ["Name1"], "species": "dog or null", "breed": "golden retriever or null", "birth_date": "YYYY-MM-DD or null", "adopted_date": "YYYY-MM-DD or null", "deceased_date": "YYYY-MM-DD or null", "attributes": [{"label": "Vet", "value": "Dr. Ruiz"}]}], "moments": [{"moment_id": "the MOMENT_ID this entry relates to, or null", "new_moment": false, "moment_fields": null, "notes": [{"person": "Name1, or null for a general note about the event itself", "note": "..."}], "mentioned_names": [{"name": "Name1", "note": "who they are / how they came up"}], "moment_groups": ["Group Name"], "moment_tags": ["tag-name"]}], ${FAMILY_SIGNAL_JSON_FIELD_MULTI_SUBJECT}}
When "moment_fields" is set, it has this shape: {"occasion": "...", "location": "...", "when_text": "...", "event_date": "YYYY-MM-DD or null", "event_end_date": "YYYY-MM-DD or null"}.

IMPORTANT — capture EVERY concrete detail the user gives about an event, not just who attended. A "notes" entry doesn't have to be about a specific person: anything the user says about the event itself — what was done, eaten, said, how it went, the weather, an activity, a gift, a reaction — belongs in its own "notes" entry with "person" set to null, UNLESS it's naturally about one specific attendee (in which case attach it to that person's own note instead). Never let a real detail the user typed disappear just because it wasn't about a named person — the event's own page shows these general notes alongside the per-person ones. Don't pad a note with filler if the user gave no detail (that's what "Was there." is for — see below); but when they DID give detail, capture it, even if it means several separate notes entries for one event.

CRITICAL — never invent, assume, or add a concrete detail the user did not actually say, in "notes" OR in "reply". If the user doesn't state HOW something happened, WHERE exactly, what a result/reading/verdict was, or how someone felt, do not supply a plausible-sounding guess for it — leave it out entirely. This applies even when a detail feels like an obvious or typical part of the situation (e.g. if the user says "we found out the baby's going to be a girl," do NOT assume or add that this happened at an ultrasound, a doctor's appointment, or that "other health markers looked good" — they didn't say that, so it isn't true as far as this app knows). A shorter note that only contains what was actually said is always correct; an embellished one is a fabricated record of something that didn't happen.

IMPORTANT — a "notes" entry only belongs to a specific attendee when THEY are the one who did, said, or experienced the thing described — not merely because the sentence names them or is ABOUT them. E.g. if the user says "we found out the baby is going to be a girl," that's a general event-level detail ("person": null), never a note on the baby's own profile — the baby didn't discover or announce anything, they're just the topic of a fact the user is reporting. Likewise "my mom found out Steve got the job" is Mom's note (she's the one who found out), not Steve's, even though Steve is named. Ask yourself "did this person themselves do/say/experience this?" before attaching a note to them; if the answer is no, it's a general note instead.

IMPORTANT: "relevant_people" must list EVERY person mentioned by name anywhere in your "reply" text, not just the main subject of the question — if your reply mentions 5 people by name, relevant_people should have all 5.

IMPORTANT — name spelling: when writing a person's name anywhere (in "reply", "relevant_people", "notes", etc.), copy their spelling EXACTLY as it appears in the roster provided in this prompt, character for character — same capitalization, same spelling. Never respell, "correct," or reformat a name from the roster, even if it looks unusual. This is what makes their name in your reply clickable — a respelled name breaks that link.

CRITICAL — the "Who was there" list on an event's own page is driven ENTIRELY by that moment entry's own "notes": a person only shows up as having attended if they have at least one note linked to that specific moment. So whenever the user is describing or adding to an event and mentions that someone ALREADY IN THE ROSTER (or someone they explicitly asked you to add via "new_people") was AT it — even in passing, even with no other detail about them — you MUST still include an entry for them in that moment's own "notes" (e.g. {"person": "Name1", "note": "Was there."}). Do not just add them to "new_people"/"relevant_people" and stop — a person with no note attached to the moment will silently NOT appear as having attended it, even if your own "reply" text mentions them by name. If several events are being captured at once, make sure each person is attached to the RIGHT event's "notes", not lumped into just one of them. But "Was there." is a LAST RESORT for someone the user named with zero detail — if the user actually described what that person did, said, or brought, put THAT in their note instead of flattening it to "Was there." (e.g. user says "my brother Jake came and brought his new girlfriend" → Jake's note should say he brought his new girlfriend, not just "Was there.").

CRITICAL — NEVER create a profile for someone just because they came up in a story. Not everyone the user mentions is someone they want a contact for: a couple they got talking to at a bar, a waiter, a friend-of-a-friend, someone's colleague who came up once. Creating profiles for those clutters their People list and their Dunbar count, and it is annoying to undo.
- "new_people" is ONLY for someone the user EXPLICITLY asked you to add — "add Jim as a contact", "make a profile for my new neighbor Dave", "save Sarah's sister". If they didn't ask, it doesn't go here.
- EVERYONE ELSE who is brand-new (not already in the roster provided in this prompt) goes in "mentioned_names" instead — on the entry in "moments" for the event they came up at, or in the top-level "mentioned_names" if this turn isn't about an event at all. No profile is created; the user is asked separately whether they want one.
- Someone already in the roster is NOT brand-new. Use them normally in "notes"/"relevant_people" exactly as before — never put an existing person in "mentioned_names".
- Each "mentioned_names" entry is {"name": "Rachel", "note": "..."} and the "note" is REQUIRED. That note is the ONLY record of this person, so it must carry enough to answer a question about them months later — who they are, how they came up, who they were with, anything the user said about them (e.g. "One of a couple we got talking to at the bar, there with Matt."). NEVER write "Was there." for a mentioned name; that placeholder is only for a person who already has a profile.
- Do NOT also list a mentioned name in that moment's "notes" — the "mentioned_names" note is saved onto the event by itself. And don't say in your "reply" that you created a profile for them; they're saved as part of the event's notes, which is enough.

Leave "moments" as an empty array when nothing is being captured or updated — most simple questions have no moments at all. Only set "new_moment": true and fill that entry's "moment_fields" (occasion, location, when_text, event_date) when you're capturing a genuinely brand-new event.

Every "new_moment" entry needs a concise "occasion" (a few words, e.g. "Fourth of July at the lake", "Sarah's graduation dinner") — work one out from whatever the user described even if they never stated a literal title. Only leave "occasion" null if there's truly nothing to name it from at all.

When capturing a brand-new moment, also work out your best-guess ACTUAL calendar date for when it happened and put it in that entry's moment_fields.event_date as "YYYY-MM-DD" (in addition to when_text, which stays the user's own words, unchanged). Resolve relative phrases against today's date, given below — this includes not just "last week"/"a couple months ago" but ordinal-day phrasing ("the 4th" = the 4th of the current or most recently-implied month), weekday phrasing ("next Tuesday", "last Saturday" = the nearest matching weekday in that direction from today), and compound phrasing ("two weeks from Saturday", "a week from tomorrow" = do the arithmetic from today's date). If the story is clearly set in an earlier period of their life (e.g. "back in college," "when I was stationed in Germany"), use whatever surrounding context or other recorded moments give you to place it as closely as you can. If they name a season, use its first day for the year they mean (spring=Mar 1, summer=Jun 1, fall=Sep 1, winter=Dec 1). If they give a specific month/year ("May of 2027"), use the 1st of that month. If only a year is given, use January 1 of that year. Always give your closest single best guess rather than a range — exact precision doesn't matter, this is only used for sorting and display. Only leave event_date null if there is truly no time information or contextual clue to go on at all.

If the user describes the moment as spanning more than one day (e.g. "we were there from the 3rd through the 10th", "it was a long weekend trip"), also set moment_fields.event_end_date to your best-guess actual END calendar date as "YYYY-MM-DD". Leave event_end_date null for anything that sounds like a single day — never invent a range that wasn't stated or clearly implied.`

    // Roster tier — people + groups, which change only when someone/some group is added or
    // renamed, far less often than a new moment/note is recorded. Its own breakpoint, ordered
    // BEFORE the moments tier below, so the common case (recording a new note about someone who's
    // already in the app) doesn't bust it — only adding/renaming a person or group does. 1-hour
    // TTL (not the 5-minute default): this tier is the one most likely to survive unchanged
    // between separate chat sessions, and the default TTL would otherwise force a full-price
    // rewrite of the whole roster just because the user paused to think (CLAUDE.md's token/
    // billing efficiency rule).
    const selfInfo = findSelfPerson(people, nameById)
    // buildKinInstruction is wired into converse ONLY, not update-moment/update-group: those are
    // structured-extraction paths that never need cousin/aunt vocabulary, and leaving them alone
    // halves what this can affect. It rides the same 1h-cached roster tier below.
    // The whole relationships table, read ONCE and shared by both consumers below (the kin
    // instruction and the family roster) instead of each running its own select.
    const relationshipRows = await fetchAllRelationshipRows(supabaseClient)
    const [selfInstruction, kinInstruction, chatToneInstruction, userTimeZone] = await Promise.all([
      buildSelfInstruction(supabaseClient, selfInfo, nameById),
      buildKinInstruction(supabaseClient, selfInfo, nameById, relationshipRows),
      buildChatToneInstruction(supabaseClient, user.id),
      getUserTimeZone(supabaseClient, user.id),
    ])

    // The family tree, one line per person who has family on file. Before this (founder report,
    // 2026-08-10) the tree reached the model ONLY for the is_self person, so "tell me about Manuel
    // Sucre's family" could be answered only from whatever prose happened to be in moment notes —
    // the parents and siblings sitting right there on his tree were invisible. Bounded by how much
    // tree the user actually built, not by roster size: people with no relationships emit nothing.
    const familyRoster = buildFamilyRoster(relationshipRows, nameById, { deceasedIds })

    const rosterContext = `Here are the groups already created:
${groupsContext || "(none yet)"}

Here are the tags already created: ${tagsContext || "(none yet)"}

Here is everyone already recorded, by full name where a last name is known:
${peopleRoster || "(none yet)"}

Here are the pets already recorded, and who each one belongs to:
${petsRoster || "(none yet)"}

Here is the family tree already recorded, one line per person who has family on file:
${familyRoster || "(none yet)"}${selfInstruction}${kinInstruction}${chatToneInstruction}`

    // Moments tier — changes on every new capture, the most frequent write in the app, so it's
    // kept on the default 5-minute cache (a 1-hour write costs 2x instead of 1.25x, and this tier
    // busts often enough that the cheaper write usually wins).
    const momentsContext = `Here are the moments already recorded, each tagged with [MOMENT_ID: ...]:
${context || "(none recorded yet)"}`

    // Truly per-turn: changes once a day, and previously sat at the FRONT of one combined dynamic
    // block, which invalidated the whole thing daily for no reason. Kept last and uncached — it's
    // a few tokens, nothing to gain from a breakpoint here. Computed in the user's own time zone
    // (not the Edge Function's server UTC clock) — otherwise "today" rolls over at UTC midnight,
    // which is late afternoon/evening across the US, and anything logged as happening "today" in
    // the evening gets resolved to tomorrow's date.
    const now = new Date()
    const todayContext = `Today's date is ${fullDateInTimeZone(now, userTimeZone)} (${isoDateInTimeZone(now, userTimeZone)}).`

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": Deno.env.get("ANTHROPIC_API_KEY") ?? "",
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-5",
        // 4096 → 8192 (2026-08-10). This model thinks before it answers, and thinking spends the
        // SAME budget as the reply — so a question that takes real reasoning ("how many people are
        // in the Air Force group?", against a roster of ~300 names) could burn the entire 4096 on
        // thinking and return a response with no text block at all. That failed as an unparseable
        // reply and showed "Sorry, I couldn't process that", having already been billed for 4096
        // output tokens. Observed live: output_tokens 4096, thinking_tokens 4095, zero text.
        //
        // Not a cost regression — max_tokens is a ceiling, not a charge, and only turns that
        // actually need the room bill for it. It replaces spend that currently buys nothing.
        // Same fix, same reasoning as update-moment's 1500 → 3000 (2026-08-08).
        max_tokens: 8192,
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
    // Cache-health check required whenever this function is touched (CLAUDE.md rule 3): on a repeat
    // turn with no writes between, cache_read_input_tokens must be non-zero. If it's zero, some
    // per-request value is leaking into a cached tier — check the .order() clauses on the roster
    // queries first. No PII: counts only.
    console.log("usage", JSON.stringify(data.usage ?? null))
    const textBlock = data.content?.find((b: any) => b.type === "text")

    // No text block at all. The usual cause is the reply budget being spent entirely on thinking
    // (see max_tokens above) — distinguishable from every other failure by stop_reason, and worth
    // telling apart because the honest advice differs: this one is "ask something narrower", not
    // "try again", which would just burn another full budget on the identical question.
    const ranOutThinking = !textBlock && data.stop_reason === "max_tokens"
    if (!textBlock) {
      console.error(
        "Anthropic response had no text block",
        JSON.stringify({ stop_reason: data.stop_reason, usage: data.usage })
      )
    }

    let parsed: any = { reply: ranOutThinking
      ? "That one took more thinking than I had room for. Try asking about a smaller group, or narrowing the question."
      : "Sorry, I couldn't process that.", is_lookup: false, found_relevant_info: false, new_people: [], renames: [], last_name_updates: [], nickname_updates: [], relevant_people: [], person_group_tags: [], mentioned_names: [], pets: [], moments: [], family_signals: [] }
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

    // Drop any hallucinated/malformed date before it reaches an insert — see dateValidation.ts.
    for (const momentEntry of parsed.moments ?? []) {
      if (!momentEntry.moment_fields) continue
      momentEntry.moment_fields.event_date = sanitizeIsoDate(momentEntry.moment_fields.event_date)
      momentEntry.moment_fields.event_end_date = sanitizeIsoDate(momentEntry.moment_fields.event_end_date)
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

    // Pets are written AFTER new_people/renames/applyFamilySignals so an owner created earlier in
    // this same turn resolves — same ordering reasoning as the group tags below.
    for (const entry of parsed.pets ?? []) {
      const petName = String(entry?.name ?? "").trim()
      if (!petName) continue

      const ownerIds = [
        ...new Set(
          (Array.isArray(entry.owners) ? entry.owners : [])
            .map((n: any) => idByName[String(n).trim().toLowerCase()])
            .filter(Boolean)
        ),
      ] as string[]

      // A pet with no resolvable owner shows on nobody's profile — it would be a silent orphan
      // write while the reply cheerfully claims it saved. The roster is complete and new_people has
      // already run, so this should be unreachable; log loudly rather than write junk.
      if (ownerIds.length === 0) {
        console.error("Pet skipped: no owner resolved", petName, JSON.stringify(entry.owners ?? null))
        continue
      }

      const key = petName.toLowerCase()
      // Owner-scoped first, so two dogs named Bella stay distinct; then a unique bare name.
      let petId: string | null = null
      for (const ownerId of ownerIds) {
        const scoped = idByOwnerAndPetName[`${ownerId}|${key}`]
        if (scoped) {
          petId = scoped
          break
        }
      }
      if (!petId && !ambiguousPetKeys.has(key)) petId = idByPetName[key] ?? null

      const incoming: Record<string, any> = {
        species: entry.species ? String(entry.species).trim() : null,
        breed: entry.breed ? String(entry.breed).trim() : null,
        birth_date: sanitizeIsoDate(entry.birth_date),
        adopted_date: sanitizeIsoDate(entry.adopted_date),
        deceased_date: sanitizeIsoDate(entry.deceased_date),
      }
      const incomingAttributes = (Array.isArray(entry.attributes) ? entry.attributes : [])
        .filter((a: any) => a && a.label && a.value)
        .slice(0, 5)
        .map((a: any) => ({ label: String(a.label).trim(), value: String(a.value).trim() }))

      if (petId) {
        // ADDITIVE ONLY: fill fields that are currently blank, never overwrite what's already on
        // file. Chat is a lossy channel and the profile form is the deliberate one — same
        // never-lose-existing-data rule the contacts import merge follows.
        const existing = (pets ?? []).find((p: any) => p.id === petId) as Record<string, any> | undefined
        const patch: Record<string, any> = {}
        for (const [field, value] of Object.entries(incoming)) {
          if (value && !existing?.[field]) patch[field] = value
        }
        if (incomingAttributes.length > 0) {
          const merged = Array.isArray(existing?.attributes) ? [...existing.attributes] : []
          for (const attr of incomingAttributes) {
            if (!merged.some((m: any) => String(m.label).toLowerCase() === attr.label.toLowerCase())) merged.push(attr)
          }
          if (merged.length !== (existing?.attributes?.length ?? 0)) patch.attributes = merged
        }
        if (Object.keys(patch).length > 0) {
          const { error } = await supabaseClient.from("pets").update(patch).eq("id", petId)
          if (error) console.error("Pet update failed", petName, error.message)
        }
      } else {
        const { data: newPet, error } = await supabaseClient
          .from("pets")
          .insert({ user_id: user.id, name: petName, ...incoming, attributes: incomingAttributes })
          .select("id")
          .single()
        if (error || !newPet) {
          console.error("Pet insert failed", petName, error?.message)
          continue
        }
        petId = newPet.id as string
        idByPetName[key] = petId
        petNameById[petId] = petName
      }

      const resolvedPetId: string = petId
      for (const ownerId of ownerIds) {
        const { error } = await supabaseClient
          .from("person_pets")
          .upsert({ person_id: ownerId, pet_id: resolvedPetId }, { onConflict: "person_id,pet_id", ignoreDuplicates: true })
        if (error) console.error("Pet link failed", petName, error.message)
        idByOwnerAndPetName[`${ownerId}|${key}`] = resolvedPetId
      }
    }

    async function findOrCreateGroupId(name: string): Promise<string | null> {
      const existing = groupIndex.resolve(name)
      if (existing) return existing
      // Nothing matched. If the model wrote "<existing group> / Something", it's asking for a
      // subgroup under that parent — create it as one rather than as a group literally named
      // "22 AS / Something". A bare name with two existing owners resolves to null above and
      // lands here too; splitParent leaves it alone, so we'd create a genuinely new group rather
      // than guess which of the two the user meant.
      const { parentId, childName } = groupIndex.splitParent(name)
      const { data: newGroup } = await supabaseClient
        .from("groups")
        .insert({ user_id: user.id, name: childName, parent_group_id: parentId })
        .select()
        .single()
      if (newGroup) {
        groupIndex.add(newGroup)
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
    // Every moment whose cached AI summary (moments.summary) is now stale and needs regenerating in
    // the background — a brand-new moment, or an EXISTING one that just gained a note (from its own
    // "notes" entry or a mentioned-name note below). Deduped so a moment touched twice in one turn
    // only regenerates once. See the single kickoff loop after the moments loop below.
    const momentIdsNeedingResummary = new Set<string>()
    const rawDescription = messages.filter((m: any) => m.role === "user").map((m: any) => m.content).join("\n")

    // A name the founder merely MENTIONED in a story never becomes a profile on its own — see the
    // "NEVER create a profile for someone just because they came up in a story" block in the
    // instructions above. Two things have to be true at once: the detail must never be lost (so the
    // archive can still answer "what was the name of that couple we met at Pup Dog?"), and their
    // People list must not fill up with strangers. So the note is written immediately as a general
    // note on the event (person_id: null — the same shape as any other event-level detail), and the
    // profile is offered afterward as a one-tap banner which, if accepted, just re-points that same
    // note at the newly created person. Ignoring the banner loses nothing.
    const mentionedPeopleSuggestions: {
      name: string
      note: string
      noteId: string | null
      momentId: string | null
      momentLabel: string | null
    }[] = []
    // Names already spoken for this turn: anyone the family-signal path is already asking about via
    // its own banner, plus anyone collected earlier in this same turn. Two banners for one person
    // reads as a bug, not as thoroughness.
    const suggestedNameKeys = new Set<string>(
      (familyResult.newPersonSuggestions ?? []).map((s: any) => String(s.rawName ?? "").trim().toLowerCase())
    )

    async function collectMentionedNames(entries: any, momentId: string | null, momentLabel: string | null) {
      for (const entry of Array.isArray(entries) ? entries : []) {
        const name = String(entry?.name ?? "").trim()
        const note = String(entry?.note ?? "").trim()
        // A mentioned name with no note would be a banner offering to create a profile for someone
        // with nothing recorded about them — worse than useless. Drop it.
        if (!name || !note) continue

        const key = name.toLowerCase()
        // Only brand-new names belong here, but if the model hands back someone already on file the
        // right move is the ordinary one: attach the note to them, and don't ask about a profile
        // they already have.
        const existingId = idByName[key]
        if (existingId) {
          if (momentId) {
            await supabaseClient
              .from("notes")
              .insert({ person_id: existingId, moment_id: momentId, content: note, source: "home" })
            momentIdsNeedingResummary.add(momentId)
          }
          continue
        }
        if (suggestedNameKeys.has(key)) continue
        suggestedNameKeys.add(key)

        // Written NOW rather than on confirm: the note is the whole point, and it has to survive the
        // founder never answering the banner (or closing the tab before they do).
        let noteId: string | null = null
        if (momentId) {
          const { data: newNote, error } = await supabaseClient
            .from("notes")
            .insert({ person_id: null, moment_id: momentId, content: note, source: "home" })
            .select("id")
            .single()
          if (error) console.error("Mentioned-name note insert failed", name, error.message)
          noteId = newNote?.id ?? null
          if (!error) momentIdsNeedingResummary.add(momentId)
        }
        mentionedPeopleSuggestions.push({ name, note, noteId, momentId, momentLabel })
      }
    }

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
            event_end_date: momentEntry.moment_fields?.event_end_date ?? null,
          })
          .select()
          .single()
        if (newMoment) {
          momentId = newMoment.id
          // Summary regeneration is kicked off once, after the loop below, for every moment in
          // momentIdsNeedingResummary — covers both a brand-new moment (added here) and an existing
          // one that just gained a note (added further down), so a background call is never fired
          // twice for the same moment in one turn.
          if (rawDescription.trim()) momentIdsNeedingResummary.add(momentId)
        }
      }

      if (!momentId) continue
      touchedMomentIds.add(momentId)

      // Each note is an independent insert (no dedup/lookup state to race on), so they're fired
      // together instead of one round-trip at a time. A note with no "person" (or one the model
      // didn't tie to a specific attendee) is a general event-level detail — same "notes" table,
      // same moment_id, just person_id: null — rather than being silently dropped. A note that DOES
      // name a person but fails to resolve (typo, ambiguous shared name) is still dropped, same as
      // before: that's a resolution failure, not an intentional general note.
      await Promise.all(
        (momentEntry.notes ?? []).map((note: any) => {
          const rawPerson = note.person?.trim()
          if (!rawPerson) {
            return supabaseClient.from("notes").insert({
              person_id: null,
              moment_id: momentId,
              content: note.note,
              source: "home",
            })
          }
          const personId = idByName[rawPerson.toLowerCase()]
          if (!personId) return null
          return supabaseClient.from("notes").insert({
            person_id: personId,
            moment_id: momentId,
            content: note.note,
            source: "home",
          })
        })
      )
      // This moment's cached summary depends on its notes (see summarize-moment), so any new one —
      // whether this moment is brand-new or already existed — makes the cache stale. Previously only
      // a brand-new moment ever regenerated (see momentIdsNeedingResummary above): adding detail to
      // an ALREADY-recorded event via Home chat left the summary stale until someone opened the event
      // page and hit the manual refresh button (CLAUDE.md rule 3 — a DB-cached output must be
      // invalidated when the underlying data actually changes).
      if ((momentEntry.notes ?? []).length > 0) momentIdsNeedingResummary.add(momentId)

      // After this moment's own notes, so a name the model put in BOTH places (against
      // instructions) has already been handled once and gets deduped rather than double-written.
      const momentLabel =
        momentEntry.moment_fields?.occasion ??
        (moments ?? []).find((m: any) => m.id === momentId)?.occasion ??
        null
      await collectMentionedNames(momentEntry.mentioned_names, momentId, momentLabel)

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

    // A new name that came up outside any event ("I should call my new neighbor Dave"). There's no
    // moment to hang a note on, so nothing is written unless the founder accepts the banner — the
    // frontend writes it as a plain profile note at that point.
    await collectMentionedNames(parsed.mentioned_names, null, null)

    // Fire every moment's summary regeneration now, once each, in the background — after all notes
    // for all moments this turn have landed above. Doesn't block this response (the frontend already
    // re-fetches the moment when its event page opens); see momentIdsNeedingResummary's declaration
    // above for why this covers both new and already-existing moments.
    for (const momentId of momentIdsNeedingResummary) {
      const summarizePromise = fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/summarize-moment`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: req.headers.get("Authorization")!,
          apikey: Deno.env.get("SUPABASE_ANON_KEY") ?? "",
        },
        body: JSON.stringify({ momentId }),
      }).catch((e) => console.error("Background summarize-moment kickoff failed", String(e)))
      // @ts-ignore -- EdgeRuntime is a Supabase Edge Runtime global, not in the Deno std lib types
      if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(summarizePromise)
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
        mentionedPeopleSuggestions,
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
