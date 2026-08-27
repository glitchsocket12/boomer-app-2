import { serve } from "https://deno.land/std@0.224.0/http/server.ts"
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2"
import { SIGNIFICANCE_KINDS, normalizeSignificance, type Significance } from "../_shared/significance.ts"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

// One API call per batch, several batches per invocation. Kept smaller than the input alone would
// justify because the whole batch's input is wasted if the response array is cut short — and the
// per-call system prompt is only ~700 tokens, so halving the batch size costs a few cents across
// the entire 1,300-event backfill.
const BATCH_SIZE = 50

// Caps how many batches ONE invocation runs, so a 1,300-event backlog can't run past the Edge
// Function's execution timeout. The same ceiling scan-calendar-sources uses, which is known-good
// against that timeout with concurrent calls. Whatever's left is picked up by the next invocation:
// the frontend calls this in a loop and shows the progress, which is what the founder asked for
// ("a button I press, with progress"). Scoring is resumable by construction — a scored row has a
// non-null significance and is never re-sent.
const MAX_BATCHES_PER_RUN = 8

// Stable, zero-interpolation instructions — identical every batch, every user, every run.
//
// Deliberately NOT given a cache_control breakpoint: at ~700 tokens this sits below the minimum
// cacheable prefix, so a marker would silently do nothing, and CLAUDE.md is explicit about not
// adding markers where there's nothing to gain. The call logs its usage numbers instead, so the
// assumption is measured rather than trusted. If this prompt ever grows past the minimum, add the
// breakpoint here.
const instructions = `You are sorting a person's own calendar entries so an app can show them the ones most likely to be worth remembering, FIRST.

You'll be given a JSON array of calendar entries, each with an index, a short title, and a date. For EACH one, decide what KIND of thing it is.

Answer with exactly one of these words:
- "trip" — travel, a vacation, a stay away from home.
- "celebration" — a wedding, a birthday, a party, an engagement, a shower, a holiday gathering.
- "milestone" — a graduation, a retirement, a funeral, a birth, a move, a first or last of something.
- "holiday" — a named public or religious holiday.
- "gathering" — a get-together with people named in the text: dinner with friends, a visit, a reunion, a weekend with family.
- "routine" — everything else: appointments, errands, work meetings, recurring commitments, reminders, chores, classes, deadlines, and travel booked as pure logistics rather than as the trip itself.

IMPORTANT — you are not filtering anything. Every entry stays in the person's list and they review all of them themselves; this only decides what gets shown first (founder directive, 2026-08-12: the app syncs every event and the person decides). So a wrong "routine" costs them nothing but a lost head start, while a wrong non-routine crowds out the entries that really did matter. When it is genuinely a toss-up, answer "routine" and let it take its turn in the full list.

Judge only what the title actually says. Do not infer importance from the date, and do not guess at a story the words don't support — "Lunch" is routine, "Lunch with Grandma" is a gathering.

Respond with ONLY a JSON array, one object per input entry in the same order, and nothing else — no preamble, no markdown fences:
[{"index": 0, "significance": "trip"}]`

type Row = { id: string; occasion: string | null; event_date: string | null }

/**
 * Returns the batch's verdicts AND whether the call actually worked.
 *
 * The two must never collapse into one value: a failed call returning an empty map is
 * byte-identical to "the model read these and had nothing to say", and that exact conflation is
 * what let a nine-day API-key expiry run behind a green "All synced" message (PROJECT_CONTEXT §10).
 */
