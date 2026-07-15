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
      .select("name, last_name")
      .eq("id", personId)
      .single()

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
        system: `You classify a short piece of text someone typed about a person named ${person?.name ?? "someone"} (current last name on file: ${person?.last_name ?? "none"}) in an app called Boomer. Respond ONLY with a JSON object in one of these exact shapes: if the text is specifically providing or correcting their LAST NAME, respond {"type": "last_name_update", "value": "TheLastName"}. Otherwise, respond {"type": "note", "value": "the text, lightly cleaned up if needed, otherwise unchanged"}.`,
        messages: [{ role: "user", content: text }],
      }),
    })

    const data = await response.json()
    const textBlock = data.content?.find((b: any) => b.type === "text")

    let result: { type: string; value: string } = { type: "note", value: text }
    try {
      result = JSON.parse((textBlock?.text ?? "").trim())
    } catch {
      // if parsing fails, just fall back to saving it as a plain note
    }

    if (result.type === "last_name_update") {
      await supabaseClient.from("people").update({ last_name: result.value }).eq("id", personId)
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