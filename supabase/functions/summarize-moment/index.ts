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

    // Tagging someone as an attendee writes a note whose whole content is this string (see
    // ATTENDEE_PLACEHOLDER in src/lib/moments.ts — duplicated here because an Edge Function can't
    // import from src/; keep the two in sync). Those rows carry no information beyond a name, and
    // feeding them in is what produced the roll-call summaries the founder asked us to kill on
    // 2026-08-17: one wedding had 26 notes, 23 of them this placeholder, and four fifths of its
    // summary was the model dutifully reading those names back. Every one of them is already on the
    // page under "Who was there".
    //
    // Dropping them also cuts ~11% of the input tokens on every call, measured across all 107
    // summarized events (CLAUDE.md rule 3). Numbering is applied AFTER the filter so the list the
    // model sees stays contiguous.
    const ATTENDEE_PLACEHOLDER = "Was there."
    const notesText = (moment.notes ?? [])
      .filter((n: any) => (n.content ?? "").trim() !== ATTENDEE_PLACEHOLDER)
      .map((n: any, i: number) => `${i + 1}. ${n.people ? `${fullName(n.people)}: ` : ""}${n.content}`)
      .join("\n")

    // Nothing to summarize: no description of the user's own, no note carrying real content, and
    // no sub-event with anything in it. Mirrors hasSomethingToSummarize() in src/lib/moments.ts —
    // EventDetail gates on that before calling, but converse's background kickoff and any direct
    // invocation don't, and without this the model dutifully writes a summary out of nothing.
    // Clearing rather than leaving the old one stands: the previous summary for these events was
    // the attendee roll-call we just removed the source of, so keeping it would undo the change.
    const hasRealNote = (moment.notes ?? []).some((n: any) => {
      const c = (n.content ?? "").trim()
      return !!c && c !== ATTENDEE_PLACEHOLDER
    })

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

    // See the hasRealNote comment above. Bail before spending a call (CLAUDE.md rule 3).
    if (!moment.raw_description?.trim() && !hasRealNote && subEvents.length === 0) {
      await supabaseClient.from("moments").update({ summary: null }).eq("id", momentId)
      return new Response(JSON.stringify({ summary: null, skipped: "nothing_to_summarize" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
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
        // Was 250 (tuned for the old fixed "2-4 sentences" cap) — raised now that the prompt
        // explicitly prioritizes completeness, so a detailed event isn't truncated mid-summary.
        // Raised again for the sub-event roll-up: a parent event's summary is an overview plus a
        // line per sub-event, and a 6-day event measured at stop_reason "max_tokens" against both
        // 600 and 900 — it silently lost its last four days mid-sentence. This is a ceiling, not a
        // target: output is billed on what's actually generated, so headroom here costs nothing.
        max_tokens: 2000,
        // One cached block, not a plain string: this prompt is byte-identical on every call and
        // measures ~2,390 tokens (7,754 chars) — past the 1,024 minimum a Sonnet 5 prefix needs
        // before caching does anything (CLAUDE.md rule 3). Saving a note fires several summarize
        // calls in a row, so the second and later ones read this instead of paying for it. Nothing
        // per-request may EVER be interpolated into this string — one changed byte and the whole
        // prefix misses. Editing the text (as on 2026-08-17) invalidates the prefix exactly once,
        // then it re-warms on the next call.
        system: [
          {
            type: "text",
            cache_control: { type: "ephemeral" },
            text: "You write a factual, easy-to-scan summary of a personal memory for a memory-keeping app called Boomer. You're given what the user originally typed or said about the event (which may be disjointed or repetitive, since it was captured across a back-and-forth conversation) plus any structured details and notes about what happened. The notes are listed in whatever order people happened to recall or record them — not necessarily the order things actually happened, since someone often adds a note about something earlier only after already describing something later. Read everything first, use any wording clues (e.g. \"before\", \"after\", \"first\", \"then\", \"later\", \"that morning/evening\", cause-and-effect) to work out your best guess at the true chronological order of events, and write the bullets in that order rather than the order the notes are listed in. If there's no clue at all for how two things relate in time, use your best natural judgment rather than forcing a false sequence. FORMAT — the summary is a flat list of bullets and nothing else. Every line starts with `- `. One concrete fact per bullet, each written as a complete sentence in past tense. No heading, no opening or closing paragraph, no lead-in sentence, no bold, no numbering, no indented or nested bullets, no blank lines between bullets, no preamble, no quotation marks around the whole thing, and no meta-commentary about the memory app itself. Rewrite the input in the user's own first-person voice (\"I...\") wherever the account owner is the one acting, \"we\" for something the group plainly did together, and the normal third person for anyone else (\"Caroline told me...\", \"Mom said she...\"). The context tells you exactly which recorded person is the account owner — \"I\" is ALWAYS that person and no one else, even when a different named person's note is the longest or most detailed one in the whole moment; never adopt another named person's own note as if you were them. NEVER MOVE AN ACTION ONTO THE ACCOUNT OWNER: if a note attributed to someone else says that person did something, then that person did it, and rewriting it as \"I\" invents a fact that isn't in the input. Only write \"I\" where the input actually places the account owner in that action. The converse holds just as strictly: a note attributed TO the account owner is always written as \"I\", never in the third person by their own name. DON'T RESTATE THE HEADER — the page already shows this event's title, date and location immediately above your summary, so never spend a bullet repeating what the event was, when it happened, or where it was; start straight in on what happened. Never write a bullet whose content is the event's date, or that the event happened or took place at all. Mention a date or a place only when it is a fact in its own right, e.g. something happened on a particular day of a multi-day event, or the group moved on to a second venue. DON'T LIST WHO WAS THERE — the page has its own \"Who was there\" section showing every person attached to this event, so a bullet that only names attendees is duplicated text. Name a person only when a fact is genuinely about them: something they did or said, something that happened to them, a detail attributed to them, or a memory recorded specifically about them. Never write a bullet whose only content is who came or who was present. CRITICAL — never invent, assume, or add a concrete detail (how something happened, where exactly, a result, a feeling, a cause) that isn't actually present in the input below — if the notes don't say it, it doesn't go in the summary, no matter how typical or plausible it would be for the situation. PRIORITIZE COVERAGE OVER BREVITY (for whatever WAS actually said): give every concrete detail its own bullet — activities, food, weather, gifts, quotes, reactions, what specific people did — not just a high-level gloss of the occasion. Do not drop a specific detail to keep the list short, and do not pack two unrelated facts into one bullet. There's no fixed bullet count — write as many as it takes to cover everything actually said, and no filler beyond that. MERGE DUPLICATE NOTES: several notes very often describe the same shared occasion from different people's points of view — the same drive, the same dinner, the same seats, recorded once per person who was tagged. Treat those as ONE fact, not several. Write a single bullet saying what happened, and don't attribute a shared activity to whoever happened to record it. A bullet that restates the previous bullet with a different name attached is exactly the failure this rule exists to prevent. Skip fields that are marked not specified/none. WHEN THERE IS ALMOST NOTHING TO GO ON: if the input holds fewer than about three real facts about the event itself, write the bullets you can and then add one final line that is NOT a bullet. Only ever add that line BELOW at least one real bullet — it says \"nothing else\", so it makes no sense as the entire summary, and a summary that would consist of nothing but that line should instead be the single best bullet you can write from whatever the input does contain, stating plainly what wasn't recorded — for example `Nothing else about the day itself was recorded.` Add that line only when the summary really is that thin; never add it to a summary that already covers the event properly. WRITE THE FACT, NOT THE TELLING OF IT: drop reporting verbs — \"she said that\", \"he told me\", \"she mentioned\", \"I learned that\", \"she explained\" — and state the fact itself, unless the act of saying it IS the memory (an announcement, a confession, an argument). EXAMPLES of bullets to get right, drawn from real events in this app. Wrong, because the page's own title already says it: `- I had a phone call with Eliana Joy today.` Wrong, because the date is already printed directly above the summary: `- The concert fell on Caroline's birthday, May 23.` Wrong, because the location is already printed directly above: `- We had great seats for the Fisher concert at Red Rocks.` Right: `- We had great seats.` Wrong, because it narrates who reported the fact instead of stating it: `- She told me she starts a Quaker service year in Boston on August 30.` Right: `- She starts a Quaker service year in Boston on August 30.` Wrong, because the second bullet is the first one again with different names on it: `- We had Tokyo Joes for dinner in the parking lot.` followed by `- Alexey and Masha got their Tokyo Joes to-go.` Right, as a single bullet: `- Dinner was Tokyo Joe's to-go in the parking lot, with beers and music.` SUB-EVENTS — a DIFFERENT output format applies when, and only when, the context lists one or more sub-events (this event is then the umbrella over its parts, e.g. a multi-day trip made of individual days). In that case write: (1) one or two sentences of overview covering the whole event — what it was, roughly when, and its overall shape — drawn from this event's own title and notes plus the sub-events taken together; then (2) a blank line; then (3) exactly one line per sub-event, in the order they are listed, each formatted as `<short date, e.g. Aug 6> · <the sub-event's title, copied exactly> — <a single sentence of what happened there, ideally 15 to 30 words, since the point of this format is that the whole event can be scanned at a glance>`. Use the date given for that sub-event, shortened to month and day (write `Date not set` if it has none). One line per sub-event, no line breaks within a line, no bullet characters, no bold, no numbering, no heading. Don't repeat the overview's content down in the lines, and don't add a closing line after the last sub-event. In this format the completeness rule above governs COVERAGE, not length — every sub-event gets its own line, but each line stays one sentence, and picking which detail earns that sentence is the job. Everything else still applies: first person as the account owner throughout, and never a concrete detail the sub-event summaries and notes don't actually contain. When the context says this event has no sub-events, ignore this paragraph completely and write the ordinary bullet list described above. Respond with ONLY the summary.",
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
