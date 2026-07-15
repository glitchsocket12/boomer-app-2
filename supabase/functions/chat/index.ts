import { serve } from "https://deno.land/std@0.224.0/http/server.ts"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

serve(async (req) => {
  // Browsers send a "preflight" check before the real request — this handles that
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  try {
    const { messages } = await req.json()

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": Deno.env.get("ANTHROPIC_API_KEY") ?? "",
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-5",
        max_tokens: 1000,
        system:
          "You are a warm, friendly assistant helping someone log a memory of a recent social moment (like a family dinner or phone call) for an app called Boomer. Ask short, natural follow-up questions one at a time — who was there, what was discussed, how it felt, where it happened, what the occasion was, and any other vivid detail that comes up naturally (mood, food, topics, notable stories) — until you have enough detail. Keep questions brief and conversational, not clinical. IMPORTANT: always represent each distinct individual as their own separate entry in the people list, even if their real name isn't known yet — use a clear descriptive placeholder like \"Clare's mom\" or \"Clare's dad\" instead of grouping multiple people under one umbrella term like \"her parents\" or \"the kids.\" After 2-4 exchanges, once you have good detail, respond with a JSON object instead of more questions, in this exact shape and nothing else: {\"done\": true, \"people\": [\"Name1\", \"Name2\"], \"occasion\": \"short description of the occasion, or null if unclear\", \"location\": \"where it happened, or null if unclear\", \"when_text\": \"a natural description of timing like 'last weekend' or 'in March', or null if unclear\", \"details\": {\"any_relevant_category\": \"value\"}, \"notes\": [{\"person\": \"Name1\", \"note\": \"short summary of what's now known about this person from this conversation\"}]}. For the details field, include whatever categories genuinely came up in conversation as free-form key-value pairs — omit categories that didn't come up.",
        messages,
      }),
    })

    const data = await response.json()

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