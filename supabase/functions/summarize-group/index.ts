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
    const { groupId } = await req.json()

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: req.headers.get("Authorization")! } } }
    )

    const { data: group } = await supabaseClient
      .from("groups")
      .select(
        "id, name, person_groups(people(name, last_name)), moment_groups(moments(occasion, raw_description))"
      )
      .eq("id", groupId)
      .single()

    if (!group) {
      return new Response(JSON.stringify({ error: "Group not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    const fullName = (p: { name: string; last_name: string | null }) =>
      p.last_name ? `${p.name} ${p.last_name}` : p.name

    // Members = explicit person_groups roster ONLY. Attending an event tagged to this group
    // doesn't make someone a member (the same event can be tagged to multiple groups), so
    // event attendees are intentionally not folded into this set.
    const memberNames = new Set<string>()
    for (const pg of group.person_groups ?? []) {
      if (pg.people) memberNames.add(fullName(pg.people))
    }

    const events = (group.moment_groups ?? [])
      .map((mg) => mg.moments)
      .filter((m): m is { occasion: string | null; raw_description: string } => m !== null)
      .map((m) => m.occasion || m.raw_description)

    const context = `Group name: ${group.name}
Members: ${memberNames.size > 0 ? [...memberNames].join(", ") : "(none recorded)"}
Events tagged to this group: ${events.length > 0 ? events.join("; ") : "(none recorded)"}`

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": Deno.env.get("ANTHROPIC_API_KEY") ?? "",
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-5",
        max_tokens: 100,
        system:
          "You write a single, very short, high-level description of a group in a personal memory-keeping app called Boomer, based on its members and the events tagged to it. One sentence, no more than 20 words, plain factual tone, no preamble or quotation marks. If there isn't enough context to say anything specific, describe it generically from the name alone (e.g. \"A group called '<name>'.\"). Respond with ONLY the sentence.",
        messages: [{ role: "user", content: context }],
      }),
    })

    const data = await response.json()
    const textBlock = data.content?.find((b: any) => b.type === "text")
    const summary = (textBlock?.text ?? "").trim().replace(/^"|"$/g, "")

    if (summary) {
      await supabaseClient.from("groups").update({ summary }).eq("id", groupId)
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
