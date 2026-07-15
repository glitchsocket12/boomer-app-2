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
    const { query } = await req.json()

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: req.headers.get("Authorization")! } } }
    )

    const { data: people } = await supabaseClient.from("people").select("id, name, last_name")
    const { data: moments } = await supabaseClient
      .from("moments")
      .select("id, occasion, location, when_text, details, notes(content, person_id)")

    const nameById: Record<string, string> = {}
    const idByName: Record<string, string> = {}
    for (const p of people ?? []) {
      const fullName = p.last_name ? `${p.name} ${p.last_name}` : p.name
      nameById[p.id] = fullName
      idByName[fullName.toLowerCase()] = p.id
      idByName[p.name.toLowerCase()] = p.id // still allow matching by first name alone
    }

    // Build one block of text PER MOMENT, tagged with its real ID, so Claude can point back to a specific event
    const context = (moments ?? [])
      .map((m: any) => {
        const notePeople = (m.notes ?? []).map((n: any) => nameById[n.person_id] ?? "someone")
        const noteLines = (m.notes ?? [])
          .map((n: any) => `${nameById[n.person_id] ?? "someone"}: ${n.content}`)
          .join("; ")
        return `[MOMENT_ID: ${m.id}] Occasion: ${m.occasion ?? "unknown"} | Location: ${m.location ?? "unknown"} | When: ${m.when_text ?? "unknown"} | People: ${[...new Set(notePeople)].join(", ")} | Notes: ${noteLines}`
      })
      .join("\n")

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
        system:
          "You are a calm, factual memory assistant for an app called Boomer. The user will ask a casual question about people or events in their life. You'll be given a list of moments, each tagged with a [MOMENT_ID: ...]. Respond ONLY with a JSON object in this exact shape and nothing else: {\"answer\": \"a direct, concise answer stating what was recorded, without embellishment - a few sentences at most, or a plain invitation to add a moment if nothing relevant was found\", \"relevant_people\": [\"Name1\", \"Name2\"], \"relevant_moment_id\": \"the exact MOMENT_ID this answer is primarily about, copied exactly as given, or null if the question isn't about one specific event\"}.",
        messages: [
          {
            role: "user",
            content: `Here are the user's recorded moments:\n${context || "(no moments recorded yet)"}\n\nThe user's question: ${query}`,
          },
        ],
      }),
    })

    const data = await response.json()
    const textBlock = data.content?.find((b: any) => b.type === "text")

    let answer = "Sorry, I couldn't work that out."
    let relevantPeople: { id: string; name: string }[] = []
    let relevantMomentId: string | null = null

    try {
      const parsed = JSON.parse((textBlock?.text ?? "").trim())
      answer = parsed.answer ?? answer
      relevantPeople = (parsed.relevant_people ?? [])
        .map((name: string) => {
          const id = idByName[name.toLowerCase()]
          return id ? { id, name } : null
        })
        .filter(Boolean)
      relevantMomentId = parsed.relevant_moment_id ?? null
    } catch {
      answer = textBlock?.text ?? answer
    }

    return new Response(JSON.stringify({ answer, people: relevantPeople, momentId: relevantMomentId }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  } catch (error) {
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }
})