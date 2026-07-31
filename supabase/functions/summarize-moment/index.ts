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
      .order("created_at", { foreignTable: "notes" })
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
      .map((n: any, i: number) => `${i + 1}. ${n.people ? `${fullName(n.people)}: ` : ""}${n.content}`)
      .join("\n")

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
        // Was 250 (tuned for the old fixed "2-4 sentences" cap) — raised now that the prompt
        // explicitly prioritizes completeness, so a detailed event isn't truncated mid-summary.
        max_tokens: 600,
        system:
          "You write a warm, easy-to-read summary of a personal memory for a memory-keeping app called Boomer. You're given what the user originally typed or said about the event (which may be disjointed or repetitive, since it was captured across a back-and-forth conversation) plus any structured details and notes about who was there. The notes are listed in whatever order people happened to recall or record them — not necessarily the order things actually happened, since someone often adds a note about something earlier only after already describing something later. Read everything first, use any wording clues (e.g. \"before\", \"after\", \"first\", \"then\", \"later\", \"that morning/evening\", cause-and-effect) to work out your best guess at the true chronological order of events, and write the summary in that order rather than the order the notes are listed in. If there's no clue at all for how two things relate in time, use your best natural judgment rather than forcing a false sequence. Rewrite it all in the user's own first-person voice (\"I...\"), past tense, that reads naturally on its own — not a copy-paste of the raw input, not a bullet list, no meta-commentary about the memory app itself, no preamble, no quotation marks. PRIORITIZE COMPLETENESS OVER BREVITY: include every concrete detail given — activities, food, weather, gifts, quotes, reactions, specific people and what each of them did — not just a high-level gloss of the occasion. Do not compress away a specific detail for the sake of a shorter summary; a longer summary that keeps the specifics is strictly better than a shorter one that loses them. There's no fixed sentence count — write as many sentences as it takes to cover everything actually said, and no filler beyond that. Skip fields that are marked not specified/none. Respond with ONLY the summary.",
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
