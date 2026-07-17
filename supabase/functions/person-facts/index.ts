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
    const { personId } = await req.json()

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: req.headers.get("Authorization")! } } }
    )

    const [{ data: person }, { data: notes }] = await Promise.all([
      supabaseClient.from("people").select("name, last_name").eq("id", personId).single(),
      supabaseClient.from("notes").select("content").eq("person_id", personId).order("created_at", { ascending: true }),
    ])

    const name = person?.name ?? "this person"
    const noteText = (notes ?? []).map((n) => n.content).join("\n")

    if (!noteText.trim()) {
      return new Response(JSON.stringify({ facts: [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

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
        system: `You extract key relationship/background facts about a person named ${name} from notes recorded about them in a personal memory-keeping app called Boomer. The notes below are a mix of standalone facts and things mentioned while recording specific memories/events.

Only extract facts that are EXPLICITLY stated in the notes. Never infer, guess, or pad with generic filler. Focus specifically on these categories:
- "spouse": their spouse or partner, and that person's name if given
- "kids": whether they have children, how many, and their names if given
- "location": where they currently live
- "education": a school or college they attended
- "other": at most 2 other clearly-stated close-relationship facts (e.g. parents, siblings) — only if directly stated, not inferred

Do not use one-off event/gathering details (who attended a party, what was served, etc.) unless the text directly states a relationship fact. If a category isn't clearly stated anywhere in the notes, omit it entirely rather than guessing.

Respond with ONLY a JSON object in this exact shape:
{"facts": [{"category": "spouse" | "kids" | "location" | "education" | "other", "text": "short factual bullet, under 15 words, third person"}]}
If nothing qualifies, respond {"facts": []}.`,
        messages: [{ role: "user", content: noteText }],
      }),
    })

    const data = await response.json()
    const textBlock = data.content?.find((b: any) => b.type === "text")

    let result: { facts: { category: string; text: string }[] } = { facts: [] }
    try {
      result = { ...result, ...JSON.parse((textBlock?.text ?? "").trim()) }
    } catch {
      // if parsing fails, just report no facts rather than showing garbage
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  } catch (error) {
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }
})
