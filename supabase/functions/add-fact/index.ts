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

    const { data: person } = await supabaseClient
      .from("people")
      .select("name, last_name, reminders(id, label, month, day)")
      .eq("id", personId)
      .single()

    const reminders: { id: string; label: string; month: number; day: number }[] = person?.reminders ?? []
    const birthday = reminders.find((r) => r.label === "Birthday")
    const anniversary = reminders.find((r) => r.label === "Anniversary")

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": Deno.env.get("ANTHROPIC_API_KEY") ?? "",
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-5",
        max_tokens: 300,
        system: `You classify a short piece of text someone typed about a person named ${person?.name ?? "someone"} in an app called Boomer, so it can be filed into the right place. Info currently on file: last name = ${person?.last_name ?? "none"}, birthday = ${birthday ? `${birthday.month}/${birthday.day}` : "none"}, anniversary = ${anniversary ? `${anniversary.month}/${anniversary.day}` : "none"}. Respond ONLY with a JSON object in one of these exact shapes:
- Providing or correcting their LAST NAME: {"type": "last_name_update", "value": "TheLastName"}
- Providing or correcting their BIRTHDAY (month/day only, no year): {"type": "birthday_update", "value": {"month": 1-12, "day": 1-31}}
- Providing or correcting their ANNIVERSARY date (month/day only, no year): {"type": "anniversary_update", "value": {"month": 1-12, "day": 1-31}}
- Anything else (a plain fact, memory, or detail that doesn't fit the above): {"type": "note", "value": "the text, lightly cleaned up if needed, otherwise unchanged"}`,
        messages: [{ role: "user", content: text }],
      }),
    })

    const data = await response.json()
    const textBlock = data.content?.find((b: any) => b.type === "text")

    let result: { type: string; value: any } = { type: "note", value: text }
    try {
      result = JSON.parse((textBlock?.text ?? "").trim())
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

    return new Response(JSON.stringify({ applied: result.type }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  } catch (error) {
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }
})
