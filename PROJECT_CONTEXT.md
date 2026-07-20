# PROJECT_CONTEXT.md — Boomer

_Current state of the app, kept deliberately lean. Full narrative history (build stories, bug postmortems, deploy chronicles) lives in `PROJECT_HISTORY.md` — search that by keyword when you need the story behind something; never read it top to bottom. Keep THIS file terse: update facts in place, one line per fact, no narratives. If something is uncertain, mark it "unknown" rather than guessing._

## 1. What Boomer is

A mobile-friendly web app for backing up and staying close to your social memories — an effortless, conversational memory aid for the *texture* of relationships (who was at an event, what's going on with someone's grandkids), so the next time you see someone you're not starting cold. Repositioned 2026-07-19: no longer age-gated to "baby boomers"; still skews toward an established-relationship audience. Think "isolated social network": private archive + relationship-maintenance tool, no browsing other people's profiles. Target user is an extrovert who wants to show up better for people they already value. The founder is non-technical, building hands-on; the product's value is the quality/warmth of what it gives back, not what it stores.

## 2. Stack & Infrastructure

- **Frontend:** React via Vite, TypeScript (accidental — StackBlitz default; keep types light, not strict).
- **Backend:** Supabase (Postgres + auth + Deno Edge Functions). All AI calls happen in Edge Functions only — API keys never reach the browser.
- **AI:** Anthropic Claude API, model `claude-sonnet-5` in all functions (an invalid model string fails silently — see guard §12).
- **Speech-to-text:** OpenAI Whisper (`whisper-1`) via the `transcribe` function; needs `OPENAI_API_KEY` in Supabase secrets (project-wide list under Edge Functions → Secrets). Chosen over the free Web Speech API because that doesn't work in iPhone Safari, and the founder's end goal is an iPhone app.
- **Hosting:** Vercel, live at `https://boomer-app-2-eight.vercel.app/`, auto-deploys on every push to `main` (repo: `github.com/glitchsocket12/boomer-app-2`). `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` set in Vercel project settings; Vite bakes them in at build time. Vercel CLI (`npx vercel`) installed as a fallback deploy path.
- **Dev:** local folder, this repo. `npm run dev` (port 5173; respects `PORT` for the browser-preview tool), `npm run build`, `npm run test` (Vitest — only covers `src/lib/` pure helpers; zero Edge Function coverage).
- **Deploying Edge Functions:** `npx supabase functions deploy <name>` with a founder-provided Personal Access Token, or paste the file into the Supabase dashboard and click Deploy. `supabase/functions/_shared/` is bundled automatically.
- **Schema changes:** SQL handed to the founder to run in the SQL Editor (saved under `supabase/migrations_manual/`), or applied directly via the Management API (`POST /v1/projects/{ref}/database/query` with the same access token).
- **Token-free live verification (no login needed):** a column exists if PostgREST returns 200 (400 if not, via anon key); a function is deployed if its URL returns its own error/401 rather than Supabase's `NOT_FOUND`.

## 3. Frontend map

