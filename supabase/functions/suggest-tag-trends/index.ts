// "Eleven of your events look like Concerts — want that as a tag?" (founder ask, 2026-08-23.)
//
// scan-event-tags applies tags that are already on the roster and parks everything else — a loose
// pile of proposed words in moments.suggested_tag_names, applied to nothing. This is the pass that
// reads that pile, folds synonyms together, and writes real proposals into tag_suggestions for
// ManageTags.tsx to ask about.
//
// COST (CLAUDE.md rule 3). ONE API call, regardless of how big the library is: the entire input is
// the distinct proposed names with their event counts — a few dozen short strings — plus the tag
// roster. The events themselves are never re-read; scan-event-tags already did that, once. There
// is deliberately NO cache_control here: the whole prompt is far under the ~1024-token minimum
// cacheable prefix, so a breakpoint would be a marker with nothing behind it, and the guidance
// says not to add one where there is nothing to gain. Results are STORED in tag_suggestions and
// read from there, so opening Manage Tags costs nothing.
//
// The judgement (which names mean the same thing) is the model's; everything else — which events a
// cluster covers, what counts as often enough, what happens to a name the model forgot — is in
// _shared/tagTrends.ts, pure and unit-tested.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts"
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2"
import { fetchAllRows } from "../_shared/pagedSelect.ts"
import { buildProposals, collectCandidates, type Cluster } from "../_shared/tagTrends.ts"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

// A tag that fits one or two events isn't a trend, it's clutter — and this is the whole reason a
// new name waits for this pass instead of being applied event by event. A name under the bar stays
// in the column untouched, so if two more events like it turn up later, the next run promotes it
// with no extra bookkeeping.
const MIN_EVENTS = 3

const instructions = `You are tidying up a list of proposed tag names for someone's personal events app. Each entry is a name that was proposed for some of their events, with the number of events that proposed it.

Your job is to group entries that mean the SAME KIND OF EVENT into one cluster and pick the best single wording for it. This is what turns "Concert" (5 events), "live music" (3) and "show" (2) into one useful tag instead of three thin ones.

Rules:
- Only group names that genuinely describe the same kind of event. "Weddings" and "Engagement Parties" are related but NOT the same kind — leave them separate.
- Prefer the clearest, most general wording, in the plural, as you would want it on a filter menu: "Concerts", not "Concert" or "live music".
- Every "members" entry must be copied EXACTLY from the input names. Do not invent a member.
- A name that belongs with nothing else can be its own cluster of one, or you can leave it out entirely — either is fine, it is handled.
- If a cluster is really just the person's EXISTING tag under different words, set "existing_tag" to that tag's name copied exactly from the roster, and they'll be asked to apply the tag they already have instead of making a new one. Otherwise omit "existing_tag" or set it to null.

Respond with ONLY a JSON array and nothing else — no preamble, no markdown fences:
[{"name": "Concerts", "members": ["Concert", "live music", "show"], "existing_tag": null}]`

type Usage = Record<string, unknown> | null

async function callClustering(
  namesWithCounts: { name: string; events: number }[],
  rosterNames: string[]
): Promise<{ clusters: Cluster[]; failed: boolean; usage: Usage }> {
  const input = {
    proposed_names: namesWithCounts,
    existing_tags: rosterNames,
  }

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": Deno.env.get("ANTHROPIC_API_KEY") ?? "",
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-5",
      max_tokens: 4000,
      output_config: { effort: "low" },
      system: instructions,
      messages: [{ role: "user", content: JSON.stringify(input) }],
    }),
  })

  if (!response.ok) {
    console.error("Anthropic clustering call failed", response.status, await response.text())
    return { clusters: [], failed: true, usage: null }
  }

  const data = await response.json()
  const usage = (data.usage ?? null) as Usage
  console.log("suggest-tag-trends usage", JSON.stringify(usage))

  const textBlock = data.content?.find((b: { type: string }) => b.type === "text")
  if (!textBlock && data.stop_reason === "max_tokens") {
    console.error("suggest-tag-trends hit max_tokens with no text block")
    return { clusters: [], failed: true, usage }
  }
  try {
    const raw = textBlock?.text ?? "[]"
    const start = raw.indexOf("[")
    const end = raw.lastIndexOf("]")
    return { clusters: JSON.parse(raw.slice(start, end + 1)), failed: false, usage }
  } catch (parseError) {
    console.error("Failed to parse clustering response", String(parseError))
    return { clusters: [], failed: true, usage }
  }
}

type TrendResult = {
  candidateNames: number
  proposals: number
  failed: boolean
  usage: Usage
}

