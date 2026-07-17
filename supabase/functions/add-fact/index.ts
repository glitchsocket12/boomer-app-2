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
    const { personId, text } = await req.json()

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: req.headers.get("Authorization")! } } }
    )

    const {
      data: { user },
    } = await supabaseClient.auth.getUser()

    const { data: person } = await supabaseClient
      .from("people")
      .select("name, last_name, reminders(id, label, month, day)")
      .eq("id", personId)
      .single()

    const reminders: { id: string; label: string; month: number; day: number }[] = person?.reminders ?? []
    const birthday = reminders.find((r) => r.label === "Birthday")
    const anniversary = reminders.find((r) => r.label === "Anniversary")

    const { data: existingGroups } = await supabaseClient.from("groups").select("id, name")
    const groupsRoster = (existingGroups ?? []).map((g) => g.name).join(", ")

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": Deno.env.get("ANTHROPIC_API_KEY") ?? "",
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-5",
        max_tokens: 400,
        system: `You classify a short piece of text someone typed about a person named ${person?.name ?? "someone"} in an app called Boomer, so it can be filed into the right place. Info currently on file: last name = ${person?.last_name ?? "none"}, birthday = ${birthday ? `${birthday.month}/${birthday.day}` : "none"}, anniversary = ${anniversary ? `${anniversary.month}/${anniversary.day}` : "none"}. Groups already on file: ${groupsRoster || "(none yet)"}.

Respond ONLY with a JSON object in this exact shape:
{"type": "last_name_update" | "birthday_update" | "anniversary_update" | "note", "value": <see below>, "group_signal": null | {"group_name": "string", "confidence": "high" | "medium"}}

"type"/"value" pairing:
- Providing or correcting their LAST NAME: {"type": "last_name_update", "value": "TheLastName"}
- Providing or correcting their BIRTHDAY (month/day only, no year): {"type": "birthday_update", "value": {"month": 1-12, "day": 1-31}}
- Providing or correcting their ANNIVERSARY date (month/day only, no year): {"type": "anniversary_update", "value": {"month": 1-12, "day": 1-31}}
- Anything else (a plain fact, memory, or detail that doesn't fit the above): {"type": "note", "value": "the text, lightly cleaned up if needed, otherwise unchanged"}

"group_signal" is separate from "type" and can apply alongside any of them. A GROUP is a recurring, ongoing affiliation this person shares WITH THE APP'S USER — a school, team, military unit, workplace, or friend circle — not a one-off event.
- If the text clearly identifies a specific named group that matches (or is obviously the same as) one already on file, or clearly names a specific real institution/organization as a shared affiliation (e.g. "we went to Lincoln High together", "she was in my platoon in the Army"), set {"group_name": "<the matching or given name>", "confidence": "high"}.
- If the text strongly implies a shared group-like affiliation but is too vague/generic to be sure it should reuse or create a specific group (e.g. "was a high school friend of mine", "we used to work together", "friend from my running club"), set {"group_name": "<your best short label for it, e.g. 'High School Friends'>", "confidence": "medium"}.
- If there's no group affiliation signal at all (most facts — a relationship, a preference, a physical description, a birthday, etc.), set "group_signal" to null.
Never set a group_signal for a single one-off event or a bare location mention.`,
        messages: [{ role: "user", content: text }],
      }),
    })

    const data = await response.json()
    const textBlock = data.content?.find((b: any) => b.type === "text")

    let result: { type: string; value: any; group_signal: { group_name: string; confidence: string } | null } = {
      type: "note",
      value: text,
      group_signal: null,
    }
    try {
      result = { ...result, ...JSON.parse((textBlock?.text ?? "").trim()) }
    } catch {
      // if parsing fails, just fall back to saving it as a plain note
    }

    if (result.type === "last_name_update") {
      await supabaseClient.from("people").update({ last_name: result.value }).eq("id", personId)
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
      await supabaseClient.from("notes").insert({ person_id: personId, moment_id: null, content: result.value })
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

    return new Response(JSON.stringify({ applied: result.type, groupTag, suggestedGroup }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  } catch (error) {
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }
})