```
src/
├── main.tsx / index.css       — entry, global styles (incl. `spin` keyframe)
├── lib/
│   ├── supabase.ts            — shared client (reads VITE_* env)
│   ├── dates.ts               — eventSortDate/formatMonthYear (tested)
│   ├── summarize.ts           — short title helper (tested)
│   └── people.ts              — sortByLastName
├── pages/
│   ├── Login.tsx              — combined sign up / log in
│   ├── Home.tsx               — MAIN SCREEN: persistent chat thread → `converse`.
│   │                            Also: 4 count tiles, Dunbar card, "Recall assists
│   │                            this month" card, top-3 leaderboard + "due for an
│   │                            update" CTA, cached suggestion cards w/ refresh.
│   ├── People.tsx             — list + add person, search, sort dropdown, count
│   ├── PersonDetail.tsx       — Key Facts (cached, clickable chips, fixed order),
│   │                            missing-info nudges, notes (edit/delete/source
│   │                            labels), fact bar → `add-fact` (the ONLY edit path
│   │                            for name/nickname/birthday/anniversary — no form
│   │                            fields), relationship-suggestion banners, last-name
│   │                            nudge, delete/merge profile
│   ├── Groups.tsx             — group tiles (summary, ≤5 member chips, event chips)
│   ├── GroupDetail.tsx        — summary + refresh, members (explicit only, sorted,
│   │                            collapsible >12, hover-remove), suggestions (from
│   │                            events + associated groups, capped 20, add/deny
│   │                            all), Associated Groups (confirmed + suggested +
│   │                            manual picker), notes section, edit chat
│   ├── Events.tsx             — all moments, sorted by event_date (fallback
│   │                            created_at), "Month Year" format
│   ├── EventDetail.tsx        — AI summary, who-was-there (hover-untag,
│   │                            non-destructive), attendee suggestions from group
│   │                            rosters, collapsed notes, maps link (+", CO"
│   │                            hardcoded), rename, delete/merge, update chat
│   ├── DunbarDetail.tsx       — Dunbar's-number explainer + tier progress bars
│   └── DueForUpdate.tsx       — people sorted oldest/no note first
├── components/
│   ├── ErrorBoundary.tsx      — per-tab crash containment (raw message — not
│   │                            end-user friendly yet)
│   ├── UpdateMomentChat.tsx   — event "add detail" chat → `update-moment`
│   ├── UpdateGroupChat.tsx    — group edit chat → `update-group`
│   ├── VoiceInputButton.tsx   — mic → `transcribe`; renders null w/o MediaRecorder
│   ├── AutoGrowTextarea.tsx   — grows to 160px then scrolls; Enter sends
│   ├── PhotoGallery.tsx       — DISPLAY-ONLY placeholder tiles (no real photos)
│   ├── RefreshButton.tsx      — spinning refresh icon
│   ├── SearchBox.tsx          — client-side list filter
│   ├── Chips.tsx              — PersonChip (green) / GroupChip (gold) / EventChip
│   │                            (blue) — shared visual language everywhere
│   ├── EditButton.tsx         — pencil rename control (Event/Group headings)
│   ├── Breadcrumb.tsx         — trail for App.tsx's navStack
│   └── RelationshipSuggestions.tsx — shared suggestion-banner UI (all 4 surfaces)
```

`App.tsx` is the traffic controller: auth state, tab nav (Home/People/Events/Groups), a generic `navStack: Crumb[]` breadcrumb stack any page can push person/group/event crumbs onto, persisted to sessionStorage (`boomer-nav`) so refresh stays put. Voice input + AutoGrowTextarea are on every conversational text box (Home, event chat, group chat, fact bar).

## 4. Edge Functions (`supabase/functions/`)

| Function | Purpose |
|---|---|
| `converse` | **The main unified brain** (Home). Per turn decides: answer question / capture new moment(s — `moments` array, multiple per turn supported) / update moment / rename placeholder / name+nickname corrections / create+tag groups / relationship signals / logs recall attempts to `search_log`. Quirk: model occasionally replies in prose instead of the JSON envelope — falls back to showing that prose as the reply. |
| `add-fact` | Classifies fact-bar text: name/nickname update, birthday/anniversary (upserts `reminders`), or plain note. Group inference (`group_signal`, high=auto/medium=ask). Relationship handling via `_shared/relationships.ts`. |
| `update-moment` | Event chat. Saves per turn (not on "done"), has full people+events rosters, `moment_field_updates` (when/where/title), `add_groups`, relationship signals. |
| `update-group` | Group chat: rename, members, tag/untag events, member facts (tagged `source_group_id`), relationship signals. Saves per turn. |
| `person-facts` | Extracts Key Facts from a person's notes — explicitly stated only, never inferred. Cached in `people.key_facts`; `{refresh: true}` regenerates. Failure paths return cached facts, never wipe. Linked categories (spouse/siblings/parents/kids) resolve to person chips only on exact-full-name match. Has its OWN category vocabulary (not the shared 5-kind enum — known mismatch, read-only so harmless). |
| `summarize-group` | One-sentence group description → cached `groups.summary`. Members = explicit roster only, never event attendees. |
| `summarize-moment` | 2-4 sentence first-person event summary → cached `moments.summary`. Cleared/regenerated when notes change. |
| `suggest-prompts` | 3 suggestion cards for Home → cached in `home_suggestions` table; regenerates only when data is newer than cache or on manual refresh. |
| `transcribe` | Whisper speech-to-text. |

