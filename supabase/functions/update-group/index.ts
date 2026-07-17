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
    const { groupId, messages } = await req.json()

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: req.headers.get("Authorization")! } } }
    )

    const { data: group } = await supabaseClient
      .from("groups")
      .select(
        "id, name, person_groups(people(id, name, last_name)), moment_groups(moments(id, occasion, raw_description, notes(people(id, name, last_name))))"
      )
      .eq("id", groupId)
      .single()

    const { data: allPeople } = await supabaseClient.from("people").select("id, name, last_name")
    const { data: allMoments } = await supabaseClient.from("moments").select("id, occasion, raw_description")

    const fullName = (p: { name: string; last_name: string | null }) =>
      p.last_name ? `${p.name} ${p.last_name}` : p.name

    const currentMembers = new Set<string>()
    for (const pg of group?.person_groups ?? []) {
      if (pg.people) currentMembers.add(fullName(pg.people))
    }
    for (const mg of group?.moment_groups ?? []) {
      for (const n of mg.moments?.notes ?? []) {
        if (n.people) currentMembers.add(fullName(n.people))
      }
    }

    const taggedMomentIds = new Set((group?.moment_groups ?? []).map((mg) => mg.moments?.id).filter(Boolean))

    const taggedEvents = (group?.moment_groups ?? [])
      .map((mg) => mg.moments)
      .filter((m): m is { id: string; occasion: string | null; raw_description: string } => m !== null)
      .map((m) => `[MOMENT_ID: ${m.id}] ${m.occasion || m.raw_description}`)
      .join("\n")

    const otherEvents = (allMoments ?? [])
      .filter((m) => !taggedMomentIds.has(m.id))
      .map((m) => `[MOMENT_ID: ${m.id}] ${m.occasion || m.raw_description}`)
      .join("\n")

    const knownPeople = (allPeople ?? []).map((p) => fullName(p)).join(", ")

    const systemPrompt = `You are helping the user edit a group called "${group?.name ?? "Unknown"}" in an app called Boomer. Groups tag together people and events that share a recurring affiliation (a team, a school, a workplace, a family branch, etc.).

Current members: ${currentMembers.size > 0 ? [...currentMembers].join(", ") : "(none recorded)"}
Events already tagged to this group:
${taggedEvents || "(none)"}
Other events NOT tagged to this group (reference these by their exact MOMENT_ID if the user wants to add one):
${otherEvents || "(none)"}
All people already in the app (match against these before assuming someone is new): ${knownPeople || "(none)"}

The user may want to: rename the group, add or remove members, or tag/untag events. Don't finish right away — first ask a short, natural follow-up like "Anything else you'd like to change?" so they have a chance to make more edits in one go. Only respond with the final JSON once the user indicates they're done (says something like "no," "that's all," or "nothing else"). When you do finish, respond with ONLY a JSON object in this exact shape and nothing else, reflecting everything requested across the WHOLE conversation, not just the last message: {"done": true, "rename": "New Name or null if not renamed", "add_people": ["Name1"], "remove_people": ["Name2"], "add_event_ids": ["exact MOMENT_ID from the list above"], "remove_event_ids": ["exact MOMENT_ID of an already-tagged event"]}. Leave arrays empty and rename null for anything not requested.`

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
