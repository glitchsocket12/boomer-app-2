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
    const { messages } = await req.json()

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: req.headers.get("Authorization")! } } }
    )

    const {
      data: { user },
    } = await supabaseClient.auth.getUser()

    const { data: people } = await supabaseClient.from("people").select("id, name, last_name")
    const { data: moments } = await supabaseClient
      .from("moments")
      .select("id, occasion, location, when_text, details, created_at, notes(content, person_id)")

    const nameById: Record<string, string> = {}
    const idByName: Record<string, string> = {}
    for (const p of people ?? []) {
      const fullName = p.last_name ? `${p.name} ${p.last_name}` : p.name
      nameById[p.id] = fullName
      idByName[fullName.toLowerCase()] = p.id
      idByName[p.name.toLowerCase()] = p.id
    }

    const context = (moments ?? [])
      .map((m: any) => {
        const notePeople = (m.notes ?? []).map((n: any) => nameById[n.person_id] ?? "someone")
        const noteLines = (m.notes ?? [])
          .map((n: any) => `${nameById[n.person_id] ?? "someone"}: ${n.content}`)
          .join("; ")
        const recordedOn = new Date(m.created_at).toDateString()
        return `[MOMENT_ID: ${m.id}] Occasion: ${m.occasion ?? "unknown"} | Location: ${m.location ?? "unknown"} | When (as described): ${m.when_text ?? "unknown"} | Recorded on: ${recordedOn} | People: ${[...new Set(notePeople)].join(", ")} | Notes: ${noteLines}`
      })
      .join("\n")

    const todayString = new Date().toDateString()

    const systemPrompt = `You are Boomer's memory assistant. You help someone build and explore a record of their social moments and the people in their life, entirely through natural conversation.

Today's date is ${todayString}.

Here are the moments already recorded, each tagged with [MOMENT_ID: ...]. Each one shows "When (as described)" — the timing phrase the user originally used (like "last summer") — and "Recorded on" — the actual date they typed that phrase. IMPORTANT: interpret relative time phrases relative to when they were RECORDED, not relative to today. For example, work out which actual year "last summer" refers to based on the recorded date, not today's date. When asked things like "how many years ago," calculate using today's actual date compared to the year you worked out.
${context || "(none recorded yet)"}

Each time the user writes something, figure out what they're doing:
- If they're asking a broad question about a PERSON (like "tell me about Steve"), pull together everything recorded about that person across ALL their moments and notes into one summary — don't require an exact match to a single moment.
- If they're asking a narrower question about a specific event or detail, answer that specifically.
- If you genuinely can't find anything relevant to what they asked, don't just say "nothing found" and stop there. Instead, do ONE of these, whichever fits better: (a) if there's a close but imperfect match, mention what you did find and gently ask if that's what they meant, or (b) if there's truly nothing related, ask a warm, specific question that might jog their memory (e.g. "I don't have anything on a trip to Denver yet — was that with someone I already know, or someone new?"), or (c) invite them to share the memory now. Never respond with just an empty dead-end.
- If they're describing a brand-new memory that isn't already recorded, ask a couple of short natural follow-up questions if useful (who, where, occasion), and once you have enough, record it as a new moment.
- If they're adding detail to something already recorded, treat it as an update to that existing MOMENT_ID, not a new one.
- If they give a real name for someone previously recorded under a vague placeholder, that's a rename, not a new person.
- If they mention someone's last name specifically, that's a last name update, not a general note.

At the end of EVERY turn, respond with ONLY a JSON object in this exact shape and nothing else:
{"reply": "the natural conversational text to show the user - a few sentences, factual, not overly enthusiastic", "new_people": ["Name1"], "renames": [{"old_name": "...", "new_name": "..."}], "last_name_updates": [{"person": "...", "last_name": "..."}], "notes": [{"person": "...", "note": "..."}], "moment_id": "the MOMENT_ID this turn relates to, or null", "new_moment": false, "moment_fields": null, "relevant_people": ["Name1"]}

IMPORTANT: "relevant_people" must list EVERY person mentioned by name anywhere in your "reply" text, not just the main subject of the question — if your reply mentions 5 people by name, relevant_people should have all 5.

Leave arrays empty and fields null when they don't apply — most simple questions will have empty arrays. Only set "new_moment": true and fill "moment_fields" (occasion, location, when_text) when you're capturing a genuinely brand-new event.`

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": Deno.env.get("ANTHROPIC_API_KEY") ?? "",
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-5",
        max_tokens: 700,
        system: systemPrompt,
        messages: messages,
      }),
    })

    const data = await response.json()
    const textBlock = data.content?.find((b: any) => b.type === "text")

    let parsed: any = { reply: "Sorry, I couldn't process that.", new_people: [], renames: [], last_name_updates: [], notes: [], moment_id: null, new_moment: false, moment_fields: null, relevant_people: [] }
    try {
      const raw = textBlock?.text ?? ""
      // Pull out just the JSON object, even if there's stray text before/after it
      const start = raw.indexOf("{")
      const end = raw.lastIndexOf("}")
      const jsonSlice = raw.slice(start, end + 1)
      parsed = { ...parsed, ...JSON.parse(jsonSlice) }
    } catch {
      parsed.reply = raw || parsed.reply
    }

    for (const rename of parsed.renames ?? []) {
      const oldKey = rename.old_name.toLowerCase()
      const existingId = idByName[oldKey]
      if (existingId) {
        await supabaseClient.from("people").update({ name: rename.new_name }).eq("id", existingId)
        idByName[rename.new_name.toLowerCase()] = existingId
      }
    }

    for (const name of parsed.new_people ?? []) {
      const key = name.toLowerCase()
      if (!idByName[key]) {
        const [first, ...rest] = name.trim().split(" ")
        const lastName = rest.length > 0 ? rest.join(" ") : null
        const { data: newPerson } = await supabaseClient
          .from("people")
          .insert({ user_id: user?.id, name: first, last_name: lastName })
          .select()
          .single()
        if (newPerson) idByName[key] = newPerson.id
      }
    }

    for (const update of parsed.last_name_updates ?? []) {
      const id = idByName[update.person.toLowerCase()]
      if (id) await supabaseClient.from("people").update({ last_name: update.last_name }).eq("id", id)
    }

    let momentId: string | null = parsed.moment_id ?? null
    if (parsed.new_moment) {
      const { data: newMoment } = await supabaseClient
        .from("moments")
        .insert({
          user_id: user?.id,
          raw_description: messages.map((m: any) => m.content).join("\n"),
          occasion: parsed.moment_fields?.occasion ?? null,
          location: parsed.moment_fields?.location ?? null,
          when_text: parsed.moment_fields?.when_text ?? null,
        })
        .select()
        .single()
      if (newMoment) momentId = newMoment.id
    }

    for (const note of parsed.notes ?? []) {
      const personId = idByName[note.person.toLowerCase()]
      if (personId) {
        await supabaseClient.from("notes").insert({
          person_id: personId,
          moment_id: momentId,
          content: note.note,
        })
      }
    }

    const relevantPeople = (parsed.relevant_people ?? [])
      .map((name: string) => {
        const id = idByName[name.toLowerCase()]
        return id ? { id, name } : null
      })
      .filter(Boolean)

    return new Response(JSON.stringify({ reply: parsed.reply, people: relevantPeople, momentId }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  } catch (error) {
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }
})