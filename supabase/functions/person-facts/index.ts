import { serve } from "https://deno.land/std@0.224.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

const LINKED_CATEGORIES = new Set(["spouse", "siblings", "parents", "kids"])
const DEFAULT_LABELS: Record<string, string> = {
  siblings: "Siblings:",
  parents: "Parents:",
  kids: "Children:",
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
      supabaseClient.from("notes").select("id, content").eq("person_id", personId).order("created_at", { ascending: true }),
      supabaseClient.from("people").select("id, name, last_name, nicknames"),
    ])

    const name = person?.name ?? "this person"
    const validNoteIds = new Set((notes ?? []).map((n) => n.id))
    // Tag each note with its own id so the model can tell us exactly which note(s) a fact came
    // from — same [X_ID: ...] tagging technique search.ts/update-group already use for moments.
    const noteText = (notes ?? []).map((n) => `[NOTE_ID: ${n.id}] ${n.content}`).join("\n")

    if (!noteText.trim()) {
      return new Response(JSON.stringify({ facts: [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    // Same ambiguous-key-safe lookup used by add-fact/converse/update-moment, so a named
    // relative's bare first name or nickname only resolves to a real profile link when unambiguous.
    const nameById: Record<string, string> = {}
    const idByName: Record<string, string> = {}
    const ambiguousKeys = new Set<string>()
    function claimKey(key: string, id: string) {
      if (!key) return
      if (idByName[key] && idByName[key] !== id) {
        ambiguousKeys.add(key)
      } else {
        idByName[key] = id
      }
    }
    for (const p of allPeople ?? []) {
      const fullName = p.last_name ? `${p.name} ${p.last_name}` : p.name
      nameById[p.id] = fullName
      idByName[fullName.toLowerCase()] = p.id
      claimKey(p.name.toLowerCase(), p.id)
      for (const nickname of (p.nicknames ?? "").split(",").map((n: string) => n.trim()).filter(Boolean)) {
        claimKey(nickname.toLowerCase(), p.id)
      }
    }
    for (const key of ambiguousKeys) delete idByName[key]

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
        system: `You extract key relationship/background facts about a person named ${name} from notes recorded about them in a personal memory-keeping app called Boomer. The notes below are a mix of standalone facts and things mentioned while recording specific memories/events, each prefixed with its own "[NOTE_ID: ...]" tag.

Only extract facts that are EXPLICITLY stated in the notes. Never infer, guess, or pad with generic filler. Focus specifically on these categories:
- "spouse": their spouse or partner
- "siblings": their brothers/sisters, by name if given
- "parents": their mother/father, by name if given
- "kids": their children, by name if given
- "location": where they currently live
- "education": a school or college they attended
- "other": at most 2 other clearly-stated close-relationship facts not covered above (e.g. grandparents, in-laws) — only if directly stated, not inferred

Do not use one-off event/gathering details (who attended a party, what was served, etc.) unless the text directly states a relationship fact. If a category isn't clearly stated anywhere in the notes, omit it entirely rather than guessing. If notes disagree (e.g. two different spellings/names given for the same relationship), prefer treating them as separate facts rather than silently merging or picking one — the app will let the user reconcile these.

Respond with ONLY a JSON object in this exact shape:
{"facts": [
  {"category": "location" | "education" | "other", "text": "short factual bullet, under 15 words, third person", "note_ids": ["..."]},
  {"category": "spouse", "relationship_label": "a short lead-in phrase describing the relationship as stated, e.g. \\"Married to\\", \\"Engaged to\\", \\"Partner of\\" — or, if no name is given at all, a complete standalone phrase like \\"Married.\\"", "person_names": ["exactly as given — 0 or 1 names"], "note_ids": ["..."]},
  {"category": "siblings" | "parents" | "kids", "person_names": ["exactly as given, one per person"], "text": "a fallback bullet ONLY when NO names at all are given, e.g. \\"Has two kids.\\" — omit/null when person_names has anything in it", "note_ids": ["..."]}
]}
"note_ids" must list the exact NOTE_ID value(s) (from the "[NOTE_ID: ...]" tags above) that this specific fact was drawn from — every note directly supporting it, and only those.
Names must NEVER appear inside "relationship_label" or "text" — the app renders each name separately as a clickable link when possible, so repeating a name in those fields would show it twice.
If nothing qualifies, respond {"facts": []}.`,
        messages: [{ role: "user", content: noteText }],
      }),
    })

    const data = await response.json()
    const textBlock = data.content?.find((b: any) => b.type === "text")

    let result: {
      facts: {
        category: string
        text?: string
        relationship_label?: string
        person_names?: string[]
        note_ids?: string[]
      }[]
    } = { facts: [] }
    try {
      result = { ...result, ...JSON.parse((textBlock?.text ?? "").trim()) }
    } catch {
      // if parsing fails, just report no facts rather than showing garbage
    }

    const facts = (result.facts ?? []).map((f) => {
      // Never trust the model's note_ids blindly — drop anything that isn't a real note on this
      // person, same "don't trust a required field" lesson as elsewhere in this app.
      const noteIds = (f.note_ids ?? []).filter((id) => validNoteIds.has(id))

      if (!LINKED_CATEGORIES.has(f.category)) {
        return { category: f.category, text: f.text, noteIds }
      }

      const names = (f.person_names ?? []).filter(Boolean)
      const people = names.map((n) => {
        const id = idByName[n.toLowerCase()]
        return id ? { name: nameById[id], personId: id } : { name: n }
      })

      if (f.category === "spouse") {
        // The model doesn't always fill in relationship_label even when told to — fall back to
        // "Married to" (the overwhelmingly common case) rather than ever rendering a bare name
        // with no lead-in text.
        const relationshipLabel = f.relationship_label?.trim() || (people.length ? "Married to" : "Married.")
        return { category: f.category, relationshipLabel, people, noteIds }
      }

      return {
        category: f.category,
        relationshipLabel: DEFAULT_LABELS[f.category],
        people,
        text: people.length === 0 ? f.text : undefined,
        noteIds,
      }
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
