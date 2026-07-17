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

    const {
      data: { user },
    } = await supabaseClient.auth.getUser()

    if (!user) {
      // Without a valid user, inserts below would silently fail RLS while the AI still
      // claimed things were saved. Fail loudly instead (same reasoning as converse/index.ts).
      return new Response(
        JSON.stringify({ error: "not_authenticated", reply: "Your session has expired — please log out and log back in, then try again." }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    const { data: moment } = await supabaseClient
      .from("moments")
      .select("occasion, location, when_text, event_date, details")
      .eq("id", momentId)
      .single()
    const { data: existingNotes } = await supabaseClient
      .from("notes")
      .select("content, person_id")
      .eq("moment_id", momentId)
    const { data: people } = await supabaseClient.from("people").select("id, name")

    const nameById: Record<string, string> = {}
    const idByName: Record<string, string> = {}
    for (const p of people ?? []) {
      nameById[p.id] = p.name
      idByName[p.name.toLowerCase()] = p.id
    }

    const existingSummary = `Occasion: ${moment?.occasion ?? "unknown"} | Location: ${moment?.location ?? "unknown"} | When (in the user's words): ${moment?.when_text ?? "unknown"} | Resolved calendar date: ${moment?.event_date ?? "not set"}. Already recorded notes: ${(existingNotes ?? [])
      .map((n: any) => `${nameById[n.person_id] ?? "someone"}: ${n.content}`)
      .join("; ") || "none"}`

    const todayIso = new Date().toISOString().slice(0, 10)

    const systemPrompt = `You are helping the user add more detail to a memory they already recorded in an app called Boomer. Today's date is ${todayIso}.

Here's what's already known about this moment: ${existingSummary}

When the user shares a new detail, don't finish right away — first ask a short, natural follow-up question like "Anything else you remember about this?" so they have a chance to add more. Only set "done": true once the user indicates they're finished (says something like "no," "that's all," or "nothing else").

At the end of EVERY turn (not just the final one), respond with ONLY a JSON object in this exact shape and nothing else:
{"reply": "the natural conversational text to show the user", "done": false, "new_people": ["Name1"], "additional_notes": [{"person": "Name1", "note": "short new fact"}], "moment_field_updates": {"occasion": null, "location": null, "when_text": null, "event_date": null}}

This is saved immediately after every single turn, so only include in "new_people"/"additional_notes"/"moment_field_updates" whatever is newly given in the user's latest message — never repeat something already reflected in what's already known above.

"moment_field_updates" is for the moment's own top-level fields, not a person-specific fact. Use it when the user gives new or corrected info about the event itself:
- "when_text": the user's own words describing timing (e.g. "fall of 2025"), only when they give timing info different from what's already known.
- "event_date": your best-guess actual calendar date as "YYYY-MM-DD" matching whatever "when_text" you just set. Resolve relative phrases against today's date (${todayIso}). If they name a season, use its first day for the year they mean (spring=Mar 1, summer=Jun 1, fall=Sep 1, winter=Dec 1). If they give a specific month/year, use the 1st of that month. If only a year, use January 1. Always give your single closest best guess rather than a range.
- "location" / "occasion": only set when the user is giving new or corrected info for that specific field.
Leave any of these four keys null when the user didn't touch that field this turn.

Most notes are tied to a specific person (who they were with, what someone said or did) — use "additional_notes" for those, matching an existing recorded person's name, or "new_people" first if they aren't recorded yet. A detail about the moment itself (timing, place, title) rather than about a specific person belongs in "moment_field_updates" instead — never invent a note with no real person attached just to store a timing or location correction.`

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
        JSON.stringify({ reply: "Sorry, I'm having trouble responding right now — please try again in a moment.", done: false, changed: false }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    const data = await response.json()
    const textBlock = data.content?.find((b: any) => b.type === "text")

    let parsed: any = {
      reply: "Sorry, I didn't get a response there — please try again.",
      done: false,
      new_people: [],
      additional_notes: [],
      moment_field_updates: null,
    }
    let rawText = ""
    try {
      rawText = textBlock?.text ?? ""
      const start = rawText.indexOf("{")
      const end = rawText.lastIndexOf("}")
      const jsonSlice = rawText.slice(start, end + 1)
      parsed = { ...parsed, ...JSON.parse(jsonSlice) }
    } catch (parseError) {
      console.error("Failed to parse AI reply as JSON", String(parseError), "raw text was:", rawText)
      const replyMatch = rawText.match(/"reply"\s*:\s*"((?:[^"\\]|\\.)*)/)
      parsed.reply = replyMatch ? replyMatch[1].replace(/\\"/g, '"').replace(/\\n/g, "\n") : parsed.reply
    }

    for (const name of parsed.new_people ?? []) {
      const key = name.toLowerCase()
      if (!idByName[key]) {
        const { data: newPerson } = await supabaseClient
          .from("people")
          .insert({ user_id: user.id, name })
          .select()
          .single()
        if (newPerson) idByName[key] = newPerson.id
      }
    }

    let notesAdded = 0
    for (const note of parsed.additional_notes ?? []) {
      const personId = idByName[note.person?.toLowerCase()]
      if (personId) {
        await supabaseClient.from("notes").insert({
          person_id: personId,
          moment_id: momentId,
          content: note.note,
        })
        notesAdded++
      }
    }

    const fieldUpdates: Record<string, string> = {}
    const updates = parsed.moment_field_updates
    if (updates?.occasion) fieldUpdates.occasion = updates.occasion
    if (updates?.location) fieldUpdates.location = updates.location
    if (updates?.when_text) fieldUpdates.when_text = updates.when_text
    if (updates?.event_date) fieldUpdates.event_date = updates.event_date
    if (Object.keys(fieldUpdates).length > 0) {
      await supabaseClient.from("moments").update(fieldUpdates).eq("id", momentId)
    }

    const changed = (parsed.new_people?.length ?? 0) > 0 || notesAdded > 0 || Object.keys(fieldUpdates).length > 0

    return new Response(JSON.stringify({ reply: parsed.reply, done: parsed.done === true, changed }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  } catch (error) {
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }
})
