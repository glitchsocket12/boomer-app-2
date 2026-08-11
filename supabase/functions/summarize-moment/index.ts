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

    // Fired together — independent of each other, no reason to pay for them one round-trip at a
    // time (same reasoning as converse/index.ts's roster reads).
    const [{ data: moment }, { data: selfPerson }, { data: subEventRows, error: subEventError }, { data: parentRow }] =
      await Promise.all([
        supabaseClient
          .from("moments")
          .select(
            "id, occasion, location, when_text, raw_description, details, notes(content, people(name, last_name))"
          )
          .eq("id", momentId)
          .order("created_at", { foreignTable: "notes" })
          .single(),
        // Who "I" must always be in the summary below — without this, the model has no way to tell
        // the account owner apart from anyone else named in the notes, and can end up narrating in a
        // DIFFERENT recorded person's voice whenever their note happens to be the most detailed one
        // (e.g. writing an event as if the user's spouse were the one saying "I").
        supabaseClient.from("people").select("name, last_name").eq("is_self", true).maybeSingle(),
        // The sub-events that make up this one, if any (founder ask 2026-08-10: a parent event's
        // description should be built from its own notes PLUS what happened at each of its parts —
        // otherwise a multi-day trip's page reads as empty while everything underneath it is full).
        // Their SUMMARIES only, never their notes: the summary already covers the notes, and
        // pulling both would multiply the token cost for the same content (CLAUDE.md rule 3).
        //
        // Deliberately its own query rather than folded into the .single() above — a select naming
        // parent_moment_id would 400 the WHOLE moment read if the column isn't migrated yet, which
        // would break summarizing every ordinary event. Failing open here costs only the roll-up.
        supabaseClient
          .from("moments")
          .select("occasion, event_date, summary, raw_description")
          .eq("parent_moment_id", momentId)
          .order("event_date", { ascending: true, nullsFirst: false })
          .order("created_at", { ascending: true }),
        // Same fail-open reasoning, read for the invalidation at the bottom of this function.
        supabaseClient.from("moments").select("parent_moment_id").eq("id", momentId).maybeSingle(),
      ])

    if (!moment) {
      return new Response(JSON.stringify({ error: "Moment not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    const fullName = (p: { name: string; last_name: string | null }) =>
      p.last_name ? `${p.name} ${p.last_name}` : p.name

    const selfName = selfPerson ? fullName(selfPerson) : null

    const notesText = (moment.notes ?? [])
      .map((n: any, i: number) => `${i + 1}. ${n.people ? `${fullName(n.people)}: ` : ""}${n.content}`)
      .join("\n")

    const detailsText =
      moment.details && typeof moment.details === "object" && Object.keys(moment.details).length > 0
        ? Object.entries(moment.details)
            .map(([k, v]) => `${k}: ${v}`)
            .join(", ")
        : "(none)"

    // A sub-event's own summary is the whole point of the roll-up, but a brand-new one may not have
    // been summarized yet — fall back to its raw description rather than dropping the day entirely.
    // Sub-events with neither are blank shells and contribute nothing but noise.
    const subEvents = (subEventError ? [] : subEventRows ?? [])
      .map((s: any) => ({
        title: (s.occasion || "").trim() || "(untitled)",
        date: s.event_date || "(date not set)",
        text: (s.summary || s.raw_description || "").trim(),
      }))
      .filter((s: { text: string }) => s.text)

    const subEventsText = subEvents
      .map((s, i) => `${i + 1}. ${s.title} · ${s.date}\n${s.text}`)
      .join("\n\n")

    const context = `Title: ${moment.occasion || "(untitled)"}
When: ${moment.when_text || "(not specified)"}
Where: ${moment.location || "(not specified)"}
Other details on file: ${detailsText}
The account owner — always the "I" in the summary, never anyone else named below, even if someone else's note is more detailed: ${selfName ?? "(not set up yet — use your best judgment from context, and never write as if you ARE a different specific named person)"}
What the user originally said about it: ${moment.raw_description}
Notes recorded about who was there / what they said: ${notesText || "(none)"}
Sub-events that make up this event, already summarized, in the order they happened: ${
      subEventsText ? `\n${subEventsText}` : "(none — this event has no sub-events)"
    }`

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
        // Raised again for the sub-event roll-up: a parent event's summary is an overview plus a
        // line per sub-event, and a 6-day event measured at stop_reason "max_tokens" against both
        // 600 and 900 — it silently lost its last four days mid-sentence. This is a ceiling, not a
        // target: output is billed on what's actually generated, so headroom here costs nothing.
        max_tokens: 2000,
        // One cached block, not a plain string: this prompt is byte-identical on every call and now
        // measures ~1,300 tokens — past the ~1,024 minimum a Sonnet prefix needs before caching does
        // anything (CLAUDE.md rule 3). Saving a note fires several summarize calls in a row, so the
        // second and later ones read this instead of paying for it. Nothing per-request may EVER be
        // interpolated into this string — one changed byte and the whole prefix misses.
        system: [
          {
            type: "text",
            cache_control: { type: "ephemeral" },
            text: "You write a warm, easy-to-read summary of a personal memory for a memory-keeping app called Boomer. You're given what the user originally typed or said about the event (which may be disjointed or repetitive, since it was captured across a back-and-forth conversation) plus any structured details and notes about who was there. The notes are listed in whatever order people happened to recall or record them — not necessarily the order things actually happened, since someone often adds a note about something earlier only after already describing something later. Read everything first, use any wording clues (e.g. \"before\", \"after\", \"first\", \"then\", \"later\", \"that morning/evening\", cause-and-effect) to work out your best guess at the true chronological order of events, and write the summary in that order rather than the order the notes are listed in. If there's no clue at all for how two things relate in time, use your best natural judgment rather than forcing a false sequence. Rewrite it all in the user's own first-person voice (\"I...\"), past tense, that reads naturally on its own — not a copy-paste of the raw input, not a bullet list, no meta-commentary about the memory app itself, no preamble, no quotation marks. The context tells you exactly which recorded person is the account owner — \"I\" is ALWAYS that person and no one else, even when a different named person's note is the longest or most detailed one in the whole moment. Narrate everyone else in the normal third person (\"Caroline told me...\", \"Mom said she...\") — never adopt another named person's own note as if you were them. CRITICAL — never invent, assume, or add a concrete detail (how something happened, where exactly, a result, a feeling, a cause) that isn't actually present in the input below — if the notes don't say it, it doesn't go in the summary, no matter how typical or plausible it would be for the situation. PRIORITIZE COMPLETENESS OVER BREVITY (for whatever WAS actually said): include every concrete detail given — activities, food, weather, gifts, quotes, reactions, specific people and what each of them did — not just a high-level gloss of the occasion. Do not compress away a specific detail for the sake of a shorter summary; a longer summary that keeps the specifics is strictly better than a shorter one that loses them. There's no fixed sentence count — write as many sentences as it takes to cover everything actually said, and no filler beyond that. Skip fields that are marked not specified/none. SUB-EVENTS — a DIFFERENT output format applies when, and only when, the context lists one or more sub-events (this event is then the umbrella over its parts, e.g. a multi-day trip made of individual days). In that case write: (1) one or two sentences of overview covering the whole event — what it was, roughly when, and its overall shape — drawn from this event's own title and notes plus the sub-events taken together; then (2) a blank line; then (3) exactly one line per sub-event, in the order they are listed, each formatted as `<short date, e.g. Aug 6> · <the sub-event's title, copied exactly> — <a single sentence of what happened there, ideally 15 to 30 words, since the point of this format is that the whole event can be scanned at a glance>`. Use the date given for that sub-event, shortened to month and day (write `Date not set` if it has none). One line per sub-event, no line breaks within a line, no bullet characters, no bold, no numbering, no heading. Don't repeat the overview's content down in the lines, and don't add a closing line after the last sub-event. In this format the completeness rule above governs COVERAGE, not length — every sub-event gets its own line, but each line stays one sentence, and picking which detail earns that sentence is the job. Everything else still applies: first person as the account owner throughout, and never a concrete detail the sub-event summaries and notes don't actually contain. When the context says this event has no sub-events, ignore this paragraph completely and write the ordinary flowing summary described above. Respond with ONLY the summary.",
          },
        ],
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

      // A parent event's summary is built from its sub-events' summaries (see above), so rewriting
      // this one just made its parent's cache stale. Clearing it here — rather than in EventDetail —
      // covers every path that can change a sub-event in one line: the event page, GroupDetail, and
      // converse's background kickoff from Home chat.
      //
      // Deliberately lazy: null it now, let it regenerate the next time someone actually opens the
      // parent, so a chat that touches one day of a trip doesn't pay for a summary nobody is looking
      // at (CLAUDE.md rule 3). No recursion risk — a parent has no parent of its own.
      const parentMomentId = (parentRow as { parent_moment_id: string | null } | null)?.parent_moment_id ?? null
      if (parentMomentId) {
        await supabaseClient.from("moments").update({ summary: null }).eq("id", parentMomentId)
      }
    }

    // stop_reason/usage ride along in the response so a truncated summary or a silently-broken
    // prompt cache can be diagnosed from the browser without a dashboard log dive (CLAUDE.md rule 3
    // asks for cache_read_input_tokens to be checked whenever this code is touched). The frontend
    // reads only `summary` and ignores the rest.
    return new Response(JSON.stringify({ summary, stop_reason: data.stop_reason, usage: data.usage }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  } catch (error) {
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }
})