async function findTrends(supabase: SupabaseClient, userId: string): Promise<TrendResult> {
  const [momentsRes, tagsRes, existingRes] = await Promise.all([
    // Paged and account-wide: this is every event that has ever been scanned, which is exactly the
    // shape PostgREST silently truncates at 1000 rows.
    fetchAllRows<{ id: string; suggested_tag_names: unknown }>((from, to) =>
      supabase
        .from("moments")
        .select("id, suggested_tag_names")
        .eq("user_id", userId)
        .order("id")
        .range(from, to)
    ),
    supabase.from("tags").select("name").eq("user_id", userId).order("id"),
    supabase.from("tag_suggestions").select("id, name, status").eq("user_id", userId),
  ])

  if (momentsRes.error) {
    console.error("Failed to read suggested tag names", momentsRes.error.message)
    return { candidateNames: 0, proposals: 0, failed: true, usage: null }
  }

  const rosterNames = ((tagsRes.data ?? []) as { name: string }[]).map((t) => t.name).sort((a, b) => a.localeCompare(b))
  const rosterKeys = new Set(rosterNames.map((n) => n.toLowerCase()))

  // A name that has since BECOME a real tag (the founder accepted it, or added it by hand) is no
  // longer a candidate for anything — drop it before it can be proposed a second time.
  const candidates = collectCandidates(momentsRes.data).filter((c) => !rosterKeys.has(c.name.toLowerCase()))
  if (candidates.length === 0) return { candidateNames: 0, proposals: 0, failed: false, usage: null }

  const { clusters, failed, usage } = await callClustering(
    candidates.map((c) => ({ name: c.name, events: c.momentIds.length })),
    rosterNames
  )
  // A failed call must not look like "no trends found" — that's the §12 silent-failure shape. Fall
  // through to the ungrouped proposals (still useful, just not synonym-folded) and say it failed.
  const proposals = buildProposals(candidates, clusters, MIN_EVENTS)

  // Split against what's already on file rather than upserting. The unique index is on
  // `lower(name)`, and PostgREST's on_conflict only names plain COLUMNS — an expression index
  // can't be targeted that way — so the read we already did above does the job instead.
  const existingByKey = new Map<string, { id: string; status: string }>()
  for (const r of (existingRes.data ?? []) as { id: string; name: string; status: string }[]) {
    existingByKey.set(r.name.toLowerCase(), { id: r.id, status: r.status })
  }

  const tagIdByName = new Map<string, string>()
  if (proposals.some((p) => p.existingTagName)) {
    const { data } = await supabase.from("tags").select("id, name").eq("user_id", userId)
    for (const t of (data ?? []) as { id: string; name: string }[]) tagIdByName.set(t.name.toLowerCase(), t.id)
  }

  const inserts: Record<string, unknown>[] = []
  const updates: { id: string; moment_ids: string[]; existing_tag_id: string | null }[] = []

  for (const p of proposals) {
    const existingTagId = p.existingTagName ? (tagIdByName.get(p.existingTagName.toLowerCase()) ?? null) : null
    const prior = existingByKey.get(p.name.toLowerCase())
    // A "No thanks" stays said, and an accepted one is already a real tag — re-offering either is
    // the fastest way to make a suggestion surface worth ignoring.
    if (prior?.status === "rejected" || prior?.status === "accepted") continue
    if (prior) {
      // Still pending: refresh its event list, since more events may have been scanned since.
      updates.push({ id: prior.id, moment_ids: p.momentIds, existing_tag_id: existingTagId })
      continue
    }
    inserts.push({
      user_id: userId,
      name: p.name,
      existing_tag_id: existingTagId,
      moment_ids: p.momentIds,
      status: "pending",
    })
  }

  if (inserts.length > 0) {
    const { error } = await supabase.from("tag_suggestions").insert(inserts)
    if (error) {
      console.error("Failed to save tag suggestions", error.message)
      return { candidateNames: candidates.length, proposals: 0, failed: true, usage }
    }
  }
  await Promise.all(
    updates.map((u) =>
      supabase
        .from("tag_suggestions")
        .update({ moment_ids: u.moment_ids, existing_tag_id: u.existing_tag_id })
        .eq("id", u.id)
    )
  )

  return { candidateNames: candidates.length, proposals: inserts.length + updates.length, failed, usage }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  try {
    const supabaseClient = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_ANON_KEY") ?? "", {
      global: { headers: { Authorization: req.headers.get("Authorization")! } },
    })
    const {
      data: { user },
    } = await supabaseClient.auth.getUser()
    if (!user) {
      return new Response(JSON.stringify({ error: "not_authenticated" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    const result = await findTrends(supabaseClient, user.id)
    return new Response(JSON.stringify(result), { headers: { ...corsHeaders, "Content-Type": "application/json" } })
  } catch (error) {
    console.error("suggest-tag-trends error", String(error))
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }
})
