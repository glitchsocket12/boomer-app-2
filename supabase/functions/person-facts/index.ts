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

    const [{ data: person }, { data: notes }, { data: allPeople }] = await Promise.all([
      supabaseClient.from("people").select("name, last_name").eq("id", personId).single(),
      supabaseClient.from("notes").select("content").eq("person_id", personId).order("created_at", { ascending: true }),
      supabaseClient.from("people").select("id, name, last_name"),
    ])

    const name = person?.name ?? "this person"
    const noteText = (notes ?? []).map((n) => n.content).join("\n")

    if (!noteText.trim()) {
      return new Response(JSON.stringify({ facts: [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    // Same ambiguous-first-name-safe lookup used by add-fact/converse/update-moment, so a
    // spouse's bare first name only resolves to a real profile link when it's unambiguous.
    const nameById: Record<string, string> = {}
    const idByName: Record<string, string> = {}
    const ambiguousFirstNames = new Set<string>()
    for (const p of allPeople ?? []) {
      const fullName = p.last_name ? `${p.name} ${p.last_name}` : p.name
      nameById[p.id] = fullName
      idByName[fullName.toLowerCase()] = p.id
      const firstNameKey = p.name.toLowerCase()
      if (idByName[firstNameKey] && idByName[firstNameKey] !== p.id) {
        ambiguousFirstNames.add(firstNameKey)
      } else {
        idByName[firstNameKey] = p.id
      }
    }
    for (const key of ambiguousFirstNames) delete idByName[key]

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
- "spouse": their spouse or partner
- "kids": whether they have children, how many, and their names if given
- "location": where they currently live
- "education": a school or college they attended
- "other": at most 2 other clearly-stated close-relationship facts (e.g. parents, siblings) — only if directly stated, not inferred

Do not use one-off event/gathering details (who attended a party, what was served, etc.) unless the text directly states a relationship fact. If a category isn't clearly stated anywhere in the notes, omit it entirely rather than guessing.

Respond with ONLY a JSON object in this exact shape:
{"facts": [{"category": "kids" | "location" | "education" | "other", "text": "short factual bullet, under 15 words, third person"} | {"category": "spouse", "relationship_label": "a short lead-in phrase describing the relationship as stated, e.g. \"Married to\", \"Engaged to\", \"Partner of\" — or, if no name is given at all, a complete standalone phrase like \"Married.\"", "person_name": "the spouse's name exactly as given, or null if no name was given"}]}
For the "spouse" fact, "relationship_label" must NEVER include the person's name itself — the app renders the name separately (as a clickable link when possible), so repeating it in "relationship_label" would show the name twice.
If nothing qualifies, respond {"facts": []}.`,
        messages: [{ role: "user", content: noteText }],
      }),
    })

    const data = await response.json()
    const textBlock = data.content?.find((b: any) => b.type === "text")

    let result: {
      facts: { category: string; text?: string; relationship_label?: string; person_name?: string | null }[]
    } = { facts: [] }
    try {
      result = { ...result, ...JSON.parse((textBlock?.text ?? "").trim()) }
    } catch {
      // if parsing fails, just report no facts rather than showing garbage
    }

    const facts = (result.facts ?? []).map((f) => {
      if (f.category !== "spouse") {
        return { category: f.category, text: f.text }
      }
      if (!f.person_name) {
        return { category: f.category, relationshipLabel: f.relationship_label }
      }
      const spouseId = idByName[f.person_name.toLowerCase()]
      return spouseId
        ? { category: f.category, relationshipLabel: f.relationship_label, personId: spouseId, personName: nameById[spouseId] }
        : { category: f.category, relationshipLabel: f.relationship_label, personName: f.person_name }
    })

    return new Response(JSON.stringify({ facts }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  } catch (error) {
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }
})
