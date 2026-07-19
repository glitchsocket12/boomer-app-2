import { serve } from "https://deno.land/std@0.224.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

// Generic ice-breakers used when there's no recorded data yet, or if the AI call fails —
// the suggestions row should never come up empty/broken, just less personalized.
const FALLBACK_SUGGESTIONS = [
  "Let me tell you a story about a recent get-together with friends or family!",
  "Take a trip down memory lane about something that happened earlier this year!",
  "Who's someone you've been thinking about lately? Catch me up on them.",
]

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: req.headers.get("Authorization")! } } }
    )

    const {
      data: { user },
    } = await supabaseClient.auth.getUser()

    if (!user) {
      return new Response(JSON.stringify({ suggestions: FALLBACK_SUGGESTIONS }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    const { data: moments } = await supabaseClient
      .from("moments")
      .select("occasion, location, when_text, created_at")
      .order("created_at", { ascending: false })
      .limit(25)
    const { data: people } = await supabaseClient.from("people").select("name, last_name").limit(40)
    const { data: groups } = await supabaseClient.from("groups").select("name").limit(20)

    if (!moments || moments.length === 0) {
      return new Response(JSON.stringify({ suggestions: FALLBACK_SUGGESTIONS }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    const momentLines = moments
      .map((m) => `Occasion: ${m.occasion ?? "unknown"} | Location: ${m.location ?? "unknown"} | When: ${m.when_text ?? "unknown"}`)
      .join("\n")
    const peopleNames = (people ?? []).map((p) => (p.last_name ? `${p.name} ${p.last_name}` : p.name)).join(", ")
    const groupNames = (groups ?? []).map((g) => g.name).join(", ")

    const context = `Recorded moments (most recent first):
${momentLines}

People on file: ${peopleNames || "(none yet)"}

Groups on file: ${groupNames || "(none yet)"}`

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
        system:
          "You write short, warm invitations that appear on the home screen of a personal memory-keeping app called Boomer, nudging the user to share something in its chat box. Based on the moments/people/groups given to you, write exactly 3 suggestions. Each is ONE upbeat, second-person sentence — like a warm nudge from a friend. Favor storytelling phrasings like \"Let me tell you a story about your wedding!\" or \"Take a trip down memory lane about your trip to Denver!\", and vary the opening across the 3 (e.g. also \"Catch me up on...\" or \"What's the latest with...\" for catching up on a person). Prefer citing something concrete and specific already on file (an actual occasion, location, or person's name) over vague filler. Vary the 3 suggestions — don't reuse the same person/event for more than one, and mix revisiting a past moment with catching up on a person or something new. Respond with ONLY a JSON array of exactly 3 strings, nothing else, no markdown fencing.",
        messages: [{ role: "user", content: context }],
      }),
    })

    if (!response.ok) {
      const errorBody = await response.text()
      console.error("Anthropic API error", response.status, errorBody)
      return new Response(JSON.stringify({ suggestions: FALLBACK_SUGGESTIONS }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    const data = await response.json()
    const textBlock = data.content?.find((b: any) => b.type === "text")

    let suggestions: string[] = FALLBACK_SUGGESTIONS
    try {
      const rawText = textBlock?.text ?? ""
      const start = rawText.indexOf("[")
      const end = rawText.lastIndexOf("]")
      const parsed = JSON.parse(rawText.slice(start, end + 1))
      if (Array.isArray(parsed) && parsed.every((s) => typeof s === "string") && parsed.length > 0) {
        suggestions = parsed
      }
    } catch (parseError) {
      console.error("Failed to parse suggestion list as JSON", String(parseError), "raw text was:", textBlock?.text)
    }

    return new Response(JSON.stringify({ suggestions }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  } catch (error) {
    console.error("suggest-prompts error", String(error))
    return new Response(JSON.stringify({ suggestions: FALLBACK_SUGGESTIONS }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }
})
