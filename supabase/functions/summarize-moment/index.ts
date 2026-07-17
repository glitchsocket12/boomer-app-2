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
    const { momentId } = await req.json()

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: req.headers.get("Authorization")! } } }
    )

    const { data: moment } = await supabaseClient
      .from("moments")
      .select(
        "id, occasion, location, when_text, raw_description, details, notes(content, people(name, last_name))"
      )
      .eq("id", momentId)
      .single()

    if (!moment) {
      return new Response(JSON.stringify({ error: "Moment not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    const fullName = (p: { name: string; last_name: string | null }) =>
      p.last_name ? `${p.name} ${p.last_name}` : p.name

    const notesText = (moment.notes ?? [])
      .map((n: any) => (n.people ? `${fullName(n.people)}: ${n.content}` : n.content))
      .join("; ")

    const detailsText =
      moment.details && typeof moment.details === "object" && Object.keys(moment.details).length > 0
        ? Object.entries(moment.details)
            .map(([k, v]) => `${k}: ${v}`)
            .join(", ")
        : "(none)"

    const context = `Title: ${moment.occasion || "(untitled)"}
When: ${moment.when_text || "(not specified)"}
Where: ${moment.location || "(not specified)"}
Other details on file: ${detailsText}
What the user originally said about it: ${moment.raw_description}
Notes recorded about who was there / what they said: ${notesText || "(none)"}`

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": Deno.env.get("ANTHROPIC_API_KEY") ?? "",
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-5",
        max_tokens: 250,
        system:
          "You write a short, warm, easy-to-read summary of a personal memory for a memory-keeping app called Boomer. You're given what the user originally typed or said about the event (which may be disjointed or repetitive, since it was captured across a back-and-forth conversation) plus any structured details and notes about who was there. Rewrite it into 2-4 smooth sentences in the user's own first-person voice (\"I...\"), past tense, that read naturally on their own — not a copy-paste of the raw input, not a bullet list, no meta-commentary about the memory app itself, no preamble, no quotation marks. Cover what happened and who was involved; skip fields that are marked not specified/none. Respond with ONLY the summary.",
        messages: [{ role: "user", content: context }],
      }),
    })

    if (!response.ok) {
      const errorBody = await response.text()
      console.error("Anthropic API error", response.status, errorBody)
      return new Response(JSON.stringify({ error: "Anthropic API error" }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    const data = await response.json()
    const textBlock = data.content?.find((b: any) => b.type === "text")
    const summary = (textBlock?.text ?? "").trim().replace(/^"|"$/g, "")

    if (summary) {
      await supabaseClient.from("moments").update({ summary }).eq("id", momentId)
    }

    return new Response(JSON.stringify({ summary }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  } catch (error) {
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }
})
