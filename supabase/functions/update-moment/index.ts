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
    const { momentId, messages } = await req.json()

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: req.headers.get("Authorization")! } } }
    )

    const { data: moment } = await supabaseClient
      .from("moments")
      .select("occasion, location, when_text, details")
      .eq("id", momentId)
      .single()
    const { data: existingNotes } = await supabaseClient
      .from("notes")
      .select("content, person_id")
      .eq("moment_id", momentId)
    const { data: people } = await supabaseClient.from("people").select("id, name")

    const nameById: Record<string, string> = {}
    for (const p of people ?? []) nameById[p.id] = p.name

    const existingSummary = `Occasion: ${moment?.occasion ?? "unknown"} | Location: ${moment?.location ?? "unknown"} | When: ${moment?.when_text ?? "unknown"}. Already recorded notes: ${(existingNotes ?? [])
      .map((n: any) => `${nameById[n.person_id] ?? "someone"}: ${n.content}`)
      .join("; ") || "none"}`

    const systemPrompt = `You are helping the user add more detail to a memory they already recorded in an app called Boomer. Here's what's already known about this moment: ${existingSummary}. When the user shares a new detail, don't finish right away — first ask a short, natural question like "Anything else you remember about this?" so they have a chance to add more. Only respond with the final JSON summary once the user indicates they're done (says something like "no," "that's all," or "nothing else"). When you do finish, respond with ONLY a JSON object in this exact shape and nothing else, including everything new mentioned across the WHOLE conversation, not just the last message: {"done": true, "new_people": ["Name1"], "additional_notes": [{"person": "Name1", "note": "short new fact"}]}. Only include people or notes that are NEW or add detail beyond what's already recorded above.`

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
        JSON.stringify({
          content: [{ type: "text", text: "Sorry, I'm having trouble responding right now — please try again in a moment." }],
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    const data = await response.json()
    if (!data.content?.find((b: any) => b.type === "text")) {
      console.error("Anthropic response had no text block", JSON.stringify(data))
    }
    return new Response(JSON.stringify(data), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  } catch (error) {
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }
})