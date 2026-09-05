# Standing instructions for this repo

The founder (see PROJECT_CONTEXT.md) is a non-technical, first-time builder and cannot review code diffs. Two standing permissions apply here, so they don't need to be asked for each time:

1. **Commit and push to `main` after finishing and verifying a change**, without asking for confirmation first. This repo auto-deploys to production on Vercel on every push to `main` — there is no staging step — so this means verified changes go live automatically. "Verified" means: build passes (`npm run build`) and, for anything with a visible UI effect, it's been clicked through in the browser preview.
2. **Keep `PROJECT_CONTEXT.md` up to date on your own** after making changes, without waiting to be asked. Update the relevant section(s) so it stays an accurate living doc — don't just leave it stale. **The docs are split for token efficiency (founder directive, 2026-07-19):** `PROJECT_CONTEXT.md` holds only the current state, kept terse (update facts in place, one line per fact — no build stories, no verification chronicles); `PROJECT_HISTORY.md` is the append-only archive for dated narratives (postmortems, incident stories), written only when a change has a story worth keeping, and never read top to bottom — search it by keyword when needed. Don't let long narratives creep back into PROJECT_CONTEXT.md.

   **Hard budget (founder directive, 2026-08-27):** `PROJECT_CONTEXT.md` stays **under 200KB** — its size is a recurring bill whenever it is read (see rule 4 — grep it, never read it whole) (200KB ≈ 50,000 tokens; the file was 524KB before the 2026-08-27 trim and is ~169KB after). Verify with `wc -c PROJECT_CONTEXT.md` before committing any doc change — the number must stay under 200000. **The budget is in BYTES on purpose:** a line count is not a real limit, because one dense bullet can carry what used to take twenty lines of indented tree. §3 Frontend map additionally stays at one line per file. If adding a fact would break the budget, something else gets cut or archived to `PROJECT_HISTORY.md` **in the same edit** — never leave it over. Apply the same test to every line: a present-tense fact, rule, constraint or open item stays; anything carrying a date, or narrating how something came to be, was verified, or was decided, is a story and moves to `PROJECT_HISTORY.md`; anything struck through or marked done gets deleted outright, because git has it.

Neither of these removes the general rule of checking in before *major/architectural* decisions (see PROJECT_CONTEXT.md Section 11) — that still applies. This is specifically about not needing a manual "yes, push it" / "yes, update the doc" for routine follow-through once work is actually done and verified.

3. **Token/billing efficiency is a standing, non-negotiable engineering rule** (founder directive, 2026-07-18). Every Edge Function that calls the Anthropic API must be built and maintained with cost in mind, per the official prompt-caching guidance (https://platform.claude.com/docs/en/build-with-claude/prompt-caching). Concretely, for this repo:
   - **Cache AI outputs in the database instead of regenerating them.** Anything expensive and re-viewable (Key Facts, group/event summaries, suggested prompts) should be generated once, saved to a column, and re-served from the DB — with a manual refresh control and/or invalidation when the underlying data actually changes. Never re-call the API on every page view for content that hasn't changed.
   - **Structure prompts for the API's prefix cache**: stable content first (fixed system prompt, deterministic tool list), volatile content last (the user's question, per-request data). Never interpolate timestamps, UUIDs, or per-request values into the system prompt — a single changed byte invalidates everything after it. Serialize any JSON fed into prompts deterministically (sorted keys, stable ordering).
   - **Add `cache_control: {type: "ephemeral"}` breakpoints** on large stable prompt prefixes in the Edge Functions (system prompt + roster context in `converse` is the prime candidate). Note the minimum cacheable prefix is ~1024–4096 tokens depending on model — short prompts silently won't cache, so don't add markers where there's nothing to gain.
   - **Verify with `usage.cache_read_input_tokens`** in the API response when touching this code — if it's zero on repeated calls, something is silently invalidating the cache.
   - Don't silently downgrade the model to save money — that's a founder decision, not an engineering one.

4. **Session token discipline is part of the same rule** (founder directive, 2026-09-04, after a
   session where a single subagent burned ~284,000 tokens — 44% of the session — to hand back a
   4,000-token report). Rule 3 governs what the *app* spends; this governs what a *session* spends.
   - **No Explore/Plan subagents when the target files are already known**, or when the change
     touches fewer than about three files. Read those files directly. A subagent re-derives the
     whole context from cold and routinely costs 50–100x the report it returns. This holds even
     when plan mode suggests spawning one.
   - **Read targeted line ranges**, not whole files, once a symbol's location is known — `grep -n`
     to find it, `sed -n 'A,Bp'` to read it. Never re-read a file already read in this session.
   - **`PROJECT_CONTEXT.md` and `PROJECT_HISTORY.md`: search by keyword, never read top to bottom.**
     `PROJECT_CONTEXT.md` costs ~42,000 tokens read whole, and nothing auto-loads it — the
     SessionStart hook only runs `npm install`.
   - **Measure before claiming a saving.** Session usage is in
     `~/.claude/projects/<project>/<session-id>.jsonl` (and `subagents/` beside it); weight cache
     reads 0.1x, cache writes 2x, output 5x. Connectors are deferred — their names cost ~20 tokens
     each and pruning them is not the win it looks like.
   - **One session per job — this is the biggest lever and it is free.** Measured 2026-09-04:
     a 746-step session spent **58% of its tokens re-reading its own conversation**, against 12%
     on builds/tests/deploys and under 2% on editing code. Every step re-reads everything before
     it, so cost grows with the square of session length, not with the work done. That session
     covered three unrelated jobs in one thread; by the third, every step was re-reading the first
     two. When the topic changes, start a new session — say so if the founder hasn't.
   - **Prefer fewer, larger steps.** Step count is the multiplier on the above. Batch independent
     tool calls into one message; don't poll, re-query logs, or re-check state that hasn't changed.
   - **Default to terse output.** Replies cost 5x what reading does (13% of that session). Write
     the full account when a decision or a postmortem needs it; otherwise report the result.
   - **The subagent rule above cuts both ways.** Wrong for known targets (one burned 44% of a
     session to return 4,000 tokens); right when the *scope itself* is the unknown — "which of
     these five functions share this bug" is a real fan-out, and four such agents came to 9% of
     the 2026-09-04 session while reading far more than would have fitted in it. Ask which case
     you are in before spawning, and never spawn to avoid reading three named files.