**Shared module** `_shared/relationships.ts`: the 5 relationship kinds (spouse/sibling/parent/child/partner), reciprocal notes written on BOTH sides (`INVERSE_RELATIONSHIP` map, per-side dedupe), confident-match = name-as-typed exactly equals full name on file (else a suggest-don't-assert banner), shared-parent inference suggestions, last-name inference for people created from relationship mentions (`inferLastNameFromSignals`, also called by the direct `new_people`/`add_people` creation paths). Used by `converse`/`add-fact`/`update-moment`/`update-group` so relationship behavior is identical at all four entry points. `chat` and `search` functions were deleted 2026-07-19 (superseded by `converse`).

## 5. AI cost & caching architecture (see CLAUDE.md rule 3 — non-negotiable)

- **DB-cached outputs** (generate once, serve from a column, refresh on data change or manual button): `people.key_facts`, `groups.summary`, `moments.summary`, `home_suggestions`. Never re-call the API for unchanged content.
- **Prompt caching:** `converse`/`update-moment`/`update-group` split the system prompt into a fully-static `stableInstructions` block (first, own `cache_control: {type: "ephemeral"}` breakpoint, zero interpolated data) and a volatile `dynamicContext` block (date/rosters, last, own breakpoint). `add-fact`/`person-facts` also cache-marked. `summarize-group`/`summarize-moment` deliberately have NO markers (under the ~1024-token minimum — nothing to gain).
- **Every roster/moment query in these functions has an explicit `.order()`** — Postgres row order is otherwise nondeterministic and silently busts the cache-prefix match. Removing one kills caching with no error.
- Verify with `usage.cache_read_input_tokens` in responses when touching this code (confirmed nonzero live 2026-07-19).
- Known flagged inefficiency (accepted for now): `add-fact`'s shared-parent helper can make up to ~12 small sequential API calls when many siblings/parents are named at once.

## 6. Database (Supabase / Postgres, RLS on everything, scoped to auth.uid())

```
people        id, user_id, name (first), last_name?, nicknames? (comma-separated
              "goes by" list, additive), key_facts jsonb?, key_facts_updated_at?,
              created_at
moments       id, user_id, raw_description (user's words only — never assistant
              turns), summary? (AI cache), occasion?, location?, when_text?
              (free-text, kept verbatim), event_date? (AI best-guess real date,
              sorting/display only, NOT ground truth; null = fall back to
              created_at), details jsonb? (open-ended tags by design),
              dismissed_person_ids jsonb [], created_at
notes         id, person_id? , moment_id?, group_id? (CHECK: person_id OR group_id),
              source? ("home" = written by converse), source_group_id? (fact
              captured via a group chat), content, created_at
              — attendance on an event IS the existence of a note with that
              moment_id; untagging nulls moment_id, never deletes.
              ⚠ two FKs to groups: embeds must be qualified
              (groups!notes_source_group_id_fkey) or PostgREST errors (PGRST201).
reminders     id, person_id, label ("Birthday"/"Anniversary"), month, day
              — no year, no automatic sending exists.
groups        id, user_id, name, summary? (AI cache), dismissed_person_ids jsonb [],
              dismissed_group_ids jsonb [], created_at
person_groups person_id + group_id (PK) — THE definition of membership (explicit
              only; event attendees are never members, only suggestions)
group_associations id, group_id_a, group_id_b (symmetric, normalized a<b by UUID
              string sort), created_at
moment_groups moment_id + group_id (PK)
search_log    id, user_id, query_text, matched bool, created_at — one row per
              genuine recall attempt in Home; powers "Recall assists this month"
home_suggestions user_id (PK), suggestions jsonb, updated_at — suggest-prompts cache
```

`dismissed_*` columns only filter suggestion lists; conversational writes never consult them, so a denied person can still be added by name in chat.

## 7. What's built (all live unless noted in §10)

- **Auth:** sign up / log in. Email confirmation DISABLED for testing — must re-enable before real users.
- **Home:** continuous chat (answer/capture/update/correct/group-tag per turn, multiple events per message, never dead-ends — suggests close matches or asks); clickable person/event/group chips on replies with canonical spellings; cached suggestion cards (tap = starts a real conversation); dashboard (People/Events/Groups/Notes counts, Dunbar card → DunbarDetail, Recall-assists card, monthly leaderboard → DueForUpdate). Known gap: the chat thread lives in component state — switching tabs loses it.
- **People:** add (first+last), search (incl. nicknames), 5 sort options, count in heading.
- **Person profile:** Key Facts (cached, ordered Parents→Spouse→Siblings→Children, exact-match chips), missing-category nudges, notes with hover edit/delete + source labels ("Added through: {event}" / "From: {Group}" / "From Home"), fact bar (AI-classified, the only field-edit path), relationship + new-person + shared-parent + last-name suggestion banners, delete/merge profile (the SEARCHED-FOR record survives; merged-away names fold into nicknames).
- **Groups:** created conversationally only (recurring affiliations — school/team/unit/workplace/circle — never one-off events); tiles with summary + capped chips; detail page per §3; membership = explicit only; suggestions from event attendance + associated-group rosters; symmetric confirmed group associations.
- **Events:** browsable, sorted by real-date guess; detail per §3; AI summary regenerates on new detail; delete/merge (searched-for survives); event-side group tagging via chat.
- **Voice input** on every text box (record → Whisper → text dropped in for review, never auto-sends; no live captions — batch only). **Auto-grow textareas** everywhere.
- **Cross-navigation:** any person/group/event mention anywhere is a chip → detail page, with breadcrumb trail; refresh restores location (sessionStorage).
- **Search boxes** on People/Events/Groups (client-side).
- Demo persona seed data exists ("John & Jane Doe", ~18 people/~22 moments — fake, handwritten UUIDs; don't pattern-match on it).

## 8. Backlog — MASTER LIST (founder's priority list; work order: bugs → quick wins → bigger features)

Items 1–13 (bugs + quick wins) all done 2026-07-18. Also done: 31–36 (2026-07-19: event delete/merge, associated groups, chat layout fix, last-name sort, note source labels, group notes).

**Open — bigger features:**
14. Global search bar on every page (decide: text match first vs. semantic — merges with 30).
15. **Relationship-aware smarts** umbrella: answer via family links ("Braden's dog" → spouse's note); resolve "my parents" (needs a user's own profile concept); auto-suggest links from note content; background relationship scanning; approval log on Home.
16. Auto-notes from chat for every person mentioned (events do this; extend everywhere).
17. Long story/voice-note handling (1–2 min recording parsed into all its facts) — chat currently chokes on long stories.
18. Real-time voice transcription (words appear as you speak; Whisper is batch-only — partial option: Web Speech captions on non-iPhone only).
19. Rules engine ("group A + group B ⇒ group C") + group hierarchy visualization.
20. Data viz: family tree, connection map.
21. Internet lookup for added context.
22. Settings page: tile colors, suggestion sensitivity, chat tone, user's own profile/library, terminology library, About.
23. **Security hardening** + honest About-page writeup ("I don't want it to be bullshit") — start from §10's reality, audit first.
24. Family-dynamic variety (half-/step-/adoptive) — **needs founder decision first**: (a) new relationship types vs. (b) qualifier field on the existing 5; qualifier also changes shared-parent inference (ask which parent, not both).
25. Sibling-group transitive linking (clique completion via suggestions; reciprocal pair-linking already works).
26. Ratings/thumbs feedback loop (tunes suggestions; does not retrain the model).
27. Photo gallery for real (upload/Supabase Storage/tagging; placeholder shipped). True camera-roll sync needs the native iPhone app.
28. Manual + AI-suggested tags on events (schema change).
29. Search within GroupDetail; People filter (criteria undecided).
30. AI/"fuzzy" semantic search (likely merges into 14).
31. **"Memory lane" curated media feed** — requested 2026-07-19. A scrollable, media-driven feed surfacing curated memories (vs. today's specific-lookup mode only); best outcome likely needs real event photos, so probably sequences after item 27 (photo gallery). Already named as a target query mode in §9's product philosophy, just not built yet.
32. **User's own profile ("Me" page or a normal People entry)** — requested 2026-07-19. All events/groups should relate back to the user themself; founder undecided whether the user should live in the People list like a normal contact or get a dedicated "Me" page. Feeds directly into item 15's "resolve 'my parents'" need — this is the underlying concept item 15 was waiting on.
33. **Refer to the user as "You" instead of "User"** — requested 2026-07-19. E.g. "Your brother is Josh," "Your Mom is Amy" — more conversational/personal than the current third-person "User" phrasing. Likely pairs with item 32 once a user profile exists.

**Parked** (don't resurrect unprompted): automatic email reminders (table exists, nothing sends); weather metadata; iPhone Contacts import; "AI should ask deeper follow-ups" thread (feeds 17).

**Small known follow-ups:** align `person-facts`' category vocabulary with the shared 5-kind enum; nicknames stated via `update-moment`/`person-facts` paths aren't written (only lookup); `converse`'s new-moment capture doesn't resolve season phrases ("fall of 2025") to `event_date` (update-moment does); friendlier ErrorBoundary fallback; Edge Function test coverage (needs Anthropic/Supabase mocks); no retroactive group backfill for pre-2026-07-15 moments.

## 9. Product & UX decisions (the standing "why")

- **iPhone app is the real end goal** — weigh iPhone Safari support in every web-API choice (this decided Whisper over Web Speech).
- Web/PWA now, not native; email over push (scope); one shared People concept under everything.
- **Talk, don't fill out forms:** groups, corrections, dates, names — all set conversationally via AI classification (the fact bar), not form fields. The only manual edit controls: Event/Group rename pencils, note edit/delete, merge/delete.
- **Flexible data over rigid structure** (jsonb `details`, free-text `when_text`): great for AI-driven recall, deliberately bad for structured reporting — don't "clean up" without asking. `event_date` was an explicit founder-approved exception (AI resolves "last week" to a real date for sorting only).
- **Never silently assert an inference.** Relationship links, new people from mentions, shared parents, last names — all "suggest, don't assert" banners unless the match is exact-full-name confident. Key Facts never infer or pad.
- **Placeholder people get renamed, not duplicated** ("Clare's mom" → real name = rename). One placeholder per distinct individual.
- Broad questions synthesize everything; never dead-end a miss.
- Membership ≠ attendance: `person_groups` is the only membership truth; attendees of a group's events are suggestions.
- Merges: the record you search for survives; the one you're standing on folds away.
- **Never make the user feel bad about forgetting** — the app is a private pre-event briefing tool, not live assistance. Two query modes: specific lookup (built) and "memory lane" curated overview (NOT built — item toward §8).
- **Input philosophy:** incremental over exhaustive; a fragment is a valid entry; AI carries the cognitive load (confirmation over free recall); "good enough" is the default. Proactive nudges: AI-selected type (action/reflection/memory-mining), trigger mechanism not designed yet.
- Security honesty tiers (item 23): encryption at rest/in transit = claimable now; E2E = roadmap only (conflicts with AI reading content today).

## 10. Pending manual steps, open bugs, cleanup

- ~~`summarize-group` member-conflation prompt fix~~ — **deployed 2026-07-19** (confirmed live: 401, not Supabase's not-found). Still worth regenerating the Sam/Jordan test group's summary (refresh button) to confirm it no longer calls Jordan a member.
- ~~`person-facts` exact-match confidence fix~~ — **deployed 2026-07-19** (confirmed live: 401, not Supabase's not-found). Gus Reynolds's cached Key Facts will still show the stale "Dating: Olivia Gillingham" chip until his profile's Key Facts are refreshed (button, or edit/delete a note).
- **Bad data cleanup (founder, in-app):** delete the wrong "Dating"/"In a relationship with" notes on Gus Reynolds's and Olivia Gillingham's profiles; delete test person "Zzztest CacheCheck" + test event "Coffee with Zzztest CacheCheck".
- **`search_log` table**: run `supabase/migrations_manual/2026-07-19-search-log.sql` if not yet run (Recall-assists card reads 0 until then; verify with the PostgREST 200/400 check).
- **Voice mic button**: backend confirmed working; still never click-tested inside the app UI post-fix.
- Email confirmation must be re-enabled (with a proper redirect URL) before real users.
- Not production-hardened generally: no 2FA/access-control story, minimal tests, raw error boundaries.
- **Before assuming a local diff is unfinished work: check what's actually deployed** — Edge Functions have been deployed from the dashboard without commits before (see §2's token-free checks). Also check `git status` for another concurrent session's work before editing.

## 11. Rules for AI assistants working on this repo

1. **The founder is a non-technical beginner** — plain language, no jargon; they can run exact terminal commands and read a file tree conceptually.
2. **Check in before major/architectural decisions.** Routine follow-through (commit/push/doc updates after verified work) needs no sign-off — see CLAUDE.md.
3. **`converse` is the living center of the app** — most product intelligence is its prompt + JSON handling. Extend it rather than building parallel paths.
4. **Prefer whole-file replacement over incremental patching** once a file is complex (track record of dupe-declaration/typo bugs).
5. Respect the flexible-data-model choice (§9) — don't add rigid columns unprompted.
6. This is a working prototype, not a production system (§10).
7. Demo data is fake — don't infer patterns from it.
8. **Token/billing efficiency is a standing rule** — CLAUDE.md rule 3 + §5 here. Never downgrade the model to save money (founder decision only).
9. Keep this doc lean per the header note; append postmortem-worthy narratives to `PROJECT_HISTORY.md` instead.

## 12. Regression guards (hard-won one-liners — full stories in PROJECT_HISTORY.md §9)

- **Silent RLS failure is the house bug:** any Supabase write that only checks `if (data)` fails silently — always check `.error`, and gate every function on a valid `user` up front (401 "log out and back in" on stale sessions). The AI will cheerfully claim it saved when nothing did.
- **Bare first names/nicknames only resolve when unique account-wide** ("two Bobs"); relationship auto-linking additionally requires name-as-typed == full name on file. Any new AI shorthand (group names too) must handle non-unique.
- **Model JSON is never clean:** slice first `{` to last `}`, retry once on parse failure, regex-extract `"reply"` as last resort. Assistant-prefill (`{role:"assistant","{"}`) is NOT supported — hard API error. Give `max_tokens` headroom for the richest turn (converse: 4096) — truncation = silent JSON failure. Remove unused fields from prompt schemas (dead output budget truncated Key Facts).
- **Save per turn, never gate on "done"** — users don't reply to closing questions.
- Build `raw_description` from `role === "user"` messages only (assistant turns can contain retry garbage).
- **Any function resolving user shorthand needs the FULL rosters** (people AND other events) — narrower context than the user's mental model = wrong guesses ("Triple Bypass" = a bike race, not surgery).
- Chips always render canonical `nameById[id]`, never the model's raw spelling; `.trim()` before name matching.
- Prompts must explicitly require a notes row for every "X was there" mention — attendance IS the note link.
- **PostgREST:** 2 FKs to one table ⇒ qualify embeds (`table!constraint`) or every consumer errors; `.eq()` on an embedded resource filters the embed's own rows — use two queries when you need the full related set. Nested-join TS types lie about cardinality — trust the schema, cast `as unknown as T`.
- `verbatimModuleSyntax`: type-only imports (`import { type X }`). Run `npm run build` locally — clean dev ≠ clean build.
- Vercel env changes need a fresh redeploy (build-time baking). Pushes absent (not failed) from Vercel's deploy list ⇒ check vercel-status.com; CLI is the fallback.
- Prompt-cache guards: stable-first/volatile-last, no timestamps/UUIDs in system prompts, deterministic JSON serialization, explicit `.order()` everywhere (§5).
- A Key Facts name with no chip = the name didn't uniquely resolve (dupe person or ambiguous name in the source note) — that's the signal, not a rendering bug.
- Fix classes of bugs, not instances: `converse`'s siblings (`update-moment`/`update-group`) have repeatedly harbored the same bug (JSON fences, max_tokens, silent errors, missing rosters) — when one function gets a reliability fix, check them all. Same for the two independent name-resolution paths (`relationships.ts` and `person-facts`).
