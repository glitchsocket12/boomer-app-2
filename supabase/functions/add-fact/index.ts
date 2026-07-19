import { serve } from "https://deno.land/std@0.224.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import {
  applyFamilySignals,
  buildSingleSubjectSignals,
  familySignalPromptSingleSubject,
  FAMILY_SIGNAL_JSON_FIELD_SINGLE_SUBJECT,
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
    const { personId, text } = await req.json()

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: req.headers.get("Authorization")! } } }
    )

    const {
      data: { user },
    } = await supabaseClient.auth.getUser()

    if (!user) {
      // Without a valid user, the notes/reminders inserts below silently fail under RLS with
      // no error the caller ever sees — same stale-session bug converse had (see PROJECT_CONTEXT.md
      // Section 9/10). Fail loudly instead of pretending the fact was saved.
      return new Response(
        JSON.stringify({ error: "not_authenticated", message: "Your session has expired — please log out and log back in, then try again." }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    const { data: person } = await supabaseClient
      .from("people")
      .select("name, last_name, nicknames, reminders(id, label, month, day)")
      .eq("id", personId)
      .single()

    const reminders: { id: string; label: string; month: number; day: number }[] = person?.reminders ?? []
    const birthday = reminders.find((r) => r.label === "Birthday")
    const anniversary = reminders.find((r) => r.label === "Anniversary")
    const personFullName = person ? (person.last_name ? `${person.name} ${person.last_name}` : person.name) : "this person"

    const { data: existingGroups } = await supabaseClient.from("groups").select("id, name")
    const groupsRoster = (existingGroups ?? []).map((g) => g.name).join(", ")

    const { data: allPeople } = await supabaseClient.from("people").select("id, name, last_name, nicknames")
    const nameById: Record<string, string> = {}
    const idByName: Record<string, string> = {}
    // A bare first name or nickname only maps to a person if that key is unique — same
    // ambiguous-key guard used in converse/update-moment (see PROJECT_CONTEXT.md Section 9,
    // the "two Bobs" bug) so a relationship mention never misattaches to the wrong person.
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
      const fullName = p.last_name ? `${p.name} ${p.last_name}` : p.name
      nameById[p.id] = fullName
      idByName[fullName.toLowerCase()] = p.id
      claimKey(p.name.toLowerCase(), p.id)
      for (const nickname of (p.nicknames ?? "").split(",").map((n: string) => n.trim()).filter(Boolean)) {
        claimKey(nickname.toLowerCase(), p.id)
      }
    }
    for (const key of ambiguousKeys) delete idByName[key]

    const addFactSystemPrompt = `You classify a short piece of text someone typed about a person named ${person?.name ?? "someone"} in an app called Boomer, so it can be filed into the right place. Info currently on file: first name = ${person?.name ?? "none"}, last name = ${person?.last_name ?? "none"}, nicknames/goes-by = ${person?.nicknames || "none"}, birthday = ${birthday ? `${birthday.month}/${birthday.day}` : "none"}, anniversary = ${anniversary ? `${anniversary.month}/${anniversary.day}` : "none"}. Groups already on file: ${groupsRoster || "(none yet)"}.

Respond ONLY with a JSON object in this exact shape:
{"type": "name_update" | "birthday_update" | "anniversary_update" | "note", "value": <see below>, "group_signal": null | {"group_name": "string", "confidence": "high" | "medium"}, ${FAMILY_SIGNAL_JSON_FIELD_SINGLE_SUBJECT}}

"type"/"value" pairing:
- Providing or correcting their NAME — first name, last name, a full "First Last" spelling correction, and/or a NICKNAME or "goes by" name (e.g. "Their name is spelled Jonathan Smith", "Her last name is Peterson", "It's actually spelled Katherine, not Catherine", "He goes by Bob", "Everyone calls her Gigi"): {"type": "name_update", "value": {"first_name": "TheFirstName" or null, "last_name": "TheLastName" or null, "nicknames": ["NewNickname1"] or null}}. Only include the part(s) actually being given/corrected — set the others to null. If the user states a full "First Last" name, include BOTH as the authoritative spelling of the whole name, even if one part already matches what's on file. "nicknames" is for a name they go by that ISN'T their formal first/last name (e.g. a childhood nickname, a name only some people call them, "Grandpa Joe") — list only newly-stated nickname(s), not ones already on file.
- Providing or correcting their BIRTHDAY (month/day only, no year): {"type": "birthday_update", "value": {"month": 1-12, "day": 1-31}}
- Providing or correcting their ANNIVERSARY date (month/day only, no year): {"type": "anniversary_update", "value": {"month": 1-12, "day": 1-31}}
- Anything else (a plain fact, memory, or detail that doesn't fit the above): {"type": "note", "value": "the text, lightly cleaned up if needed, otherwise unchanged"}

"group_signal" is separate from "type" and can apply alongside any of them. A GROUP is a recurring, ongoing affiliation this person shares WITH THE APP'S USER — a school, team, military unit, workplace, or friend circle — not a one-off event.
- If the text clearly identifies a specific named group that matches (or is obviously the same as) one already on file, or clearly names a specific real institution/organization as a shared affiliation (e.g. "we went to Lincoln High together", "she was in my platoon in the Army"), set {"group_name": "<the matching or given name>", "confidence": "high"}.
- If the text strongly implies a shared group-like affiliation but is too vague/generic to be sure it should reuse or create a specific group (e.g. "was a high school friend of mine", "we used to work together", "friend from my running club"), set {"group_name": "<your best short label for it, e.g. 'High School Friends'>", "confidence": "medium"}.
- If there's no group affiliation signal at all (most facts — a relationship, a preference, a physical description, a birthday, etc.), set "group_signal" to null.
Never set a group_signal for a single one-off event or a bare location mention.

${familySignalPromptSingleSubject(person?.name ?? "this person")}`

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": Deno.env.get("ANTHROPIC_API_KEY") ?? "",
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-5",
        max_tokens: 500,
        // This prompt is unique per-personId (name/birthday/nicknames baked in), so caching
        // only helps across repeated calls for the SAME person, not across different profiles —
        // still worth it since the instructions block is long.
        system: [{ type: "text", text: addFactSystemPrompt, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: text }],
      }),
    })

    const data = await response.json()
    const textBlock = data.content?.find((b: any) => b.type === "text")

    let result: {
      type: string
      value: any
      group_signal: { group_name: string; confidence: string } | null
      family_signals: { relationship: string; person_names: string[] }[]
    } = {
      type: "note",
      value: text,
      group_signal: null,
      family_signals: [],
    }
    try {
      result = { ...result, ...JSON.parse((textBlock?.text ?? "").trim()) }
    } catch {
      // if parsing fails, just fall back to saving it as a plain note
    }

    if (result.type === "name_update") {
      const updates: { name?: string; last_name?: string; nicknames?: string } = {}
      if (result.value?.first_name) updates.name = result.value.first_name
      if (result.value?.last_name) updates.last_name = result.value.last_name
      if (Array.isArray(result.value?.nicknames) && result.value.nicknames.length > 0) {
        // Add newly-stated nicknames alongside whatever's already on file, rather than
        // replacing — same additive, dedupe-by-lowercase spirit as the reciprocal-note dedupe below.
        const existing = (person?.nicknames ?? "").split(",").map((n: string) => n.trim()).filter(Boolean)
        const merged = [...existing]
        for (const nickname of result.value.nicknames) {
          const trimmed = String(nickname).trim()
          if (trimmed && !merged.some((n) => n.toLowerCase() === trimmed.toLowerCase())) merged.push(trimmed)
        }
        updates.nicknames = merged.join(", ")
      }
      if (Object.keys(updates).length > 0) {
        await supabaseClient.from("people").update(updates).eq("id", personId)
      }
    } else if (result.type === "birthday_update" || result.type === "anniversary_update") {
      const label = result.type === "birthday_update" ? "Birthday" : "Anniversary"
      const existing = label === "Birthday" ? birthday : anniversary
      const { month, day } = result.value ?? {}
      if (month && day) {
        if (existing) {
          await supabaseClient.from("reminders").update({ month, day }).eq("id", existing.id)
        } else {
          await supabaseClient.from("reminders").insert({ person_id: personId, label, month, day })
        }
      }
    } else {
      const { error: noteError } = await supabaseClient
        .from("notes")
        .insert({ person_id: personId, moment_id: null, content: result.value })
      if (noteError) {
        console.error("add-fact: failed to save note", noteError.message)
        return new Response(
          JSON.stringify({ error: "save_failed", message: "That didn't save — please try again." }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        )
      }
    }

    let groupTag: { id: string; name: string } | null = null
    let suggestedGroup: string | null = null

    if (result.group_signal?.group_name && user) {
      const key = result.group_signal.group_name.toLowerCase()
      const match = (existingGroups ?? []).find((g) => g.name.toLowerCase() === key)

      if (result.group_signal.confidence === "high") {
        let groupId = match?.id ?? null
        let groupName = match?.name ?? result.group_signal.group_name
        if (!groupId) {
          const { data: newGroup } = await supabaseClient
            .from("groups")
            .insert({ user_id: user.id, name: result.group_signal.group_name })
            .select()
            .single()
          if (newGroup) {
            groupId = newGroup.id
            groupName = newGroup.name
          }
        }
        if (groupId) {
          await supabaseClient
            .from("person_groups")
            .upsert({ person_id: personId, group_id: groupId }, { onConflict: "person_id,group_id", ignoreDuplicates: true })
          groupTag = { id: groupId, name: groupName }
        }
      } else if (result.group_signal.confidence === "medium") {
        suggestedGroup = match?.name ?? result.group_signal.group_name
      }
    }

    let familyTags: { id: string; name: string }[] = []
    let relationshipSuggestions: { parentId: string; parentName: string; childId: string; childName: string }[] = []
    let newPersonSuggestions: {
      relationship: string
      rawName: string
      reciprocalNote: string
      suggestionText: string
      candidateId?: string
      candidateName?: string
    }[] = []

    if (user && (result.family_signals ?? []).length > 0) {
      const applied = await applyFamilySignals(
        supabaseClient,
        Deno.env.get("ANTHROPIC_API_KEY") ?? "",
        buildSingleSubjectSignals(personFullName, result.family_signals ?? []),
        { idByName, nameById }
      )
      familyTags = applied.familyTags
      relationshipSuggestions = applied.relationshipSuggestions
      newPersonSuggestions = applied.newPersonSuggestions
    }

    return new Response(
      JSON.stringify({ applied: result.type, groupTag, suggestedGroup, familyTags, relationshipSuggestions, newPersonSuggestions }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    )
  } catch (error) {
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }
})