async function callScoring(batch: Row[]): Promise<{ byId: Map<string, Significance>; failed: boolean }> {
  const payload = JSON.stringify(
    batch.map((r, i) => ({ index: i, title: r.occasion ?? "", date: r.event_date }))
  )

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
      system: [{ type: "text", text: instructions }],
      messages: [{ role: "user", content: payload }],
    }),
  })

  if (!response.ok) {
    console.error("Anthropic scoring call failed", response.status, await response.text())
    return { byId: new Map(), failed: true }
  }

  const data = await response.json()
  // CLAUDE.md rule 3 asks for this to be verified rather than assumed. Expected to read 0 here —
  // the prompt is below the cacheable minimum, so there is no prefix to serve from cache. If it
  // is ever non-zero, the prompt has grown and a cache_control breakpoint is now worth adding.
  console.log(
    "score-candidates usage",
    JSON.stringify({
      input: data.usage?.input_tokens ?? null,
      cache_read: data.usage?.cache_read_input_tokens ?? null,
      output: data.usage?.output_tokens ?? null,
      events: batch.length,
    })
  )

  const textBlock = data.content?.find((b: any) => b.type === "text")
  const byId = new Map<string, Significance>()
  try {
    const raw = textBlock?.text ?? "[]"
    const parsed = JSON.parse(raw.slice(raw.indexOf("["), raw.lastIndexOf("]") + 1))
    for (const item of parsed) {
      const row = batch[item?.index]
      // An index the model skipped or invented simply goes unscored, so it comes back around on
      // the next invocation rather than being silently mislabelled.
      if (row) byId.set(row.id, normalizeSignificance(item?.significance))
    }
  } catch (parseError) {
    console.error("Failed to parse scoring response", String(parseError))
    return { byId: new Map(), failed: true }
  }
  return { byId, failed: false }
}

async function countUnscored(supabase: SupabaseClient): Promise<number> {
  const { count } = await supabase
    .from("moment_import_candidates")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending")
    .is("significance", null)
  return count ?? 0
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } })

  try {
    // The caller's own JWT, so RLS scopes every read and every write in here to their rows. No user
    // id is ever taken from the request body — the standing rule for all of this project's
    // functions (SECURITY.md).
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: req.headers.get("Authorization")! } } }
    )

    const { data: rows, error: readError } = await supabase
      .from("moment_import_candidates")
      .select("id, occasion, event_date")
      .eq("status", "pending")
      .is("significance", null)
      // Newest first: the events someone actually remembers are the recent ones, so a founder who
      // stops the run partway through still got the most useful half. `id` breaks ties, because
      // paging an unstable sort is how rows get skipped.
      .order("event_date", { ascending: false, nullsFirst: false })
      .order("id")
      .limit(BATCH_SIZE * MAX_BATCHES_PER_RUN)

    if (readError) {
      // Almost certainly the column not existing yet, i.e. the migration hasn't been run.
      console.error("score-candidates read failed", readError.message)
      return json({ error: "not_ready", message: readError.message }, 400)
    }

    const pending = rows ?? []
    if (pending.length === 0) return json({ scored: 0, remaining: 0, failed: 0 })

    const batches: Row[][] = []
    for (let i = 0; i < pending.length; i += BATCH_SIZE) batches.push(pending.slice(i, i + BATCH_SIZE))

    const results = await Promise.all(batches.map((batch) => callScoring(batch)))
    const failed = results.filter((r) => r.failed).length

    // Grouped by verdict and written as one filtered statement per kind — at most six updates for
    // 400 rows, each an `.in()` of well under the 100-id chunk size this codebase already treats as
    // the safe ceiling for URL length.
    const idsByKind = new Map<Significance, string[]>()
    for (const result of results) {
      for (const [id, kind] of result.byId) {
        const list = idsByKind.get(kind)
        if (list) list.push(id)
        else idsByKind.set(kind, [id])
      }
    }

    let scored = 0
    for (const kind of SIGNIFICANCE_KINDS) {
      const ids = idsByKind.get(kind)
      if (!ids || ids.length === 0) continue
      for (let i = 0; i < ids.length; i += 100) {
        const chunk = ids.slice(i, i + 100)
        const { error } = await supabase
          .from("moment_import_candidates")
          .update({ significance: kind })
          // Re-asserting the status guards against scoring something the founder decided on in
          // another tab while this batch was in flight.
          .eq("status", "pending")
          .in("id", chunk)
        if (error) console.error("Failed to write significance", kind, error.message)
        else scored += chunk.length
      }
    }

    // Counted fresh AFTER the writes, so the progress the founder is watching is the real number
    // left rather than this invocation's arithmetic.
    const remaining = await countUnscored(supabase)
    return json({ scored, remaining, failed })
  } catch (error) {
    console.error("score-candidates failed", String(error))
    return json({ error: "failed" }, 500)
  }
})
