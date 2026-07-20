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
    const { personId, refresh } = await req.json()

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: req.headers.get("Authorization")! } } }
    )

    const [{ data: person }, { data: notes }, { data: allPeople }] = await Promise.all([
      supabaseClient.from("people").select("name, last_name, key_facts").eq("id", personId).single(),
      supabaseClient.from("notes").select("id, content").eq("person_id", personId).order("created_at", { ascending: true }),
      supabaseClient.from("people").select("id, name, last_name, nicknames"),
    ])

    // Serve the cached facts unless the caller explicitly asks to regenerate (token-efficiency
    // rule in CLAUDE.md: never re-call the API for content that hasn't changed).
    const cachedFacts = person?.key_facts ?? null
    if (!refresh && cachedFacts !== null) {
      return new Response(JSON.stringify({ facts: cachedFacts, cached: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    const name = person?.name ?? "this person"
    const noteText = (notes ?? []).map((n) => n.content).join("\n")

    if (!noteText.trim()) {
      // No notes left — clear any stale cached facts so they don't reappear on a later visit.
      if (cachedFacts !== null && cachedFacts.length > 0) {
        await supabaseClient.from("people").update({ key_facts: [], key_facts_updated_at: new Date().toISOString() }).eq("id", personId)
      }
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
        max_tokens: 1500,
        // Unique per-personId (name baked in), so caching only helps across repeated
        // regenerations for the SAME person — still cheap to include since this call already
        // only runs on a cache miss (see the DB-cache check above).
        system: [{ type: "text", text: `You extract key relationship/background facts about a person named ${name} from notes recorded about them in a personal memory-keeping app called Boomer. The notes below are a mix of standalone facts and things mentioned while recording specific memories/events.

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
  {"category": "location" | "education" | "other", "text": "short factual bullet, under 15 words, third person"},
  {"category": "spouse", "relationship_label": "a short lead-in phrase describing the relationship as stated, e.g. \\"Married to\\", \\"Engaged to\\", \\"Partner of\\" — or, if no name is given at all, a complete standalone phrase like \\"Married.\\"", "person_names": ["exactly as given — 0 or 1 names"]},
  {"category": "siblings" | "parents" | "kids", "person_names": ["exactly as given, one per person"], "text": "a fallback bullet ONLY when NO names at all are given, e.g. \\"Has two kids.\\" — omit/null when person_names has anything in it"}
]}
Names must NEVER appear inside "relationship_label" or "text" — the app renders each name separately as a clickable link when possible, so repeating a name in those fields would show it twice.
If nothing qualifies, respond {"facts": []}.`, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: noteText }],
      }),
    })

    if (!response.ok) {
      const errorBody = await response.text()
      console.error("person-facts: Anthropic API error", response.status, errorBody)
      // Never blank out good facts because one regeneration failed — fall back to the cache.
      return new Response(JSON.stringify({ facts: cachedFacts ?? [], error: "extraction_failed" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    const data = await response.json()
    const textBlock = data.content?.find((b: any) => b.type === "text")

    let result: {
      facts: {
        category: string
        text?: string
        relationship_label?: string
        person_names?: string[]
      }[]
    } = { facts: [] }
    try {
      const rawText = textBlock?.text ?? ""
      const start = rawText.indexOf("{")
      const end = rawText.lastIndexOf("}")
      const jsonSlice = start !== -1 && end !== -1 ? rawText.slice(start, end + 1) : rawText
      result = { ...result, ...JSON.parse(jsonSlice) }
    } catch (parseError) {
      console.error("person-facts: failed to parse AI reply as JSON", String(parseError), "raw text was:", textBlock?.text)
      // A garbled reply must not wipe previously-good facts — fall back to the cache.
      return new Response(JSON.stringify({ facts: cachedFacts ?? [], error: "parse_failed" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    // The model sometimes emits the same linked category more than once (e.g. two siblings
    // recorded in two separate notes come back as two "siblings" facts) — merge each of
    // siblings/parents/kids into a single fact so the UI shows one row with all the buttons.
    const MERGE_CATEGORIES = new Set(["siblings", "parents", "kids"])
    const mergedByCategory: Record<string, { category: string; person_names: string[]; text?: string }> = {}
    const rawFacts: typeof result.facts = []
    for (const f of result.facts ?? []) {
      if (!MERGE_CATEGORIES.has(f.category)) {
        rawFacts.push(f)
        continue
      }
      const existing = mergedByCategory[f.category]
      if (!existing) {
        mergedByCategory[f.category] = { category: f.category, person_names: [...(f.person_names ?? [])], text: f.text }
        rawFacts.push(mergedByCategory[f.category])
      } else {
        for (const n of f.person_names ?? []) {
          if (!existing.person_names.some((e) => e.toLowerCase() === n.toLowerCase())) existing.person_names.push(n)
        }
        // Once any names exist, drop the nameless fallback text ("Has two kids.")
        if (existing.person_names.length > 0) existing.text = undefined
      }
    }

    const facts = rawFacts.map((f) => {
      if (!LINKED_CATEGORIES.has(f.category)) {
        return { category: f.category, text: f.text }
      }

      const names = (f.person_names ?? []).filter(Boolean)
      const people = names.map((n) => {
        // idByName already resolves nicknames/bare first names to a profile only when the
        // match is unambiguous (ambiguous keys were deleted above) — the same resolution
        // converse/update-group/update-moment trust to tag a note to a person, so a Key Fact
        // chip can trust it too rather than requiring the note to repeat the person's full name.
        const id = idByName[n.toLowerCase()]
        return id ? { name: nameById[id], personId: id } : { name: n }
      })

      if (f.category === "spouse") {
        // The model doesn't always fill in relationship_label even when told to — fall back to
        // "Married to" (the overwhelmingly common case) rather than ever rendering a bare name
        // with no lead-in text.
        const relationshipLabel = f.relationship_label?.trim() || (people.length ? "Married to" : "Married.")
        return { category: f.category, relationshipLabel, people }
      }

      return {
        category: f.category,
        relationshipLabel: DEFAULT_LABELS[f.category],
        people,
        text: people.length === 0 ? f.text : undefined,
      }
    })

    // Persist so future visits are served from the DB instead of re-calling the API.
    const { error: saveError } = await supabaseClient
      .from("people")
      .update({ key_facts: facts, key_facts_updated_at: new Date().toISOString() })
      .eq("id", personId)
    if (saveError) console.error("person-facts: failed to save key_facts cache", saveError.message)

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
