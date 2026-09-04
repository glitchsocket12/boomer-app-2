# PROJECT_HISTORY.md — Boomer (archive)

_This is the ARCHIVE. It holds the full narrative history of the project — build stories, bug postmortems, deploy chronicles, verification logs — exactly as originally written (section numbers preserved; internal "see Section N" references refer to sections of THIS file). **For the current state of the app, read `PROJECT_CONTEXT.md` instead — do not read this file top to bottom.** Open this file only when you need the full story behind a specific past decision, bug, or feature; search it by keyword or date. New history entries are appended here (dated) only when a change has a postmortem-worthy story; routine changes just update `PROJECT_CONTEXT.md` in place._

---

## 1. Purpose and Vision

Boomer is a mobile-friendly web app for anyone who wants to back up and stay close to their social memories — likely still skewing toward an older, more established-relationship audience, but **no longer age-gated in framing** (repositioned 2026-07-19; the app is no longer scoped to "baby boomers" specifically — see Section 12 for the full repositioning). The founder (the person you're working with) has no professional coding background and is building this hands-on, learning as they go — explanations should stay in plain language, and major decisions should be checked in on before being built, not just announced.

The core insight driving the product: people don't forget the big things, they forget the *texture* — who was at an event, what was discussed, what's going on with someone's grandkids, what a friend mentioned in passing three months ago. Boomer's job is to be an effortless, conversational memory aid for that texture, so the next time you see someone, you're not starting cold.

**The founder's own words on what makes the app special:** "the output is what is going to make the app special" — meaning the quality, warmth, and usefulness of what the app gives back (not just what it stores) is the actual product. A proactive framing they liked: the app inviting someone back into a memory ("want to take a trip down memory lane about this event?").

**Early user feedback describes it as an "isolated social network"** — similar in spirit to Facebook, but without the element of browsing or interfacing with other people's profiles. It's private and self-contained, not a networked platform. Core intent: a combination memory archive and relationship-maintenance tool, leaning heavier toward the archive function. It should not just store data unused — it should actively help people view the data of their life, live more intentionally and fully, and show up better for the people who matter to them. **Target user:** an extroverted person who genuinely cares about maintaining relationships — not primarily someone isolated or struggling to connect, but someone who wants to be even more thoughtful and present with people they already value. See Section 12 for the full design-philosophy discussion this reframing came out of.

## 2. Original Goals / MVP Scope

The founder's original brief specified exactly two core features:

1. **"Add a Moment"** — a conversational feature where the user describes a recent social event (typed or spoken) and an AI asks follow-up questions (who was there, what was discussed), saving the result as notes tied to each person mentioned. Later, the user can ask "tell me about [person]" and get a summary.
2. **Simple Reminders** — manually add important dates (birthdays, anniversaries) for people, with a notification a few days before ("It's almost [name]'s birthday").

Build order requested: user accounts/login first, then Reminders, then Add a Moment.

Since then, the project has grown well beyond this original two-feature scope (see Section 8). The automatic email-sending half of Reminders was explicitly deferred early on and has not yet been revisited.

## 3. Technology Stack

- **Frontend:** React (via Vite), written in **TypeScript** (`.tsx`/`.ts`) — this happened somewhat by accident, because StackBlitz's default "React" starter template uses TypeScript even when "React" (not "React + TS") is selected. The founder is not a TS expert; keep type annotations light and pragmatic, not strict/idiomatic TS.
- **Backend / database / auth:** Supabase (Postgres + built-in auth + Edge Functions). Chosen specifically because it bundles auth and a database together, minimizing setup for a beginner.
- **AI:** Anthropic's Claude API, called exclusively from Supabase **Edge Functions** (Deno-based serverless functions) — never from the frontend — because the API key must never be exposed in browser-visible code.
- **Speech-to-text:** OpenAI's Whisper API (`whisper-1`), called from a new `transcribe` Edge Function, added 2026-07-16 for voice input (see Section 6). Chosen over the browser's free built-in Web Speech API because that free API's speech-recognition half **does not work at all in iPhone Safari** — a dealbreaker since the founder's eventual goal is an iPhone app (see Section 8). Small per-use cost (~$0.006/minute), requires an `OPENAI_API_KEY` secret in Supabase.
- **Dev environment:** As of 2026-07-15, moved off StackBlitz to **Claude Code working directly in a local folder** (`C:\Users\jakev\Downloads\boomer-app-2`), specifically to stop the copy-paste workflow between claude.ai chat and StackBlitz that caused repeated friction (see Section 9). Node.js/npm and the Supabase CLI (as a local devDependency, run via `npx supabase`) are now installed on this machine. Edge Functions were pulled out of the Supabase dashboard into `supabase/functions/` in this repo, so both frontend and backend are now edited and deployed from the same local repo — no more pasting code into either StackBlitz or the Supabase dashboard.
- **Hosting/deployment:** **Live on Vercel** as of 2026-07-15 (`https://boomer-app-2-eight.vercel.app/`), connected to the GitHub repo (`github.com/glitchsocket12/boomer-app-2`) for auto-deploy on every push to `main`. `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` are set as environment variables in Vercel's project settings (not from `.env`, which is git-ignored). **Vercel CLI added as a local devDependency 2026-07-16** (`npx vercel`) as a fallback deploy path for when the GitHub auto-deploy connection isn't working (see Section 9's Vercel-GitHub outage incident) — normal workflow is still just "push to main," this is only a backup.
- **Model name in use:** `claude-sonnet-5` in all Edge Functions. (Earlier revisions mistakenly used an invalid model string, `claude-sonnet-4-6`, which caused a silent failure mode — see Section 9.)
- **Testing:** **Vitest**, added 2026-07-16 (`npm run test`). Minimal setup — see Section 10 for exactly what is and isn't covered.

## 4. Project Architecture

```
src/
├── main.tsx / index.css      — app entry point, minimal global styles
├── App.tsx                   — top-level "traffic controller": auth state,
│                                tab navigation (Home / People / Events /
│                                Groups), and routes to a person's profile
│                                (PersonDetail) when one is selected from
│                                anywhere in the app. Each tab is wrapped
│                                in an ErrorBoundary so a bug in one page
│                                can't blank the whole app (see Section 9).
├── lib/
│   └── supabase.ts           — single shared Supabase client, reads
│                                VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
│                                from .env
├── pages/
│   ├── Login.tsx              — combined sign up / log in screen
│   ├── Home.tsx                — THE MAIN SCREEN. A continuous chat thread
│   │                             (not one-shot search) that calls the
│   │                             `converse` Edge Function. Handles
│   │                             questions, new memories, corrections,
│   │                             and group tagging, all in one thread.
│   ├── People.tsx              — list of people, add a person (first +
│   │                             last name), add a reminder date per
│   │                             person, click a person to view their
│   │                             profile
│   ├── PersonDetail.tsx        — one person's profile: a "Key facts"
│   │                             bulleted list (AI-extracted from that
│   │                             person's notes via the `person-facts`
│   │                             Edge Function — spouse, kids, where they
│   │                             live, education), a nudge box asking
│   │                             specifically about whichever of those
│   │                             categories is still missing, all notes
│   │                             about them (chronological), plus a
│   │                             "fact bar" to add a detail (routes
│   │                             through the `add-fact` Edge Function,
│   │                             which decides if it's a name correction
│   │                             — first name, last name, or a new
│   │                             nickname/"goes by" — a birthday/
│   │                             anniversary date, or a plain note). This
│   │                             free-text fact bar is the ONLY way to
│   │                             edit any of those fields on this page —
│   │                             there's no click-to-edit field cell or
│   │                             form anywhere on it, despite that being
│   │                             documented here at one point (see
│   │                             Section 6)
│   ├── Groups.tsx               — lists groups (e.g. "Academy Friends")
│   │                             and their members; groups are created
│   │                             CONVERSATIONALLY (via Home), not through
│   │                             a manual "create group" form
│   ├── Events.tsx               — browsable list of all moments/events
│   │                             (independent of any one person), shows
│   │                             attendees (as clickable chips to their
│   │                             profile) and any group tags
│   ├── DunbarDetail.tsx         — added 2026-07-19. Deep-dive page reached
│   │                             by tapping Home's "People you'd have lost
│   │                             track of" card: explains Dunbar's number,
│   │                             then shows the user's own people count
│   │                             against Dunbar's nested tiers (Intimate
│   │                             circle/5, Close friends/15, Meaningful
│   │                             contacts/150, Beyond Dunbar's limit) as
│   │                             progress bars, plus an outbound link to
│   │                             further reading. See Section 6.
│   └── DueForUpdate.tsx         — added 2026-07-19. "Due for an update"
│                                 nudge list reached from Home's leaderboard
│                                 footer CTA: people sorted by oldest (or
│                                 no) note first, so it's the practical
│                                 inverse of the leaderboard. See Section 6.
├── components/
│   ├── ErrorBoundary.tsx        — catches a render-time crash in whatever
│   │                             it wraps and shows an error message
│   │                             instead of taking down the whole app
│   ├── UpdateMomentChat.tsx     — small inline conversational widget for
│   │                             adding detail to an already-identified
│   │                             moment, calls the `update-moment` Edge
│   │                             Function. Was mainly used before Home
│   │                             became fully conversational; may now be
│   │                             partially redundant with Home's general
│   │                             capability to update moments in-thread.
│   ├── VoiceInputButton.tsx     — reusable mic button (added 2026-07-16),
│   │                             records audio via the browser's
│   │                             MediaRecorder API, sends it to the
│   │                             `transcribe` Edge Function, and hands the
│   │                             transcribed text back to whichever text
│   │                             box it's next to. Used by Home.tsx,
│   │                             UpdateMomentChat.tsx, and PersonDetail.tsx's
│   │                             fact bar — every conversational/text-entry
│   │                             point in the app. Renders nothing (returns
│   │                             null) on a browser with no MediaRecorder
│   │                             support, so it fails invisibly rather than
│   │                             showing a broken button.
│   ├── AutoGrowTextarea.tsx     — reusable text box (added 2026-07-16) that
│   │                             grows downward as its content wraps, instead
│   │                             of cutting text off/scrolling horizontally
│   │                             like a single-line `<input>` did. Enter
│   │                             sends (via an `onEnter` callback prop),
│   │                             Shift+Enter inserts a manual line break.
│   │                             Capped at 160px tall, then scrolls internally
│   │                             rather than growing forever. Used in the
│   │                             same three places as VoiceInputButton.tsx
│   │                             above, replacing the plain `<input>` each
│   │                             had before.
│   ├── PhotoGallery.tsx         — DISPLAY-ONLY placeholder (added 2026-07-17)
│   │                             for the future photo gallery feature (see
│   │                             Section 7, item 10). Renders a "Gallery"
│   │                             section with 4 static decorative tiles, no
│   │                             real photos/upload/storage. Used on
│   │                             PersonDetail.tsx, EventDetail.tsx, and
│   │                             GroupDetail.tsx purely to demonstrate the
│   │                             layout to the founder.
│   ├── RefreshButton.tsx        — small icon button (added 2026-07-17) with
│   │                             a spinning-while-loading state (reuses the
│   │                             `spin` keyframe in index.css). Used next to
│   │                             a group's AI-generated summary on
│   │                             GroupDetail.tsx to regenerate it on demand.
│   └── SearchBox.tsx            — plain text input (added 2026-07-17), styled
│                                 to match the app's existing inputs. Used on
│                                 People.tsx, Events.tsx, and Groups.tsx to
│                                 client-side filter each page's already-loaded
│                                 list by name/title/summary as you type.
```

**As of 2026-07-15, the standalone "Add a Moment" page (`AddAMoment.tsx`) was removed** — Home's unified conversation already covers that capture flow, so the separate page/tab was redundant. Its Edge Function (`chat`) is still deployed but is now unused by the frontend entirely (see the Edge Functions table below). The Events and Groups tabs (described above) were also actually wired into the nav bar for the first time as part of this same change — the architecture doc had described them for a while, but they weren't reachable from the UI until now.

**Supabase Edge Functions (Deno, in the Supabase dashboard, not local CLI):**

| Function | Purpose | Status |
|---|---|---|
| `update-moment` | Add detail to one specific moment | Active, used by `UpdateMomentChat.tsx`. Prompt-cached (see below). |
| `add-fact` | Classifies a typed fact as a last-name correction vs. a plain note. Also detects a stated spouse relationship (e.g. "Married to Carol") and, when found, finds-or-creates that spouse's own person record and writes a reciprocal note onto THEIR profile too, so the founder never has to type the same relationship fact twice from both sides | Active, used by `PersonDetail.tsx` and `Home.tsx`'s per-person note adding; spouse-reciprocity added 2026-07-17, deployed and confirmed working. Also confirmed 2026-07-18 (fresh live test) to correctly write a stated nickname into `people.nicknames` via the fact bar's `name_update` classification. Prompt-cached (see below). |
| `transcribe` | Turns a recorded voice clip into text via OpenAI Whisper | Active, added 2026-07-16, used by `VoiceInputButton.tsx`. Needs an `OPENAI_API_KEY` secret set in Supabase (see Section 10) — not yet click-tested end-to-end (see Section 6). |
| `converse` | **The main unified brain.** One conversation handles: answering questions (about people, groups, or events), capturing brand-new moments, updating existing moments, renaming placeholder people, last-name corrections, and creating/tagging groups — all decided per-turn from conversational context. This is what `Home.tsx` calls. | Active, actively evolving, deployed and confirmed live 2026-07-19/20. Prompt-cached (see below). **Known quirk**: the model occasionally replies in plain prose instead of the required JSON envelope (reproduced live during testing) — `converse` now falls back to showing that raw prose as the reply instead of a generic "couldn't process that" apology, since the prose answer is usually already correct. |
| `summarize-group` | Writes a short, high-level one-sentence description of a group from its members + tagged events, saves it to `groups.summary` | Active, added 2026-07-16, used by `Groups.tsx` and `GroupDetail.tsx` (see Section 6) |
| `update-group` | Multi-turn conversational editing of a group — add/remove members, tag/untag events, rename. Can also capture a plain fact about a member mentioned mid-conversation as a note on that person's own profile, tagged with `source_group_id` so it shows a "From: [Group name]" label there | Active, added 2026-07-16, used by `UpdateGroupChat.tsx` on `GroupDetail.tsx`. Prompt-cached (see below). |
| `summarize-moment` | Rewrites an event's raw captured description + notes into a short, readable 2-4 sentence first-person summary, saves it to `moments.summary` | Added 2026-07-16, used by `EventDetail.tsx` and `GroupDetail.tsx` (see Section 6). **Confirmed live 2026-07-18** — the function is deployed and the `moments.summary` column exists; click-tested end-to-end (generated a real summary for a live event) |
| `suggest-prompts` | Looks at the user's recorded moments/people/groups and writes 3 warm, specific invitations to share something (e.g. "Take a second to share one of your favorite moments from your wedding!"), shown as tappable cards on Home before the first message of a session | Active, added 2026-07-17, used by `Home.tsx` (see Section 6). Results now cached in the DB instead of regenerated on every visit. |
| `person-facts` | Reads all of a person's `notes.content` and extracts ONLY explicitly-stated relationship/background facts (spouse, kids, where they live, education, plus up to 2 other close-relationship facts), never inferring or padding — returns `{facts: [{category, text}]}`. For a "spouse" fact, also resolves the named spouse to an existing person record (same ambiguous-first-name-safe matching as `converse`/`update-moment`) and includes `personId`/`personName` when it finds one, so `PersonDetail.tsx` can render a clickable link instead of plain text | Added 2026-07-17, extended 2026-07-17 (spouse linking), used by `PersonDetail.tsx` (see Section 6). **Key Facts caching confirmed live 2026-07-18**: `people.key_facts`/`key_facts_updated_at` columns exist, a live test showed facts saved to the DB with a timestamp and served from cache (not regenerated) on a repeat profile view. Prompt-cached (see below). |

**`chat` and `search` were deleted 2026-07-19/20** (both locally and from Supabase) — dead code, fully superseded by `converse`.

**Prompt caching (2026-07-19/20):** `converse`/`update-moment`/`update-group`/`add-fact`/`person-facts` all send their system prompt with Anthropic `cache_control: {type: "ephemeral"}` breakpoints, per the token/billing efficiency rule in `CLAUDE.md`. `converse`/`update-moment`/`update-group` split their system prompt into two blocks — a fully static `stableInstructions` block (no interpolated data, reusable across every user/turn) and a `dynamicContext` block (today's date + the current roster/moments, its own breakpoint) — so a write between turns only invalidates the smaller dynamic block, not the large instructions block. This also fixed a real bug: the underlying Supabase queries had no explicit `.order()`, so Postgres could return the same rows in a different order between calls with no data change, which silently broke the cache-prefix match on every single turn. All the roster/moment/group queries in these functions now have explicit `.order()` clauses for exactly this reason — removing one on a future edit will quietly kill caching again without any error. Verify caching is actually landing via `usage.cache_read_input_tokens` in the Anthropic response (Supabase's function-log analytics endpoint can be flaky/eventually-consistent when checking this).

**Shared module:** `supabase/functions/_shared/relationships.ts` centralizes family-relationship detection (spouse/sibling/parent/child/partner) — reciprocal note writing on both profiles, "confident match only" linking, and new-person suggestions — used by `converse`, `update-moment`, `update-group`, and `add-fact` so the same vocabulary and behavior apply everywhere a relationship can be mentioned, not just the profile fact bar.

**Multiple concurrent Claude Code sessions worked on this repo in parallel on 2026-07-19/20** (prompt caching + a new relationship-detection feature) without coordinating. Their changes merged compatibly with no corruption (verified: clean git history, no conflict markers, full build pass, every touched file read end-to-end), but this was good luck from touching different parts of the same functions, not a guarantee. Treat two simultaneous sessions in this same folder as a real risk to watch for, not a hypothetical — if starting a new session, check `git status`/`git log` first for another session's in-progress or very recent work.

## 5. Database Structure (Supabase / Postgres)

All tables use Row Level Security (RLS), scoped so a user can only ever see/modify their own data (via `auth.uid()` matching either directly or through a join back to `people`/`moments`/`groups`).

```
people
  id            uuid PK
  user_id       uuid → auth.users
  name          text            (first name — historically just "name",
                                  functions as first name once last_name
                                  was added)
  last_name     text, nullable  (added later; many older/seeded people
                                  may have this blank)
  nicknames     text, nullable  (added 2026-07-17. Comma-separated list of
                                  "goes by" names, e.g. "Bob, Grandpa Joe" —
                                  a single free-text field, not a separate
                                  table, matching how simple `last_name`
                                  already is. Written conversationally via
                                  the fact bar (add-fact's name_update
                                  classification, additive — a newly-stated
                                  nickname is appended, not a replacement)
                                  and, as of 2026-07-18, via the Home chat
                                  too (converse's nickname_updates, same
                                  additive merge — see Section 9/10 bug
                                  fix below). NOTE: a "Goes by" direct
                                  click-to-edit field on PersonDetail.tsx
                                  was previously documented here, alongside
                                  similarly-documented Last name/Birthday/
                                  Anniversary click-to-edit cells — a
                                  2026-07-19 doc-accuracy pass confirmed
                                  none of that was ever actually built.
                                  It was documentation drift, not a
                                  removed feature: the real product
                                  decision, recorded in Section 9, was to
                                  use this same fact-bar/AI-classification
                                  approach for last name too, and nicknames
                                  plus birthday/anniversary followed the
                                  same pattern. See Section 4/6 for the
                                  corrected description. Every AI
                                  name-matching function (converse,
                                  update-moment, add-fact, person-facts,
                                  update-group) also treats each nickname
                                  as an alternate lookup key, same
                                  ambiguous-name guard as first names — see
                                  Section 6.)
  created_at

moments                          ("events" in the UI/Events page)
  id            uuid PK
  user_id       uuid → auth.users
  raw_description text          (original raw conversation text, kept
                                  for reference — NOT shown directly on
                                  Event tiles anymore, see `summary` below)
  summary       text, nullable  (AI-generated, see Section 6 — a short
                                  readable rewrite of raw_description +
                                  notes, shown on EventDetail.tsx and
                                  GroupDetail.tsx's event tiles instead
                                  of the raw dump)
  occasion      text, nullable
  location      text, nullable
  when_text     text, nullable  (INTENTIONALLY free-text, kept verbatim —
                                  people describe timing loosely, "last
                                  summer" etc. Still shown as-is on the
                                  Event detail page. For ANSWERING
                                  questions in conversation, `converse`
                                  still reasons about when_text's meaning
                                  relative to created_at, not event_date
                                  — see Section 8, date reasoning; this
                                  wasn't changed.)
  event_date    date, nullable  (added 2026-07-16. A real calendar date
                                  the `converse` AI resolves from when_text
                                  + today's date + surrounding context at
                                  capture time, e.g. "last week" -> an
                                  actual YYYY-MM-DD. Best-effort, not
                                  user-verified — used for sorting/display
                                  only, not treated as ground truth.
                                  NULL for anything recorded before this
                                  was added, and possibly null going
                                  forward too if the AI truly has no time
                                  clue to work with. Pages fall back to
                                  created_at when null — see
                                  eventSortDate()/formatMonthYear() in
                                  Events.tsx and the matching helper in
                                  GroupDetail.tsx.)
  details       jsonb, nullable (OPEN-ENDED tags, e.g. {"mood": "...",
                                  "food": "..."} — deliberately NOT fixed
                                  columns, because real debriefs surface
                                  unpredictable categories. Trade-off:
                                  great for AI-driven search/reasoning,
                                  not good for structured reporting/
                                  filtering later if that's ever wanted.)
  created_at    timestamp        (the REAL date the moment was recorded —
                                  used together with when_text for date
                                  math)
  dismissed_person_ids jsonb     (added 2026-07-17, NOT NULL DEFAULT '[]'::jsonb —
                                  array of person UUIDs the user has said should
                                  NOT be suggested as an attendee of THIS event,
                                  see Section 6's "Also from the affiliated
                                  group?" deny feature. Same reasoning/pattern
                                  as `groups.dismissed_person_ids`.)

notes
  id            uuid PK
  person_id     uuid → people, NULLABLE (made nullable 2026-07-19 so a
                                  note can belong to a GROUP instead of a
                                  person — see group_id below. A CHECK
                                  constraint requires person_id OR
                                  group_id to be set, never neither.)
  moment_id     uuid → moments, NULLABLE (nullable was added later
                                  specifically so a note can be a
                                  standalone manually-added FACT about a
                                  person, not tied to any one moment —
                                  e.g. "married to X, shares a house")
  group_id      uuid → groups, NULLABLE (added 2026-07-19 — a
                                  free-standing note ABOUT a group,
                                  written directly on GroupDetail.tsx's
                                  own Notes section, no event needed.
                                  person_id is null for these rows. New
                                  additive RLS policies scope these to
                                  `groups.user_id = auth.uid()`, separate
                                  from and not touching the existing
                                  person_id-based policies.)
  source        text, NULLABLE  (added 2026-07-19. `"home"` when the note
                                  was inserted by `converse` (the Home
                                  chat); null for notes added natively on
                                  their own page (a person's fact bar, an
                                  event's own follow-up chat, a group's
                                  own Notes section) — drives the
                                  "From Home" note-card label, see
                                  Section 6/10)
  source_group_id uuid → groups, NULLABLE (added 2026-07-19. Set when a
                                  PERSON note was captured via a group's
                                  "Edit this group" chat mentioning a
                                  plain fact about a member — drives the
                                  "From: [Group name]" note-card label,
                                  see Section 6/10)
  content       text
  created_at

reminders
  id            uuid PK
  person_id     uuid → people
  label         text            (e.g. "Birthday", "Anniversary")
  month         int
  day           int
  created_at
  -- NOTE: no year field; NOTE: no automatic email-sending is wired up
  -- yet, this table only supports the manual/in-app half of Reminders

groups
  id            uuid PK
  user_id       uuid → auth.users
  name          text            (e.g. "Academy Friends")
  summary       text            (nullable; AI-generated, see Section 6)
  dismissed_person_ids jsonb     (added 2026-07-17, NOT NULL DEFAULT '[]'::jsonb —
                                  array of person UUIDs the user has said should
                                  NOT be suggested as a member of this group,
                                  see Section 6's "deny a suggestion" feature.
                                  Reuses `groups`' existing RLS instead of a new
                                  join table with its own policies, same
                                  jsonb-for-flexibility reasoning as
                                  `moments.details`.)
  dismissed_group_ids jsonb      (added 2026-07-19, NOT NULL DEFAULT '[]'::jsonb —
                                  same idea as dismissed_person_ids above, but for
                                  the Associated Groups suggestion feature: group
                                  UUIDs the user has said should NOT be suggested
                                  as associated with this group. SQL handed off to
                                  the founder to run — see Section 10.)
  created_at

person_groups                    (join table, many-to-many)
  person_id     uuid → people
  group_id      uuid → groups
  PK (person_id, group_id)

group_associations                (added 2026-07-19, join table, many-to-many,
                                   SYMMETRIC self-reference on groups — a CONFIRMED
                                   "these two groups are associated" link, distinct
                                   from the suggestion derived from shared
                                   events/members. See Section 6's "Associated
                                   Groups" feature. SQL handed off to the founder
                                   to run — see Section 10.)
  id             uuid PK
  group_id_a     uuid → groups
  group_id_b     uuid → groups   (ordering normalized client-side, group_id_a <
                                  group_id_b by UUID string sort, so the same pair
                                  can't be linked twice regardless of which
                                  group's page the link was approved from)
  created_at

moment_groups                    (join table, many-to-many)
  moment_id     uuid → moments
  group_id      uuid → groups
  PK (moment_id, group_id)

search_log                        (added 2026-07-19 — one row per Home chat message
                                   `converse` classifies as a genuine recall/lookup attempt,
                                   NOT a new memory being captured, a correction, or idle chat.
                                   Powers the "Recall assists this month" dashboard stat — see
                                   Section 6's "Working as intended" stats feature. SQL handed
                                   off to the founder to run — see Section 10.)
  id             uuid PK
  user_id        uuid → auth.users
  query_text     text            (the user's raw message that turn)
  matched        boolean         (true if converse's reply actually surfaced relevant existing
                                   info, false if it came up empty and fell back to a
                                   clarifying question/close-match/invite-to-share)
  created_at

home_suggestions                 (added 2026-07-19 — DB cache for Home's "A few ideas"
                                   suggestion cards, see Section 9's home-page-slowness fix.
                                   One row per user; applied directly via the Supabase
                                   Management API, not a dashboard paste.)
  user_id        uuid PK → auth.users
  suggestions    jsonb           (array of 3 suggestion strings, last AI-generated result)
  updated_at     timestamptz     (compared against the latest moments/notes created_at to
                                   decide whether the cache is stale — see suggest-prompts)
```

## 6. Features Already Built (and confirmed working end-to-end)

- Sign up / log in (Supabase Auth, email confirmation currently **disabled** in the Supabase dashboard for ease of testing — see Section 10, this needs to be re-enabled before real users)
- People list: add a person (first + last name), view list. Tiles match the Groups/Events convention — the person's full name is the clickable title, with a row of color-coded chips underneath (gold `GroupChip` for group membership, blue `EventChip` for events they're tied to) so you can jump straight to a related group/event. No data fields are shown on this list page.
- Person detail page (click into a tile): **corrected 2026-07-19** — this doc previously described standardized "field cells" for Last name, Birthday, and Anniversary that were click-to-edit right on the cell, with a "not on file" placeholder when missing. A doc-accuracy check found none of that exists in the shipped code — no field cells, no "not on file" placeholders, no click-to-edit UI of any kind on this page. It appears to have been documentation drift (described here but never actually built) rather than a feature that was built and later removed. See the corrected description in the next two bullets.
- Reminders: Birthday/Anniversary are set the same way as everything else on this page — by typing a plain-language sentence into the fact bar (e.g. "Her birthday is March 3rd"), which `add-fact` classifies and upserts into `reminders` (updates the existing row for that label if one exists, else inserts a new one). There is no date-picker, click-to-edit cell, or any other dedicated form anywhere in the app for setting these. **No automatic email/notification sending exists yet.**
- Person profile page: chronological notes, a "fact bar" to add a detail directly — the only way to edit last name, nicknames, birthday, or anniversary on this page. Routes through AI classification (`add-fact` Edge Function) that files the text wherever it best fits: a first/last-name correction or a new nickname/"goes by" name, a birthday/anniversary date (upserts into `reminders`), or — if none of those — a plain note. This is a general classifier, not a fixed list of hard-coded phrases, so it's expected to handle new phrasings of these cases reasonably well.
  - **The fact bar now also infers group membership from a fact, or asks when it's not sure** (built 2026-07-17). Previously documented right above this as a known gap (`add-fact` had zero group awareness, unlike `converse`) — the founder hit it directly: typing "Adrienne was a high school friend of mine" did nothing group-related at all. `add-fact` now gets the same kind of groups roster `converse` already uses, and its classification response gained an independent `group_signal` field (`{group_name, confidence: "high"|"medium"} | null`) alongside whatever the fact itself was filed as. **High confidence** (a specific named institution/organization clearly shared with the app's user, e.g. "we went to Lincoln High together") auto-tags immediately — same reuse-by-name-or-create-new behavior `converse` already uses for groups, no confirmation needed, consistent with how `converse` already auto-tags without asking when the signal is explicit. **Medium confidence** (a real but vague affiliation signal with no specific name, e.g. "was a high school friend of mine," "we used to work together") does NOT create or tag anything by itself — it returns a suggested group name, and `PersonDetail.tsx` shows an inline "It sounds like {name} might belong to a group called '{suggested name}'. Add them?" banner with Yes/Add / No thanks buttons; "Yes" does the same find-existing-or-create-group-then-tag logic, entirely client-side (no AI call needed for a deterministic yes/no action). A one-line "✓ Also added {name} to '{group}'" confirmation shows after either an auto-tag or a confirmed suggestion, since the fact bar has no back-and-forth chat thread to react in. Build passes; **not yet live** — `add-fact` is an Edge Function change, needs the same paste-into-Supabase-dashboard-and-Deploy step as other function changes (see Section 4/infra notes); not click-tested inside the logged-in app by the assistant (login-requires-a-password limitation noted elsewhere in this doc) — worth the founder trying the exact "Adrienne" example once deployed, and also trying a specific/confident example (e.g. naming an actual school) to confirm the auto-tag path doesn't ask first.
- **Person profile now leads with a "Key facts" bulleted list, plus a prompt for whatever's missing** (built 2026-07-17, founder-requested). The founder wanted the profile page to surface the "brass tacks" on a person at a glance — specifically relationship/background facts (spouse, kids and their names, where they live, education) — separate from the existing group/event chips, which already cover *how the user knows this person* rather than *who this person is*. New `person-facts` Edge Function (see the table above) reads all of that person's `notes.content` (both standalone facts and things mentioned while recording events) and asks Claude to pull out ONLY what's explicitly stated for those categories (plus up to 2 other clearly-stated close-relationship facts, e.g. parents/siblings) — **deliberately no inference or filler**, matching the founder's explicit instruction not to make anything up. `PersonDetail.tsx` calls it once per page view (no caching/new column, unlike `groups.summary`/`moments.summary` — this reads current notes fresh every time rather than needing a schema change and a manual SQL step) and renders whatever comes back as a bulleted list in a "Key facts" box, or a "Gathering what we know…" placeholder while loading; the box itself is hidden entirely if there are no facts and nothing is loading. Directly below the fact bar's usual spot, a separate dashed-border nudge box lists specific questions for only the categories still missing (e.g. "Where did Steve go to school?"), computed client-side from a fixed 4-question template (not AI-generated, so the wording stays predictable) — or, if the person has zero notes at all, a single "Tell us a memory about {name} to get started" line instead. Build passes; click-tested via a disposable test account (since email confirmation is off — see Section 10) confirming the empty-state nudge and the "which questions are missing" logic both render correctly and nothing crashes. **`person-facts` itself is NOT yet deployed** — same paste-into-Supabase-dashboard-and-Deploy step as other new functions (see Section 10) — so the "Key facts" list will stay empty (falling back to the missing-info nudge for all 4 categories) until that's done; worth the founder deploying it and then confirming a real bullet list appears for a person with notes like "married to X, two kids named Y and Z."
  - **Spouse facts now link to the other person's actual profile, and saving one side automatically fills in the other** (built 2026-07-17, founder-requested follow-up — the initial "Key facts" list only showed spouse info as plain text, and saying "married to X" on one person's page did nothing on X's own page). Two changes, both server-side: (1) `person-facts` now also resolves a "spouse" fact's named person against the existing people roster (reusing the same unique-first-name-else-full-name matching `converse`/`update-moment` already use) and, when it finds a match, includes that person's id/name in the fact it returns — `PersonDetail.tsx` renders this as a clickable green `PersonChip` navigating straight to that person's own profile. If the spouse isn't a separate person record yet (or the name is ambiguous, e.g. two "Bob"s on file), it falls back to plain text — same fail-safe-to-inert-text philosophy as everywhere else in the app that resolves names. (2) `add-fact` gained a `spouse_signal` alongside its existing `group_signal`, set only when a fact names a SPECIFIC spouse (a bare "he's married" with no name given sets nothing, since there'd be nothing to link) — it finds-or-creates that person the same way `update-moment`/`converse` create a newly-mentioned person, then writes a reciprocal note ("Married to {this person's name}.") onto the spouse's own `notes`, with a light dedupe check (skips writing it again if the spouse already has a note mentioning this person's name alongside "married"/"spouse") so re-saving the same fact doesn't pile up duplicates. `PersonDetail.tsx` shows a one-line "✓ Also updated {spouse}'s profile…" confirmation banner after a successful save, same pattern as the existing group-tag confirmation. `App.tsx` now passes `onSelectPerson` into `PersonDetail` (it previously didn't need to, since nothing on the page linked to another person). Build passes; click-tested via a disposable test account confirming the fact bar still saves without crashing and the missing-info nudge still renders correctly when the backend can't yet resolve anything (both Edge Functions are still on their pre-2026-07-17 deployed versions this session — same "no Supabase access token" limitation noted throughout this doc) — the actual clickable-chip-appears and other-profile-gets-updated behavior can't be confirmed until both functions are (re)deployed, see Section 10.
    - **Same-day fix: the spouse's name was showing up twice** (once as the AI's own free-text bullet, once as the chip appended next to it, e.g. "Married to Rob Leonard. [Rob Leonard]") — founder caught this from a screenshot. `person-facts`'s schema for the "spouse" category changed from a single free-text `text` field to a `relationship_label` (a short lead-in phrase with the name deliberately excluded, e.g. "Married to", or a standalone "Married." when no name is given) plus `person_name` — the frontend now composes the bullet itself (`relationship_label` + either the `PersonChip` or the plain name, never both) instead of trusting the AI to phrase a bullet that already excludes the name. Other categories (kids/location/education/other) are unaffected, still a single AI-written `text` bullet. **The founder deployed this and confirmed the duplicate-name bug was fixed**, but caught a new regression from the same change (see next entry).
    - **Same-day follow-up fix: `relationship_label` sometimes came back empty from Claude despite the prompt asking for it**, so a "spouse" bullet could render as a bare name button with no "Married to" lead-in at all (founder screenshot: Manuel's page showed just a "Clare Sucre" button, no text before it). `person-facts` now defaults `relationshipLabel` to `"Married to"` (or `"Married."` when there's no name to attach) whenever the model's own `relationship_label` comes back blank, instead of trusting the model to always fill it in — same "never trust the model to produce a required field, always have a deterministic fallback" lesson as elsewhere in this app's Edge Functions. Build passes; **not yet deployed** — needs the same paste-into-Supabase-dashboard-and-Deploy step on `person-facts` again (see Section 10) before this specific fix goes live; worth the founder reloading Manuel's page afterward to confirm it now reads "Married to Clare Sucre" with the name as a button.
  - **"New relationship suggestion" banner, instead of silently creating or linking a person profile** (built 2026-07-19, founder-requested after a note on Gus Reynolds's profile — "he's dating a girl named Olivia" — silently created a brand-new, unlinked "Olivia" profile instead of asking first). The founder's stated principle: creating a new person, OR linking a relationship to an existing one, as a *side effect* of a relationship mention should always be a suggestion, the same "suggest, don't assert" pattern already used for the shared-parent inference below — never an automatic write. Also added a new `partner`/"dating" relationship kind (previously only `spouse`/`sibling`/`parent`/`child` existed). First pass only gated on whether the name matched *anyone at all*, auto-committing any match — but a live test the same day (typing "dating a girl named Olivia" on Gus's profile, with an unrelated existing "Olivia Gillingham" already on file) showed that was still wrong: a bare first name matching someone who has a last name on record is a guess, not a fact, and got auto-linked as if confirmed. **Fixed same day**: `add-fact`'s matching logic (`supabase/functions/add-fact/index.ts`) now only treats a match as confident enough to auto-commit when the name **as typed** exactly equals the matched person's full name on file (`nameById[matchedId].toLowerCase() === key`) — a bare first name resolving to someone with a fuller name on record no longer auto-links. Any non-confident case (no match at all, or a loose partial match) returns a `newPersonSuggestions` entry (capped at 6), with a `candidateId`/`candidateName` attached when there was a loose match. `PersonDetail.tsx` renders each as a two-stage banner (reusing the same `mergeOpen`/`mergeCandidate` two-step narrowing pattern already in this file for the merge-profile flow): with a candidate, stage one asks "Is this the same person as {candidateName}, already in your contacts?" (Yes links the relationship note directly onto that existing profile; No moves to stage two); with no candidate, stage one asks "Add this?" (Yes creates a brand-new person plus the relationship note). Stage two either way: "Add {name} as a new contact anyway, without confirming that relationship?" (Yes creates a bare person record with no relationship note; No does nothing further). Declining entirely doesn't lose the original text — the fact typed on the known person's own profile is already saved as a plain note regardless of what happens with `family_signals` (a separate, unconditional code path), so "keep as a note that feeds the model, don't create a profile" is the natural fallback the moment auto-linking stopped — no new schema was needed for that outcome. Deliberately scoped to this person-page "Add a fact" flow only; Home chat's separate `new_people` auto-creation (`converse/index.ts`, no relationship modeling at all) was left alone as a smaller, lower-risk change — worth a follow-up if the same bloat/mismatch problem shows up there. Build passes. **Deployed and live** (confirmed by the founder's own click-test surfacing the bug above, meaning the first pass of this code was genuinely running in production) — the confidence-check fix itself has not yet been separately re-confirmed live; worth the founder re-testing the exact "Olivia" repro once redeployed to confirm it now asks "is this the same person?" instead of auto-linking. **The bad data from the original test (a "Dating"/"In a relationship with" note on both Gus Reynolds's and Olivia Gillingham's profiles) is still live and needs manual cleanup** — delete the note via the trash icon in each profile's Notes section.
  - **Key facts generalized from spouse-only to spouse/siblings/parents/children, all clickable, plus a "suggest, don't assert" shared-parent inference** (built 2026-07-17, founder-requested — typing "Her brothers are Danny and Josh Volin" on Jess's page should recognize Danny/Josh already exist, link them as buttons, and (carefully) notice that Jess's own parents might also belong on their profiles). This was explicitly scoped down before building: the founder confirmed inferred relationships should only ever be **suggested for confirmation, never silently written as fact** (same reasoning as the app's very first "don't make up key facts" instruction — a wrong inference here, e.g. a half-sibling or step-parent, would plant a false "fact" with no review step), and that the inference should check **both directions** (adding a sibling checks for a shared parent gap; adding a parent checks that person's already-known siblings for the same gap), not just the original one-directional example. Three parts: (1) `person-facts`'s old single "spouse" special-case became a general `LINKED_CATEGORIES` treatment (`spouse`, `siblings`, `parents`, `kids`) — each category now returns a `people: [{name, personId?}]` array (0+ people, not just 0-or-1) resolved against the roster the same way spouse already was, so `PersonDetail.tsx` renders a `PersonChip` for every name that matches an existing person and plain text for ones that don't (e.g. a named sibling nobody's added yet). The old catch-all "other" category (which used to lump parents/siblings into an unlinked 2-item cap) now only covers things that don't fit those four, like grandparents or in-laws. (2) `add-fact`'s `spouse_signal` became `family_signals`, an array covering all four relationship kinds with per-relationship reciprocal-note phrasing (`"Married to X."` / `"Their sibling is X."` / `"Their child is X."` / `"Their parent is X."`) written onto the OTHER person's profile, same find-or-create-then-reciprocal-note approach as spouse, generalized. (3) The actual inference: after a sibling or parent signal resolves, a small separate AI call (scoped to just the two people involved, not the whole account) reads each one's own notes for explicitly-stated parent names, resolves those to existing people, and diffs the two sets — anyone missing on one side becomes a `relationshipSuggestion` object (`{parentId, parentName, childId, childName}`) sent back in the response, capped at 6 and deduped. `PersonDetail.tsx` renders each as its own inline banner ("It looks like {parent} might also be {child}'s parent. Add this?") with Yes/No, styled like the existing group-suggestion banner; "Yes" writes the same two deterministic reciprocal notes directly (no AI call needed for a confirmed yes/no action, same reasoning as `confirmSuggestedGroup`), "No" just clears the banner and writes nothing — declines aren't remembered persistently (same as the group-suggestion banner before `dismissed_person_ids` was added for groups; the same suggestion could resurface later if re-triggered). Build passes. **Both `add-fact` and `person-facts` need a manual redeploy for this to go live** (see Section 10) — until then, a stated sibling/parent/child fact still saves as a plain note as before, just without the reciprocal write, the clickable link, or the suggestion banner.
  - **Key Facts tiles can now be individually edited or deleted, and show where each one came from** (built 2026-07-17, founder-requested after noticing the same person showing up as two slightly different names — e.g. "Bridget Dugan's girlfriend" and "Bridget Burson's girlfriend" — on one profile, a duplicate/mismatched-name data-quality issue with no way to fix it from the app itself). **Checked in with the founder first** on what "delete" should mean here — permanently deleting the underlying note text, vs. only hiding the fact and keeping the note (the latter would need a new schema column, same pattern as `dismissed_person_ids`). The founder chose permanent deletion, so no schema change was needed. Two parts: (1) `person-facts` now tags each note it sends to Claude with its own `[NOTE_ID: ...]` marker (same tagging technique `search.ts`/`update-group` already use for moments) and asks for a `note_ids` array back on every extracted fact, so each Key Fact bullet can be traced back to the exact note(s) it was drawn from — filtered against the person's real note IDs so a hallucinated ID can't silently attach a delete/edit action to the wrong data. (2) `PersonDetail.tsx`'s Key Facts list now uses a `KeyFactItem` component: hovering a bullet reveals a pencil + trash badge in the corner (same wrapper-plus-corner-badge hover pattern already used for member/suggestion chips on `GroupDetail.tsx`/`EventDetail.tsx`, chosen because nothing resizes on hover so it can't flicker). The pencil swaps the bullet for an inline textarea (pre-filled with the source note's actual text) with Save/Cancel; saving updates that note's `content` directly in the database, so the correction actually improves the underlying data, not just how this one bullet displays. The trash icon deletes the source note(s) outright. Both only appear when a fact traces back to exactly one note — a fact assembled from several notes at once (rare) shows no edit/delete control, to avoid an ambiguous "which note do I change" case. Below each bullet, a small line now shows the date it was added plus where it came from: a clickable "Added through: {event name}" button (from the source note's `moment_id`, navigating straight to that event) when it was tied to a moment, or plain "Added through this person's profile" text when it wasn't. Editing or deleting refreshes both the notes list and the Key Facts extraction immediately. Build passes; **`person-facts` needs a manual REdeploy** for this change to take effect (see Section 10) — until then, the live function simply won't return `note_ids` at all, and the frontend defaults that to an empty list rather than crashing, so existing Key Facts bullets keep working exactly as before (just without edit/delete/source info) in the meantime. Click-tested end-to-end via a disposable test account: since the deployed extraction function couldn't be exercised directly in this session (same redeploy-pending situation), the extraction response was substituted with a fixed test payload (referencing real notes/a real event created in the test account) to verify the frontend half in isolation — confirmed hovering reveals both icons without flicker, editing a bullet rewrote the correct underlying note (visible in the notes list below), deleting a duplicate bullet removed its note from the database, the event-sourced bullet showed a working "Added through: {event}" button, the profile-only bullets showed the plain text instead, and a fact with no `note_ids` (simulating the still-live old function) rendered normally with no edit/delete controls and no crash.
- **Unified Home conversation** (the main current interface): a persistent chat thread, not one-shot search, that can:
  - Answer broad questions about a person ("tell me about Steve") by synthesizing across ALL their notes/moments
  - Answer narrow questions about a specific event
  - Gracefully handle "nothing found" by suggesting close matches or asking a clarifying question, rather than dead-ending
  - Correctly reason about relative dates ("last summer") using the moment's actual recorded date + today's date, so it can answer things like "how many years ago"
  - Capture a brand-new memory conversationally, mid-thread
  - Update/add detail to an already-recorded moment
  - Rename a placeholder person (e.g. "Clare's mom") to a real name once given, rather than creating a duplicate
  - Recognize and apply last-name corrections
  - **Recognize and create/tag Groups conversationally — actually implemented and click-tested working 2026-07-15** (see the important caveat right below this list; this had been described in this doc for a while as if built, but wasn't). A GROUP means a recurring, ongoing affiliation the user was part of over time — a school/academy, sports team, military unit, workplace, or friend circle — NOT a one-off event or a single location mention. Two distinct signals: (1) if the story itself is framed around one of these affiliations (e.g. "my time at the Air Force Academy," "my 5th grade Pop Warner team"), the MOMENT gets tagged to that group; (2) if the user explicitly says a specific person shares that same affiliation (e.g. "he was on my Pop Warner team too"), that PERSON gets tagged as a member of the group. A brand-new group is created automatically the first time it's mentioned; later mentions reuse the existing one by matching name/phrasing.
  - Show clickable chips for every person mentioned by name in a reply (not just the main subject), which navigate to that person's profile
  - **Now also shows a clickable event chip whenever a reply is tied to a moment** (built 2026-07-17). `converse` had always returned a `momentId` in its response, but `Home.tsx` only ever rendered the `people` chips it also returns, silently dropping the event side — so capturing a brand-new memory showed who was created but gave no way to jump straight to the event itself. Fixed on the frontend only (no Edge Function change needed, since `momentId` was already there): when a reply includes a `momentId`, `Home.tsx` does one extra lookup of that moment's `occasion`/`raw_description` to build a label via the existing `summarize()` helper, and renders it as the same blue `EventChip` (`components/Chips.tsx`) used everywhere else in the app, alongside the person chips. Clicking it pushes the event onto `App.tsx`'s breadcrumb stack like any other `EventChip`. Shows up any time a reply is tied to a moment (new capture or adding detail to an existing one), not just brand-new captures. Build passes; not click-tested inside the logged-in app by the assistant (same login-requires-a-password limitation as elsewhere in this doc).
  - **Now also shows a clickable group chip whenever a reply tags or creates a group** (built 2026-07-17, requested by the founder to match the existing person/event chip treatment). Unlike the event chip above, this needed an Edge Function change: `converse` already tagged groups via `moment_groups`/`person_group_tags` each turn but never reported which group(s) that touched back to the caller. It now collects every group ID/name touched that turn (deduping by group ID, since a single turn could both tag a moment to a group and tag a person into it) into a `groups` array in its response. `Home.tsx` renders these as the same gold `GroupChip` (`components/Chips.tsx`) used everywhere else, alongside the person and event chips, and clicking one pushes the group onto `App.tsx`'s breadcrumb stack the same way `Groups.tsx`/`GroupDetail.tsx` already do. `App.tsx` now passes an `onSelectGroup` prop into `<Home>` (it previously only passed `onSelectPerson`/`onSelectEvent`). Build passes; regression-tested live (a normal Home conversation still sends/receives fine against the still-old-deployed `converse`, which simply omits the new `groups` field — no crash). **The chip itself can't appear until deployed** — same one-step pattern as other Edge Function changes: paste `supabase/functions/converse/index.ts` into the Supabase dashboard and deploy it, then worth the founder trying a story that clearly names a recurring affiliation (e.g. "back when I played on my Pop Warner team") to confirm the group chip shows up alongside the usual person/event chips.
- Groups page: lists groups and members (read-only view; groups are created via conversation, not a manual form). Confirmed working end-to-end 2026-07-15, including actually receiving real group tags from Home conversation (see above). **2026-07-17: each group's name is now the clickable element itself (matching the Event tile pattern in `Events.tsx`), instead of a separate "View events →" link below the title** — same visual/UX language, one less redundant control per tile.
- **`converse`'s brand-new-moment capture had the same "who was there" gap as `update-moment`, just discovered later** (fixed 2026-07-17). The founder noticed Matt Speisbach was clearly named in an event's AI-written summary but missing from "Who was there" on the same page. Root cause was identical to the `update-moment` bug fixed earlier that day: `converse`'s prompt never explicitly required a linking note for a bare "so-and-so was there too" mention during initial capture, so the person (or their mention) could end up in `raw_description`/the generated summary without ever getting a `notes` row tied to the moment — and "Who was there" is driven entirely by that `notes` link, not by anything in the summary text. Deliberately did NOT fix this by having "Who was there" also scan/parse the AI summary text for names (that would be a second, much less reliable name-matching path alongside the one that already exists — free-text name extraction risks exactly the duplicate/misattached-person bugs this doc already has several entries about). Fixed at the source instead, the same way as `update-moment`: `converse`'s prompt now explicitly requires a `notes` entry (even a bare "Was there.") for anyone mentioned as present. This prevents it going forward; it does NOT retroactively fix any already-recorded event with this gap — for those, the fix is to just re-mention the missing person in that event's own "Remember something else?" chat once `update-moment`'s own equivalent fix is deployed.
- **Event detail page gained an "Affiliated Groups" heading and event-side group tagging** (built 2026-07-17). The group chip row already existed on `EventDetail.tsx` (populated from `moment_groups`) but had no heading, unlike every other section on the page — now reads "Affiliated Groups" when the event has at least one tagged group (same `styles.subheading` used by "Who was there"/"Notes"; still hidden entirely when there are none, matching how "Who was there" already behaves). More substantially, tagging a group to an event previously required going to the GROUP's own page and using its "Edit this group" chat (`UpdateGroupChat.tsx`) to add this event by name — there was no way to do it from the event's own side. `update-moment` gained an `add_groups` field (mirroring `converse`'s existing `moment_groups`/`findOrCreateGroupId` reuse-or-create logic) so saying something like "tag this under my High School Friends" directly in the event's own chat now tags it immediately — reuses an existing group by name if it clearly matches one already on file, creates a new one otherwise, and clears that group's cached `summary` so it regenerates to include this event. Deliberately does NOT auto-infer a group tag just from event content/attendees on its own (e.g. noticing "lots of these guests are from high school") without the user saying so — that would risk the same over-eager group-creation the app's group philosophy has always guarded against (see Section 11), so it only acts on an explicit tagging instruction in the conversation, asking a clarifying question first if the signal is only implied. Build passes; **not yet live** — same paste-into-Supabase-dashboard-and-Deploy step as the other `update-moment`/`converse` changes today; not click-tested by the assistant (login limitation, see elsewhere in this doc).
- Events page: browsable list of all moments, with attendees (clickable, jump to profile) and group tags, independent of any one person. Confirmed working end-to-end (click-tested) 2026-07-15.
- Both Events and Groups are now reachable from the main nav bar (Home / People / Events / Groups) — the standalone "Add a Moment" tab was removed since Home's conversation already covers that capture flow.
- **Unified Person/Group/Event cross-navigation with a real breadcrumb trail** (built 2026-07-15, extended same day). `App.tsx` holds a single generic navigation stack (`navStack: Crumb[]`, each crumb `{type: 'person'|'group'|'event', id, label}`) instead of separate ad-hoc "viewing X" state per entity — this replaced an earlier same-day version that only supported Groups→Events drill-down. Any page can push a person, group, or event onto the stack and the right detail page renders based on the top of the stack; clicking a `Breadcrumb.tsx` segment jumps back to that point in the stack, and each detail page also has its own single-step "← Back to {parent}" button. This makes navigation symmetric in every direction: from Groups → clicking a group's name opens `GroupDetail.tsx`, whose event tiles show a short summary + "See more →" → an event's full detail (`EventDetail.tsx`); from Events → a color-coded group chip on any event card jumps straight to that group, or the event title opens its detail; from a person's profile (`PersonDetail.tsx`, reachable from People, Home, or any chip elsewhere) → a limited (5-max, "+N more") row of that person's affiliated group and event chips. Chip styling is now centralized in `components/Chips.tsx` (`PersonChip` = green pill, `GroupChip` = gold badge with a dot, `EventChip` = blue italic card with a `›`) so the same visual language — color plus shape, not just color — marks what kind of thing a chip links to everywhere it appears. `People.tsx` previously rendered its own disconnected local `PersonDetail` overlay that bypassed all of this; it now goes through the same `onSelectPerson` prop as every other page. Click-tested end-to-end across all directions.
- **Event detail now has a conversational "add more detail" section**, reusing the existing `UpdateMomentChat.tsx` component (previously only reachable from `PersonDetail.tsx`'s fact bar) inside `EventDetail.tsx`, below the existing notes list. Saving refreshes the event's notes in place. Building this surfaced a real bug — see Section 9, the `UpdateMomentChat` JSON-fence bug — now fixed.
- **Rename an Event or Group directly from its detail page** (built 2026-07-15) — a small pencil-icon button (`components/EditButton.tsx`, shared between both pages) sits just to the right of the heading in `EventDetail.tsx` and `GroupDetail.tsx`; clicking it swaps the heading for an inline text input with Save/Cancel. This is the first manual (non-conversational) rename control in the app — everywhere else, names are only ever set/corrected by talking to Home. Saving an Event updates `moments.occasion` directly (blank clears it back to the "Untitled moment" fallback used everywhere else); saving a Group updates `groups.name` (must be non-empty). Both call straight through the Supabase client from the component — no Edge Function involved, since no AI classification is needed for a direct rename. `App.tsx`'s `navStack`/breadcrumb caches each crumb's label at the time it was pushed, so a `renameCurrentCrumb` helper in `App.tsx` (passed down as an `onRenamed` prop) patches the current crumb's label in place after a successful save, keeping the breadcrumb trail in sync without a full reload. The Events/Groups list pages and any other page that shows the old name self-correct next time they mount, since they always refetch on load. Click-tested end-to-end (including confirming the rename persists after navigating away and back).
- Demo/seed data: a fictional persona "John & Jane Doe" (61-year-old retired Air Force veteran in Colorado Springs) with ~18 people, ~22 moments, and 90+ notes, seeded via direct SQL for demo/testing purposes (SQL files were generated and handed off, not run by the assistant directly — the user runs them in the Supabase SQL Editor)
- **Voice input on every conversational text box** (built 2026-07-16, UX fixed same day after founder testing): a mic button (`VoiceInputButton.tsx`) next to the input on Home's main chat, the Event-detail "add more detail" chat (`UpdateMomentChat.tsx`), and the person profile's one-line fact bar. Press to record; a speech bubble above the button shows a live "Listening… 0:0X — tap the mic again when you're done" state (with a pulsing dot) so it's unambiguous the app is recording and what to do next, then "Turning that into words…" while transcribing. The recording is sent to the `transcribe` Edge Function (OpenAI Whisper), and the transcribed text is dropped into the text box for the user to review/edit before pressing Send — it does not auto-send. Deliberately NOT the free browser Web Speech API originally planned, because that API's speech-recognition half has no support at all in iPhone Safari, and the founder's stated end goal is an iPhone app — see Section 8 for the reasoning.
  - **First real-world test (2026-07-16) surfaced two problems, both since fixed:** (1) the button gave no feedback about what state it was in or what to do next (just a color change) — fixed with the speech-bubble status described above; (2) transcription failed every single time with no visible error. Root cause, found by directly calling the deployed `transcribe` function with a synthetic audio clip and reading OpenAI's own error text: the `OPENAI_API_KEY` secret had never actually been added in Supabase (adding OpenAI billing alone didn't fix it — the key itself was the missing piece). **Fixed** once the founder added the secret under Supabase dashboard → **Edge Functions → Secrets** (a project-wide secrets list, not something attached to the individual function — worth remembering, since that's the part that was easy to miss). Confirmed working end-to-end via a direct test call (real `200` response with real transcribed text back from OpenAI) same day. Errors are also now shown to the user as an actual on-screen message instead of silently resetting, for if this or a similar failure ever recurs.
  - **Known gap, not addressed yet:** the founder's stated expectation was live, word-by-word captions while speaking, like some other voice assistants — not currently possible with this batch-style Whisper approach (transcription only happens after you stop recording). A live-captions assist could be added later using the free Web Speech API purely as an on-screen visual aid (not the saved text) on browsers that support it — but that's Chrome/Android/desktop only, not iPhone Safari, so it would be a partial improvement, not a fix everywhere. Not built; flagged here as a possible follow-up, not started.
  - **Still not click-tested inside the actual app UI, by anyone, as of this writing** — the backend fix was confirmed working via a direct call to the Edge Function (real transcribed text came back), but not yet by actually clicking the mic button in the live app post-fix. The assistant can't do this itself (requires logging in, which it can't do without entering a password); worth the founder giving it one more try in the app to confirm the full loop end-to-end.
- **Text boxes grow downward instead of cutting text off** (built 2026-07-16): the same three text-entry points as voice input (Home's main chat, the Event-detail "add more detail" chat, and the person profile's fact bar) now use `AutoGrowTextarea.tsx` instead of a single-line `<input>`. As you type a long message, the box grows taller (wrapping text onto new lines) instead of scrolling sideways and hiding what you've already typed, up to a 160px-tall cap, then it scrolls internally. Enter still sends, same as before; Shift+Enter now also inserts a manual line break, which wasn't previously possible with a single-line input. The component's grow logic was verified directly (isolated test: box grew from ~40px to 119px as text was typed) after the founder initially reported it not working — that turned out to be a deploy pipeline problem (see Section 9's Vercel-GitHub outage incident), not a bug in this component. Confirmed live in production 2026-07-16 by fetching the deployed bundle directly and checking it contains this code. Still not click-tested inside the actual logged-in app by the assistant (same login limitation as voice input) — worth the founder giving it a look now that it's actually live.
- **Events page now sorted by when things actually happened, not when they were recorded, with a consistent date format** (built 2026-07-16). Added a nullable `moments.event_date` column (real `date`, see Section 5). When `converse` captures a brand-new moment, it now also resolves a best-guess actual calendar date from the user's own words (e.g. "last week," "May of 2027," "back in college") plus today's date and conversation context, and saves it alongside the existing free-text `when_text` (which is untouched and still shown on Event detail). The top-level Events page and `GroupDetail.tsx`'s event list both sort newest-to-oldest by `event_date`, falling back to `created_at` when it's null (true for everything recorded before this change), and both display a uniform "Month Year" (e.g. "November 2027") instead of the previously inconsistent raw `when_text`/date mix. This was an explicit, deliberate exception to the "when_text is intentionally free-text, don't add rigid date columns" principle in Section 11 — checked in with the founder first; the founder wanted the AI to actively reason out real dates from spoken-style relative phrases ("she'll say 'last week,' the AI needs to figure out the actual date from today's date"), not just leave dates unstructured. `event_date` is a best-effort AI guess, not user-verified ground truth — it's used only for sorting/display, and the existing when_text-vs-created_at date reasoning `converse` uses to answer questions was left as-is (see Section 8). Click-tested end-to-end, including a live "last week" phrase resolving to the correct date and sorting into the right chronological position.
- **Group tiles on the Groups page now show color-coded event chips, matching the People tile convention** (built 2026-07-16). `Groups.tsx`'s query was extended to pull each group's tagged moments (via `moment_groups(moments(id, occasion, raw_description, ...))`, same join used by `GroupDetail.tsx`), and each tile now renders a row of blue `EventChip`s (from `components/Chips.tsx`) underneath the existing person chips, capped at 4 with a "+N more" overflow — the exact pattern `People.tsx`'s `PersonCard` already used for its own event chips. Clicking a chip pushes that event onto `App.tsx`'s breadcrumb stack, same as every other `EventChip` in the app. Build passes; **not click-tested inside the logged-in app by the assistant** (same login-requires-a-password limitation noted elsewhere in this doc, e.g. voice input) — worth the founder confirming visually in the app.
- **Fixed: a group's member chips on the Groups page only showed people explicitly tagged via `person_groups`, missing people the AI already considered part of the group when answering chat questions** (fixed 2026-07-16). Root cause: two independent things both look like "who's in this group" but aren't the same query. `person_groups` rows only get written when the user explicitly states someone belongs to the group (e.g. "she was on my Pop Warner team too" — see the `converse` system prompt in Section 5/8). But the `converse` chat answer for "tell me about X group" also pulls in anyone mentioned in the notes of any moment tagged to that group via `moment_groups`, which is a much looser bar — so someone could show up in a chat answer without ever getting a `person_groups` row. This is why the founder saw "Caroline Volin" as the only member chip on the Volin Family tile, while asking the chat "tell me about the Volin Family" also surfaced Faith and Josh. **Decided with the founder:** the member chip list should match what the chat already shows, not the stricter definition. `Groups.tsx` now unions both sources — explicit `person_groups` members plus everyone appearing in `notes.people` across that group's tagged moments — deduped by person ID. No schema change; `person_groups` itself is untouched (still written the same explicit way), this only changed what the Groups page *displays*. Build passes; not click-tested inside the logged-in app by the assistant (same login limitation as above) — worth the founder confirming the Volin Family tile now shows Caroline, Faith, and Josh.
- **`GroupDetail.tsx`'s event tiles now match the single-Event-page format and field order** (built 2026-07-16, from a founder-annotated screenshot of `EventDetail.tsx` numbering the desired order). Each tile in a group's event list previously showed just a bare summary line, meta, and a "See more →" link; it now shows, top to bottom: clickable title, meta (date/location), the event's own group chip(s), the full description, and a "Who was there" row of attendee chips — the same fields in the same order as the Event detail page, minus the Notes list and the "add more detail" chat box (page-only content, not appropriate for a list tile). Required extending `GroupDetail.tsx`'s Supabase query to also pull `notes(people(...))` and `moment_groups(groups(...))` (previously only fetched for the `!inner` filter join), and threading `onSelectPerson`/`onSelectGroup` down from `App.tsx` so the new chips are clickable. Build passes; not click-tested inside the logged-in app by the assistant (same login-requires-a-password limitation noted elsewhere in this doc) — worth the founder confirming a group with tagged events looks right.
- **Groups now show an AI-generated one-sentence summary of what the group actually is** (built 2026-07-16). Follow-up to the tile-formatting change above: the founder noticed the Groups list tile had no description of the *group* itself (only a name, member chips, and a scattering of event summaries used as filler), and wanted a real high-level description instead — explicitly **not** something typed in manually, but generated from the group's own members and tagged events, the same "figure it out from context" philosophy `converse` already uses everywhere else. New nullable `groups.summary` column (schema change; the founder ran the `ALTER TABLE` themselves in the SQL Editor, and deployed the new `summarize-group` Edge Function by pasting it into the dashboard — same paste-it-yourself pattern used for `transcribe`, since this session had no Supabase access token). `summarize-group` gathers the group's members (union of explicit `person_groups` rows and everyone appearing in notes on its tagged moments, same union logic `Groups.tsx` already uses for member chips) plus its tagged events' occasions, and asks Claude for a single ≤20-word sentence, which is cached back into `groups.summary` so it's only generated once per group, not on every page view. Both `Groups.tsx` and `GroupDetail.tsx` call it lazily the first time they render a group with no summary yet, showing a "Figuring out what this group is about…" placeholder in the meantime. Build passes; the deployed function was sanity-checked directly (unauthenticated POST returned `401`, confirming it exists and is live, not a `404`), but the actual generated text has **not** been click-tested inside the logged-in app by the assistant (same login-requires-a-password limitation as elsewhere in this doc) — worth the founder opening the Groups page to confirm real summaries appear (not just the placeholder) and read sensibly.

- **Events now show an AI-generated readable summary instead of the raw captured text** (built 2026-07-16). The founder flagged that `EventDetail.tsx` and `GroupDetail.tsx`'s event tiles were both directly displaying `moments.raw_description` verbatim — literally the user's own words concatenated across a multi-turn capture conversation (e.g. the Lorenzo's wedding event), which reads disjointed/awkward rather than as a proper summary, unlike Groups which already got a real AI summary the day before (see below). New nullable `moments.summary` column (schema change, same paste-it-yourself pattern as `groups.summary` — see Section 10) plus a new `summarize-moment` Edge Function that takes the event's title/when/where/details/raw_description/notes and rewrites them into a short (2-4 sentence) first-person narrative, cached back into `moments.summary` so it's only generated once per event. `EventDetail.tsx` generates+displays it lazily on first view (same pattern `GroupDetail.tsx` already used for group summaries); `GroupDetail.tsx`'s event-tile list does the same per-tile. Saving a new note via `UpdateMomentChat` (the "Remember something else?" box) now also clears the cached summary first so it regenerates with the new detail included. Other places that reference `raw_description` (`Events.tsx`, `Groups.tsx`, `People.tsx`, `PersonDetail.tsx`) were left as-is — they only ever used it for a short truncated title/chip label via `summarize()`, not a full-paragraph display, so they weren't part of the reported problem. Build passes; **not yet live** — see Section 10, needs the founder to run one SQL statement and paste/deploy one Edge Function, same two-step process as `summarize-group` was rolled out.

- **Groups can now be edited through a conversation, not just the name-only pencil control** (built 2026-07-16). `GroupDetail.tsx` gained an "Edit this group" chat box at the bottom (`UpdateGroupChat.tsx`), the same multi-turn pattern as Event detail's `UpdateMomentChat.tsx`: the user types (or speaks) a request, the AI asks a short follow-up ("Anything else you'd like to change?") to collect everything in one pass, then applies all of it at once. The founder explicitly chose full scope here — members, events, and rename, not just a subset — matching the app's general "talk to it, don't fill out a form" philosophy. The new `update-group` Edge Function gives the AI the group's current members (same explicit-`person_groups`-plus-note-mentions union used elsewhere), its currently-tagged events, and every other event in the app tagged with `[MOMENT_ID: ...]` (the same technique `search.ts` uses) so it can reference an *existing* event precisely instead of fuzzy-matching text; it responds with `{done, rename, add_people, remove_people, add_event_ids, remove_event_ids}`. The client applies each piece directly via the Supabase client (creating new people if a named person doesn't exist yet, same as `UpdateMomentChat.tsx` already does), then clears and regenerates the group's cached `summary` (see the AI-summary feature above) since membership/events just changed, before refreshing the page. This resolves the "no in-app way to remove a person from a group" gap previously listed in Section 10 — it's no longer Table-Editor-only, though removal by name still depends on the AI matching the name correctly rather than a manual dropdown/list UI. Build passes; the deployed function was sanity-checked directly (unauthenticated POST returned `401`, not `404`), but not click-tested inside the logged-in app by the assistant (same login limitation as elsewhere in this doc) — worth the founder trying a real edit (e.g. "add so-and-so to this group") to confirm the full loop, especially that removed/added members actually show up correctly on the Groups list tile afterward.
  - **`update-group` gained the same fixes as `update-moment`, ported over 2026-07-17**: it now saves whatever's new (renames, member/event changes) immediately after every single turn, server-side, instead of only on the AI's final "done" turn (same non-reply-loses-data problem, same fix — "done" is now purely a "stop asking follow-ups" signal); it checks for an authenticated `user` up front and fails loudly instead of silently no-op'ing under RLS; and it uses the same unique-first-name-else-full-name matching to avoid misattaching an edit to the wrong same-named person. `UpdateGroupChat.tsx` was simplified to match (no more client-side Supabase writes or reply-text JSON parsing — it just displays `reply` and calls `onSaved()` when the function reports `changed: true`). `GroupDetail.tsx`'s own refresh after a chat turn is now silent (`loadMoments(true)`) so it doesn't flash the whole page to "Loading…" and unmount the in-progress chat mid-conversation, same reasoning as `EventDetail.tsx`'s equivalent fix. Build passes; the new "Who's in this group" section was click-tested directly (via a disposable test account, since email confirmation is off — see Section 10) and confirmed rendering correctly. **`update-group` is now deployed and confirmed working end-to-end 2026-07-17**, via a repeat of the exact original repro (via the same disposable test account): typed "Add my aunt Carol and uncle Steve to this group too," the group's own page showed both new members in "Who's in this group" before ever answering the AI's "anything else?" follow-up, and they were still there after navigating away to Groups and back — confirming the per-turn autosave fix actually resolves the founder's original report.
  - **`GroupDetail.tsx` gained a "Who's in this group" members section, matching what the Groups list page already showed per-tile** (also 2026-07-17). The single-group detail page previously showed the group's tagged events but never its own member roster at all — an inconsistency with `Groups.tsx`, which already unions explicit `person_groups` membership with everyone appearing in notes on the group's tagged moments (see the "Fixed: a group's member chips…" entry above). `GroupDetail.tsx` now does the same union and renders it as a `PersonChip` row right under the group's AI summary.
- **Event detail page formatting cleanup** (built 2026-07-16). Three changes to `EventDetail.tsx`/`UpdateMomentChat.tsx`: (1) the Notes list (the raw per-note entries below "Who was there") is now collapsed by default behind a "▸ Show notes"/"▾ Hide notes" toggle, with a fixed italic hint explaining what it's for ("These are the individual details you shared for this memory — exactly what fed the summary above") — the founder felt the raw notes took up a lot of room and added little once the AI summary existed above them. (2) The location line (e.g. "Buena Vista") is now a blue, underlined link that opens a Google Maps search in a new tab; the map query always appends ", CO" to the raw location text (not shown in the link's visible label) since this app's locations are overwhelmingly Colorado-area for this founder — a hardcoded assumption specific to this single-user app, not a general geocoding solution. (3) `UpdateMomentChat.tsx`'s input row (textarea/mic/Send) is now `position: fixed` to the bottom of the viewport instead of sitting inline after the message list, so it stays on-screen while scrolling a long event page — confirmed there's no transformed/scroll-contained ancestor in `App.tsx`/`main.tsx` that would break fixed positioning. **First round of founder testing (same day) reported neither the toggle nor the sticky bar showing up** — turned out to be a false alarm: the change had only been built locally and not yet pushed, so the founder was still looking at the old deployed version; not an actual bug in the code. Build passes; not click-tested inside the logged-in app by the assistant (same login-requires-a-password limitation as elsewhere in this doc) — worth the founder reloading the live app (hard-refresh if needed) to confirm all three now show up correctly.
  - **The same floating/sticky input bar was extended to the Group and Person pages** (built 2026-07-17). `UpdateGroupChat.tsx`'s input row now uses the identical `position: fixed` wrapper as `UpdateMomentChat.tsx` (same styles, copy-pasted intentionally rather than extracted into a shared component, matching this codebase's existing per-page style pattern), and `GroupDetail.tsx` got the same bottom page padding so it doesn't get covered. `PersonDetail.tsx`'s "Add a fact" bar isn't a separate chat component like the other two (it's a single-shot form, not a multi-turn conversation), so the same fixed wrapper was applied directly around that inline `<form>` instead; the `groupTagMessage`/`suggestedGroup` banners below it had their negative `marginTop` (previously compensating for the form's `marginBottom` in normal document flow) removed, since a `position: fixed` element no longer occupies space in that flow. Frontend-only change (no Edge Function involved) — live as soon as this push deploys, no separate paste-and-deploy step needed. Not click-tested by the assistant (login limitation, see elsewhere in this doc).

- **Reversed 2026-07-17: group "membership" no longer unions in event attendees — it's the explicit `person_groups` roster only.** The founder reported that "Wings of Blue" (a friend group) had picked up a bunch of Volin family members it shouldn't have, because those family members attended a shared event (the founder's wedding) that was tagged to both groups. Root cause: the "Fixed: a group's member chips…" union decided on 2026-07-16 (see above) — anyone in the notes of *any* moment tagged to a group counted as a "member" — breaks down whenever the same moment is tagged to more than one group, since `moment_groups` allows that by design. Attending one group's event doesn't mean you belong to every other group that event happens to also be tagged to. **Decided with the founder:** membership goes back to meaning only "explicitly added to this group" (`person_groups`), full stop, in all four places that had adopted the union — `Groups.tsx`, `GroupDetail.tsx`, `summarize-group`, and `update-group`. To avoid losing the visibility the 2026-07-16 change was trying to give, event-only attendees (people who show up in a tagged event's notes but were never explicitly added) are still shown, but in a clearly separate, distinctly-styled ("Also seen at this group's events", dashed chip border) section — never merged into the actual member list, and not fed to the AI as "members" in `summarize-group`/`update-group` anymore. (**Note:** this section was later removed from `Groups.tsx` specifically — see the later-same-day entry below — and now lives only on `GroupDetail.tsx`.) Build passes; not click-tested inside the logged-in app by the assistant (same login-requires-a-password limitation noted elsewhere in this doc) — worth the founder confirming the Wings of Blue tile now shows only its real members, with the Volin family (if not explicitly added) appearing under "Also seen at this group's events" instead.
  - **`GroupDetail.tsx` follow-up, same day: the "Also seen at this group's events" chips and member chips are now actionable, not just labels.** Clicking a name under "Also seen at this group's events" now directly adds that person to the group (`person_groups` upsert) instead of navigating to their profile — the founder wanted a one-tap way to promote an event attendee into a real member, right from this new section. Separately, hovering a mouse over a chip under "Who's in this group" now fades it slightly and swaps in a trash icon; clicking while hovered removes that person from the group (`person_groups` delete). Both actions clear the cached `groups.summary` and let it regenerate, same as any other membership change. This is a direct client-side Supabase write (no Edge Function involved), so it deploys fully via the normal `git push` → Vercel flow, unlike the fix above. Hover-to-reveal is mouse-only by design (matches how the founder described the interaction) — on a touchscreen these chips still just navigate to the profile, same as before. Build passes; not click-tested inside the logged-in app by the assistant (same login limitation as elsewhere in this doc).
    - **Bug fix, next day (2026-07-17): the hover-to-remove member chip vibrated/flickered uncontrollably and couldn't actually be used.** Root cause: hovering swapped the chip's rendered content from the person's full name to a small icon, which shrank the button's width — pulling it out from under the stationary cursor, which fired `mouseleave`, which put the longer name back, which put the cursor back inside the button, which fired `mouseenter` again, looping as fast as the browser could repaint. **First fix attempt** kept the name always rendered underneath at reduced opacity with the trash icon as an absolutely-positioned overlay on top — this did stop the flicker, but broke clicking through to the person's profile, since hovering still swapped the chip's own `onClick` from "go to profile" to "remove," same as before.
    - **Superseded, same day: member chips now match `SuggestionChip`'s already-working pattern exactly**, instead of being their own hover-swap variant. The chip itself is now a plain, always-clickable name that goes to the person's profile, full stop — hovering never changes what clicking the name does. A separate small trash badge appears in the corner on hover (a sibling element, not a change to the main chip), and clicking *that* is the only way to remove someone from the group. This is the same wrapper-plus-corner-badge structure `SuggestionChip`'s "×" already used successfully, so member removal now has the same discoverability and the same flicker-proof behavior (nothing resizes on hover) with none of the "which action does a click do right now" ambiguity the two earlier versions had. Build passes; not click-tested inside the logged-in app by the assistant (same login limitation as elsewhere in this doc) — worth the founder confirming both that hovering no longer flickers AND that clicking a member's name now correctly opens their profile.
    - **"Deny a suggestion" added (2026-07-17), same session as the flicker fix.** The founder wanted a way to permanently tell the app "don't suggest this person for this group again" for someone who showed up under "Also seen at this group's events" but doesn't actually belong — distinct from adding them. **Checked in with the founder first** on whether a denial should persist across visits (requiring a small schema change) or just hide for the current view (no schema change, but the person reappears on reload); the founder chose persistence. New `groups.dismissed_person_ids` jsonb column (see Section 5) stores an array of denied person IDs per group — reuses the `groups` table's existing RLS rather than standing up a new join table with its own policies. `GroupDetail.tsx`'s suggestion chips now show a small "×" badge in the corner on hover (a separate absolutely-positioned element, not a content swap, so it doesn't have the same flicker risk as the member-chip bug above); clicking it appends the person's ID to `dismissed_person_ids` and the chip disappears immediately, permanently excluded from that group's future suggestion list. This is a schema change requiring a manual one-time step — see Section 10.
  - **`Groups.tsx` (the top-level list page) intentionally diverged from `GroupDetail.tsx`, later the same day (2026-07-17).** The founder wanted the Groups list to stay a lightweight overview, not a place to manage membership: (1) member chips per tile are now capped at 5 (`MEMBER_LIMIT`), collapsing any rest into a "+N more" text, matching the existing pattern already used for that tile's event chips (`AFFILIATION_LIMIT`) — a group with a large roster (e.g. an extended family) can no longer dominate the whole page; the full roster is still visible by clicking into the group. (2) The "Also seen at this group's events" suggestion section (added earlier the same day, see above) was removed from `Groups.tsx` entirely — the founder explicitly didn't want the ability to add/remove group members from the list-tile level, only from a group's own detail page. `GroupDetail.tsx` is unaffected and keeps the full suggestion/approve/deny/remove-member UI described above; `Groups.tsx`'s query was also trimmed to stop fetching `notes(people(...))` on tagged moments, since nothing on this page needs it anymore. Build passes; not click-tested inside the logged-in app by the assistant (same login limitation as elsewhere in this doc).

- **Event detail page now suggests other members of an affiliated group as one-tap additions to "Who was there"** (built 2026-07-16). When a moment has one or more `moment_groups` tagged, `EventDetail.tsx`'s query was extended to also pull each group's roster (`moment_groups(groups(id, name, person_groups(people(id, name, last_name))))`). Any group member who isn't already an attendee (i.e. has no note tied to this moment) now shows up as a dashed "+ Name" chip under a new "Also from the affiliated group?" section. Clicking one inserts a trivial `notes` row (`content: "Was there."`, same convention `update-moment` already uses for a bare "so-and-so was there too" mention) directly from the client, then re-runs the same silent-refresh-and-invalidate-summary path as the "Remember something else?" chat (`handleNoteSaved`), so the person moves into "Who was there" and the AI summary regenerates to include them. Only suggests from `person_groups` (explicit membership), not the looser "anyone mentioned in a group's notes" union some other pages use, since the latter would suggest people already tied to *some* event, which is noisier for this specific "who else was probably at this one" use case. Click-tested end-to-end via a disposable test account (email confirmation is off, same pattern as other click-tests in this doc): created a "Book Club" group with Carol and Steve, logged a moment mentioning only Carol, confirmed Steve appeared as a "+ Steve" suggestion chip, clicked it, and confirmed he moved into "Who was there" and the summary updated to mention him by name.
  - **Follow-up (2026-07-17): both "Who was there" and "Also from the affiliated group?" got the same hover-badge treatment as `GroupDetail.tsx`'s member/suggestion chips, for consistency.** Requested by the founder specifically so an event page's chips behave the same way a group page's already do. "Who was there" chips (`AttendeeChip`) now always navigate to the profile on click; hovering reveals a small trash badge in the corner that untags them from the event. "Also from the affiliated group?" chips (`SuggestedAttendeeChip`) keep clicking-to-add as before, plus a hover-revealed "×" badge to permanently deny that person as a suggestion for this specific event (new `moments.dismissed_person_ids` jsonb column, same pattern as `groups.dismissed_person_ids` — see Section 5; requires a manual one-time SQL step, see Section 10). **Important distinction the founder specifically asked to preserve, since "Who was there" has no separate membership flag the way group membership does — attendance is 100% derived from whether a note's `moment_id` points at this event:** untagging someone via the trash badge does NOT delete their notes. It sets `moment_id` to `null` on their note(s) for this event (the same "standalone fact" state `notes.moment_id` already supports for manually-added facts), so any real content they wrote stays fully intact and visible on their own profile — it just no longer counts toward this event's attendee list. Deliberately checked in with the founder on this before building, after an earlier phrasing of the tradeoff caused confusion; the founder was explicit that this must be a non-destructive tagging operation, not a delete. Build passes; not click-tested inside the logged-in app by the assistant (same login limitation as elsewhere in this doc).
  - **"Remove all suggestions" bulk-deny added (2026-07-17), both `GroupDetail.tsx` and `EventDetail.tsx`.** The founder found clicking each suggested person one at a time cumbersome once a group/event had several. A small "× Remove all suggestions" text button now appears next to the suggestion section's own heading (only when there's more than one suggestion to clear) — clicking it adds every currently-shown suggested person's ID to that group's/event's `dismissed_person_ids` in one write, same column and same "just suppresses the suggestion chip" semantics as denying one person individually; the per-person "×"/hover-deny is untouched and still works standalone. **Confirmed by design, not just by assumption:** denying (individually or in bulk) does NOT block adding that person later through a conversational chat — `converse`, `update-group`, and `update-moment` all write directly to `person_groups`/`notes` and never read `dismissed_person_ids` at all, so a denied suggestion can still be explicitly re-added by name in a normal conversation; `dismissed_person_ids` only ever filters which candidates get computed into the suggestion list in the first place. Build passes; not click-tested inside the logged-in app by the assistant (same login limitation as elsewhere in this doc).

- **Home now suggests what to share, before the user says anything** (built 2026-07-17, directly realizing the founder's own framing from Section 1: "want to take a trip down memory lane about this event?"). Before the first message of a session, `Home.tsx` shows up to 3 tappable suggestion cards above the chat box (e.g. "Take a second to share one of your favorite moments from your wedding!"), fetched once on mount from a new `suggest-prompts` Edge Function. That function pulls the user's recent moments (occasion/location/when_text, most recent 25), people, and groups, and asks Claude for 3 short, specific, second-person invitations — preferring to cite something concrete already on file over generic filler, and falling back to warm generic ice-breakers if the account has no moments yet or the AI call fails, so this row never renders broken or empty-looking. **Deliberately AI-generated, not client-side keyword templates** — checked in with the founder first (Section 11.2), who chose the AI-Edge-Function approach over a cheaper/simpler client-side template option specifically for warmer, more varied phrasing, consistent with how the rest of the app (`converse`, `summarize-group`) already works. Clicking a suggestion inserts it into the thread as an ASSISTANT bubble (not into the text input) — it's the app speaking, not something the user is being asked to say themselves — then the user types their own reply as the next turn; this matches the existing "text boxes fill, they don't auto-submit" convention (see `VoiceInputButton`) while treating the suggestion itself as the app's own proactive line, not the user's. Build passes. **Deployed by the founder 2026-07-17** — confirmed live via a direct unauthenticated check against the function endpoint (`401`, not `404`; an earlier deploy attempt the same day had actually failed, first caught by this same check returning `404`, then re-deployed and reconfirmed). **Click-tested end-to-end 2026-07-17** via a disposable test account (email confirmation is off, same pattern as other click-tests in this doc): logged in fresh, confirmed the 3 suggestion cards render, clicked one, and confirmed it dropped into the thread as the app's opening line with the cards disappearing — no console errors.
  - **Founder feedback same day: the AI call takes a beat, and with no loading indicator it looked like nothing was there** — before the cards appear, the space above the chat box was just blank, so it wasn't obvious anything was coming if you glanced away or tried to type immediately. **Fixed** by adding a `suggestionsLoading` state (starts `true`, flips to `false` once the `suggest-prompts` call settles either way) — while loading, a small spinning-circle icon plus "Finding a few things to ask about — give it a second before tapping away…" shows immediately in the same spot the cards will occupy, so there's instant feedback rather than a blank pause. The spin animation is a plain CSS `@keyframes` added to `index.css` (the only global stylesheet in this app) rather than a component library, consistent with this app having no icon/animation dependencies anywhere else.

- **People can now have nicknames/"goes by" names, and the app recognizes them in conversation** (built 2026-07-17, founder-requested — for people like grandparents, someone who goes by a middle name, or a nickname, so the user can talk about them by whatever name they'd naturally use instead of always having to know/use the person's formal recorded name). New `people.nicknames` column (see Section 5) holds a comma-separated list. `PersonDetail.tsx` originally gained a "Goes by" field in a fields grid alongside Last name/Birthday/Anniversary, using a click-to-edit `TextFieldCell` pattern — **that whole grid, including this field, was removed in the 2026-07-17 profile redesign** (see later in this section); nicknames can still be set via chat/the fact bar, just not through a dedicated on-page editor for now. `add-fact`'s classifier also learned to recognize a stated nickname from typed text (e.g. "He goes by Bob," "Everyone calls her Gigi") as part of its existing `name_update` type — new nicknames are appended to whatever's already on file (deduped case-insensitively), never overwriting. The People page's search box now matches nicknames too, alongside full name. Most importantly, every AI name-resolution function in the app — `converse`, `update-moment`, `add-fact` (spouse-name resolution), `person-facts` (spouse-name resolution), and `update-group` — now treats each person's nicknames as additional lookup keys alongside their first/full name, using the exact same "ambiguous name" collision guard already in place for shared first names (see the "two Bobs" bug in Section 9): a nickname only resolves automatically if it's unique across everyone on file, otherwise it's dropped from automatic matching and the AI is instructed to ask which person is meant. `converse`/`update-moment`/`update-group`'s system prompts now also show each person's nicknames in their roster text (e.g. "Joseph Smith (also goes by: Grandpa Joe)") so the AI is aware a nickname refers to an existing person rather than treating it as someone new. Build passes. **Not yet live** — needs the same two manual steps as other recent changes (see Section 10): one `ALTER TABLE` for the new column, and a redeploy of all five touched Edge Functions. Not click-tested inside the logged-in app by the assistant (same login-requires-a-password limitation noted throughout this doc) — worth the founder adding a nickname to someone (e.g. "Grandpa Joe" on Joseph Smith's profile) and then trying to reference them by that nickname in a Home conversation, once deployed.

- **Search boxes added to the People, Events, and Groups list pages** (built 2026-07-17). Each page gets a text box (new shared `components/SearchBox.tsx`, styled to match the existing text-input convention) right below the heading — only shown once the page actually has at least one item, so it doesn't clutter an empty list. Filtering is entirely client-side against data already loaded on the page (no new Edge Function or query), matched case-insensitively as a substring: People matches full name; Events matches title/location/AI summary/attendee names/tagged group names; Groups matches name/AI summary/member names. Each page shows a distinct "No one/No events/No groups match "X"" message when a search has zero results, separate from the existing "nothing here yet" empty state. Build passes; click-tested end-to-end in the browser preview (added two test people, confirmed a partial-name search narrowed to the matching one and a no-match query showed the correct empty state) — no console errors. **Note:** the click-test used the local dev server against the real production Supabase project (this app has no separate dev database), so it left two throwaway test people ("Alice", "Bob") in the live data; the assistant flagged this to the founder to delete manually rather than deleting data itself.

- **Person profile page redesigned for clarity, founder-requested 2026-07-17 (visual cleanup, no schema/Edge Function changes).** Four changes to `PersonDetail.tsx`: (1) The top "fields grid" (Last name / Goes by / Birthday / Anniversary click-to-edit tiles) was removed entirely — the founder felt it didn't look good and wants to workshop a cleaner way to surface a person's details later. The underlying data isn't gone (last name still shows in the page heading; last name/nicknames/birthday/anniversary can still be set via the AI fact bar or Home chat, same as before) — only the manual grid-of-tiles editor UI is gone, along with the now-unused `TextFieldCell`/`DateFieldCell`/`FieldCell` components and their save handlers. (2) The pencil/trash edit-delete controls and "Added through: {event}" source line that used to live on each Key Facts bullet moved onto the Notes section instead — every note card (not just ones traced back to a single source note) now gets its own hover-revealed edit/delete badges and, if it came from a tagged event, a clickable "Added through" button; Key Facts bullets are now purely presentational (no hover state, no `person-facts` `note_ids` dependency). (3) The flat notes list is now under a "Notes" heading with a show/hide toggle, matching the `▸/▾` pattern already used on `EventDetail.tsx`'s notes section (same style, but defaults **open** here since notes are the primary content on a person's page, unlike the event page where they're supplementary to an AI summary). (4) The person's group/event chips are now under separate "Associated Groups" / "Associated Events" headings (reusing the `subheading` style already established on `GroupDetail.tsx`/`EventDetail.tsx`) instead of one unlabeled row. **Side effect worth knowing:** `PersonDetail.tsx` no longer selects the `nicknames` or `reminders` columns at all (they had no UI consumer left after removing the fields grid), which incidentally means this page no longer needs the pending `ALTER TABLE people ADD COLUMN nicknames text;` migration (see Section 10) to load — `People.tsx` still does, though. Build passes (`npm run build`). **Not click-tested in the live app by the assistant** — same login-requires-a-password limitation noted throughout this doc; worth the founder clicking through a person's profile (hover a note to see the edit/trash badges, toggle Notes open/closed, confirm Associated Groups/Events chips still navigate correctly) after this deploys.

- **Refresh-stays-put + Key Facts caching/merge (master-list items 1, 2, 5, 12), built 2026-07-18.** Three related changes:
  - **Refresh no longer kicks you back to Home.** `App.tsx` now persists `view` + `navStack` to `sessionStorage` (key `boomer-nav`) on every navigation and restores it on startup, with validation and a safe fallback to Home for anything malformed. Per-browser-tab by design (sessionStorage), so a refresh stays exactly where you were but a brand-new tab still starts at Home. Frontend-only — live on the next Vercel deploy. Verified in the browser preview that a saved location restores without crashing and that logged-out users still land on Login; the full logged-in refresh test is left to the founder (login limitation as elsewhere).
  - **Key Facts are now cached in the DB instead of regenerated on every profile visit** (first application of CLAUDE.md's token-efficiency rule; the founder had specifically flagged the cost). New `people.key_facts` jsonb + `people.key_facts_updated_at` columns store the last good extraction. `person-facts` now accepts `{personId, refresh}`: plain visits serve the cache with **zero AI calls**; `refresh: true` regenerates and re-saves. `PersonDetail.tsx` passes `refresh: true` after any note add/edit/delete or confirmed relationship suggestion, and a `RefreshButton` (same component as `GroupDetail`'s summary refresh) now sits next to the "Key facts" heading for manual regeneration. Deleting a person's last note clears their cached facts server-side so stale facts can't reappear.
  - **The disappearing-facts bug had a second root cause fixed here too:** an Anthropic API error or an unparseable AI reply used to return `facts: []`, silently wiping whatever was on screen. Both failure paths now return the cached facts instead (`error: "extraction_failed"` / `"parse_failed"` alongside), so a bad regeneration can never blank out previously-good facts. Separately, same-category linked facts (siblings/parents/kids) coming back as multiple entries — e.g. two siblings recorded in two different notes producing two "Siblings:" rows — are now merged server-side into one fact per category with all person buttons combined (case-insensitive name dedupe; the nameless fallback text like "Has two kids." is dropped once any names exist).
  - Build passes. **The Edge Function half is NOT live until the Section 10 steps are done (SQL first, then deploy — order matters).** The frontend half is safe to deploy independently: the currently-deployed `person-facts` just ignores the new `refresh` flag.

- **Remaining founder-reported bugs fixed 2026-07-18 (master-list items 3, 4, 6, 7).** Four separate fixes:
  - **`add-fact` was missing the same fail-loudly auth check `converse` already got** (this was an explicitly-flagged audit gap in Section 10 — "likely has the same silent-failure pattern that `converse` had"). It now returns `401 {error: "not_authenticated"}` up front if the session is stale, and the note-insert path now checks `.error` and returns `500 {error: "save_failed"}` on a genuine DB failure, instead of silently no-op'ing. This is almost certainly what the founder saw as "notes are sometimes saving and sometimes not saving" on a person's profile — a stale session made writes vanish under RLS with zero feedback. `PersonDetail.tsx`'s `submitFact()` now actually checks for `error`/`data?.error` and shows a red banner with the message instead of clearing the input and calling `loadData()` as if it had succeeded; on failure the typed text is preserved so nothing is lost.
  - **Chat replies could misspell a person's name in the prose even when the person was tagged/linked correctly.** `converse`'s system prompt now has an explicit instruction to copy a roster name's spelling character-for-character into "reply"/"relevant_people"/etc. and never respell it. This can reduce but not fully eliminate model spelling drift in free-text prose — it's a prompting fix, not a hard guarantee.
  - **The actual clickable-button-vs-plain-text inconsistency (the real bug, distinct from the prose typo above) is fixed with certainty:** `converse`, `search`, and `add-fact`'s reciprocal-note code all had spots where a person chip's label came from whatever spelling the AI happened to output, rather than the person's real profile spelling — so if the AI's own text drifted even slightly, the button (when it did render) could carry the wrong spelling. All three now always render the canonical `nameById[id]` value on the chip, never the AI's raw string. Name-matching lookups across `converse`/`search` also now `.trim()` before lowercasing, closing a narrow gap where trailing/leading whitespace in the AI's output could silently fail to match an existing person (a mention with no matching profile always renders as plain text, not a button — this is inherent to name-based matching, but trimming removes one avoidable cause of it).
  - **Clicking a suggested prompt on Home now actually starts a real conversation** instead of just inserting the suggestion as inert assistant text the user then had to reply to unprompted. `Home.tsx` was refactored around a shared `sendMessage(text)` (used by both the Send button and a clicked suggestion card) — clicking a suggestion now sends it through `converse` as the opening user message and renders a real AI reply with its own people/event/group chips, the same as if the user had typed it themselves.
  - Build passes. `add-fact`, `converse`, and `search` are Edge Function changes — **not live until manually redeployed** (paste each file from `supabase/functions/` into its dashboard function and Deploy, or `npx supabase functions deploy add-fact converse search` with a fresh access token); `Home.tsx`/`PersonDetail.tsx` are frontend-only and go live on the next Vercel push. Not click-tested inside the logged-in app by the assistant (same login-requires-a-password limitation as elsewhere in this doc) — worth the founder trying: (1) a fact-bar submission with a deliberately-expired session to confirm the red error banner appears instead of a silent no-op, (2) clicking a Home suggestion card to confirm it now gets a real reply, (3) a chat mention of someone whose name has unusual capitalization/spelling to confirm the button is spelled correctly.

- **Five "quick win" master-list items (8, 9, 10, 11, 13) built 2026-07-18.** All frontend-only except item 11, which touches `suggest-prompts`:
  - **Item 8 — contact count.** `People.tsx`'s heading now reads "People (150)" etc., using the already-loaded list's length; no new query.
  - **Item 9 — Home dashboard stats.** `Home.tsx` runs four `head: true` count-only queries (`people`, `moments`, `groups`, `notes`) on mount and shows a 4-tile stat row above the suggestion cards, only in the empty (pre-conversation) state. Deliberately cheap: `head: true` transfers zero rows, just the count.
  - **Item 10 — Event tile formatting.** `Events.tsx`'s meta line (date · location) now matches `Groups.tsx`'s summary line styling (italic, `#666`) instead of its previous plain-gray style, and both the meta line and the attendee section now always render something (falling back to "No date or location yet" / "No one tagged yet." instead of collapsing to nothing) — mirroring `Groups.tsx`'s "Figuring out what this group is about…" / "No members yet." fallback pattern so card heights are more consistent across the two pages.
  - **Item 11 — reworded suggestions.** `suggest-prompts`'s fallback list and system-prompt examples now lead with the founder's preferred phrasings ("Let me tell you a story about…", "Take a trip down memory lane about…"), with "Catch me up on…"/"What's the latest with…" as the catch-up-on-a-person variant. **Not live yet** — Edge Function change, needs a manual redeploy (paste `supabase/functions/suggest-prompts/index.ts` into the dashboard and Deploy, or `npx supabase functions deploy suggest-prompts`); until then the old wording keeps showing.
  - **Item 13 — People sorting.** New dropdown next to the People search box: Name (A–Z/Z–A), Recently added (by `created_at`), Most notes ("relevance" proxy — total note count, descending), and Upcoming dates ("timely" proxy — nearest upcoming birthday/anniversary from `reminders.month/day`, soonest first, `Infinity`/unchanged position for anyone with none). All sorting is client-side against the already-loaded list; `People.tsx`'s query now also selects `created_at` and `reminders(month, day)`. This is a scoped-down version of the original ask — see the master-list note in Section 7 for what's simplified vs. the founder's fuller "timely relevance" example.
  - Build passes (`npm run build`). **Click-tested end-to-end live** (founder-provided login) against the real production data: verified the (150) count renders, Home's stat row shows real counts (150/16/12/262), Events cards show the new fallback text where there's no location/date or no attendees, and all five sort options visibly reorder the People list (A–Z, Z–A, Recently added, Most notes, Upcoming dates all produced distinct, correct-looking orderings). The reworded suggestions did not yet appear live in this test since `suggest-prompts` hasn't been redeployed — expected, per the note above.

- **A person can now be deleted or merged into another profile directly from their own page** (built 2026-07-18, founder-requested after noticing a duplicate "Noah" person alongside the real "Noah Bach" — see the matching Section 9 entry for how that duplicate happened). `PersonDetail.tsx` gained a "Profile" section at the bottom of the page with two actions, both client-side Supabase writes (no Edge Function involved): **Delete this profile** (behind an inline "are you sure" confirmation, matching the style of the existing group/relationship suggestion banners) permanently removes the person along with their `notes`, `reminders`, and `person_groups` rows. **Merge with another profile…** opens a search box (reusing `SearchBox.tsx`) to find a duplicate person; picking one and confirming moves all of the duplicate's notes over to the current profile, unions their group memberships (no duplicate `person_groups` rows), keeps whichever reminder wins on a label collision (current profile's, if both have one, e.g. two "Birthday" entries), and folds the duplicate's own name(s)/nicknames into the current profile's `nicknames` field — so a bare first-name mention already sitting in old note text (like the standalone "Noah" that caused the original bug) resolves unambiguously going forward, since only one person now has that name. The duplicate record is deleted at the end, and the current profile's cached `key_facts` is cleared so it regenerates from the merged notes on next view. Both actions intentionally do NOT try to scrub the deleted/merged-away person's name out of *other* people's note text (their notes just mention someone by name; there's no reliable way to "unmention" prose) — any other profile's cached Key Facts pointing at the removed ID will simply stop resolving to a clickable button next time it regenerates, same fail-safe-to-plain-text behavior as any other unresolved name elsewhere in the app. Build passes; **click-tested end-to-end live** (the founder logged into the app in-session so the assistant could drive it directly, a first for this doc — see Section 10) — created a throwaway test person and confirmed Delete removes them from the People list; used Merge to fold the real duplicate "Noah" into "Noah Bach," confirming the moved-over notes, unioned parent facts, and updated Key Facts/sibling button all appeared correctly, and the duplicate no longer appears anywhere in the app.

- **Event Notes section now groups identical notes shared by multiple people, instead of repeating one card per person (built 2026-07-18, founder-requested after noticing the same rafting-trip sentence appearing as three separate near-identical cards for three different attendees).** When someone describes an event involving several people in one Home message, `converse`'s per-attendee insert loop (Section 4) writes one `notes` row per tagged person, and the LLM commonly writes the exact same sentence for each of them — visually redundant clutter on `EventDetail.tsx`'s Notes list. `EventDetail.tsx` now groups that event's notes by exact trimmed `content` text before rendering: notes sharing identical text collapse into a single card listing every tagged person's name (comma-separated) instead of one card per person, while notes with distinct text (edits, follow-up chat additions, a genuinely different observation about one person) still render as separate cards exactly as before. This is a display-only grouping done client-side at render time — no schema change, no new column, the underlying `notes` rows are untouched and still independently editable/deletable elsewhere. `PersonDetail.tsx`'s own Notes list was deliberately left unchanged: it's already filtered to one person's notes, so the multi-person duplication this fixes never applies there. Build passes (`npm run build`). **Not click-tested in the live app** — no test login credentials available in this session; the founder chose to skip live verification given the small, low-risk, display-logic-only nature of the change. Worth a quick look next time the founder is in an event with multiple attendees tagged from one message, to confirm the grouped card reads well.

- **"Associate a New Group" manual picker added, plus an Associated Groups chip-styling fix (founder-requested 2026-07-19).** Two changes to `GroupDetail.tsx`, both frontend-only: (1) The confirmed-associated-group chip and the suggested-associated-group chip were rendering with the same green pill/dashed style used for *people* chips (`styles.person`/`styles.eventOnlyChip`) — visually indistinguishable from a person, and inconsistent with how group chips actually look everywhere else in the app (gold badge with a dot, from `Chips.tsx`'s `GroupChip`, e.g. on `PersonDetail.tsx`'s own "Associated Groups" and on each event card's group tags). Confirmed chips now render the real shared `GroupChip` component (wrapped in the same hover-reveals-trash-badge pattern as before); suggested chips keep their own local style but recolored gold/dashed to match, so a group now reads as a group at a glance regardless of confirmed/suggested state. (2) A new "+ Associate a New Group" button sits next to the "Associated Groups" heading. Clicking it opens an inline panel (new `SearchBox` + a gold `GroupChip` for every other group not already confirmed) fetched fresh from `groups` on open; clicking any group in the list calls the same `handleApproveGroupSuggestion` write the suggestion-approval flow already uses, so a manually-added group behaves identically to an approved suggestion (creates the same symmetric `group_associations` row, disappears from both the picker and any existing suggestion chip for it). This is a direct, no-signal-required path to link two groups that share no members or events — the suggestion engine can never surface those. Build passes (`npm run build`). **Click-tested end-to-end in the browser preview** against the real production Supabase project (no separate dev database — same as other click-tests in this doc): opened the picker on "Book Club," confirmed "Hiking Crew" listed, clicked it, confirmed it moved into the confirmed row with the correct gold `GroupChip` styling (verified via computed styles: solid gold border/background, `border-radius: 8px`, `font-weight: 700` — matching `GroupChip` exactly) and disappeared from both the picker and the suggestion row, then hovered the confirmed chip, clicked its trash badge, and confirmed it reverted cleanly back to suggestion-only state. No console errors. The test association was undone before finishing, so live data is unchanged.

- **"Who's in this group" now also suggests members from confirmed Associated Groups (founder-requested 2026-07-19), symmetric by design.** `GroupDetail.tsx`'s member-suggestion pool (previously event-attendees only) now merges a second signal: anyone who's an explicit member (`person_groups`) of any group currently in this group's confirmed `group_associations`. New `loadAssociatedGroupMembers()` runs whenever the confirmed-associated-groups list loads or changes (on mount, and after approving/removing an association), fetching every `person_groups` row for those group IDs and deduping by person. The two signals (event attendance + associated-group membership) are combined into one suggestion list — same "either signal is enough, no visual distinction between sources" pattern already used for the Associated Groups suggestions themselves — with the label generalized from "Also seen at this group's events" to "Seen at this group's events, or in an associated group." Reuses the existing dismiss/add machinery unchanged (`dismissed_person_ids`, `handleAddMember`, `handleDenySuggestion`/`handleDenyAllSuggestions`) — a person dismissed or added here behaves identically regardless of which signal surfaced them. **Deliberately symmetric, not hierarchical** — confirming "Air Force Academy" as associated with "Air Force" surfaces Academy members as Air Force suggestions AND (if visited) Air Force's own members as Academy suggestions equally; there's no "broader/narrower group" flag on `group_associations`, matching how the association itself already works (a plain symmetric pair, see Section 5). Founder explicitly chose this over adding a one-directional hierarchy flag, given the latter would be a schema/architecture change rather than a UI addition. **Known tradeoff, accepted:** associating a small group with a large one (e.g. this app's demo "Air Force" ↔ "Wings of Blue," 47 members) can surface a large number of suggestion chips at once — mitigated by the existing "× Remove all suggestions" bulk-dismiss and per-chip dismiss, not by any new filtering. Build passes (`npm run build`). **Click-tested end-to-end in the browser preview** against the real production Supabase project (founder-provided login, no separate dev database): on the "Air Force" group (already associated with "Air Force Academy" and others), confirmed the suggestion list included people who are only in an associated group (not in any of Air Force's own events), clicked one to add them (moved into "Who's in this group," disappeared from suggestions, group description correctly went back to "Figuring out what this group is about…" then regenerated), then removed them again via the member chip's hover-trash to fully restore the pre-test state. No console errors. (Also noted in passing: a second concurrent session had already committed/pushed the previously-uncommitted "Associate a New Group" picker described in the prior bullet, ahead of this one — no conflict, just confirmed already live.)

- **Home dashboard grew from raw inventory counts to "working as intended" signals, plus a Dunbar's-number deep-dive page (founder-requested 2026-07-19).** The original 4-tile stat row (People/Events/Groups/Notes, Section 6 item 9 above) only showed *how much* was stored, not whether the app was actually doing its job of keeping detail from slipping away — so a new section was added between those tiles and the "Ask about anyone…" prompt (additive, the 4 tiles are unchanged): (1) **"People you'd have lost track of" card** — `max(0, people_count - 150)` against Dunbar's number (150, the number of stable relationships a person can reliably keep in their head unaided), with a fallback variant ("X of ~150") shown instead when the count is at or under 150. Tapping it opens the new `DunbarDetail.tsx` page: explains the concept, then shows the user's own count against Dunbar's actual nested tiers (Intimate circle/5, Close friends/15, Meaningful contacts/150, Beyond Dunbar's limit/uncapped) as progress bars, plus an outbound link to further reading. **v1 deliberately skips per-person tier assignment** (option (c) from the founder's own three options in the spec) — each bar just shows the total count capped at that tier's size, nested-circle style, not an actual sorted breakdown of *which* people are in which tier; worth revisiting with manual tiering or note-frequency inference later if it's wanted. (2) **"Recall assists this month" card** — count of `search_log` rows this calendar month where `matched` is true (see Section 5's new `search_log` table). Logging happens inside `converse` itself, not a separate AI call: the existing JSON contract gained `is_lookup` (true only when the user's message was a genuine recall attempt, not a new memory/correction/group-tag/chat) and `found_relevant_info` (whether the reply actually surfaced real existing detail vs. falling back to a clarifying question) — zero added token cost worth mentioning, reusing the one call `converse` already makes per turn, consistent with the founder's standing token-efficiency directive. (3) **Leaderboard module, "Most reinforced this month"** — top 3 people by count of `notes` added this calendar month (rank, initials-circle avatar, name, "N updates"), reusing the already-loaded `stats.people` gate so it only shows once there's at least one person. Deliberately NOT a single "deepest relationship" stat (explicitly rejected in the spec as too declarative/judgmental about one named person) and deliberately avoids language like "closest relationship"/"favorite" anywhere in the copy. A footer CTA "See who's due for an update →" links to the new `DueForUpdate.tsx` page — the inverse list, people sorted with no-notes-at-all first, then oldest last-note first, framed as a nudge ("a quick nudge, not a ranking") rather than a ranking. Both new pages fetch their own data client-side (plain count/aggregate queries, no AI call, no caching column needed — same reasoning as `person-facts`' fresh-per-view pattern where regeneration cost doesn't apply). New DB: `search_log` table (Section 5), **SQL handed off to the founder to run — see Section 10**; until it's run, the Recall Assists card just reads 0 (the query fails silently the same fail-open way `head:true` count queries already do elsewhere, no crash). Build passes (`npm run build`). **Click-tested end-to-end in the browser preview** against the real production Supabase project (already-logged-in test session): confirmed the new cards/leaderboard render with real data (282 people → "132" beyond-Dunbar card, real leaderboard names/counts), tapping the Dunbar card opened `DunbarDetail.tsx` with correct tier math (5 of 5 / 15 of 15 / 150 of 150 / 132 beyond) and the footer line, back-navigation returned to Home with dashboard state intact, the leaderboard footer CTA opened `DueForUpdate.tsx` with people correctly sorted (no-notes-yet people first, alphabetically), and clicking both a leaderboard row and a due-for-update row navigated to the right person's profile with a correct breadcrumb trail. No console errors. **`converse`'s `search_log` insert has not been live-verified** (needs the table to exist first, i.e. the founder running the handed-off SQL, then a redeploy of `converse` — see Section 10) — worth the founder trying an actual recall question ("tell me about Steve") after both steps to confirm a matched row appears and the Recall Assists count ticks up.

- **Four UX refinements to `GroupDetail.tsx`'s member lists, founder-requested 2026-07-19 after visiting the "Air Force" group (the group with the most associated groups, and so the largest suggestion pool).** All frontend-only, no schema changes: (1) **"Add all suggestions"** sits next to the existing "Remove all suggestions" for the member-suggestion list — a single batched `person_groups` upsert for every currently-visible suggestion chip (new `handleApproveAllSuggestions`), mirroring how "Remove all" already batches dismissals. (2) **Member suggestions are capped to 20 at a time** (`MEMBER_SUGGESTION_LIMIT`) instead of showing the full pool at once — a group associated with several large groups (Air Force's suggestion pool was 159 people from "Wings of Blue," "Air Force Academy," etc.) was otherwise an unscannable wall of chips. This is a pure display-time `.slice(0, 20)` on the already-loaded, already-deduped suggestion list, not a new query or new state — adding or dismissing a suggestion shrinks the underlying pool, so the next candidate fills the visible batch in automatically with no "load more" click needed. The label shows "(20 of 159 shown)" once the pool exceeds the cap. "Add all"/"Remove all" only ever act on the visible batch, consistent with the batch-at-a-time model. (3) **Explicit members collapse behind a "▸ Show all N members" toggle past 12** (`MEMBER_LIST_LIMIT`), expanding in place to "▾ Show fewer members" — same motivation as `Groups.tsx`'s existing `MEMBER_LIMIT`/"+N more" truncation on the list-page tiles, but here as an interactive expand/collapse on the group's own detail page rather than a static label, since the full roster is the whole point of this page. (4) **"Who's in this group" now shows a live count** next to the heading (e.g. "Who's in this group (52)"), same pattern as the existing People-page contact count. Build passes (`npm run build`). **Click-tested end-to-end in the browser preview** against the real production Supabase project (founder-provided login): on "Air Force," confirmed the suggestion label read "(20 of 159 shown)" with exactly 20 chips and both new/existing bulk buttons present; temporarily lowered `MEMBER_SUGGESTION_LIMIT` to 2 to keep the live-data footprint of the test small, confirmed "Add all suggestions" added both visible people (verified via a real DOM click — the harness's synthetic click tool intermittently failed to land on this particular button for unclear reasons, confirmed via a direct `.click()` call instead) and the pool immediately re-filled with the next 2 candidates, confirmed "Remove all suggestions" dismissed a batch and the pool re-filled again, then fully reverted the test (removed the 2 added members via the existing per-member trash badge, reset the group's `dismissed_person_ids` back to `[]` via a direct authenticated REST call using the session already in the browser — confirmed both before-state and after-state matched exactly) and restored `MEMBER_SUGGESTION_LIMIT` to 20. Separately confirmed on "Wings of Blue" (52 explicit members): only 12 shown initially with a "▸ Show all 52 members" toggle, expands to all 52 with "▾ Show fewer members," and collapses back correctly. No console errors at any point.

- **Full-repo audit against CLAUDE.md's token/billing efficiency rule, prompt-cache restructuring in `converse`/`update-group`/`update-moment` (2026-07-19).** Founder asked for a scan of every AI call site against the standing prompt-caching directive. Audit result: `person-facts`, `suggest-prompts`, `summarize-group`, and `summarize-moment` were all already compliant — DB-cached (`key_facts`, `home_suggestions`, `groups.summary`, `moments.summary`), regenerated only on real data changes or an explicit refresh, and the two short one-shot prompts (`summarize-group`/`summarize-moment`) correctly have no `cache_control` at all since they're under the ~1024-token minimum caching threshold (adding one there would gain nothing). The three multi-turn conversational functions — `converse`, `update-group`, `update-moment`, the highest-traffic and most token-heavy calls in the app — all shared the same real inefficiency: each built ONE system-prompt string that interleaved the large fixed instruction block with per-request volatile data (the moments/roster/group-state context) in the middle, wrapped in a single `cache_control` breakpoint. Since writing any new note/moment/person changes that volatile text, and it sat in the *middle* of the prompt, a single write invalidated the entire cached prefix — including the ~1,500-2,000 words of instructions that come after it and never change. Given "add a moment" is the core use case, this meant paying full reprocessing cost on nearly every other turn. **Fix:** all three were restructured so the fixed instructions (now a literal string with zero interpolated data) come first as their own `cache_control` block, and the volatile data (today's date, moments, roster, groups) comes last as a second `cache_control` block — two breakpoints per function. The large stable block can now be reused as a cache hit far more often; only the small trailing data block needs reprocessing when something changes. Wording is otherwise unchanged word-for-word (only "roster above" → "roster provided in this prompt," since order changed) — the JSON output contracts are untouched. One lower-priority finding, not changed: `add-fact`'s family-relationship suggestion helper (`extractRelationNames`) can make up to ~12 sequential small API calls in a single request when several siblings/parents are named at once — capped at 6 suggestions and a rare path, flagged for a future look rather than touched now. Build passes (`npm run build`). **Deployed live** via `npx supabase functions deploy` for all three functions (founder provided a fresh Personal Access Token in-session). **Click-tested end-to-end in the browser preview** against the real production Supabase project (already-logged-in session): a recall question ("Tell me about Caroline Volin") returned a correct, fully-detailed answer with correctly-resolved clickable name chips; a new-moment capture ("coffee with a new friend named Zzztest CacheCheck") correctly created the new person and a new event; and an `update-moment` follow-up ("We met at Cache Test Cafe") correctly updated the event's location and regenerated its summary. No console errors. **Cache-hit token counts were not independently confirmed this session** — the Supabase Management API's log-analytics endpoint didn't surface the function's own `console.log("converse usage", ...)` line on the query shapes tried (schema/ingestion delay, not investigated further given functional correctness was already confirmed). Worth spot-checking `cache_read_input_tokens` in the Supabase dashboard's Edge Function logs after two back-to-back Home messages, next time someone's in there. **Cleanup needed:** this test left one throwaway test person ("Zzztest CacheCheck") and one throwaway test event ("Coffee with Zzztest CacheCheck") in the live data — same as prior sessions' test-data notes in this doc, flagged here rather than deleted by the assistant; safe to delete via the event's own "Delete this event" button and the person's profile "Delete this profile" action.

- **Relationship detection extended to all four conversational entry points, via a new shared module (built and deployed 2026-07-19).** The founder reported inconsistent relationship-mapping behavior ("depending on how and where the information was presented"); investigation confirmed the root cause was structural, not a bug: `add-fact` (the profile fact bar) was the *only* place that parsed a relationship mention into `family_signals`, wrote a reciprocal note on the other person's profile, and generated `relationshipSuggestions`/`newPersonSuggestions` banners (see the 2026-07-17/07-19 entries above). Home chat (`converse`), an event's own chat (`update-moment`), and a group's own chat (`update-group`) all had zero relationship-specific logic — a relationship mentioned there landed as an untyped, one-sided plain note, with no reciprocal write and no suggestion, ever. **Fix, per the founder's explicit choice of a shared module over copy-pasting the logic into three more places:** all of `add-fact`'s relationship machinery — the 5-way `spouse`/`sibling`/`parent`/`child`/`partner` vocabulary, the deterministic reciprocal-note/dedupe-keyword/forward-phrase maps, the exact-full-name-match confidence discipline, and the "suggest, don't assert" shared-parent inference — was extracted into `supabase/functions/_shared/relationships.ts`, a new pattern for this codebase (previously each Edge Function was fully self-contained; Supabase's own bundler picks up `_shared/` automatically on deploy, confirmed working). `add-fact` was refactored to call this shared module with zero behavior change (its own subject is always the profile being viewed). `converse`, `update-moment`, and `update-group` each gained: a `family_signals` field in their JSON contract with an explicit `"subject"` name (unlike `add-fact`, these three can be describing a relationship between any two already-named people in one message, not just "this profile's own relatives" — e.g. "her brother Jake" in Home chat needs to know "her" refers to Sarah, who must be named elsewhere in the same message); a shared prompt-text builder (`familySignalPromptMultiSubject()`) so the vocabulary/wording is now byte-identical across all three, instead of each maintaining its own copy; and a call into `applyFamilySignals()` after their existing people-processing steps (so a relationship's subject or named relative can resolve even if the same message just created or renamed them — this also fixed a latent gap where `converse`/`update-group`'s `new_people`/`add_people` loops updated `idByName` but never `nameById`, which would have produced "undefined" text in a reciprocal note for a brand-new person). **Deliberately excluded, by design:** a relationship stated as "my mom"/"my brother" with no named subject still can't be captured anywhere in the app, including here — the app's user has no profile record of their own for such a note to attach to; this matches how `add-fact`'s `family_signals` already worked (always scoped to a specific *named* person's relatives) and isn't a new limitation introduced by this change. The suggestion-banner UI itself (previously ~150 lines of confirm/decline handlers and JSX living only in `PersonDetail.tsx`) was extracted into a new shared `src/components/RelationshipSuggestions.tsx` (`RelationshipSuggestionBanners` component + `toStagedNewPersonSuggestions` helper), then wired into `Home.tsx`, `UpdateMomentChat.tsx`, and `UpdateGroupChat.tsx` alongside the existing `PersonDetail.tsx` usage — all four surfaces now render the identical "It looks like {X} might also be {Y}'s parent" / "New relationship suggestion: {X} is {Y}'s parent. Add this?" banners with the same confirm/decline/dedupe behavior. Build passes (`npm run build`). **Deployed live** via `npx supabase functions deploy add-fact converse update-moment update-group` (founder provided a fresh Personal Access Token in-session; all four functions correctly bundled `_shared/relationships.ts`). **Click-tested end-to-end in the browser preview** against the real production Supabase project (already-logged-in session), one confirming test per entry point, using disposable "Zztest" people cleaned up (deleted) before finishing: (1) profile fact bar — regression-tested unchanged behavior (married-to note, new-person suggestion banner, confirm flow all worked); (2) Home chat — stated "Zztest Beta is Zztest Alpha's brother," confirmed the reciprocal note "Their sibling is Zztest Alpha." appeared on Beta's profile automatically, no suggestion banner needed since it was a confident match; (3) event chat — stated a sibling relationship about someone not even tagged to that event (subject resolved from the full people roster, not just event attendees), confirmed the reciprocal note landed on the correct profile; (4) group chat — stated "Zztest Alpha's mom is Zztest Epsilon" (a brand-new name), confirmed the "New relationship suggestion: Zztest Epsilon is Zztest Alpha's parent. Add this?" banner appeared, clicked "Yes, add," and confirmed it created the new person with the correct reciprocal note. No console errors at any point.
  - **Known remaining inconsistency, not fixed in this pass:** `person-facts` (the read-only Key Facts panel on a profile) still has its own, independently-typed vocabulary (`siblings`/`parents`/`kids`/`spouse`/`other` — plural, no `partner`/dating category) rather than importing the shared 5-way enum this change introduced. It's read-only (re-derives everything fresh from note text on every regeneration, never writes) so this doesn't cause incorrect data, only a naming mismatch between what the shared module now calls things and what this one display-only function calls them — worth aligning in a future pass, but deliberately left alone here to keep this change scoped to the write paths the founder actually asked about.

- **Merge direction reversed for both the person and event merge features (founder-flagged as counterintuitive, fixed 2026-07-19).** Both merges (`PersonDetail.tsx`, `EventDetail.tsx`, see the 2026-07-18/07-19 entries above) originally kept whichever profile/event the user was *currently viewing* as the survivor, folding the search result into it and deleting the search result. That's backwards from how people actually find duplicates: they click into the unwanted one first, realize it's a dupe, then search for the correct one — so the natural expectation is that the one they search for and pick is the one that survives, and the one they're standing on disappears. **Fixed:** `handleMerge` (PersonDetail) and `handleMergeEvent` (EventDetail) now swap `duplicateId`/`survivorId` — the current profile/event is always the one folded away and deleted; `mergeCandidate` (the search result) is always the survivor. Button/banner copy was reworded to match ("This is a duplicate — merge it away…" instead of "Merge with another profile…"; "Search for the profile/event you want to keep…"; confirmation explicitly names which one gets deleted and that you'll be taken to the survivor). Since the profile/event being viewed no longer exists after merging, both `PersonDetail` and `EventDetail` gained an `onMerged` callback prop; `App.tsx` wires it to a new `replaceCurrentCrumb()` (swaps the current breadcrumb entry for the survivor in place, rather than pushing a new one on top of a now-dead crumb, so the back button and breadcrumb trail land somewhere real). Build passes (`npm run build`). **Click-tested end-to-end in the browser preview** against the real production Supabase project: created throwaway test people/events directly via the Supabase client (bypassing the AI chat, to avoid API cost and keep real data untouched), merged a duplicate into a keeper for both people and events, confirmed in each case the banner copy read correctly at both steps, the app landed on the survivor's page with the breadcrumb correctly replaced (not stacked), notes/reminders/group tags moved over, the duplicate's name was added to the survivor's nicknames, and the duplicate record was actually deleted — verified directly against the database, not just the UI. All test data and scratch scripts were deleted afterward; no residue left in production data.

- **Relationship notes only reaching one side of a relationship, fixed 2026-07-19 (founder-reported: "Jalen, Julia, and Wyatt Lacy — some share notes, some don't, the relationships are not mapping").** Root cause, found by inspecting the real Jalen/Julia/Wyatt Lacy data: `applyFamilySignals` (`supabase/functions/_shared/relationships.ts`, added 2026-07-19, see the entry above) only ever wrote a reciprocal note onto the *named relative's* profile, on the documented assumption that "the original fact, in the user's own words, already lives on the subject's own profile." That assumption holds for `add-fact` (the profile fact bar always separately saves the raw typed text on the subject, `add-fact/index.ts` lines 169-180) but is false for `converse`/`update-moment`/`update-group` (Home/event/group chat): those only save a plain note for someone when the AI also happens to emit a `notes`/`additional_notes` entry naming them, which a *pure* relationship-only statement (no described moment) never does. Concretely: Julia Lacy's profile had "Married to Jalen Lacy." (a reciprocal note — meaning Jalen was the subject somewhere, likely a Home-chat message with no accompanying moment), and Wyatt Lacy's profile had reciprocal "Their parent is ___" notes from both parents — but Jalen Lacy's own profile had **zero notes at all**, since nothing ever wrote his side of either relationship. **Fixed:** `applyFamilySignals` now writes a note on *both* sides of every relationship — the existing reciprocal note onto the named relative (unchanged), plus a new matching note back onto the subject's own profile, phrased via a new `INVERSE_RELATIONSHIP` map (spouse/sibling/partner are symmetric; parent/child invert — e.g. subject "Jalen," relationship "child," target "Wyatt" now also writes "Their child is Wyatt Lacy." onto Jalen, not just "Their parent is Jalen Lacy." onto Wyatt). Each side has its own independent dedupe check (existing notes scanned for the other person's name + a relationship keyword) so this doesn't create duplicates when the subject's raw fact already exists from `add-fact` or a moment note. Build check N/A (Deno Edge Function code, not covered by `npm run build`/`tsc`, same as all other `supabase/functions/` changes in this doc). **Existing bad data for Jalen/Julia/Wyatt Lacy was repaired directly through the live app** (not a DB script): typed "Married to Julia Lacy. Their child is Wyatt Lacy." into Jalen Lacy's own profile fact bar against the real production Supabase project (this pathway — `add-fact`'s own raw-note save — was already correct and needed no fix). Confirmed Jalen's profile now shows both the raw note and correct Key Facts ("Married to Julia Lacy" / "Children: Wyatt Lacy"), and confirmed Julia's and Wyatt's existing notes were *not* duplicated (the currently-deployed, pre-fix `add-fact` already had its own working dedupe check on the target side). **Deployed and confirmed live 2026-07-19** — `npx supabase functions deploy add-fact converse update-moment update-group` (founder provided a fresh Personal Access Token in-session). **Click-tested end-to-end in the browser preview** against the real production Supabase project, isolating the exact gap this fix targets (a relationship stated with no moment involved): created disposable "Zztest Gamma"/"Zztest Delta" test people via a Home-chat moment, then in a separate message stated "Zztest Gamma is married to Zztest Delta." with no new moment described — confirmed **both** profiles picked up a "Married to [other]." note (previously only one side would have), and Key Facts on both correctly showed "Married to." All test data (both people and the throwaway "Coffee with new friends" event) deleted afterward; no residue left in production data.

- **Last-name inference for people created from a relationship mention, founder-requested 2026-07-19** ("if Ale's wife is Molly, it should suggest a last name based on Ale's; same for a child/sibling added by name — e.g. Garth Brooks's brothers Jared and Michael should suggest 'Brooks'"). Two parts, both scoped to all five relationship kinds (spouse/partner/sibling/parent/child), always offered as a suggestion the founder confirms — never silently asserted, and correctable afterward via chat like any other fact:
  - **Part A — at creation time.** `NameIndex` (`supabase/functions/_shared/relationships.ts`) gained a `lastNameById` map, populated alongside the existing `idByName`/`nameById` in all four callers (`add-fact`, `converse`, `update-group`, `update-moment` — each already fetched `last_name` for its roster query, so this is a one-line addition per file, not a new query). `applyFamilySignals` now attaches a `suggestedLastName` (the subject's own last name) to a `NewPersonSuggestion` whenever the named relative was given as a bare first name; the shared frontend copy of that type (`src/components/RelationshipSuggestions.tsx`) shows the full proposed name in the banner ("Add Jared Brooks as a new contact (last name suggested to match)?") and falls back to it when neither `confirmNewPersonSuggestion` nor `addNewPersonAnyway` found a last name typed in the name itself. **A second, non-obvious gap surfaced during testing:** `converse`/`update-group`/`update-moment` each also have their own separate, silent "create this new person directly" path (`new_people`/`add_people`) that fires whenever the model spots an unfamiliar name — independent of the relationship-suggestion banner above, and it runs *before* `applyFamilySignals`. A name that's both "new" and named as someone's relative in the same message (e.g. "Josh Volin's brother is Jared") was getting created there first, with no last name, so by the time `applyFamilySignals` ran it already looked like a confident match and the suggestion path never fired at all. Fixed with a new shared helper, `inferLastNameFromSignals(rawName, familySignals, index)`, called from all three of those direct-creation sites so the new person gets the subject's last name at creation time too, matching Part A's behavior exactly.
  - **Part B — retroactive nudge on an already-existing first-name-only profile** (the founder's "click into Molly's profile" case — covers people created before this fix, or where the linked person didn't have a last name themselves yet at creation time). `PersonDetail.tsx` now scans a no-last-name profile's own notes for the app's known deterministic relationship-note phrasings (mirroring `RECIPROCAL_NOTE` from `relationships.ts` — kept in sync manually, flagged in a comment), resolves the named other person, and if they have a last name, shows a new actionable Yes/No banner (a new component-local addition; the existing "Key facts" nudge box is plain-text prompts only, not actionable). Confirming does a plain `people.update({last_name})` then reloads notes/Key Facts the same way any other fact-bar save does.
  - Build passes (`npm run build`), all 22 existing Vitest tests still pass. **Deployed live** via `npx supabase functions deploy add-fact converse update-group update-moment` (founder provided a fresh Personal Access Token in-session). **Click-tested end-to-end in the browser preview** against the real production Supabase project: (1) Part B verified first, against a disposable test sibling created with no last name — the "Add 'Volin' as [name]'s last name?" banner appeared on their profile and confirming it correctly updated the heading and Key Facts; (2) Part A verified via the profile fact bar on Josh Volin — typing "His sister is Qwyntessa" surfaced "New relationship suggestion: Qwyntessa is Josh Volin's sibling. Add Qwyntessa Volin as a new contact (last name suggested to match)?", and confirming created the new person as "Qwyntessa Volin" directly (last name applied at creation, no Part B nudge needed since Part A already handled it). All disposable test people/notes created during this verification (two via Home chat before the redeploy, one via the fact bar after) were deleted afterward, including the leftover reciprocal notes they left on Josh Volin's real profile; confirmed no residue left in production data.

- **Julia Lacy's "Wyatt" Key Fact showing as plain text instead of a button, investigated and fixed 2026-07-19 — near-miss where the fix almost reintroduced a same-day bug.** Founder asked why Wyatt (Julia's son) rendered as unlinked text on Julia's profile when the exact same relationship showed as a clickable chip on Jalen's (Julia's spouse's) profile. Root cause, confirmed by reading both profiles live: Julia's note said "Their daughter's name is Wyatt" (first name only, entered 2026-07-18), while Jalen's said "...Their child is Wyatt Lacy" (full name, entered 2026-07-19 — the `INVERSE_RELATIONSHIP` fix from the entry above). `person-facts`'s exact-full-name-match rule (this rule was itself added earlier the same day, see the Gus/Olivia entry above) correctly declined to link a bare first name, working exactly as designed — this was not a bug in that rule. **First attempt (wrong, caught and reverted the same session):** reasoned that since `idByName` already resolves a bare first name to a unique existing profile only when unambiguous (ambiguous keys are deleted from the map before this point), trusting that resolution directly — the same way `converse`/`update-group`/`update-moment` already trust it to tag notes to people — would be safe and would fix this class of case everywhere, not just for Julia. Deployed this looser matching to production (`npx supabase functions deploy person-facts`) and confirmed it fixed Wyatt's chip. **The mistake:** this change was made without first checking PROJECT_HISTORY for *why* the strict rule existed — it turned out to be the exact same-day fix for Gus Reynolds's profile (see the "New relationship suggestion" entry above): a bare "Olivia" had auto-linked to an unrelated existing "Olivia Gillingham" purely because she was the only Olivia in the roster, when the person Gus was actually describing wasn't in the system at all. "Unambiguous in the roster" and "confirmed identity" are not the same thing, and the loosened `person-facts` logic reopened exactly that hole — it would have re-created the Gus/Olivia false link the next time anyone hit "Refresh key facts" on his profile. Caught by re-reading PROJECT_HISTORY before moving on, not by an external report. **Corrected:** reverted `person-facts` to the strict exact-full-name-match rule and redeployed immediately; confirmed live that Gus Reynolds's profile still correctly showed "Dating: Olivia" as plain unlinked text (the brief window the loose version was live never got exercised against his cached data, since nothing had triggered a refresh on his profile in that window — verified directly, not assumed). **Actual fix for Julia's case:** edited her note via the profile's own edit-note UI to read "Their daughter's name is Wyatt Lacy," which triggered the normal note-edit-driven Key Facts regeneration and produced a correctly-linked chip through the legitimate strict-match path — no code change needed, matching how Jalen's side had already self-corrected once his note used the full name. **Lesson recorded in PROJECT_CONTEXT.md:** before loosening any name-matching/confidence check in this codebase, check PROJECT_HISTORY for why it was added — several of these rules exist specifically because a looser version already caused a real false-positive earlier.

## 7. Features Currently In Progress / Explicitly Deferred

- **Automatic email reminders** — deferred early on ("Not yet — let's move to Add a Moment first and come back to this"). Never revisited since. The `reminders` table exists but nothing sends anything automatically.
- ~~Voice input~~ — **built 2026-07-16 across all conversational text boxes** (see Section 6), but not yet functional in production until the founder adds an `OPENAI_API_KEY` Supabase secret (see Section 10). Moved here from "not yet built" to note it's code-complete but pending one manual setup step, not untouched.
- **Weather/time metadata enrichment** on moments (pulling historical weather for the date/location of an event) — discussed as an interesting idea, explicitly deferred in favor of other priorities. Would require geocoding + a historical weather API (e.g. Open-Meteo, free/no-key).
- **iPhone Contacts integration** — using a person's real saved address/contact info from the user's phone contacts — explicitly deferred as unnecessary complexity for now.
- **Tuning AI conversation quality** — the founder has repeatedly noted the AI could ask better/more thorough follow-up questions before wrapping up a conversation; called "good for MVP, but something to improve" more than once. This is an ongoing, never-fully-resolved thread, not a discrete task.
- ~~Groups tagging for moments~~ — **done and confirmed 2026-07-15** (see Section 6). No longer deferred; moved here to note it's resolved, not tracked as a gap.
- **Existing (pre-2026-07-15) moments and people are NOT retroactively grouped.** Group tagging only happens going forward, on new conversation turns. If the founder wants old moments (like the seeded "Air Force safety school" entry) tagged into a group, that has to be resurfaced/re-mentioned in a Home conversation — there's no batch/backfill tool for this.
- **UI/UX feature backlog, requested 2026-07-16.** Ordered easiest to hardest (see that conversation for full reasoning):
  1. ~~Refresh button next to a group's AI-generated description~~ — **done 2026-07-17.** A small refresh icon (`src/components/RefreshButton.tsx`) next to `GroupDetail.tsx`'s summary re-calls `summarize-group`; the new result saves to `groups.summary` (existing behavior of that function) and persists across reloads until refreshed again. Click-tested end-to-end.
  2. ~~Hover-to-reveal trash/remove icon on person/event/group chips (e.g. removing someone mistakenly added to an event).~~ — **done 2026-07-17**, in stages across a couple of sessions. `GroupDetail.tsx`'s "Who's in this group" chips and `EventDetail.tsx`'s "Who was there" chips both now always navigate to the profile on click, with a separate hover-revealed corner trash badge to remove/untag; suggestion chips on both pages (`GroupDetail.tsx`'s "Also seen at this group's events", `EventDetail.tsx`'s "Also from the affiliated group?") got a matching hover-revealed "×" to permanently deny one suggestion, plus a "× Remove all suggestions" bulk action next to each section's heading once there's more than one to clear. Denying (individually or in bulk) only suppresses the suggestion chip going forward (via `dismissed_person_ids` on `groups`/`moments`) — it does NOT block adding that person later through a normal conversational chat, since `converse`/`update-group`/`update-moment` write directly to `person_groups`/`notes` and never consult that column. `EventDetail.tsx` untagging is specifically non-destructive: it nulls a note's `moment_id` rather than deleting the note, since "attendee" has no separate flag there the way group membership does — the founder was explicit this must never delete real written content. See Section 5 for the two `dismissed_person_ids` columns and Section 10 for their pending manual `ALTER TABLE` steps.
  3. ~~Cap group tiles at ~4 member names, then "+N more" instead of names stacking unevenly.~~ — **done 2026-07-17.** `Groups.tsx` tiles cap member chips at 5 (`MEMBER_LIMIT`), collapsing the rest into "+N more", same pattern as the existing event-chip cap.
  4. ~~Search bar on the People page (client-side name filter).~~ — **done 2026-07-17**, built in a separate session alongside item 5 (`src/components/SearchBox.tsx`, client-side filtering against already-loaded data, no new query).
  5. ~~Search bar on the Events page (client-side filter).~~ — **done 2026-07-17**, same session/commit as item 4. (The Groups page also got a search box as part of the same change, filtering by name/summary/member names — not originally itemized on this list but a natural extension of the same pattern.)
  6. Search within a single group's members/events on `GroupDetail.tsx`.
  7. A filter on People (criteria not yet decided — needs a quick decision on what to filter by, e.g. group membership or upcoming reminders).
  8. Manual tags on events, with AI-suggested tags (similar pattern to existing group-tagging suggestions) — needs a schema change.
  9. AI/"fuzzy" semantic search (e.g. typing "wedding" surfaces wedding-related events without an exact text match) — needs a new AI-backed search Edge Function, not a simple filter.
  11. **Full sibling-group transitive linking — requested 2026-07-17, not yet built, next session.** Founder's exact ask: if Josh is tagged as Jess's sibling, Josh's own profile should automatically show Jess as his sibling too, AND any of Jess's other siblings (e.g. Danny) should automatically also be linked as Josh's siblings — the whole sibling group should stay mutually connected, not just each person individually linked back to whoever they were first tagged against. **Important: the first half of this is already built and deployed** (see Section 6/9's "Key facts generalized..." entry) — `add-fact`'s `family_signals` already writes a reciprocal "Their sibling is X." note the moment a sibling fact is saved, so Jess→Josh already produces Josh→Jess automatically. What's NOT built yet is the second half: Danny and Josh (both already linked to Jess, but not directly to each other) don't get auto-connected as siblings of each other. **Plan for next session:** extend the existing `findSharedParentSuggestions` machinery in `add-fact` (see Section 6) — which already does almost exactly this shape of work for parents — into an equivalent sibling-clique check: when a sibling link is confirmed/added, look at everyone already known as a sibling of either person in the pair, and for any pair among them that ISN'T already linked, surface it the same "suggest, don't assert" way (a Yes/No banner, nothing auto-written) rather than silently declaring full siblinghood. Needs a Section 6-style entry once built, plus the usual Edge Function redeploy step.
     - **Founder follow-up, same day: also flagged that "suggest the shared parents when siblings exist" should exist — this part is ALREADY BUILT** (the `findSharedParentSuggestions` feature described above and in Section 6 — click-tested end-to-end with Steve/Amy → Danny/Josh). Nothing new needed for that half.
     - **Genuinely new ask from the same message: represent family-dynamic variety — half-siblings, step-parents, adoptive parents, etc. — instead of flattening everyone to a plain "sibling"/"parent."** Not built, and **deliberately not started without a check-in first** — this changes the relationship vocabulary itself, which is more of a data-model decision than a UI tweak (per Section 11's "check in before major/architectural decisions" rule). Two shapes worth discussing with the founder before picking one: (a) add qualifier variants as their own relationship types the AI can detect (e.g. "half-sibling", "step-parent", "adoptive-parent" alongside the existing four), with their own Key Facts labels ("Half-sister:" vs "Siblings:"); or (b) keep the four base relationship types but add an optional qualifier field (`{relationship: "sibling", qualifier: "half" | "step" | "adoptive" | null, person_names}`) that both the extraction and reciprocal-note phrasing respect. Whichever shape is chosen, it also changes the shared-parent suggestion logic's assumptions — a "half-sibling" qualifier means only ONE parent is likely shared, not both, so the suggestion should probably ask which parent rather than proposing both. Worth raising as the first question of next session rather than guessing.
  12. **Photo gallery for people/events/groups, added 2026-07-17.** Photos attached to a person/event/group tile, shown as an additional gallery view alongside the text-based memory. **Key constraint surfaced and decided:** a web app cannot silently auto-sync with a phone's photo library — that requires native photo-library permissions (iOS PhotoKit), only possible from a real installed app, tying directly to the founder's eventual iPhone-app goal (see Section 8). Decision: build **manual photo upload/attach now** (with embedded metadata like date-taken used to help auto-suggest which event a photo belongs to, manual tagging as the fallback), and revisit true automatic camera-roll syncing only once/if the native app happens. Likely the most involved item on this list — needs a new Supabase Storage bucket, upload UI across three different tile types, and metadata extraction, not just frontend display logic.
     - **Visual placeholder built 2026-07-17** (`src/components/PhotoGallery.tsx`) — a "Gallery" section with 4 static, decorative pastel tiles (a camera icon, no real images) now appears on `PersonDetail.tsx`, `EventDetail.tsx`, and `GroupDetail.tsx`, captioned "Preview of an upcoming feature — these are placeholders, not real photos yet." This is display-only, to demonstrate the layout/format to the founder: no upload, no storage, no Supabase Storage bucket, no metadata extraction. The actual upload/attach/tagging functionality above is still not built.
- **Edge Function test coverage is a known follow-up, not yet started.** The 2026-07-16 Vitest setup (see Section 3, Section 10) only covers frontend pure-logic helpers. The higher-risk untested code is the AI-classification logic in `converse`/`add-fact` — covering that would require mocking the Anthropic API and the Supabase client, a bigger project than the minimal setup done so far.

- **MASTER LIST — founder's full app-testing feedback, logged 2026-07-18.** This consolidates two long voice-note readings from the founder plus everything still open from the older backlog above (which it supersedes as the working priority list — unfinished items from that list appear here as items 27–30). Cross-session note: the sibling-transitive-linking and family-dynamic-variety asks previously logged "for next session" are items 24–25 here. Work order agreed with the founder: **bugs first, then quick wins, then bigger features.** A standing engineering rule was added to CLAUDE.md the same day (token/billing efficiency + prompt caching) that applies to *all* AI-calling work on this list.

  **Bugs:**
  1. ~~Key Facts disappearing/not updating on person profiles~~ — **fixed 2026-07-18** (see Section 6; pending the Section 10 manual steps to go live).
  2. ~~Refreshing the browser kicks the user back to the home page~~ — **fixed 2026-07-18** via sessionStorage nav persistence (see Section 6). The related-but-separate "Home conversation lost when switching tabs" gap (Section 10) is NOT fixed by this — the chat thread itself still lives in component state.
  3. ~~Clicking a suggested prompt on Home doesn't auto-start the chat~~ — **fixed 2026-07-18** (see Section 6; frontend-only, live on next push).
  4. ~~Notes from person-profile chats sometimes don't save~~ — **fixed 2026-07-18**, root cause was `add-fact` missing the fail-loudly auth check `converse` already had (see Section 6; pending Edge Function redeploy).
  5. ~~Key Facts splits same-type facts across lines~~ — **fixed 2026-07-18** (server-side merge in `person-facts`; same pending deploy as item 1).
  6. ~~Chat output sometimes misspells a person's name~~ — **prompt-level mitigation shipped 2026-07-18** (see Section 6); reduces but can't fully guarantee zero drift in free-text prose, unlike item 7 below which is fixed with certainty.
  7. ~~Person references in chat replies are inconsistently rendered~~ — **fixed with certainty 2026-07-18**: chip labels now always use the canonical profile spelling instead of the AI's raw text, across `converse`/`search`/`add-fact` (see Section 6).

  **Quick wins:**
  8. ~~Total contact count next to "People" heading~~ — **built 2026-07-18**, see Section 6.
  9. ~~Home dashboard stats: total people, events, groups, and notes/data points~~ — **built 2026-07-18**, see Section 6.
  10. ~~Event tiles sized consistently, matching group-tile formatting~~ — **built 2026-07-18**, see Section 6.
  11. ~~Reword suggested prompts ("Let me tell you a story about…", "Take a trip down memory lane about…")~~ — **built and deployed 2026-07-18**, see Section 6.
  12. ~~**Key Facts caching**~~ — **built 2026-07-18** (see Section 6; pending the Section 10 manual steps to go live).
  13. ~~People sorting: date added, alphabetical A–Z/Z–A, relevance, and "timely" relevance~~ — **built 2026-07-18**, see Section 6. The "relevance"/"timely" variants are a pragmatic scoping of the original ask (note count, and nearest upcoming birthday/anniversary) rather than true AI-driven relevance (e.g. "an upcoming reunion surfaces graduation-related people") — that fuller version would need item 14/30's semantic-search machinery and wasn't attempted here.

  **Bigger features:**
  14. Global search bar on every page — type-ahead across people, events, groups. (Decide whether this starts as simple text match or becomes the AI "fuzzy" semantic search from old backlog item 9 / item 30 below.)
  15. **Relationship-aware smarts** (umbrella for ~6 founder asks): answer via family links ("Braden's dog" → spouse's profile note); resolve relative references ("add my parents" → look up the user's own profile); suggest a spouse's last name when blank; auto-suggest family links from note content ("Gavin had a baby" → link mom/dad/baby + notes on all three); background scanning for likely relationships; an approval log on Home where suggestions are approved/rejected.
  16. Auto-notes from chat — when a chat mentions people, add a note to their profiles automatically (events already do this; extend everywhere).
  17. Long story/voice-note handling — chat currently chokes on long stories; support a 1–2 minute recording parsed into all its facts.
  18. Real-time voice transcription (words appear as you speak, Claude-Code-style).
  19. Rules engine — user-defined rules (e.g. "members of group A + group B also belong to group C") plus group hierarchy structure/visualization.
  20. Data visualizations — family tree; connection map of who knows whom.
  21. Internet lookup to add context to answers.
  22. Settings page — event-tile colors, suggestion sensitivity, chat tone (friendly vs matter-of-fact), a profile/library for the user themself, a **terminology library** (user teaches the app their vernacular in advance), and an About section.
  23. **Security** — real hardening (encryption story, 2FA, access control), and an About-page security writeup that only claims what's actually true. Founder: "I don't want it to be bullshit." Requires an honest audit of current state first (note: Section 10's "nothing here has been production-hardened" is the starting reality).
  24. Half-siblings/step-parents/adoptive relationships (family-dynamic variety) — needs the founder decision described in old-backlog item 11's follow-up before building.
  25. Sibling-group transitive linking (the clique-completion half; reciprocal linking already built).
  26. Ratings/feedback loop — thumbs-up/down on suggestions and chat replies, used to tune app behavior over time (expectation set with founder: this tunes the app's suggestions, it does not literally retrain the model).

  **Carried over from the old backlog (still open):**
  27. Photo gallery — the real upload/storage/tagging feature (placeholder tiles shipped 2026-07-17).
  28. Manual + AI-suggested tags on events (schema change).
  29. Search within a single group's members/events on `GroupDetail.tsx`; and a People filter (criteria still undecided — pairs with item 13).
  30. AI/"fuzzy" semantic search (may merge into item 14).
  31. ~~Delete an event, or merge a duplicate event into another~~ — **built 2026-07-19.** `EventDetail.tsx` gained a "Delete this event" / "Merge a duplicate event into this one…" danger zone, same shape/pattern as `PersonDetail.tsx`'s existing Delete/Merge profile feature (commit bcc8fd4). Delete removes the moment, its notes, and its group tags. Merge moves the duplicate's notes (`notes.moment_id`) and group tags over (unioned, not duplicated), deletes the duplicate moment, and clears the primary's cached summary so it regenerates including the merged notes. Click-tested end-to-end.
  32. ~~"Associated Groups" section on a group's own profile~~ — **built 2026-07-19, then upgraded same day to a confirm/suggest model.** The original version (auto-derived from shared events, always shown as fact, no way to remove one) is superseded. The current version: a new `group_associations` table holds CONFIRMED associations (approved by the user), shown as plain chips — click goes to that group's profile, hover reveals a trash badge to unlink. Below that, a suggestion row proposes groups NOT yet confirmed, sourced from two signals — groups tagged to the same events as this one (the original derivation, reusing `EventDetail.tsx`'s "Affiliated Groups" one-hop reasoning) AND groups this group's own explicit members belong to elsewhere — filtered against both confirmed and dismissed (`groups.dismissed_group_ids`, same pattern as `dismissed_person_ids`). Approve/deny on a suggestion chip is the exact same interaction pattern as `GroupDetail.tsx`'s own "Also seen at this group's events" person-suggestion chips (click to approve, hover for an × to dismiss). Section now sits directly above the events list (moved down from just under the summary), and shows "No groups at this time." as a placeholder when there are zero confirmed associations. Building the original version surfaced a real bug in `GroupDetail.tsx`'s existing moments query — see Section 9. **SQL for `group_associations` and `groups.dismissed_group_ids` handed off to the founder to run — see Section 10; the frontend degrades cleanly (empty state, no crash) until then, confirmed via a disposable test-account click-test.**
  33. ~~Group tile chat layout fix~~ — **fixed 2026-07-19.** Root cause: `UpdateGroupChat.tsx` (and, found to have the identical bug, `UpdateMomentChat.tsx` on `EventDetail.tsx`) pinned the input bar to the browser viewport's bottom edge (`position: fixed`) while the message thread grew in normal page flow — so the conversation could end up scrolled far away from the input that was supposedly attached to it. Fixed by switching both to the same in-flow-thread-plus-auto-scroll pattern `Home.tsx` already used correctly (a bounded, internally-scrollable message list immediately above a normal-flow input row, auto-scrolling to the newest message via a bottom ref).
  34. ~~Sort "Who's in this group" and "Who was there" chip lists by last name~~ — **built 2026-07-19.** New `sortByLastName()` helper in `src/lib/people.ts` (falls back to first name when last name is blank), applied to both `GroupDetail.tsx` and `EventDetail.tsx`'s attendee/member/suggestion chip lists. Click-tested end-to-end.
  35. ~~Note-card source labels — extend to Home and per-group/per-event origins~~ — **built 2026-07-19.** Added a `notes.source` text column (set to `"home"` by `converse` on notes it creates) and a `notes.source_group_id` column (set by a new capability added to `update-group`: its chat can now capture a plain fact about a member — e.g. "oh, Bob mentioned he's retiring" — as a note on that person's profile, tagged with the group it came from). `PersonDetail.tsx`'s NoteCard now shows, in priority order, "Added through: [event]" (unchanged) → "From: [Group name]" (clickable) → "From Home" → nothing (native/fact-bar entry, unchanged). `EventDetail.tsx`'s own notes list now also shows a "From Home" tag when applicable. **The `converse` and `update-group` Edge Functions need to be redeployed for the "From Home"/"From: [Group]" labels to actually appear** — see Section 10.
  36. ~~Notes section on Group profiles~~ — **built 2026-07-19.** `GroupDetail.tsx` gained a free-form Notes section (add/edit/delete, same hover-reveals-edit/delete card pattern as `PersonDetail.tsx`'s notes) backed by a new nullable `notes.group_id` column — `notes.person_id` was made nullable to allow a note to belong to a group instead of a person. New additive RLS policies scope group-owned notes to `groups.user_id = auth.uid()`, without touching the existing person-owned-note policies.

  **Parked (not scheduled unless the founder revives them):** automatic email reminders; weather metadata on events; iPhone Contacts integration; the ongoing "AI should ask better follow-up questions" thread (connects to item 17).

## 8. Key UX / Product Decisions (and the reasoning behind them)

- **The founder's real end goal is an iPhone app, not just a web app** — surfaced 2026-07-16 while planning voice input. This doesn't retroactively change the "web app, not native" decision below (nothing about hosting/deployment changed), but it directly shaped the voice-input approach: the free browser Web Speech API's speech-recognition half isn't supported in iPhone Safari at all, so a paid cloud transcription service (OpenAI Whisper, via the new `transcribe` Edge Function) was used instead specifically so voice actually works on iPhone today, without ruling out wrapping this same web app natively later (e.g. with Capacitor) if/when that's pursued. Going fully native was explicitly considered and deferred as too big a detour for now — checked in with the founder first, who confirmed "cheaply/efficiently as possible" is fine for this MVP proof-of-concept stage.

- **Web app (PWA-capable), not native mobile.** Vastly simpler for a beginner to build/deploy than App Store distribution; can be added to a phone home screen later if needed.
- **Email reminders instead of push notifications.** Founder initially wanted true phone push notifications (would have required PWA installability), but explicitly walked this back to "email is probably fine for now" to reduce scope.
- **A shared "People" concept from the start**, rather than building Reminders as a fully standalone feature — a deliberate early decision so that Reminders and Add a Moment (and later, Groups/Events) all reference the same underlying people, avoiding rework.
- **Flexible/open-ended `details` field on moments (jsonb), not fixed columns per category.** Reasoning: a real debrief of an event surfaces unpredictable categories (mood, food, topics, weather mentioned, etc.) that can't be fully enumerated in advance. Trade-off explicitly acknowledged: this makes broad AI-driven search very capable, but is NOT well-suited to structured reporting/analytics later (e.g. "chart every mood logged this year") if that's ever wanted — that would need more rigid columns.
- **`when_text` is free text, not a date field**, because people describe timing loosely ("last weekend," "back in March"). The system compensates by also storing the moment's real `created_at` and having the AI reason about what the relative phrase *actually* meant relative to that real date, plus today's date for anything like "how many years ago."
- **Last name as a separate, AI-correctable field**, added specifically to help disambiguate people/relationships (e.g. recognizing two people share a last name and might be married). Chosen over a plain manual edit field — the founder explicitly preferred the more elegant "smart fact bar" (type a correction in natural language, an AI classification step decides if it's a structured update or a general note) over a simple form field, accepting the added complexity as worthwhile.
- **Renaming a placeholder person instead of creating a duplicate.** A real bug was found and fixed: if a moment mentions an unnamed person (e.g. "her mom"), the AI is instructed to use a clear placeholder name (e.g. "Clare's mom") as its own distinct person — and later, when a real name is given, the conversation logic explicitly treats that as a RENAME of the existing placeholder person, not a new person, to avoid duplicate/fragmented profiles.
- **Home redesigned from one-shot search into a continuous conversational thread**, specifically so follow-up messages can naturally correct, extend, or create memories without restarting — this was a deliberate, explicitly-discussed architecture decision (not an incremental tweak), including agreeing to merge what had been three separate Edge Functions (`search`, `update-moment`, `add-fact`-like logic) into the single `converse` function that decides intent per turn.
- **Groups created conversationally, not via a manual "create group" form** — consistent with the overall product philosophy that the app should feel like talking to someone, not filling out data-entry forms. Groups (and moment-group tagging) can also apply to events, not just people, per the founder's explicit request.
- **Vague, generic questions should synthesize everything known, not require an exact phrase match.** A real bug was found (`tell me about Steve` failed, but a more specific phrasing worked) and fixed by explicitly instructing the AI to treat broad person-questions as "summarize everything," and to never dead-end on a miss — instead suggest a close match or ask a clarifying, memory-jogging question.

## 9. Bugs Found and Fixed (worth knowing so they aren't reintroduced)

- **Key Facts silently disappeared for a person with a lot of notes (found 2026-07-17 by the founder on Jess Volin's real profile)** — the box showed "Gathering what we know…" and then vanished entirely, with no error, even though her notes clearly had extractable facts. Root cause: `person-facts` was still tagging every note with a `[NOTE_ID: ...]` marker and asking Claude to return a `note_ids` array on every extracted fact — a leftover from the edit/delete-on-Key-Facts feature that the 2026-07-17 profile redesign (see Section 6) made obsolete by moving edit/delete to the Notes section instead. For someone with enough notes to generate several facts, all those note-ID arrays ate into the function's 700-token output cap, truncating the response mid-JSON — `JSON.parse` failed, was caught silently, and fell back to "no facts," which made the whole box disappear (it only renders while loading or when there's at least one fact). **Fixed**: removed `note_ids` from the schema entirely (nothing consumes it anymore), raised `max_tokens` to 1500 as a safety margin, added a `response.ok` check with `console.error` logging for the actual upstream error (previously unread `response.json()` silently produced empty `content` on any API-level failure), and switched to the same first-`{`-to-last-`}` tolerant JSON extraction already used in `update-moment` instead of trusting the raw reply to be clean JSON. **Lesson: when a UI element is removed or changed to no longer need a field from a Claude JSON response, remove that field from the prompt/schema too — leaving it in is not just dead code, it's wasted output budget that can push a real response over a token cap for anyone with enough data.**
- **Invalid Anthropic model name** (`claude-sonnet-4-6`) caused every AI call to silently fail, with the app quietly showing a generic "Sorry, I couldn't process that" instead of surfacing the real API error. Fixed by using `claude-sonnet-5` and by improving error visibility during debugging (a temporary DEBUG passthrough was used once and then removed). **If future debugging is needed, don't assume a generic fallback message means the whole system is broken — check Edge Function logs/invocations for the actual upstream error first.**
- **Assistant-message "prefill" trick (`{role: "assistant", content: "{"}`) to force clean JSON output is NOT supported by this model/setup** — it caused a hard `invalid_request_error`. The working fix instead parses the JSON out of the reply text directly (finds the first `{` and last `}` and parses that slice), tolerating any stray text Claude might add around the JSON.
- **Search/converse originally only matched people by first name**, meaning last-name-based questions ("tell me about the Rudigers") silently returned nothing even though the data existed. Fixed by including last names in the name-matching maps built for the AI's context.
- **A search reply could mention multiple people by name in its prose, but only the primary subject got a clickable profile link** — fixed by explicitly instructing the AI that `relevant_people` must include every name mentioned in the reply text, not just the main subject.
- **Two people who were actually one couple's unnamed parents got created as a single merged profile**, and giving their real names afterward didn't fix it. Root cause: the AI was bundling multiple distinct people under one vague label (e.g. "her parents") instead of treating them as separate individuals with separate placeholders. Fixed at the source (instructed to always use one placeholder per distinct individual) plus added a rename mechanism as a safety net.
- **StackBlitz/GitHub workflow was a major source of non-code friction**: a GitHub folder upload silently failed to include the `src` folder (common browser drag-drop limitation), leading to a confusing multi-hour debugging detour chasing a "does the file exist?" Vite error that had nothing to do with the code itself. Ultimately resolved by abandoning the GitHub-import path and creating files directly inside a fresh StackBlitz project instead.
- **Multiple large code pastes were silently truncated mid-paste** (e.g. `AddAMoment.tsx`, `converse`), producing confusing parse errors that looked code-related but were actually paste/environment issues. **Lesson: for large files, prefer providing a downloadable file over a giant inline code block when possible**, and if a paste-related error occurs, first suspect truncation before suspecting logic errors.
- **A stray duplicate declaration and a literal "constconst" typo** crept into the `converse` function during iterative patching. **Lesson: past a certain size/complexity, prefer replacing a whole file cleanly rather than making many small incremental find-and-replace edits to it**, since incremental edits on top of a long conversation are error-prone to track by hand.
- **`verbatimModuleSyntax` (in `tsconfig`) requires type-only imports.** `import { FormEvent } from 'react'` in `Login.tsx`, `People.tsx`, and `PersonDetail.tsx` built fine locally but failed Vercel's build (`error TS1484`) — local dev had been silently tolerating it. Fixed with `import { type FormEvent } from 'react'`. **Lesson: a clean local dev server is not proof a production build will succeed; run `npm run build` locally before assuming a deploy will work.**
- **Supabase's query builder mistypes many-to-one nested joins as arrays, but returns a single object at runtime.** Building the Events and Groups pages, `notes(people(...))` and `moment_groups(groups(...))` were typed by TypeScript as if `people`/`groups` could be arrays (Supabase's JS client can't infer real foreign-key cardinality without generated schema types). Trusting that inferred type instead of the actual database relationship (a note belongs to exactly one person, a moment_groups row tags exactly one group) caused a `TypeError: object is not iterable` at runtime the moment real data loaded, which crashed the whole app to a blank white page with no visible error — because there was no error boundary anywhere. Fixed by (1) matching the code to the real one-to-one/many-to-one shape (a nullable single object, not an array) rather than bending the code to satisfy the type checker, and (2) adding `ErrorBoundary.tsx`, now wrapped around each tab in `App.tsx`, so a future bug like this shows an error message instead of blanking the app. **Lesson: when a Supabase nested-select's inferred TypeScript type doesn't match the actual foreign-key relationship, trust the database schema (check whether the join is really one-to-many or many-to-one) over the type checker, and use `as unknown as T` to correct the type rather than reshaping the code around a wrong inferred type.**
- **A stale/revoked auth session made `converse` silently do nothing while the AI confidently claimed it had saved everything.** Discovered while building group tagging (2026-07-15): a browser had a locally-cached Supabase session whose access token hadn't time-expired yet, but whose underlying session had been revoked server-side ("Session from session_id claim in JWT does not exist"). `supabaseClient.auth.getUser()` inside the Edge Function returned no user in that state, so every insert (`people`, `moments`, `notes`, `groups`, etc.) failed its RLS check and silently did nothing — `.insert().select().single()` just returns `null` data with no thrown error, so the function's existing code never noticed. The AI, unaware anything failed, still generated a normal-sounding "I've recorded this" reply from the model's own text generation, completely disconnected from whether the database write actually happened. This means it's plausible that some past "confirmed working end-to-end" conversational captures never actually saved anything, if they happened to run on a stale session — there was no way to have noticed at the time. **Fixed** by adding an explicit check right after `getUser()`: if there's no user, `converse` now returns a 401 with a "your session has expired, please log out and log back in" reply instead of proceeding. **Lesson: any Supabase insert/update call whose result is only checked via `if (data)` and never via `error` will fail completely silently under RLS — for anything where silent failure would be bad (which is most user-facing writes), check `error` explicitly, or at minimum gate the whole operation on a known-valid `user` up front the way `converse` now does.**
- **First production deploy showed a totally blank white page, with no console errors.** Root cause: Vite bakes `VITE_*` env vars into the bundle at *build time*, not read live at runtime. A Vercel auto-deploy (triggered by a git push) built and shipped *before* the Supabase env vars had been correctly saved in Vercel's dashboard, so `createClient(undefined, undefined)` failed at startup with no visible error. **Lesson: after adding/changing env vars in Vercel, you must trigger a fresh deploy (e.g. "Redeploy" on the latest deployment) — saving the variables alone does not update an already-built deployment.** Also: Vercel's default "Visit" link for a deployment can be a protected preview-style URL (e.g. `boomer-app-2-<hash>-boomer-app.vercel.app`) that silently redirects to a Vercel login page for anyone without dashboard access; the real public URL is the plain `boomer-app-2-eight.vercel.app` production alias.
- **`UpdateMomentChat.tsx` showed the AI's raw completion JSON to the user instead of saving silently**, discovered 2026-07-15 while click-testing the new conversational "add more detail" section on Event detail. The `update-moment` Edge Function's system prompt tells Claude to reply with "ONLY a JSON object... and nothing else," but Claude still sometimes wraps it in a ` ```json ... ``` ` fence, so `JSON.parse(reply.trim())` threw, fell into the `catch`, and the fenced JSON blob was displayed as if it were a normal conversational reply — the note never got saved. This is the same class of bug already documented above for `converse`/`add-fact` (assistant JSON output isn't reliably "clean"), but the fix had never been backported to `UpdateMomentChat.tsx`. **Fixed** the same way: instead of `JSON.parse(reply.trim())`, slice from the first `{` to the last `}` in the reply before parsing, tolerating any stray fencing/text around the JSON. **Lesson: this fix pattern needs to be applied to every place a Claude reply is expected to be parseable JSON, not just the one place it was first found — `add-fact` and any future JSON-expecting call site should be checked too.**
- **`converse`'s `max_tokens: 700` was too low for content-heavy turns**, discovered 2026-07-16 debugging a real "Sorry, I couldn't process that" report. A single message capturing a new moment plus several new people (each needing its own note) generates enough JSON output to get cut off mid-generation, so `JSON.parse` failed and the raw truncated JSON leaked into the chat as the "reply" text instead of a normal sentence. **Fixed** by raising `max_tokens` to 2048, and by making the JSON-parse fallback pull just the `"reply"` field out via regex (instead of dumping the raw truncated text) as a safety net if it ever gets cut off again. Also added `console.error` logging on both a non-OK Anthropic response and a failed JSON parse, since previously any upstream failure was swallowed with zero trace in the Edge Function logs — Invocations showed a plain 200 with no hint anything was wrong. **Lesson: `max_tokens` needs headroom for the richest realistic turn (many new people/notes at once), not just a typical one, and any place an upstream call can fail silently needs a `console.error` so Function Logs are actually useful when something breaks.**
- **A retry after a failed/truncated turn corrupted the saved event text**, found immediately after the `max_tokens` fix above (same 2026-07-16 incident). `raw_description` was built from `messages.map(m => m.content).join("\n")` — the *entire* conversation thread, not just the current message — so once the first (failed) attempt's garbled reply became part of the thread, resending the same message and succeeding saved a mashup of the original text, the failed reply, and the retry all concatenated together as the event's description. **Fixed** by filtering to `role === "user"` messages only before joining. The one event already saved with garbled text from this bug needed a manual fix via the Supabase Table Editor (`moments` table) since there's no in-app edit UI for `raw_description` itself (only the `occasion` title is editable in `EventDetail.tsx`). **Lesson: anything built by joining/concatenating the full message thread should be re-examined for whether prior *assistant* turns (which can contain garbage on a retry) are accidentally included alongside the user's own words.**
- **A clearly-named recurring affiliation (e.g. "AMIC," introduced as "AMIC update from today...") didn't get tagged as a group on first mention**, same 2026-07-16 incident. The group-tagging instructions asked the AI to recognize framing like "my time at the Air Force Academy," but didn't explicitly call out a leading acronym/label pattern, so a single first-mention wasn't enough signal. **Fixed** by adding explicit guidance to treat a name the user leads with as an update's label, or repeatedly refers back to (e.g. "the class," "the program"), as a strong group signal even on its very first mention.
- **The "Remember something else?" chat on Event detail (`UpdateMomentChat.tsx` → `update-moment` function) silently did nothing on failure**, found 2026-07-16 right after the `converse` fixes above, when notes typed there weren't saving despite what looked like a normal conversation. `update-moment` never checked `response.ok` on the Anthropic call at all (worse than `converse`'s original bug) — on a failed/errored API call it just proxied the raw error object back, which has no `content` array, so the frontend's `data.content?.find(...)` came back `undefined` and the reply rendered as a **blank empty chat bubble** with no indication anything had gone wrong. Its `max_tokens: 500` was also the smallest of any of these AI calls, making truncation on a multi-note "done" summary more likely than anywhere else. **Fixed** the same way as `converse`: check `response.ok` and log/return a real error message instead of proxying a raw failure, raised `max_tokens` to 1500, and added a frontend guard in `UpdateMomentChat.tsx` so an empty reply shows an explicit "didn't get a response, try again" bubble instead of nothing. **Not click-tested end-to-end** (no test login credentials available in the session that made this fix) — only verified `npm run build` passes and the app loads without crashing; worth confirming in the app that notes now save reliably through this chat box. **Lesson: `search`/`chat`/`update-moment` being "stale copies" of `converse`'s logic (see Section 10) isn't just a feature-parity gap — the very same reliability bugs (unhandled API errors, low `max_tokens`) need to be checked across all of them, not just the one that happened to get bug reports.**
- **Vercel's GitHub-based auto-deploy silently stopped working for several pushes in a row, 2026-07-16.** After the transcribe-function fix (`db478da`), the next three pushes (`c54af01`, `31f0ace`, `6ad8909` — the auto-grow textarea feature) never appeared in Vercel's Deployments list at all, in any status, even with status filters cleared. Extensive checking ruled out every project-level cause: the GitHub App had "All repositories" access, the connected-repo panel looked normal, Ignored Build Step was "Automatic" (default), no Deploy Hooks were configured. The actual cause was found on **Vercel's own status page** (vercel-status.com): an active incident, "Errors logging in with GitHub" — degraded GitHub login/connection specifically, which broke the deploy trigger for any repo connected that way, including this one. Not caused by anything in this repo or its settings. **Worked around** by installing the Vercel CLI locally (`npx vercel`, added as a devDependency) and deploying directly with `vercel --prod --token=...` using a personal access token the founder generated — this bypasses the broken GitHub connection entirely and deploys straight from local source. Confirmed the correct bundle went live by fetching the deployed JS directly and checking for code unique to the new feature. **Lesson: if pushes to `main` stop showing up as new Vercel deployments at all (not failed, just absent) and every project-level Git setting looks normal, check vercel-status.com before assuming a local misconfiguration** — and the Vercel CLI (now installed) is a ready fallback deploy path that doesn't depend on the GitHub connection. Once Vercel resolves that class of incident, the normal push-to-deploy flow should resume without any further action needed.
- **Two people sharing a first name (e.g. two different "Bob"s, one of them "Bob Jenkins") got confused with each other** — a group tag meant for one of the AMIC "Bob"s was applied to the unrelated "Bob Jenkins" instead. Root cause: `converse`'s name-lookup table mapped *both* a person's full name and their bare first name to their ID; when two people shared a first name, each one's insert silently overwrote the other's bare-first-name entry, so whichever person happened to load last from the database won every lookup by first name alone — regardless of which one was actually meant. **Fixed** two ways: (1) a bare first name now only resolves to a person if it's unique across everyone recorded — if there's a collision, that shortcut is removed entirely, so an ambiguous reference fails to match rather than silently attaching to the wrong person; (2) the system prompt now includes an explicit roster of everyone recorded (full name where a last name is known) plus an instruction to always use full names — never a bare shared first name — when there's a collision, or to ask the user which person is meant if it's unclear. The bad `person_groups` row linking Bob Jenkins to AMIC was removed manually via the Table Editor (no in-app way to remove a group member — see Section 10). **Lesson: any place the AI is given a shorthand way to reference an entity by name (not just people — this could equally bite group names or occasions) needs to consider what happens when that shorthand isn't unique, not just the common case where it is.**

- **A duplicate person record ("Noah" alongside the real "Noah Bach") silently broke the sibling relationship between Noah and Aaron Bach**, found 2026-07-18 by the founder: Noah's profile had a note stating the sibling fact, but it didn't show in Key Facts or as a clickable button, and Aaron's profile had no matching note at all. Investigation found two compounding issues, not one: (1) Aaron's profile no longer had an explicit sibling note — at some point the original fact had been edited/replaced with a note only stating shared parents ("Aaron and Noah's parents are David and Laura Bach"), leaving only the auto-generated reciprocal note on Noah's side ("Their sibling is Aaron Bach.") with nothing grounding it on Aaron's own profile; `person-facts` was inferring the sibling fact from the shared-parents note anyway (arguably over-inferring, since the prompt says never to infer), and the inferred name came back as the bare "Noah" rather than a full name. (2) That bare "Noah" collided with a genuinely separate duplicate person record also named just "Noah" (no last name) — the same ambiguous-first-name guard used everywhere else in this app (`converse`/`add-fact`/`person-facts`) correctly refused to resolve the ambiguous name to either person, so the Key Facts bullet rendered as plain text instead of a button. **Fixed** two ways: added an explicit note naming "Noah Bach" in full on Aaron's profile (grounding the fact properly instead of relying on inference), and merged the duplicate "Noah" into "Noah Bach" using the new Merge feature (see Section 6) — which also folded "Noah" into "Noah Bach"'s nicknames, so any old note text that only ever says the bare first name now resolves correctly since there's no longer a second "Noah" to collide with. **Lesson: a Key Facts bullet with no matching button is a useful signal on its own — it means the extracted name didn't uniquely resolve to a person, which is either a genuine duplicate person record or an ambiguous/missing full name in the source note, not a bug to route around case-by-case.** Also worth noting: this was the first session where the founder logged into the live app directly in the assistant's browser preview, letting the assistant click-test changes end-to-end for the first time — every earlier "not click-tested, login limitation" caveat elsewhere in this doc was a workaround for not having that; it's not a standing constraint, just something that hadn't been done yet.
- **`vite.config.ts` didn't respect the `PORT` env var, breaking the AI assistant's browser-preview tool whenever port 5173 was already taken** (e.g. by another session's dev server), discovered 2026-07-17. The preview tool assigns a free port via `PORT` and expects the dev server to bind there, but Vite's default port (5173) is hardcoded unless `server.port` is explicitly configured, so Vite silently fell back to its own auto-increment (5174) instead — a port the tool's proxy didn't know about, so navigation to the "assigned" URL just hung/failed. **Fixed** by adding `server: { port: process.env.PORT ? Number(process.env.PORT) : 5173 }` to `vite.config.ts`, plus `"autoPort": true` in `.claude/launch.json`. This doesn't affect `npm run dev` run normally (still defaults to 5173) — only matters when something else has that port occupied.
- **"Who was there" silently failed to include people mentioned in the event chat**, found 2026-07-17 right after the autosave fix above. Root cause was two compounding gaps in `update-moment`, neither present in `converse`: (1) attendee chips on `EventDetail.tsx` are derived ENTIRELY from `notes` rows tied to the moment (`for (const n of moment.notes) if (n.people) attendees.set(...)`) — there's no separate "attendee" concept — but the system prompt never told the AI that a bare "so-and-so was there too" mention (with no other fact about that person) still needed a note; the AI would often add the person via `new_people` and stop there, so they were created but never linked to this moment, and silently never appeared. (2) `update-moment` never gave the AI a roster of already-recorded people (unlike `converse`, which does) and only matched names by bare first name — so a full-name mention, or two people sharing a first name, could either fail to match an existing person (creating an unwanted duplicate) or attach to the wrong same-named person entirely (the exact "two Bobs" class of bug documented below). **Fixed** by porting `converse`'s roster + full-name/ambiguous-first-name matching logic into `update-moment` unchanged, adding a peopleRoster string to the prompt, and adding an explicit instruction that ANY mention of someone being present must produce an `additional_notes` entry for them (even a bare "Was there.") since that's the only thing that makes them show up. Also fixed new-person inserts to split first/last name the same way `converse` does (previously a full "First Last" string was saved entirely into the first-name field). **Confirmed deployed and working 2026-07-18** via a live click-test (disposable test account): mentioning a new person's presence in an event's "Remember something else?" chat correctly created and linked them as an attendee.
- **`UpdateMomentChat.tsx`'s "Remember something else?" chat only saved anything once the AI's final "done" turn was reached**, found 2026-07-17 by the founder: they typed a detail ("I believe the event was in fall of 2025"), got back "Anything else you'd like to add?", didn't reply, and navigated away — nothing was saved. The founder noted most people don't bother replying to an AI's closing follow-up question, so gating every save behind that final turn meant routine non-replies silently lost data. Root cause: unlike `converse` (which saves everything it extracts on every single turn, immediately, regardless of whether the conversation continues), `update-moment` only parsed/saved `new_people`/`additional_notes` from the one turn where the model happened to emit `{"done": true, ...}` — any turn before that just showed conversational text and saved nothing. **Fixed** by rewriting `update-moment/index.ts` to match `converse`'s pattern: it now always returns structured JSON (`{reply, done, new_people, additional_notes, moment_field_updates}`) and persists whatever's new to the database itself, server-side, on every turn — "done" is now purely a "stop asking follow-ups" signal, not a gate on saving. Since each call re-fetches the moment's current state fresh from the DB, whatever got saved on turn N is already reflected in the "already known" context built for turn N+1, so the model naturally doesn't re-save the same fact twice. `UpdateMomentChat.tsx` was simplified to match — it no longer does its own Supabase writes (`saveUpdates` was removed entirely) or parses JSON out of the reply text; it just displays whatever `reply` string the function returns and calls `onSaved()` whenever the function reports `changed: true`. `EventDetail.tsx`'s `loadMoment()` gained a `silent` parameter so this per-turn refresh doesn't flash the whole page to "Loading…" and unmount the in-progress chat (and its local message-thread state) on every save. **Confirmed deployed and working 2026-07-18**: a live test added a date correction, got the AI's closing follow-up question, deliberately did NOT reply, and navigated away to a different tab and back — the correction was already saved.
- **Same incident, second half:** the founder also noticed that a timing correction like "fall of 2025" never touched the Date shown next to the location link on the event page — it wasn't just an autosave-timing issue, `update-moment` had no way to update the moment's own `when_text`/`event_date`/`location`/`occasion` fields at all, only ever add per-person notes (so a bare timing correction with no named person attached had nowhere real to go). **Fixed** as part of the same rewrite: the AI now returns a `moment_field_updates` object (only the fields actually being corrected that turn, e.g. `{"when_text": "fall of 2025", "event_date": "2025-09-01"}`), resolved against today's date the same way `converse` resolves a brand-new moment's `event_date` (season → 1st of that season's month, month/year → the 1st, year-only → Jan 1), which the function writes straight to the `moments` row. This only updates `EventDetail.tsx`'s own meta line (`when_text`); it does NOT backport the same season-phrase resolution into `converse`'s brand-new-moment capture path, which still only explicitly handles specific month/year or year-only phrasing — worth doing later if a similar gap shows up there. **Confirmed deployed and working 2026-07-18** via a live click-test (disposable test account): correcting an event's date in the "Remember something else?" chat immediately updated the date shown on the event page.
- **A full name-spelling correction typed into a person's fact bar (e.g. "Their name is spelled Jonathan Smith") only ever updated the last name, silently dropping the first name**, found 2026-07-17 by the founder. Root cause: `add-fact`'s classifier only ever had a `last_name_update` type — there was no way for its response shape to carry a first-name change at all, so when the AI correctly recognized a full-name correction, it had nowhere to put the first-name half and that part was just lost. This wasn't a save-timing bug like the ones above — the fact bar already calls `loadData()` right after every submit, so a successful update was always reflected immediately; the gap was purely that the classification/update logic had no first-name path to begin with. **Fixed** by replacing `last_name_update` with a more general `name_update` type whose value is `{"first_name": ... or null, "last_name": ... or null}` — the AI includes whichever part(s) the text is actually giving or correcting (a bare "Her last name is Peterson" only sets `last_name`; a full "Jonathan Smith" sets both, treated as the authoritative spelling of the whole name even if one part already matched what was on file). `add-fact/index.ts`'s system prompt was also given the person's current first name (previously it only saw the last name), and the apply step now writes to `people.name` and/or `people.last_name` depending on which fields came back non-null. `PersonDetail.tsx` was not changed — no first-name click-to-edit cell was added, since the ask was specifically about the chat/fact bar working correctly, and the existing "Last name" cell pattern was left as-is for a possible later follow-up. Build passes (no frontend files changed). **Deployed and confirmed working 2026-07-17** via a live click-test (disposable test account): typed "Their name is spelled Mariana Volinsky" into a person previously on file as just "Maria" with no last name — the page heading and the Last name cell both updated immediately, to "Mariana Volinsky" and "Volinsky" respectively.
- **Describing several separate events in one Home message caused a hard failure ("Sorry, I couldn't process that")**, found 2026-07-17 by the founder trying to catch up on four different things (a race, a friend's engagement trip, a bachelor party, a staycation) in a single message. Root cause: `converse`'s per-turn JSON contract could only ever represent ONE new/updated moment per turn (singular `moment_id`/`new_moment`/`moment_fields`/`notes`/`moment_groups` fields) — there was no way for the AI to express "these are four separate events," so faced with a message that genuinely described four, it produced output that didn't match the expected shape at all, which failed both `JSON.parse` and the regex fallback that normally rescues a merely-truncated reply. **Fixed** with a real restructuring, checked in with the founder first given the size of the change (this is the most central function in the app): the contract now has a `moments` array instead of singular fields — the AI includes one independent entry per distinct event (own `moment_fields`/`notes`/`moment_groups` each), and the prompt explicitly instructs it to split multiple events into separate entries rather than merging or dropping any, capturing all of them directly (not asking a follow-up per event) when the message already gives enough detail for each. `max_tokens` was also raised 2048 → 4096 to give a multi-event turn enough headroom. The apply logic now loops over `parsed.moments`, resolving/creating each one independently and collecting every touched moment ID. The response shape changed from singular `momentId` to a `momentIds` array; `Home.tsx` was updated to match — it now does one parallel Supabase fetch per touched moment (instead of one fetch for a single `momentId`) and renders one `EventChip` per event, so a single multi-event message now shows multiple event chips at once, the same way `people`/`groups` chips already handled multiple items. Build passes; regression-tested live against the still-old-deployed `converse` (a normal single-question turn still works fine and shows a person chip, since `Home.tsx`'s new code just treats a missing `momentIds` as an empty array — no crash). **Deployed by the founder 2026-07-17 and confirmed working end-to-end** via a live click-test (disposable test account) of the exact original four-events repro: three of the four (the Ironman, the bachelor party, the Breckenridge staycation) were captured immediately, each with its own `EventChip`, and the AI correctly asked a follow-up only for the fourth (the Washington DC trip, which had no date in the original message) instead of failing outright or dropping it — replying with a date completed that one too. Confirmed via the Events page afterward that all four exist as separate, correctly-attributed records with the right people/location/date each.
- **A note about the "Triple Bypass" bike race got silently discarded on the event-chat, replaced with a generic "Sorry, I didn't get a response there" bubble**, found 2026-07-18 by the founder. Root cause was two compounding gaps: (1) `update-moment` only ever gave the AI context about the *current* moment being edited — unlike `converse`, it never saw a roster of the user's *other* saved events — so when the note referenced "the triple bypass" (an existing event named "Triple Bypass," a bike race), the AI had no way to recognize that and read it as a literal medical procedure instead, which appears to have made it break out of the required JSON reply format; (2) when that happens, the fallback parser found no `"reply"` key at all and fell back to a generic unhelpful message, silently dropping whatever the user had just typed with zero retry and zero record of the failed save. **Fixed** three ways: added an `otherEventsRoster` (name + rough timing of every other saved moment) to the system prompt, the same pattern `converse` already uses, plus an explicit instruction to check that roster before assuming an ambiguous term means something else, and to ask a direct clarifying question (still wrapped in valid JSON) rather than guess when genuinely unsure; added a one-time automatic retry when the model's reply fails to parse into JSON at all, since this class of format slip is usually a one-off; and fixed `update-moment` to actually check `.error` on each note insert instead of assuming every insert succeeded (the same class of gap `add-fact` had before its 2026-07-18 fix), returning an honest "that didn't save" reply if every note in a turn failed. **Lesson: any Edge Function that resolves user-typed shorthand against "what's already known" needs the full relevant roster (people AND events), not just whatever's scoped to the current record — an AI with a narrower view than the user's own mental model will guess wrong on exactly the references a human would find obvious.** **Confirmed deployed and working 2026-07-18**: a live test created a second event, then mentioned "the triple bypass" in that second event's own update-chat — it correctly recognized the existing bike race (via `otherEventsRoster`) instead of misreading it as a medical procedure.

- **A recurring "no Supabase access token this session" / "login limitation" caveat throughout this doc turned out not to be a hard blocker.** 2026-07-18: without any Supabase CLI login or access token, live deploy/schema status was fully verified two ways: (1) querying the PostgREST endpoint directly with the anon key from `.env` — a column that doesn't exist yet returns a 400 error, one that exists returns 200 even with no matching rows, so every pending `ALTER TABLE` could be checked with one curl call each; (2) calling each Edge Function URL directly — Supabase returns a distinct `{"code":"NOT_FOUND",...}` for a function that was never deployed at all, versus the function's own error response (e.g. `{"error":"Moment not found"}`) if it exists and ran its own code, so "is this function even deployed" is answerable without any login. For anything needing an actual logged-in user (testing real feature behavior, not just "does it exist"), signing up a disposable test account directly in the browser preview (same pattern as the founder's own disposable-account click-tests elsewhere in this doc) works fine and needs no credentials from the founder. **Future sessions should default to this instead of assuming they have to wait for the founder to click through the dashboard or hand over a login.**
- **A Supabase nested-select filter (`.eq('moment_groups.group_id', groupId)` combined with `moment_groups!inner(...)`) silently filters the EMBEDDED array too, not just which parent rows are returned** — found 2026-07-19 building the "Associated Groups" feature (master list item 32). `GroupDetail.tsx`'s moments query used exactly this pattern to find "moments tagged to this group," which correctly returned only the right moments, but as a side effect also trimmed each returned moment's own `moment_groups` array down to just the one row matching the filter — so a moment tagged to two groups (e.g. an event tagged to both "AMIC" and "Air Force Academy") would only ever show ONE of those tags when read back this way, making it impossible to derive "what else is this moment tagged to." **Fixed** by splitting into two queries: first a plain `moment_groups` lookup to get the list of moment IDs tagged to this group (no embedding, so no filtering side effect), then a separate `moments` query using `.in('id', momentIds)` with an unfiltered `moment_groups(...)` embed, which returns every group tag on each moment. **Lesson: a `.eq()` filter on a nested/embedded resource in a Supabase query filters that embedded resource's own rows in the response, not just which parent rows qualify — if you need the full unfiltered related rows for a parent you've already filtered some other way, use two queries instead of one filtered embed.** Click-tested end-to-end after the fix (AMIC and Air Force Academy, sharing one tagged event, correctly show each other under "Associated Groups").
- **Every person's Notes section silently went blank ("Nothing recorded yet") even for people with a long real history** — found 2026-07-19 by the founder ("people are missing notes... as an example, Isma"). Root cause: `notes` gained a SECOND foreign key to `groups` in the same 2026-07-19 batch that added the first — `source_group_id` (item 35, "From: [Group]" note labels) and `group_id` (item 36, group-owned notes) were both added to the `notes` table, and `PersonDetail.tsx`'s notes query embedded the related group with a bare, unqualified `groups(id, name)`. That was fine with one FK; with two, PostgREST can no longer infer which relationship is meant and returns an error (`PGRST201`, "Could not embed because more than one relationship was found") instead of data — so `notesRes.data` came back `null`, and `setNotes(notesRes.data ?? [])` silently fell back to an empty array, exactly the same "unchecked `.error`" failure shape documented repeatedly elsewhere in this section. This broke literally every profile in the app, not just Isma's — it only happened to surface on profiles someone actually looked at closely. Confirmed via a direct PostgREST call (bypassing the frontend) that Isma's 6 real notes were untouched in the database the entire time; nothing was lost. **Fixed** by qualifying the embed to the specific FK actually wanted for the "From: [Group]" label — `groups:groups!notes_source_group_id_fkey(id, name)` — leaving the `group_id` relationship (used elsewhere for group-owned notes) alone. Click-tested end-to-end: Isma's profile now shows all 6 notes again. **Lesson: adding a second foreign key from a table to one already involved in an existing embed is a breaking change for that embed, not an additive one — PostgREST needs the relationship named explicitly (`table!constraint_name`) the moment there's more than one path, and an unqualified embed that worked before will start erroring for everyone, not just new data. Grep for every other unqualified embed of the same two tables when this kind of schema change happens.**

- **Git had fallen out of sync with what was actually deployed to Supabase**, found 2026-07-19 investigating a "home page not responding" report. `converse`, `add-fact`, `person-facts`, `update-group`, `update-moment` all had uncommitted local changes adding `cache_control: {type: "ephemeral"}` prompt-cache breakpoints (per CLAUDE.md's token-efficiency rule) plus deterministic `.order()` calls on every roster/moment query in `converse` (Postgres doesn't guarantee row order without one, so identical data could come back reshuffled between turns and silently bust the cache-prefix match) — and `chat`/`search` were deleted locally, superseded by `converse`. Verified live before touching anything: called the deployed `converse` function directly and confirmed `cache_read_input_tokens` was nonzero on a second turn (caching genuinely working in production), and confirmed via direct fetch that `chat`/`search` both 404 on Supabase already. So all of this had actually been deployed (likely pasted into the Supabase dashboard directly in an earlier session) but never committed — committed and pushed to reconcile git with reality. **Lesson: a `git status` showing uncommitted changes doesn't mean unfinished work — for this repo, Edge Function edits can be deployed straight from the Supabase dashboard, so always check what's actually live (see the token-free verification technique two entries up) before assuming local diffs are pending.**
- **Root cause of the "home page not responding" report: `suggest-prompts` had no caching at all**, found the same session. Unlike every other AI-calling function in this app, it called the Anthropic API fresh on every single Home page load (confirmed live: ~3.8–4.1s per call, 3/3 test calls, no DB persistence, no timeout/AbortController) — the exact "regenerate on every page view" anti-pattern CLAUDE.md's token-efficiency rule calls out by name. The rest of the page (stats, leaderboard) loaded fine in parallel; it was specifically the "Finding a few things to ask about…" suggestions box that hung for several seconds on every visit, which read as the app being unresponsive. **Fixed 2026-07-19**, checked in with the founder first on the invalidation approach (schema change): added a new `home_suggestions` table (`user_id` PK → `auth.users`, `suggestions` jsonb, `updated_at`) with the same serve-cache-by-default pattern as `person-facts`'s `key_facts` — a plain Home visit now returns the cached row (confirmed live: 448ms, `cached: true`, no Anthropic call) and only regenerates when a moment or note was recorded more recently than the cache, or via a new "Refresh suggestions" icon added next to the suggestion list on `Home.tsx` (mirrors `PersonDetail.tsx`'s `RefreshButton` pattern exactly). Table + RLS policies were applied via the Supabase Management API's `POST /v1/projects/{ref}/database/query` endpoint (no CLI DB password needed, just the same personal access token used for `functions deploy` — see [[project-boomer-infra]]) since this session had a fresh access token rather than the usual dashboard-paste fallback.

- **Key Facts rendered relationship categories in whatever order the AI happened to extract them in, so the same kind of fact (Parents, Spouse, Siblings, Children) could appear in a different position from one profile to the next** — found 2026-07-19 as a UX-consistency request from the founder. `person-facts`'s `facts` array order simply follows the model's raw JSON output order (and, before this fix, `PersonDetail.tsx` rendered `keyFacts.map(...)` with no re-sort), so one person's profile might show "Married to..." before "Parents:" while another showed the reverse, purely by chance of what the model emitted first. **Fixed client-side** in `PersonDetail.tsx`: added a `sortKeyFacts()` helper with a fixed category-priority order (parents → spouse → siblings → kids), applied via a stable sort right after `loadFacts()` receives the response, so it re-orders both freshly-generated and already-cached `key_facts` rows without needing any backend change or cache invalidation. Non-relationship categories (location, education, other) keep their original relative order, appended after the four relationship categories. Click-tested: Josh Volin's profile (Parents, then Married to, then sibling note) and Steve Volin's profile (Married to, then Children — no parents/siblings fact present) both confirmed the fixed order.
- **A married couple named together with only the last person spelled out (e.g. "Josh's parents are Amy and Steve Volin") failed to link the first name to their existing profile**, found 2026-07-19 by the founder on Josh Volin's real profile ("Amy" showed as plain unlinked text in Key Facts, "Steve Volin" as a real link, even though an "Amy Volin" profile already existed). Root cause was in `_shared/relationships.ts`'s `applyFamilySignals`: the AI extraction step split the sentence into `person_names: ["Amy", "Steve Volin"]` — nothing told it that a shared trailing surname applies to every name in the group, not just the one it's printed next to — and `isConfidentMatch` (by design) only links a name that matches someone's FULL name on file, so bare "Amy" couldn't confidently resolve to "Amy Volin" and fell into a "new person?" suggestion instead of linking the real existing person. **Fixed** by adding an explicit instruction to the shared `CATEGORY_DESCRIPTIONS` prompt text (used by all four callers — `add-fact`, `converse`, `update-moment`, `update-group`, so one fix covers every entry point): when multiple people are named together and only the last has a surname, write out each full name in `person_names` (e.g. `["Amy Volin", "Steve Volin"]`), since a married couple is almost always described this way rather than "Amy Volin and Steve Volin." Deployed via `npx supabase functions deploy add-fact converse update-moment update-group`. **Confirmed deployed and working 2026-07-19** via a live click-test on Josh Volin's real profile: re-submitting "His parents are Amy and Steve Volin." through the fact bar correctly matched both existing profiles (confirmation banner: "Amy Volin and Steve Volin's profiles have been updated to reflect this relationship."), wrote proper reciprocal notes ("Their parent is Amy Volin." / "Their parent is Steve Volin."), and Key Facts now shows both as clickable links after a refresh.

## 10. Known Limitations / Things NOT Yet Done

- ~~"Deny a suggestion" (see Section 6, 2026-07-17) is code-complete but NOT yet live~~ — **confirmed live 2026-07-18.** `ALTER TABLE groups ADD COLUMN dismissed_person_ids ...` and the `moments` equivalent have both been run — verified directly against the live database (both columns queryable with no error) and by loading a real group's and a real event's detail page end-to-end in a fresh test account with no failure.
- ~~Event AI-summary feature (see Section 6, `summarize-moment`) is code-complete but NOT yet live~~ — **confirmed live 2026-07-18.** `moments.summary` exists and the `summarize-moment` function is deployed (confirmed distinct from Supabase's genuine "function not found" response) and was click-tested end-to-end: opening a real event generated and displayed a real AI summary, and a follow-up correction (date fix) correctly regenerated it.
- **No automatic email sending** for reminders (table exists, no sending logic).
- **Voice input (see Section 6) is now confirmed working as of 2026-07-16** — the `OPENAI_API_KEY` secret was missing in Supabase (not a billing issue as first suspected), fixed once the founder added it under Edge Functions → Secrets. Verified via a direct call to the deployed function (got real transcribed text back). Not yet click-tested inside the actual app UI by anyone since the fix — worth the founder trying the mic button again to confirm the full loop.
- **Email confirmation is disabled** in Supabase Auth (was turned off specifically to ease local testing, since Supabase's default confirmation link points to `localhost:3000`, which doesn't resolve in StackBlitz). **This must be reconsidered/re-enabled before any real users sign up**, or a proper redirect URL must be configured.
- **Production deployment now live** on Vercel (`https://boomer-app-2-eight.vercel.app/`), auto-deploying from GitHub `main` — resolved as of 2026-07-15 (see Section 3, Section 9).
- **`search`, `chat`, and `update-moment` Edge Functions may be stale/out of sync** with the improvements made to `converse` (date reasoning, last-name matching, relevant_people-mentions-everyone, graceful "nothing found" handling, etc.) since those fixes were applied to `converse` but not necessarily backported. `chat` is now fully unused by the frontend (`AddAMoment.tsx` was removed) and is a candidate for deletion rather than backporting; `update-moment` is still used by `PersonDetail.tsx`'s fact bar via `UpdateMomentChat.tsx`.
- ~~No in-app way to remove a person from a group, or a group from a moment~~ — **resolved 2026-07-16** via the new "Edit this group" conversational chat on `GroupDetail.tsx` (see Section 6's group-editing feature). Not yet click-tested end-to-end by the assistant; keeping this line until the founder confirms a real removal works, since a bad name-match in that flow would silently do nothing (same class of risk as any AI-driven write elsewhere in this doc).
- **Note-card source labels (master list item 35) are code-complete but the "From Home"/"From: [Group name]" labels won't actually appear until `converse` and `update-group` are redeployed.** The 2026-07-19 `notes` schema change (`source`, `source_group_id`, `group_id` columns — see Section 5) has been run and confirmed live; the frontend rendering logic that reads those columns is deployed (any push to `main` ships it); but the two Edge Functions that WRITE those columns are still running their pre-2026-07-19 code until manually redeployed (no Supabase access token was available this session — see the CLI-auth notes in Section 3/9). Until then: new notes just get `source: null`/`source_group_id: null` same as before, which fails gracefully to no label (not a crash) — this is a missing-feature gap, not a bug. **To finish this: paste the updated `supabase/functions/converse/index.ts` and `supabase/functions/update-group/index.ts` into their respective Supabase dashboard Edge Function Code tabs and click Deploy**, or run `npx supabase functions deploy converse` / `npx supabase functions deploy update-group` with a fresh access token.
- **No error boundaries existed anywhere until 2026-07-15** — a crash in any one page used to blank the entire app with zero on-screen feedback. A generic `ErrorBoundary` now wraps each tab (see Section 4, Section 9), but it only shows a raw error message/stack trace, which is fine for debugging but not something a non-technical end user should ever actually see — worth designing a friendlier fallback before this goes to real users.
- **AI conversation quality (depth of follow-up questions) is an acknowledged ongoing weakness**, not a solved problem — expect the founder to keep raising this.
- **Minimal automated test setup added 2026-07-16 (Vitest).** `npm run test` runs `src/lib/dates.test.ts` and `src/lib/summarize.test.ts` — covering the two small pure-logic helpers in `src/lib/` (`eventSortDate`/`formatMonthYear`, moved out of duplicate copies in `Events.tsx` and `GroupDetail.tsx` into a shared `src/lib/dates.ts`, and `summarize`). This only covers frontend pure functions, not components or the Edge Functions — the AI-classification logic in `converse`/`add-fact`/etc. still has zero test coverage, since testing those would mean mocking the Anthropic API and Supabase client (a bigger follow-up project, not done yet). All other verification is still manual, click-through testing in the browser preview before each push.
- **UUIDs in the demo seed-data SQL were handwritten/generated by the assistant for demo purposes** (e.g. `10000000-0000-0000-0000-000000000001`) — these are NOT how real user data will look; don't assume production IDs follow any particular pattern.
- **`chat` and `search` likely have the same silent-failure pattern that `converse` had** (see Section 9's stale-session bug) — not yet audited to confirm they check for a missing/unauthenticated user before writing, or check `.error` on inserts. `converse`, `add-fact`, and (as of the 2026-07-18 "Triple Bypass" fix, see Section 9) `update-moment` have all been fixed. `chat` is unused by the frontend and a deletion candidate rather than worth fixing.
- ~~The 2026-07-17 group-membership fix... `summarize-group` and `update-group` need to be manually redeployed~~ — **both are confirmed deployed as of 2026-07-18** (live, not a Supabase platform 404). **But a live test the same day found the underlying bug is only half-fixed**: `summarize-group`'s query logic correctly builds its `Members:` line from `person_groups` only (excluding event attendees, per the comment already in `supabase/functions/summarize-group/index.ts`), and the group page's own roster list is correct. However, the AI-written one-sentence summary still named a non-member — a test group had exactly one real member (Sam Rivera) plus a tagged event whose raw description happened to name a second person (Jordan Lee, who only attended that event, never added as a group member) — and the generated summary read "A small cycling group of Sam Rivera **and Jordan Lee**...", folding the attendee into "members" wording anyway. Root cause: the event's own text (`occasion || raw_description`) still names attendees, so even with a correct `Members:` line in the prompt, the model conflates "mentioned in a tagged event" with "is a member." — **Fixed 2026-07-18**: `summarize-group`'s events line now explicitly notes those descriptions "may mention other people who were just at that one event, not necessarily group members," and the system prompt itself has an added CRITICAL instruction to only ever call the people listed under `Members:` members, never anyone else even if named in an event description (`supabase/functions/summarize-group/index.ts`). Code-complete but **NOT yet deployed** — needs the usual manual Edge Function redeploy (paste into the Supabase dashboard, or `npx supabase functions deploy summarize-group` with a fresh access token); worth the founder regenerating that same Sam/Jordan test group's summary afterward (the refresh button on `GroupDetail.tsx`) to confirm it no longer calls Jordan a member.
- ~~`person-facts` Edge Function needs one more manual REdeploy for the token-truncation fix~~ — **deployed and confirmed 2026-07-17**, including a deliberate stress test (not just the original bug report): 25 notes were added to a single test profile (mixing relationship facts, hobbies, travel, physical description, etc.) and Key Facts still extracted fully and correctly — Siblings, Parents, education, location, and two "other" facts all appeared with no truncation and no silent disappearance, and the missing-info nudge box correctly narrowed down to just the one still-unknown category ("Does Jess have kids?"). Both `add-fact` and `person-facts` are now fully deployed and confirmed working for everything in Section 6's relationship-linking entries.
- ~~`add-fact` Edge Function needs a manual REdeploy~~ — **deployed and confirmed working end-to-end 2026-07-17**: reciprocal writes, siblings/parents/children linking, and the shared-parent suggestion banners (in both trigger directions) were all click-tested live via a disposable test account (Jess/Danny/Josh/Steve/Amy) with real results matching the design exactly, including confirming a suggestion actually writes the note onto the other person's profile. One thing worth knowing: this redeploy is not retroactive — facts typed before it was deployed won't get the reciprocal write; only new facts going forward do.
- ~~Nicknames feature (see Section 6, 2026-07-17) is code-complete but NOT yet live~~ — **confirmed live 2026-07-18.** `people.nicknames` exists, and a live test confirmed the People.tsx search box correctly finds someone by a nickname stored in that column, and that `add-fact`'s fact bar correctly writes a stated nickname there. **However, a real gap was found in the same test, not a deploy issue: `converse` (the main Home chat) never writes to `people.nicknames` at all** — it only reads/matches existing nicknames for the "two Bobs" ambiguity guard (`supabase/functions/converse/index.ts`, `new_people` is just a list of name strings with no nickname field). So if someone says "my friend Sam, who goes by Sammy" in the Home chat, Boomer records it as a plain sentence in Sam's notes but never actually saves "Sammy" as a searchable nickname — only typing it directly into the person's own fact bar does. — **Fixed 2026-07-18**: `converse`'s JSON contract gained a `nickname_updates` field (`{"person": "...", "nicknames": ["NewNickname1"]}`, mirroring `last_name_updates`), a system-prompt instruction to recognize "goes by"/nickname phrasing mid-conversation, and a handler that additively merges into `people.nicknames` (same dedupe-by-lowercase logic `add-fact` already uses) (`supabase/functions/converse/index.ts`). Code-complete but **NOT yet deployed** — needs a manual redeploy of `converse` (paste into the Supabase dashboard, or `npx supabase functions deploy converse` with a fresh access token) before "my friend Sam, who goes by Sammy" actually saves a searchable nickname; worth the founder trying that exact phrasing in Home afterward and then searching "Sammy" on the People page to confirm. Note: `update-moment` and `person-facts` have the identical gap (nicknames used for lookup only, never written) — not fixed here, since neither was part of the reported bug; worth a follow-up if a nickname stated through those paths turns out to have the same problem.
- ~~Key Facts caching (see Section 6, 2026-07-18) is code-complete but NOT yet live~~ — **confirmed live 2026-07-18.** Both `people.key_facts`/`key_facts_updated_at` columns exist and `person-facts` is deployed; a live test showed a person's Key Facts saved to the database with a timestamp and served back from that cache (not regenerated) on a later profile view.
- ~~Associated Groups (master list item 32, upgraded 2026-07-19) is code-complete but NOT yet live~~ — **confirmed live 2026-07-19.** The founder ran the handed-off SQL; `group_associations` and `groups.dismissed_group_ids` both confirmed to exist via direct PostgREST query. Full loop click-tested end-to-end in a disposable test account (two groups, "Book Club" and "Hiking Crew," sharing a member): a member-based suggestion correctly appeared on each group's page for the other, approving one correctly created a symmetric confirmed link visible on both groups' pages, hovering a confirmed chip and clicking its trash badge correctly removed the link (and the suggestion correctly reappeared, since the underlying shared-member signal was still there), and hovering a suggestion chip and clicking its "×" correctly dismissed it permanently (confirmed by reloading fresh from the DB — the dismissed suggestion did not reappear). Zero console errors throughout.
- **Home's conversation thread is lost when you switch tabs.** `Home.tsx` keeps its chat history in local component state, and `App.tsx` unmounts `Home` entirely when you navigate to another tab, so an in-progress conversation (including one where the AI just asked a follow-up question before saving) resets to empty if you leave and come back. Noticed 2026-07-15 while testing group tagging; not fixed, just flagging it as a real UX gap.

- ~~"New relationship suggestion" banner (see Section 6, 2026-07-19) — confidence-check fix needs a manual redeploy~~ — **confirmed live and working 2026-07-19**: the founder re-tested the exact "dating a girl named Olivia" repro after redeploying `add-fact` — it correctly asked "is this the same person as Olivia Gillingham?", the founder said no, it then asked about creating a new contact, the founder said no again, and it correctly fell back to saving just a plain note with no relationship linked to either profile. **However, the same test surfaced a second, independent occurrence of the identical bug**: Gus's Key Facts panel still showed a "Dating: Olivia Gillingham" clickable chip. Root cause: `person-facts` (the function that generates Key Facts) does its own separate AI extraction pass over a person's raw note text and its own from-scratch name-to-person resolution (`supabase/functions/person-facts/index.ts`) — it never goes through `add-fact`'s `family_signals`/suggestion mechanism at all, so fixing that mechanism didn't touch this code path. The plain note ("Is dating a girl named Olivia," saved via the "just a note" outcome above) was enough on its own for `person-facts`'s extraction to produce a `{category: "spouse", relationship_label: "Dating", person_names: ["Olivia"]}` fact, and its person-linking step then resolved the bare name "Olivia" to the existing "Olivia Gillingham" with no confidence check at all — the exact same class of bug as the original `add-fact` issue, just in a second, independent piece of code. **Fixed 2026-07-19**: `person-facts`'s name-to-person resolution now requires the name as stated to exactly match the candidate's full name on file before rendering a clickable link (same rule just applied to `add-fact`) — a bare "Olivia" no longer resolves to "Olivia Gillingham" and instead renders as plain, unlinked text. **Not yet deployed** — needs a manual redeploy of `person-facts` (paste `supabase/functions/person-facts/index.ts` into the Supabase dashboard and Deploy, or `npx supabase functions deploy person-facts` with a fresh access token). **Also, this is a caching bug on top of the code bug**: `people.key_facts` is only regenerated on the refresh icon or after a note changes (see the token-efficiency caching entry above) — even once redeployed, Gus's profile will keep showing the stale "Dating: Olivia Gillingham" chip from the cached JSON until the Key Facts refresh button is clicked (or another note is added/edited/deleted, which also triggers a refresh). **Still pending, unrelated to this specific fix**: the bad note text itself ("Dating"/"In a relationship with" reciprocal note wrongly linking Gus Reynolds and Olivia Gillingham from the original bug report) still needs manual deletion from both profiles' Notes sections — not something the assistant can do without being logged into the app. **Lesson: any place a relationship gets surfaced from note text and resolved to a specific person — not just the one place a bug was first reported — needs the same confidence discipline; `add-fact` and `person-facts` independently duplicate this exact resolution logic and both had the same gap.**
- **A `/next-actions` skill exists** (`.claude/skills/next-actions/SKILL.md`, added 2026-07-18) — run it in a fresh session to get a prioritized punch list from this doc's Master List (Section 7) and pending-deploy items (Section 10), without re-reading the whole doc by hand each time.
- **Home dashboard "working as intended" stats (see Section 6, 2026-07-19) — two manual steps pending before "Recall assists this month" actually counts anything.** (1) Run `supabase/migrations_manual/2026-07-19-search-log.sql` in the Supabase SQL editor to create the `search_log` table (same handoff pattern as `group_associations` before it). (2) Redeploy `converse` (paste `supabase/functions/converse/index.ts` into the Supabase dashboard and Deploy, or `npx supabase functions deploy converse` with a fresh access token) so it starts writing to that table. Until both are done, the card just shows 0 — no crash, confirmed in the browser preview. Everything else in this feature (the Dunbar card/page, the leaderboard, the due-for-update page) is plain frontend querying against existing tables and is already live the moment this is pushed to `main`.
- ~~Two-sided relationship notes fix (see Section 6, 2026-07-19, the Jalen/Julia/Wyatt Lacy bug) is code-complete but NOT yet deployed~~ — **deployed and confirmed live 2026-07-19**, see the Section 6 entry for the click-test details (Home-chat relationship with no moment now writes a note on both people's profiles).

## 11. Things a Future AI Assistant Must Understand Before Changing This Code

1. **The founder is a genuine coding beginner.** Explanations should stay in plain, jargon-light language. Don't assume familiarity with git, npm, TypeScript, or general dev workflows — but they've now picked up a fair amount through this process (they can read a file tree, run terminal commands when told exactly what to type, and understand the shape of the architecture at a conceptual level).
2. **Check in before major/architectural decisions**, don't just build silently — this has been the working pattern throughout, and deviating from it (building something significant without confirming direction first) would be inconsistent with how this project has been run.
3. **`converse` is the living, central piece of the whole app.** Almost all product intelligence lives in its system prompt and its JSON response-handling logic. Future feature work will very likely mean extending this function's prompt/schema rather than building something parallel to it.
4. **Prefer whole-file replacement over incremental patching once a file is complex**, per the lessons in Section 9 — this codebase has a track record of incremental-edit bugs (duplicate declarations, typos from partial pastes).
5. **The data model favors flexibility (jsonb, free-text dates) over rigid structure**, by deliberate choice, in service of AI-driven conversational search being the primary way data is consumed — don't "clean this up" into strict typed columns without checking whether that trade-off is still wanted.
6. **Nothing here has been production-hardened.** Auth email confirmation is off, there's no deployed hosting, and there are no tests. Treat this as a working prototype/demo, not a production system, unless told otherwise.
7. **The demo data (John & Jane Doe persona) is fake/seed data for demonstration purposes only** — don't confuse it with real user data, and don't assume its patterns (fixed hand-written UUIDs, uniform note counts, etc.) reflect how real usage will look.
8. **See `CLAUDE.md` in the repo root for standing workflow permissions** — as of 2026-07-15, the founder has explicitly asked for verified changes to be committed and pushed to `main` (which auto-deploys to production) without asking each time, and for this document to be kept up to date without being asked. This does not relax the "check in before major/architectural decisions" rule above — it's specifically about not needing manual sign-off on routine follow-through once work is done and verified.

## 12. Product Philosophy & Strategic Direction (repositioning, 2026-07-19)

This section captures a founder strategy conversation, not code changes — no features were built from this yet. It's the reasoning future work (including the Master List in Section 7) should be checked against.

**Repositioning.** See Section 1 — the app is no longer scoped to baby boomers specifically, though it likely still skews toward an older, more established-relationship audience.

**Two core adoption risks:**
1. **Ease of input** — getting information from the user into the app needs to be as close to effortless as possible. One idea raised: letting the app listen to phone calls and auto-transcribe/extract relevant info. Real complexity here (device-level call-access restrictions, two-party consent laws, on-device vs. cloud transcription tradeoffs) means this is a **later-stage feature, not a v1 assumption**. A lower-lift version worth building first: let users import a voice memo or transcript after a call ends, feeding the same extraction pipeline "Add a Moment" already uses.
2. **Security** — users will want strong assurance their data is encrypted and can't be exposed in a breach. Realistic tiers to communicate honestly, not oversell: baseline encryption at rest/in transit (achievable now); minimizing what's stored and being transparent about access (achievable now, builds trust); true end-to-end encryption where even the app operator can't read the data (a real future differentiator, but currently in tension with AI features that need to read content — roadmap, not a current claim). This connects to Master List item 23 (Section 7) — an honest security audit/writeup, not a marketing claim.

**Input philosophy: incremental, not exhaustive.** Favor small, frequent inputs over large one-time "story dumps." A single sentence or fragment should be a valid, complete entry on its own. The AI should carry more of the cognitive load than the user — proposing likely conclusions for the user to confirm/correct, rather than always asking the user to recall and generate from scratch. Favor confirmation over free recall wherever possible. "Good enough" should be the default, not "complete," so the app doesn't feel like homework. Users have compared the experience to a diary/journal — a reasonably accurate comparison, with the key distinction that this app is fundamentally about *other people*, not just self-reflection.

**Proactive nudges.** The app should proactively prompt users about relationships that have gone quiet, but a single fragile question ("anything new with Steve?") shouldn't dead-end on "no." Nudges should offer varied types of value depending on context: action-oriented (suggest scheduling a catch-up or sending a note), reflection-oriented (ask something that deepens the profile without a new event, e.g. "what's your favorite thing about Steve?"), or memory-mining (ask for more detail on an existing past moment). **Decision: start with AI-selected nudges** (the AI picks which type fits the relationship/context) rather than always presenting the user a menu of options. Exact trigger mechanism (calendar vs. manual vs. location-based) and the detailed nudge-selection logic are both explicitly not designed yet.

**Design principle: never make the user feel bad about forgetting.** Nobody likes hearing "we've met before" or being told they've repeated a story — the app must never make the user feel embarrassed about their own memory gaps. This is largely mitigated by the briefing use case below (pre-event prep, not live assistance) — the user has time to privately absorb context beforehand rather than visibly relying on it in the moment. A related value-add, distinct from that mitigation: helping the user avoid repeating themselves *to others* (e.g. "you've already told Steve about the move twice") is its own valuable feature, not just a risk to manage.

**Briefing use case (pre-event prep tool).** The app is used in advance of a planned social event/encounter — not live, during the conversation itself. It's a prep/briefing tool, and this framing should keep shaping Home's conversational design (see Section 8). Two distinct query modes need to be supported, and both likely route through the same intent-detection logic `converse` already uses to distinguish "answer a question" vs. "update a moment" vs. "create a new moment":
1. **Specific-fact lookup** — e.g. "Who is Jake's mom?" — precise retrieval, single right answer, factual/concise tone. This is what `converse` already does well today.
2. **Broad overview / "memory lane"** — e.g. "I'm going to my high school reunion, walk me down memory lane" — a synthesis task where the AI scopes relevant memories (likely via Groups/Events), curates a highlight reel rather than dumping everything, and may warrant a warmer, more narrative tone than the flat factual tone used for specific lookups. **Not built yet** — `converse` doesn't currently distinguish these two modes or scope-and-curate for the second one.

This overview-mode briefing depends on Groups/Events being well-populated to scope what's relevant to a given occasion, which is part of why that machinery (Section 4/6) matters sooner rather than later.

**Open follow-ups, not yet designed in detail:** exact trigger mechanism for pre-event nudges; the full call-listening/transcription feature (transcript-import suggested as the lower-lift first step); a concrete security/encryption implementation plan; detailed nudge-selection logic; the "memory lane" overview-mode briefing itself.

---

## 13. Sibling-linking bugs — three separate root causes, found via the Sucre and Berzins families (2026-07-20)

The founder reported the Sucre brothers (Ale, Fede, Manuel) inconsistently showing each other as siblings, then — after that fix shipped — reported the same thing for the Berzins family (Mark & Margaret Berzins, parents; Caroline Volin, Clare Sucre, Patrick Berzins, Bridget Berzins, children). Both reports traced back to `_shared/relationships.ts` and `RelationshipSuggestions.tsx`, but turned out to be **three distinct bugs**, found one layer at a time as each fix exposed the next:

**Bug 1 — confirming a suggestion banner only ever wrote onto the named person, never back onto the subject.** A confident full-name match (e.g. typing "Fede Sucre") always correctly wrote reciprocal notes on both sides. But when a name only loosely matched (e.g. bare "Fede" vs. full "Fede Sucre" on file), the app correctly asked "is this the same person?" — and confirming that banner (`confirmSamePersonSuggestion`/`confirmNewPersonSuggestion` in `RelationshipSuggestions.tsx`) only ever inserted the note onto the OTHER person, never back onto the subject whose profile the fact was actually typed on. Fixed by adding `subjectId`/`subjectName` to the suggestion payload and writing both sides on confirm, mirroring what the confident-match path already did.

**Bug 2 — siblings named together in one sentence never linked to each other.** "Manuel's brothers are Ale and Fede" linked Manuel↔Ale and Manuel↔Fede directly, but never Ale↔Fede — the app had no notion that people named as siblings in the same breath are siblings of each other too. Founder's explicit call (asked directly, see chat): link them automatically when confidently known, not via a suggestion banner, since it's the same certainty as the already-accepted subject link, not a separate guess. Implemented as a full pairwise write among everyone confidently resolved in one signal (`confidentPeers` in `applyFamilySignals`), plus a `coSiblings` field on suggestions so a person confirmed via a banner also retroactively links to any other co-named sibling — looked up by EXACT full name only (never a bare-name guess), so it only succeeds once that other sibling is also for-real confirmed; confirming with a different name than guessed, or never confirming, safely leaves it unlinked rather than risking a wrong link.

**Bug 3 — the dedupe check was too loose, and specifically hurt the SUBJECT of the original sentence.** This one only showed up on the Berzins family, and was the actual reason Caroline Volin — not any of her siblings — kept showing incomplete results. The reciprocal-note dedupe check (`writeNoteIfMissing`) was checking "does this person already have SOME note mentioning the other person's name plus a family-shaped keyword (`/sibling|brother|sister/i` etc.)" instead of "does this EXACT deterministic note already exist." Caroline's own raw sentence — "Her siblings are Clare Sucre, Bridget Berzins, and Patrick Berzins" — already mentions each name AND contains the word "siblings," so it satisfied the dedupe check for Caroline's OWN profile and silently blocked her from ever getting her own "Their sibling is Clare Sucre." notes — even though Clare, Bridget, and Patrick all correctly got notes pointing back at her. Every OTHER sibling looked fully linked; the one person who'd actually typed the fact was the one left incomplete. Fixed by switching the dedupe check to an exact case-insensitive text match against the deterministic note itself, which only ever matches a prior run of that same write — never a coincidental natural-language mention. `DEDUPE_KEYWORD` and the per-relationship regex map were removed entirely since nothing needs them anymore.

**A fourth thing worth naming, not fixed because it isn't fixable by this app's design:** the AI classification call that turns a typed sentence into structured `family_signals` occasionally drops one name's last name out of a list of several (this is almost certainly what put Bridget through the "is this the same person?" suggestion path in the first place, while her siblings Clare and Patrick — named in the exact same sentence — resolved with full confidence). This is the same category of imprecision as `person-facts` occasionally omitting one of several explicitly-listed names on a Key Facts extraction (documented earlier, unrelated code path) — inherent LLM non-determinism on multi-item lists, not a deterministic bug with a code fix. What Bug 3's fix buys here: even when this happens, the founder can just re-state the same fact once the gap is noticed, and it will now correctly fill in exactly what's missing rather than being silently blocked by the dedupe check.

**Verification:** all three fixes were deployed (`add-fact`/`converse`/`update-group`/`update-moment`, which all bundle `_shared/relationships.ts`) and confirmed live with disposable test people created and deleted for the purpose — covering the same-person suggestion path, the new-person suggestion path, and the fail-safe decline when a last-name guess doesn't match a real record. The Berzins family's real data was then fully repaired live (all 6 sibling pairs and all 8 parent-child pairs among Mark, Margaret, Caroline, Clare, Patrick, and Bridget confirmed bidirectional via direct queries, not just the UI), and one accidental duplicate note (from a flaky click during testing) was cleaned up via the note's own delete control.

**Incidental finding, not part of this bug:** there are three different people named bare "Bridget" in the system (Berzins, Dugan — Patrick's fiancée — and McKnight) — a real, pre-existing 3-way name collision. It didn't cause a wrong link here (the app's ambiguous-bare-name handling correctly refused to guess), but it's worth the founder knowing it exists, in case a future fact mentioning bare "Bridget" needs a name/nickname adjustment to resolve unambiguously.

**Follow-up same day: database-wide scrub, not just the two reported families.** The founder asked (reasonably) whether the same asymmetry could be sitting undetected elsewhere, rather than surfacing one family at a time. It could, and did: a full scan of every note against the app's own 5 deterministic reciprocal phrasings ("Their sibling is X.", "Their child is X.", "Their parent is X.", "Married to X.", "In a relationship with X.") — resolving each named person by EXACT full name only, same confidence discipline as the app itself, and checking whether the mirror note existed anywhere on the named person's own profile (normalizing away a missing trailing period, since some older notes predate the deterministic phrasing being fully standardized) — found **49 asymmetric pairs across 312 people / 417 person-notes**, including ones from families already believed fixed: Manuel Sucre had never actually gotten "Their sibling is Ale Sucre."/"Their sibling is Fede Sucre." onto his OWN profile (Bug 3 again, just on data older than its fix), and Ale was separately missing his mirror to Fede for the same reason. 48 of the 49 were safe, mechanical mirror-completions of a fact already stated somewhere (no new inference — same discipline as the reciprocal write itself) and were bulk-inserted directly via the PostgREST REST API (with the founder's explicit approval, since a single script writing to ~40 different people's records at once tripped the permission classifier as a bulk action, distinct from the single-profile edits used everywhere else this session). Re-scanning afterward confirmed exactly zero remaining gaps except the one held back.

**The one held-back case, flagged instead of auto-fixed:** Jill Tullman has two notes claiming marriage to her — one from "David Adelstein" (full name, confidently resolved and completed) and a separate one from a bare "David" with no last name, whose own single note is *also* just "Married to Jill Tullman." — identical content to David Adelstein's. That's the signature of a duplicate profile, not two facts, and writing a second "Married to David." onto Jill would have asserted a conflicting-looking second marriage instead of fixing anything. Left for the founder to merge via the app's own merge-profile feature (Search for "David", merge the bare one into "David Adelstein" or vice versa) rather than guessed at.

**Method note for future scrubs like this:** the scan is cheap and safe to re-run any time (read-only, a few REST calls, no AI cost) — it's a good first move whenever a relationship-linking bug is fixed, to check whether older data needs the same fix applied retroactively, rather than waiting for the founder to notice each broken pair one family at a time. Deliberately did NOT attempt fuller transitive closure (e.g. two people who are each a stated sibling of the same third person, but never stated as siblings of each other) — that crosses from "complete an already-stated fact" into "infer a new one," which risks asserting full-sibling status in what might actually be a half-/step-sibling family structure (an explicitly unresolved design question — see the Master List's family-dynamic-variety item). Worth a founder decision before ever automating that part.

---

## 14. Anthropic API cost drivers: cache-tier restructuring + relationship-extraction dedupe (2026-07-20)

The founder asked to workshop a fix for two named cost drivers: `converse` (and its siblings `update-moment`/`update-group`) re-sending the entire per-user archive every chat message, and relationship-extraction fanout when family facts are captured.

**Archive re-send.** All three functions built ONE combined cache block (people + groups + moments/this-item + today's date), with a single `cache_control` breakpoint. Any single write — a new note, a renamed person, even the date rolling over at midnight (which sat at the FRONT of the block) — invalidated the entire thing, forcing a full-price cache rewrite of data that mostly hadn't changed. Restructured into ordered tiers per function, least-to-most volatile: a roster tier (people/groups/other-items, own breakpoint, 1-hour cache TTL, since it changes far less often than a new note is recorded) → a hot-write tier (moments for `converse`; this-item's-own-state for `update-moment`/`update-group` — own breakpoint, default 5-minute TTL, since this is the actual frequent-write tier) → today's date (uncached tail, moved off the front). Net effect: the common case — recording a new note about someone already in the app — now only busts the small hot-write tier, leaving the roster cached; only adding/renaming a person or group busts both.

**Relationship-extraction fanout.** `_shared/relationships.ts`'s shared-parent suggestion logic (`findSharedParentSuggestions`/`extractRelationNames`) is the previously-documented ~12-call worst case (PROJECT_CONTEXT.md §5). Reading the actual call graph showed a chunk of that fanout was pure duplicate work: the "parent" signal branch compares the subject against each of up to 5 known siblings in a loop, and each iteration re-derived the SUBJECT's own parent list from scratch — a fresh notes read plus a fresh Claude call — even though nothing about the subject changed between iterations. Added a request-scoped memo (`getRelationNames`, keyed by `"kind:personId"`) so each person's parent/sibling list is only ever resolved once per request no matter how many pairwise comparisons reference them. Separately, added a Key-Facts fast path: `people.key_facts` (written by `person-facts`) already contains the same parents/siblings extraction for anyone who's had their profile page visited or refreshed — `getRelationNames` now checks that cache first and only falls back to a live Claude call when it's empty. This whole code path only ever feeds a "suggest, don't assert" banner (never an automatic write), so Key Facts occasionally being a little stale (refreshed on profile visit/refresh, not proactively on every note write elsewhere) was judged an acceptable trade — worst case is a missed or slightly-lagging suggestion, never a wrong assertion.

**Founder's call.** Also offered a third, bigger lever — sending each moment's cached one-line AI summary instead of full note text for older/less-central moments, for a harder cost ceiling as the archive grows — but flagged the real trade-off (fuzzier answers on very old, very specific questions) and let the founder decide rather than building it silently. Founder chose "free fixes only" for now; the summarization idea is parked, not built, until the archive is actually big enough to need it.

**Initially not deployed, then closed out same session.** Pushing to `main` only auto-deploys the Vercel frontend, not Supabase functions, and no Supabase access token was available at first (`npx supabase projects list` failed with `LegacyPlatformAuthRequiredError`). The founder then supplied a Personal Access Token directly in chat ("use this code for any other pushes you need today") and approved a fourth fix in the same breath: the conversation thread itself (`messages` array) had never had a `cache_control` breakpoint in any of the three chat functions, so even with the system-prompt tiers cached, a long back-and-forth still re-paid full price for the whole growing thread every turn. Added `_shared/promptCache.ts` (`withMessageCacheBreakpoint`) — puts the marker on the last message's content, the 4th and final breakpoint available in each function (max 4/request) — and wired it into `converse`/`update-moment`/`update-group` (single-turn `add-fact`/`person-facts` don't need it). With the token in hand, ran `npx supabase functions deploy` for `converse`/`update-moment`/`update-group`/`add-fact` (the project ref, `dedtnytxhzzjimkozncc`, was pulled from the already-public `VITE_SUPABASE_URL` in `.env` rather than asked for again) and confirmed all 4 live via the token-free check (401, not Supabase's not-found). See PROJECT_CONTEXT.md §10.

**Concurrent session, unrelated:** partway through this same session, `git status` started showing `Events.tsx`/`EventDetail.tsx`/`Groups.tsx`/`GroupDetail.tsx`/`People.tsx` modified and a new `src/components/SearchAddPicker.tsx`, none of which this session touched — a hook also confirmed another dev server was already running in the folder. Left entirely alone (staged/committed only this session's own files by name, never a blanket `git add -A`); looks like search-and-add-picker work across the People/Events/Groups surfaces (backlog items 14/29/30), landed and documented by whoever was running that other session.

## 15. Backlog item 32, the real build: relationships table, self profile, "My page," real family tree (2026-07-20)

**Where this started.** Item 32 ("User's own profile") was requested 2026-07-19: the user had no profile of their own, so "my mom is Amy" had nowhere to attach and family links only ever lived as free-text notes + `people.key_facts` JSON (AI-extracted per-profile, its own category vocabulary, no queryable structured graph). A prior session shipped a click-through-only UX preview first — `CircleMock.tsx` ("My page": self header, "Your circle" grid, "Your groups" list) and `FamilyTreeMock.tsx` (a genealogy-style SVG tree whose layout is COMPUTED from a relationship data model — `{union:{a,b?}, siblings}` branches per tier, each PERSON carrying their own `parentName` so a couple's two partners can trace to two different branches above them, i.e. paternal vs maternal grandparents both shown) — both on placeholder data, no Supabase calls, specifically to get the shape of the UX validated before committing to a schema. The founder's rationale for tying the tree to group membership rather than blood-relationship inference: it lets you decide who counts as family (chosen family, in-laws, a close friend's family), and doubles as a relationship-data-collection nudge (an "unplaced" group member with no relationship on file is a prompt to add one). That same session, the founder explicitly confirmed the architecture for the real build: a `relationships` table as shared source of truth, with the family tree, `person-facts` Key Facts linking, reciprocal notes, and "my mom/dad" resolution all reading/writing through it — not staying siloed per-feature — and said not to bring it back for another sign-off.

**The real build (this session).** Schema: `people.is_self boolean` (partial unique index per `user_id` — at most one self profile) plus a `relationships` table (`person_a_id`, `person_b_id`, `kind` — spouse/sibling/partner symmetric and normalized `person_a_id < person_b_id` by uuid sort like `group_associations`; `parent` directional, `person_a_id` IS the parent, no separate stored "child" kind). A one-time backfill DO-block parsed the 5 deterministic `RECIPROCAL_NOTE` phrasings out of existing notes (exact-name match only, best-effort) — landed 75 rows from the founder's real note history on first run.

`_shared/relationships.ts`'s `applyFamilySignals` (the one function all 4 entry points — `converse`/`add-fact`/`update-moment`/`update-group` — already funneled reciprocal-note writes through) now ALSO dual-writes into `relationships` via a new `_shared/relationshipsTable.ts` (`upsertRelationship`/`getRelationshipsForPerson`), taking a `userId` param threaded through from each caller's already-fetched `user.id`. `RelationshipSuggestions.tsx` (the frontend confirm-a-suggestion banner flow, which bypasses `applyFamilySignals` since it runs client-side after a user clicks "yes") got the identical dual-write via a browser-side mirror at `src/lib/relationshipsTable.ts` (Deno can't import across the Vite boundary, so this is a second copy — keep in sync if the shape changes).

`person-facts` cross-references the table now too: after its usual AI extraction from notes text, it additively merges in any relationships-table-linked person not already resolved by exact-name text match, for the 4 linked categories (spouse/siblings/parents/kids) — never overrides an AI-extracted fact, just fills in a person the table already confidently knows about.

"My mom/dad" resolution: a new `_shared/selfContext.ts` (`findSelfPerson`/`buildSelfInstruction`) builds an instruction paragraph — who the self person is, plus their known parents/spouse/siblings/kids from the table — appended to `converse`/`update-moment`/`update-group`'s own DYNAMIC per-user roster tier, never their STABLE tier (the self person's name/relationships are per-user data, and CLAUDE.md's caching rule requires the stable tier to stay byte-identical across every user/session — putting per-user data there would defeat the globally-shared cache). `add-fact` needed no change: a fact typed on the self profile's own page already treats that profile as the subject regardless of "my" phrasing, since `buildSingleSubjectSignals` always hardcodes the subject to whichever profile is being viewed.

Frontend: `Circle.tsx` (real "My page," replacing `CircleMock.tsx`) — onboarding when no self person exists yet (search existing people to flag `is_self`, or create a blank one that lands on its own `PersonDetail` to name it, same "blank shell → fact bar" pattern as manual "add person"), live circle grid read via `getRelationshipsForPerson`, "+" per box writes through a new shared `src/lib/writeRelationship.ts` (`linkRelationship`/`createAndLinkRelationship` — writes the relationships-table row AND the both-sides reciprocal note, mirroring the edge-function discipline). `FamilyTree.tsx` (replacing `FamilyTreeMock.tsx`) keeps the EXACT validated layout/reflow algorithm from the mock, now fed by `src/lib/familyTree.ts`'s `buildFamilyTree(personId)` — one full-table fetch of `people`+`relationships`, then an in-memory graph walk (parents/children/spouses/siblings maps) into the tiers/branches the renderer expects. Works for ANY person, not just the self person: clicking any name re-centers the whole tree via a fresh `buildFamilyTree` call. Grandparents tier also pulls in parents' siblings (aunts/uncles, riding in the same branch as their sibling) and those aunts/uncles' own kids (cousins, shown as extended branches in the root's own generation tier) — one hop further than the mock's hand-authored example, computed generically. `RelationshipAddPicker.tsx` replaced `MockAddPicker.tsx` (which only ever searched a 6-name hardcoded array) with a real search-everyone-or-create-new picker.

**Deploy.** Founder provided a fresh Supabase Personal Access Token in chat. Migration applied via the Management API's `POST /v1/projects/{ref}/database/query` (confirmed via `information_schema.columns` and a `relationships` row count). All 5 changed Edge Functions (`add-fact`, `converse`, `update-group`, `update-moment`, `person-facts`) redeployed via `npx supabase functions deploy <name> --project-ref dedtnytxhzzjimkozncc` — 3 of the 5 hit a transient Cloudflare 502 on the first attempt (retryable, per the error body), succeeded on retry.

## 16. Siblings never inherited a shared parent (2026-07-20)

**The bug.** Founder reported: added Brad Volin as Steve Volin's brother via the family tree's "+" picker, then Brad's own tree showed no parents — even though Steve's parents (Harvey & Roberta Volin) were already on file. Root cause: `linkRelationship`'s `siblings` branch (`src/lib/writeRelationship.ts`) only ever wrote the `sibling` relationship row between the two people; nothing copied an existing sibling's `parent` rows onto the new one. Every reader (`buildFamilyTree`, `getRelationshipsForPerson`, `person-facts`) does a strict per-person lookup with no sibling-based fallback, so the gap was invisible until viewing the new sibling's own profile/tree. The edge-function chat/fact-bar path (`_shared/relationships.ts`) had the same gap in its confident-match pairwise sibling-write loop — it only had a "suggest, don't assert" AI-guessed shared-parent banner (`findSharedParentSuggestions`), never a direct write.

**The fix.** Added `syncSiblingParents` to both `writeRelationship.ts` (frontend "+" picker) and `_shared/relationships.ts` (chat/fact-bar confident-match path): whenever two people are linked/confirmed as siblings, read both sides' real `parentIds` from the `relationships` table and copy whichever parent either side already has onto the other side. This is a direct copy of already-confirmed data, not a guess — distinct from `findSharedParentSuggestions`, which stays as-is for the separate case of two people who might share a parent that's only ever been typed in free text, never confirmed.

**Backfill.** A one-off script (authenticated as the real `jakevolin@gmail.com` account, RLS-respecting) ran the same sync logic against every existing sibling pair in the live table: 23 sibling pairs checked, 7 parent rows added (e.g. Aaron/Noah Bach, Lisa/David Bach, Danny/Jess Volin). Steve/Brad Volin themselves were already consistent by the time this ran (Brad's parents had apparently been hand-added after the founder noticed the gap). One insert failed on the `relationships_no_self_pair` constraint — a duplicate "Barbara Bach" profile (two different person rows with the identical name), the same class of issue as the known duplicate-Amy-Volin/duplicate-David cleanup items — left alone, flagged below for the founder to merge via People search + merge-profile.

**Verification.** `npm run build` clean. Click-tested live against the real account: created a disposable test person, linked them as a sibling of Jake Volin (who already has Amy/Steve Volin as parents on file), confirmed the new person's own re-centered family tree immediately showed Amy and Steve as parents plus the full grandparent tier — then deleted the test person, its relationships, and its notes afterward.

**Deploy status.** The frontend fix (`writeRelationship.ts`) shipped automatically via the Vercel-on-push pipeline. The edge-function mirror (`_shared/relationships.ts`) was redeployed the same day once the founder supplied a fresh Supabase access token: `add-fact`, `converse`, `update-group`, `update-moment` all via `npx supabase functions deploy <name> --project-ref dedtnytxhzzjimkozncc`, all 4 succeeded on the first attempt (no Cloudflare 502 retries this round, unlike §15), confirmed live via a 401 (not Supabase's platform not-found) on each.

**Verification, and a self-inflicted near-miss worth remembering.** `npm run install` was needed first — this worktree's `node_modules` was empty (0 packages) even though `package.json` was fine; a fresh `.env.local` also had to be created (gitignored, not committed) since Vite needs `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` and neither existed in this worktree — pulled the project ref from the Management API's project list and the anon key from its api-keys endpoint, rather than asking the founder for either. Logged in as the real founder account (`jakevolin@gmail.com`) and created a real self-profile end-to-end (onboarding → rename via fact bar → "+" added "Amy Volin" as a parent) — which is where it got interesting: the app already had an EXISTING contact named "Jake Volin" (last_name collision), so the new self profile, also renamed to "Jake Volin," created a duplicate name — the exact "two Bobs" ambiguity class this app guards against everywhere else, self-inflicted by testing with a name that happened to already exist in the founder's real 318-person contact list. Caught immediately by querying `people` directly (two rows both named "Jake"+"Volin", one `is_self`), and by finding the founder's contacts ALSO already have two separate "Amy Volin" rows (a pre-existing duplicate, unrelated to this session, left alone — not this task's job to fix). Cleaned up precisely: deleted the exact test note by its own row id (not a blanket "notes containing Jake" delete), deleted the test self-profile person (cascaded the relationships row via the table's `on delete cascade`), and confirmed via direct query that the ambiguous name was gone and Amy Volin's notes were back to their original count. Family-tree and re-centering verification then used fully disposable, obviously-fake names (`ZzztestRoot/Mom/Kid/Sib TreeCheck`, a throwaway `Zzztest Family` group) instead of anything resembling a real name, specifically to avoid a repeat — confirmed re-centering (clicking a parent re-derives their own tree independently), the "+" write-through on the tree page itself (not just My Page), and tier computation (a person with no parents on file correctly gets no Parents/Grandparents tier at all). All disposable data deleted after, confirmed zero residue (`is_self` count 0, no `%zzztest%` groups, relationship count back to the post-backfill 75). **Lesson: when live-testing a relationship/name-writing feature against a real, populated account, use an obviously-fake disposable name from the start — even a "safe-sounding" real name (the founder's own) can collide with existing data in a 300+ person contact list, and the app's own ambiguous-name guard means that collision actively breaks name resolution for both records until cleaned up.**

---

## 17. Family tree bug scan (2026-07-20, wire-connection follow-up 2026-07-21)

**The audit.** Founder-requested audit of `familyTree.ts`/`FamilyTree.tsx` turned up and fixed five bugs: Parents/Grandparents tiers now always render with an add option (previously vanished entirely at zero, unlike Kids — no way to add a first parent from the tree); tree "+" can now add a spouse (previously only ever added a sibling); a person can now show more than one spouse/partner on the tree (previously only the first was shown, others silently dropped); "add grandparent" now offers one option per parent by name instead of silently always attaching to whichever parent was listed first (closes backlog item 32c); the `relationships` query is now ordered by `created_at` so which parent/spouse a tree branch anchors on is stable across reloads instead of depending on unspecified DB row order. Verified end-to-end against the real `jakevolin@gmail.com` account (Jake Volin's tree — Amy/Steve Volin as parents, Lisa/David Bach as Amy's side, Noah Bach as cousin) including adding a disposable second spouse to confirm multi-spouse rendering, then deleted the test person.

**Follow-up fix, same day: canvas clipping.** The SVG canvas was a fixed 680px width, so wide trees (many siblings/spouses) overflowed the viewBox and got clipped instead of shown. Canvas now sizes to actual content width and scrolls horizontally in its own strip instead of clipping.

**Follow-up fix, 2026-07-21: wire connections.** Founder-reported, spotted on his own live tree (Amy/Steve Volin as parents). Parent-child connector lines now drop from the marriage-line midpoint of a couple instead of just one parent's box (was: Jake+Josh only visually connected to whichever parent was `primaryParentId`). Aunts/uncles now fetch and render their own spouse (was: hardcoded out entirely, so a married-in aunt/uncle never showed or connected) with no blood-anchor of their own, so they only ever show via the marriage line, never a false ancestor line. Cousins now do the same (fetch + render their own spouse) and their own kids are now included (anchored to the cousin), closing the "cousin's spouse and cousin's kids are invisible" gap. Aunts/uncles and cousins now render on the correct side of their parent (left for `union.a`'s side, right for the trailing spouse's side) instead of all pooling to one side — this both matches a normal family-tree layout and, as a side effect, fixes a geometry bug where the sibling-group bar visually crossed through the other spouse's box. See `src/lib/familyTree.ts`/`src/pages/FamilyTree.tsx`.

**Follow-up fix, 2026-07-22: connector bar didn't reach its own stem.** Found by rendering the layout algorithm standalone and pulling real SVG coordinates out of it, not by reading code. The parent→child connector's horizontal bar only spanned the children's own positions, never the stem's — so whenever a couple's marriage-line midpoint fell outside their children's horizontal range (any asymmetric layout, e.g. cousins added unevenly on one side), the stem and bar didn't touch and the connection looked broken. Fixed in `FamilyTree.tsx` by including the stem's x in the bar's min/max. Same round: `familyTree.ts`'s "children of X" lookups (aunt/uncle→cousins, cousin→cousin's-kids, root→root's-kids) only checked one specific person's own recorded children, missing kids recorded under their spouse instead — added `childrenOfEither()` checking both. Verified against the founder-confirmed real shape (Barbara&Bill→David/Lisa/Amy grandparents; Harvey&Roberta→Brad/Steve grandparents; David+Laura→Noah/Aaron; Brad+Julie→Elianajoy/Elaiah) via `npm run build` + a synthetic-data harness rendered through the real `FamilyTree.tsx`/`familyTree.ts` code, screenshotted before/after.

**Follow-up fix, 2026-07-22: unrelated bars read as one connected line.** Founder-caught by clicking into other people's own tree views (e.g. centered on Aaron Bach). The stem-extension fix above widens each connector bar to reach its own anchor, which can stretch a bar well past its own children — so two unrelated bars on the same row (e.g. Aaron+Noah's own sibling bar vs. a neighboring cousin group's bar) could end up close enough to look like one continuous connected line even though they never share a point. Confirmed via coordinates (76px gap, not zero — a spacing problem, not a logic bug) then widened `BRANCH_GAP` 44→80px (confirmed 112px gap after, screenshotted). Explicit founder direction: prioritize correct wire logic over layout polish for now, width/spacing can be refined later.

**Root-cause rewrite, 2026-07-22 (item 39, founder-proposed same day, picked up in the fresh session the founder asked for).** All three follow-ups above were patches on the fact that each tier laid out independently, then stretched a connector to bridge whatever gap resulted. Rewrote `layoutTier`/rendering in `FamilyTree.tsx` so Parents/Grandparents tiers instead center each union on the midpoint of its own children's span in the tier below, with a left-to-right collision pass that pushes overlapping units apart symmetrically to a minimum clearance — ancestors positioned relative to descendants, not the reverse. A childless aunt/uncle (no children to anchor to) falls back to sitting next to its nearest resolved neighbor. At this point root-gen ("You")/Kids tiers were left unchanged (independently centered on the canvas, per the original proposal). Verified via `npm run build` + a synthetic-data harness (same founder-confirmed shape, centered on three different people incl. one where an ancestor union has to span three siblings, not just the root) — not yet confirmed against live data. While pushing, discovered a concurrent session had landed the two follow-ups above plus the item-39 proposal in the interim; merged cleanly (no logic conflicts — the connector bar-min/max fix and wider `BRANCH_GAP` compose fine with the rewrite) and re-verified numerically post-merge.

**Same-day live bug report (2026-07-22): three more issues, once tested against the real account.** The founder reported, after using the rewrite live: (1) Jake Volin's tree clipped off-screen on the left; (2) Caroline Volin's tree showed two grandparent couples (Marilee+Villis, Pat+Mimi) with no marriage line connecting them, unlike Jake's (Harvey+Roberta, Bill+Barbara); (3) a newly-added grandchild (John Leonard's kid, Eleanor June) rendered at an arbitrary spot instead of centered under her parent.

Investigated live data via the Supabase Management API (founder provided a fresh access token) before touching code, to separate data gaps from logic bugs. (2) turned out to be a real data gap, not a bug: querying `relationships` for Marilee/Villis and Pat/Mimi found only `parent` rows (both parents of Mark Berzins; both parents of Margaret Berzins respectively) — no `spouse` row between either pair, so `groupIntoBranches` correctly renders them as two separate single-person unions with no marriage line to draw. Founder needs to add the spouse relationship via the app's own picker if that's accurate (not assumed/added on their behalf, since a missing spouse link could equally mean divorced/separated co-parents).

(1) and (3) were real bugs, both from the same root cause: the rewrite anchored Parents/Grandparents to root-gen's *canvas-centered* position (computed from a natural-layout width estimate used only for sizing), so when the actual collision-resolved ancestor spread differed from that estimate, positions could land at negative x and clip off the left edge of the SVG. And Kids — per the original item 39 proposal — was left as "natural layout, independently centered on the canvas," which is fine when a Kids-tier person's own parents happen to sit near the canvas's natural center, but wrong in general (confirmed live: Eleanor June, a cousin's-cousin's kid, landed nowhere near her actual parent John Leonard).

**Fix:** replaced the per-tier "natural-layout size estimate + independent canvas centering" scheme with one shared coordinate frame. Root-gen is the only tier still laid out independently (unchanged); every other tier now derives its position from an adjacent, already-placed tier: `layoutRelativeToChildren` (renamed from `layoutAncestorTier`, generalized into a `resolveTierPositions(branches, centerFor)` core) for Parents/Grandparents as before, and a new `layoutRelativeToParent` for Kids — each Kids unit centers on wherever its own `parentId` sits in the tier above (reusing `anchorX`'s "midpoint of a union's members" logic) rather than on an independent canvas-centered layout. A single global bounding-box pass at the very end (over every tier's now-mutually-consistent placed positions) picks one uniform shift + canvas width to fit everything, instead of each tier separately guessing where the canvas center is. Verified via `npm run build` + a synthetic-data harness modeling both Jake's real shape and Caroline's real shape (Marilee/Villis and Pat/Mimi as unlinked couples; Margaret's three siblings Susie/Ward/Pam; John Leonard's kid Eleanor June) — pulled real SVG coordinates confirming zero negative x (no clipping) and Eleanor June's center landing exactly on her parents' marriage-line midpoint (512 = 512). Not yet re-confirmed against the live account after this fix.

## 18. Undo a mis-added family tree relationship (2026-07-21)

**The report.** Barbara Bach's tree showed Bill as her father and Lisa as her sister, when the real facts are Bill=husband, Lisa=daughter — bad data with no way to fix it except direct DB surgery.

**The fix.** Added `removeRelationship` (`src/lib/relationshipsTable.ts`) and `unlinkRelationship` (`src/lib/writeRelationship.ts`, deletes the relationship row + both reciprocal notes the original add wrote) plus a "Remove a relationship" section on the family tree page (`FamilyTree.tsx`) — hover-reveals-a-trash-icon chip (same pattern as `PersonDetail.tsx`'s `AffiliatedGroupChip`) + confirm banner (same pattern as its delete-profile flow), scoped to the centered person's own direct relations (parent/spouse/sibling/child — one hop further out isn't a relationship *of* them, re-center onto that person first). Doesn't unwind `syncSiblingParents` side effects from the original bad add; re-adding correctly re-syncs on its own.

**Verification gap.** Verified with `npm run build` + a synthetic-data harness (deleted before commit) only — no live credentials in that session to fix Barbara/Bill/Lisa's actual data or confirm end-to-end. See PROJECT_CONTEXT.md §10 for current status of the real fix.

---

## 19. Death, divorce, and remarriage on the family tree (2026-07-24)

**The ask.** Founder's concrete case: Andy Volin (blood) married Andi Romagnoli (married in), Andy died, Andi remarried Michael Galchinsky (also married in, already on file under "The Volins" group). How should the tree show a deceased person, an ended marriage, and a remarriage without implying the wrong thing (that Andy/Andi are still active, or that Michael is a blood line)?

**Design.** No new relationship kind, no restructuring — `Union.spouses` already supported more than one spouse per person (the multi-spouse layout from item 17's bug scan). Added two nullable columns instead: `people.deceased_date` (presence = deceased) and `relationships.ended_reason` (spouse/partner only, only legal value `'divorce'`). Death deliberately has no flag on `relationships` — a union reads as ended if EITHER party has a `deceased_date` OR the row has `ended_reason = 'divorce'`, so marking someone deceased once automatically mutes every marriage line they were in, with no second place to remember to update. Rendering: a deceased person's box goes muted grey with a small "†"; an ended union's marriage line renders dashed instead of solid. Step-parent/step-sibling/half-sibling labels are computed, not stored — `relationshipLabels.ts`'s `describeRelationship` walks the same parent/spouse graph `familyTree.ts` already builds (a step-parent is a parent's spouse who isn't themselves a parent; a step-sibling is that step-parent's child through their OTHER union) — wired into `selfContext.ts`'s per-request AI prompt tier (bounded to one extra query per known parent, not a full graph walk, since that tier can't afford it on every `converse` call).

**A near-miss with a concurrent session.** Another live Claude Code session was mid-edit on unrelated files (event-date support, Dunbar tier names, a Home stat-label rename) in the same working directory throughout this work. A `git stash`/`pop` round-trip done to isolate a build-error check briefly swept up that session's uncommitted changes too (nothing was lost — the pop restored everything), but it was a reminder that this repo can have two live sessions at once. Held off committing until confirming with the founder, who chose to bundle everything once the other session's own build gap resolved itself (they'd fixed it mid-flight). See `feedback_concurrent_sessions` memory.

**A real regression caught before shipping.** `familyTree.ts`'s `loadGraph()` selects `deceased_date`/`ended_reason` by column name — before the migration ran, that made the ENTIRE people/relationships query fail (not just those columns), so the family tree rendered as a blank "Unknown" tree for everyone. Caught by testing in the browser preview before pushing, not assumed safe from the code alone. Fixed by applying the migration (`supabase/migrations_manual/2026-07-24-deceased-and-divorce.sql`) via the Management API using a founder-supplied access token before any of this shipped — schema and code must land together for an additive-but-required-column change like this, not code-first.

**A second bug, root node.** The tree's root/focal person is built as a hand-written object literal (`rootNode`) rather than through the shared `node()` helper every other person goes through — so the very first live test (a disposable "Ztest Deceased" person, marked deceased, centered as root) showed no "†" on themselves even though a spouse one hop out correctly showed the marker. `node()` sets `deceased` from the graph; `rootNode` didn't. One-line fix. Lesson: any hand-rolled `TreePerson` construction that bypasses `node()` needs the same fields kept in sync by hand — worth grep-checking for these whenever `TreePerson` gains a new field.

**A third bug, multi-spouse dashing.** First cut only dashed the FIRST marriage-line segment in a person's spouse chain (`k === 0`), reasoning that segments between two non-`a` spouses aren't a real relationship. But `endedWithAnchor` on `chain[k+1]` is always computed relative to `a` regardless of position (every spouse's real marriage is to `a`, a hub-spoke model — the rendered chain is only a layout convenience), so restricting to `k===0` silently left a widow's SECOND marriage's dashed status unrendered when testing a 3-person chain (deceased spouse + new spouse, both attached to the same widow). Fixed by dropping the `k===0` restriction.

**Verification.** `npm run build` + `npm run test` (added `relationshipLabels.test.ts`, 5 cases incl. the exact Andy/Andi/Michael-shaped step-family graph) both green. Live-clicked through with three disposable people (`Ztest Deceased`/`Ztest Widow`/`Ztest NewSpouse`) — confirmed muted-grey + "†" on the deceased node, dashed lines on both an ended-by-death and an ended-by-divorce union, solid line on the still-current union, and that marking deceased/divorced correctly removed the corresponding "offer to mark again" UI slot. All three deleted after (People count back to 433). Real Volin data (Andy/Andi/Michael, already on file) deliberately left untouched throughout — the founder hasn't yet said whether Andi should be marked as Andy's widow or already remarried to Michael in the data itself.

---

## 20. Sam Volin's tree went blank-ish after "the Andy situation" (2026-07-24)

**The report.** Founder: after "the Andy situation," Sam's profile no longer shows the previously-existing relationships tied to the broader Volin tree.

**False lead ruled out first.** Item 19 already documented a real regression where `loadGraph()` selecting `deceased_date`/`ended_reason` before the migration ran broke the ENTIRE tree for everyone. Checked that first via a token-free PostgREST probe (`GET .../people?select=id,deceased_date` — a 200 rules out "column doesn't exist", no token needed) — came back 200, so the migration is live and that's not what's happening here.

**Actual cause.** Not a regression at all — a data-shape gap that predates item 19. Sam Volin's `parent` relationship row points at Andi Romagnoli only, never directly at Andy Volin (her now-deceased husband and Sam's actual blood father) — confirmed by note timestamps, Sam's "parent is Andi Romagnoli" fact was logged 2026-07-19, three days before the Andy↔Andi marriage was even recorded. `childrenOfEither()` already walks a spouse's kids too, so Andy's OWN tree always showed Sam fine (via Andi). But nothing did the reverse: Sam's own tree only ever read `g.parentsOf.get(rootId)` directly, so centering on Sam never discovered Andy, and everything upstream of Andy (Harvey/Roberta grandparents, Steve/Brad aunts/uncles) silently disappeared. Sam's tree happened to look "normal" for a while, because it always had this gap — the "Andy situation" (Andy's death, then Andi's remarriage to Michael Galchinsky per item 19) is just what drew the founder's attention to Sam's page.

**The fix.** `buildFamilyTreeFromGraph` (`familyTree.ts`) now expands a root's recorded parents with each parent's spouse for tree-walking purposes only (`expandParentsWithSpouses` + `groupIntoCouples` for couple-aware side assignment, replacing index-parity `sideOfParent`) — symmetric to what `childrenOfEither` already did in the child direction. First cut expanded to ANY spouse and immediately surfaced a second bug in testing: Andi has two spouses on file (Andy, deceased; Michael Galchinsky, her current living husband per item 19's real data, never touched by that session) — expanding to both pulled Michael's unrelated family into Sam's tree as a fake third "grandparent side." Narrowed to DECEASED spouses only, since a still-living spouse-of-a-parent is presumptively a step-parent/in-law (most often exactly this remarriage shape) with no bearing on the kid's own lineage, while a deceased one is very plausibly the actual blood parent whose fact just wasn't re-recorded once the survivor remarried.

**Verification.** `npm run build` green. Live in the browser preview against real production data (no synthetic test people needed — the Volin family's real, already-on-file data was the exact repro case): Sam's tree now shows the full Volin lineage (Harvey/Roberta grandparents, Steve/Amy/Brad/Julie aunts-uncles-in-laws, cousins, their kids) without Michael Galchinsky appearing anywhere in it. Natalie Gregorian (Sam's sibling, same one-sided parent data) checked too, same fix applies cleanly, her own divorced spouse Alex Gregorian still renders correctly (unaffected — that's a root-level spouse, not a parent-expansion case). Andy Volin's own tree re-checked byte-for-byte identical to before (no regression). Spot-checked an unrelated two-parent family (Mark/Marilee/Villis Berzins) to confirm ordinary trees are unaffected. No manual data edit needed in the end — the code fix alone resolved what was reported, so the "add Andy Volin as an explicit second parent" data patch floated during planning was skipped as unnecessary.

---

---

## 21. Calendar feature, built end to end in one gameplanned session (2026-07-24)

**The ask.** Founder wanted to gameplan a Calendar feature before building — see the not-checked-in plan file `i-want-to-gameplan-cuddly-wilkinson.md` for the full design discussion, including mockup iterations in chat. Key decisions made during gameplanning, not just handed down: (1) per-calendar secret iCal URLs, not full Google OAuth account access — founder explicitly didn't want to hand over broader access than the feature needs; (2) the "what to suggest" list reuses the app's existing `tags` system rather than a new hardcoded enum — founder's stated standing principle is to avoid hardcoding option lists anywhere in the product, template-and-let-people-extend instead; (3) sync triggers on both an automatic daily schedule AND a manual button, not just one.

**Phase 1 — Calendar.tsx.** New nav tab: upcoming list + a real month grid reading existing `moments`/`reminders` (no new tables). First cut used `gridTemplateColumns: repeat(7, 1fr)` with no `minmax(0, 1fr)` clamp — a long event title stretched its whole column instead of truncating, and a shorter month (4-5 rows vs 6) changed the grid's total height, which the founder reported as clicks landing on the wrong element after rapid Previous/Next navigation (the page reflowing between clicks). Fixed both: `minmax(0, 1fr)` + `overflow: hidden` for the truncation, and always rendering a fixed 42-cell/6-row grid padded with muted adjacent-month days (same approach Google/Apple Calendar use) so the page height never changes between months — verified across 14 consecutive months via a scripted click-through, card position/height pixel-identical every time.

**A second founder-reported issue, unrelated to Calendar specifically.** "Why is the whole app so thin on desktop" — every page (17 files) hardcoded the same `maxWidth: 600px` page column. Confirmed harmless to widen since any phone viewport is already narrower than 600px (the constant only ever affects desktop rendering) — bumped to 840px everywhere except Landing.tsx's own unrelated `maxWidth` (a marketing-page callout box, not the app shell).

**Phase 2 — calendar-source connection.** `calendar_sources` table + `validate-calendar-source` Edge Function (fetches server-side specifically to dodge the browser CORS wall a client-side fetch of an arbitrary calendar host would hit) + `CalendarSettings.tsx` sub-page. Deployed live via the Management API using a founder-supplied Supabase Personal Access Token (pasted in-session, never written to disk — same pattern used for every deploy step in this session). Live-tested by adding a real public ICS feed and by discovering, mid-test, that the founder had independently added their own real calendar ("Jake and Ceeb calendar") on the production site while this was being built — left untouched throughout, a good sign the feature was discoverable without prompting.

**Phase 3 — the import/suggestion pipeline.** New minimal ICS parser (`_shared/ics.ts`, RFC5545 line-unfolding + just the fields needed) and `scan-calendar-sources` Edge Function: fetch → parse → filter (cancelled/stale/solo-logistics) → batch through Claude with `cache_control`-tiered prompts (stable instructions + the founder's tag list, both cached 1h, mirroring `update-moment`'s tiering) → match attendees to `people` in code → write to a new `moment_import_candidates` review queue, never directly to `moments`. Two trigger paths sharing one function: a user's own JWT for manual "Sync now," and a shared secret (stored via Supabase Vault, never committed to git) for a daily `pg_cron` + `pg_net` job scanning every connected account. `pg_cron`/`pg_net` weren't enabled on this project yet — enabled via the Management API before scheduling. First live sync run against the founder's real calendar produced 11 candidates; also surfaced that the founder's actual calendar has several duplicate birthday entries under distinct `ical_uid`s (real data, not a pipeline bug — confirmed by checking the raw UIDs).

**A real bug caught by live-testing with real data, not synthetic.** Accepting the one candidate with real attendees (an "85th Anniversary Dinner") created two junk `people` rows literally named `cgberzins@gmail.com` and `jake.volin@gmail.com` — the founder's own account, duplicated. Root cause: Google's ICS export sets an ATTENDEE's `CN` (display name) to their own email address when no display name is set, and the pipeline had no filter for that shape, nor for the calendar owner's own email always being an attendee on every one of their own events. Fixed with two filters in `scan-calendar-sources` (exclude the account owner by email match; drop any attendee whose only "name" is email-shaped) and cleaned up the two bad `people`/`notes` rows via direct SQL before redeploying. This kind of bug is exactly why the founder's own real account was the test fixture throughout this build rather than synthetic data — it wouldn't have surfaced against a clean seed calendar with named attendees.

**Phase 4 — review UI + engagement nudges.** `ImportReview.tsx`: card-per-candidate, editable fields, a checkbox per suggested attendee, reusing `RelationshipSuggestions.tsx`'s accept/reject visual idiom. Accept writes a real `moments` row + `notes` row per checked attendee (creating a new person for anyone unmatched); reject writes nothing. `Home.tsx` and `Calendar.tsx` both show a "N events found" nudge when candidates are pending — the founder's stated reasoning for building it this way at all: every open-the-app moment becomes a chance to confirm/augment the model with near-zero effort, the same engagement idea as item 50's backlog entry, now shipped for this one surface.

**Verification.** Every phase built, deployed, and live-tested against the founder's real account in the same session before moving to the next — `npm run build` green throughout, no synthetic test accounts needed since the founder's real (already-messy, already-real) calendar was the actual test fixture. Final state: accept/reject both confirmed to do exactly what they claim (real `moments`+`notes` write vs. nothing written), Home/Calendar nudge counts confirmed to track the live pending count, and the one accepted event ("85th Anniversary Dinner") showed up correctly integrated everywhere else in the app (Events count, AI-generated Home conversation-starter prompts) with no orphaned or duplicate data left behind from testing.

---

## 22. Cousin-kid layout scatter, exposed by item 20's fix (2026-07-25)

**The report.** After item 20 shipped, the founder reported the family tree "formatting" looked broken: a cousin's own kid (Jared Schepis) rendered on the far opposite side of the canvas from his mother (Carrie Schepis), and a sibling-couple's box (Andy Volin † + Andi Romagnoli) looked disconnected/floating from the rest of their generation's row instead of lining up with it.

**Root cause.** Pre-existing bug in `FamilyTree.tsx`'s layout engine, not a defect in item 20's fix itself — just never exercised at this scale before. `resolveTierPositions` (the function that positions every non-root-gen tier) only compares ARRAY-ADJACENT units in a single left-to-right collision sweep and assumes the branches array is already in left-to-right screen order; it doesn't reorder by each unit's actual resolved anchor. `familyTree.ts`'s Kids tier built `kidsBranches` as `[...rootChildNodes, ...extraKidsBranches]` — every direct kid first, then EVERY cousin's-kid appended afterward in raw discovery order, regardless of which side (blue/rose) their cousin-parent was actually on. That put a right-side cousin's kid array-adjacent to a left-side one (or to a centered direct kid), and the sweep forcibly pushed that pair into ARRAY order (left index gets a smaller x, right index gets a larger x) even when their true anchors pointed the opposite way — dragging the cousin's kid clear across the canvas, and corrupting the spacing of whichever direct kid happened to sit at that array boundary (explaining the Andy/Andi "disconnected" look). Before item 20's fix, `leftCousinBranches`/`rightCousinBranches`/`extraKidsBranches` were usually empty or tiny for any family with an in-law-recorded parent, so this array-boundary collision rarely had enough data to misfire — item 20 correctly restored the missing branch data, which is what finally gave this layout weakness enough to chew on.

**The fix.** `familyTree.ts`'s Kids tier now builds `kidsBranches` as `[...leftExtraKids, ...rootChildNodes, ...rightExtraKids]` — split `extraKidsBranches` by `union.a.side` and place left-side cousin-kids before the direct kids, right-side ones after — mirroring the exact pattern `rootGenBranches` already uses (`[...leftCousinBranches, jakeBranch, ...rightCousinBranches]`). No change to `FamilyTree.tsx` itself; keeping the array in true left-to-right order is enough for the existing adjacent-collision sweep to behave correctly.

**Verification.** `npm run build` and `npm run test` (32 tests, unrelated to this specific case but all still green) both passed. Live-verified against the real Andy Volin tree (the exact repro case) via direct SVG coordinate inspection in the browser preview: Jared Schepis (x=229) now centers correctly under his parents Carrie+Rick Schepis (x=151–431, midpoint ~291) instead of appearing near x=2000+ on the opposite side; the whole Andy/Andi/Steve/Amy/Brad/Julie sibling-and-spouses row renders as one evenly-spaced contiguous group (~24px gaps throughout) with no disconnect. Confirmed via `git diff` before committing that an unrelated, concurrently-running Claude Code session's in-progress edit to `EventDetail.tsx` (item 21's calendar feature area) was left untouched.

---

## 23. Group family tree showed a redundant, disconnected second "founder" (2026-07-25)

**The report.** Even after item 22's layout fix, The Volins' group tree still looked wrong: it showed TWO separate founder unions side by side at the top — "Roberta Volin & Harvey Volin" and "Michael Galchinsky & Andi Romagnoli" — with Sam Volin and Natalie Gregorian rendered as Michael+Andi's own kids in that second, disconnected branch, instead of as Andy Volin's kids (hence Roberta's grandkids) one tier further down where they actually belong. Andy Volin appeared alone in the Children row with no line down to anyone.

**Root cause.** `buildDescendantTreeFromGraph`'s founder-picking greedy algorithm computes a `coveredSet(id)` (blood descendants of `id`, plus the direct spouse of each blood descendant) to decide who no longer needs to be picked as their own founder. That coverage only followed ONE hop of spouse links: Andy (blood, via Roberta) → his spouse Andi gets covered — but Andi's OWN subsequent remarriage to Michael Galchinsky was never followed, so Michael (also tagged in "The Volins" group) never got marked covered. Since the greedy loop must assign every remaining tagged member to *some* founder, and Michael was still "remaining," he got picked as his own redundant founder — and because `childrenOfEither` also treats a person's spouse's kids as their own, Michael's "descendants" turned out to be the exact same Sam/Natalie that Andy's branch already covers, just misattributed to Michael/Andi directly (one generation too high) instead of correctly nested under Andy.

**The fix.** Made `coveredSet` a proper transitive closure over spouse links (a small BFS: once a spouse is covered, their own spouses get covered too, and so on) instead of stopping after one hop. This means Andi (Andy's spouse) being covered now also covers Michael (Andi's spouse) automatically, so he's never mistakenly promoted to founder — the natural generation-by-generation walk then places Sam and Natalie correctly, one tier below Andy, with Andy's marriage line to Andi rendering dashed (he's deceased) exactly as it should.

**A known, deliberately-not-fixed gap.** The founder explicitly wants BOTH marriage segments visible for Andi — the dashed Andy(deceased)–Andi line AND a solid Andi–Michael (current) line — but Michael isn't rendered in this tree at all after the fix (he's correctly excluded as a *founder*, but nothing puts him back in as a rendered in-law). The reason: `FamilyTree.tsx`'s `Union` type is a hub-spoke model — every entry in `union.spouses` is assumed married directly to `union.a`, and `endedWithAnchor` is computed relative to `a` for exactly that reason (see the comment at its `marriageLines` construction). Andy and Michael were never married to each other, so simply adding Michael into Andy's union would compute his "ended" status against the wrong pairing (Andy/Michael instead of Andi/Michael) and likely render a nonsense dashed line implying Michael's marriage to Andi ended, which it hasn't. Correctly showing a genuine two-marriage chain (Andy–Andi–Michael, each segment independently dashed/solid) needs an actual data-model change — a per-adjacent-pair ended status instead of always-relative-to-`a` — not yet scoped. Flagged to the founder rather than shipped half-right.

**Verification.** `npm run build` and `npm run test` (32 tests) both green. Live-verified in the browser preview against the real Volins group tree: title now reads "descendants of Roberta Volin & Harvey Volin" (no more duplicate founder line), Andy Volin and Andi Romagnoli sit in the same row (y=338, Children tier) with a dashed marriage line between them, and Sam Volin/Natalie Gregorian now sit one full tier below (y=458, Grandchildren tier) — correctly nested under Andy instead of duplicated as a top-level founder pair. Confirmed Michael Galchinsky no longer appears anywhere in this tree (the known gap above, not a new bug).

---

## 24. Genuine remarriage chains: Andy †–Andi–Michael, with a step-parent label (2026-07-25)

**The ask.** Item 23 correctly stopped Michael Galchinsky from being mis-registered as a phantom founder, but left him unrendered entirely — the founder's actual want, stated plainly: "Because Andy is deceased, I want him to show up, even though Andi is remarried. Because Andy is the blood Volin, we want him to show up." Concretely: Andy †—Andi should render dashed, Andi—Michael solid, both in the same diagram. The founder also asked to gameplan showing relationship *types* more broadly (biological/adopted/step) — scoped down via a quick check-in to: surface the ALREADY-COMPUTED `relationshipLabels.ts` labels (step-parent/step-sibling/half-sibling) in the tree itself, no schema change, not a new biological/adopted/step data field (that's a separate, bigger project — migration + editing UI + backfill decision).

**Root cause of the missing render.** `Union` (`familyTree.ts`) was a pure hub-and-spoke model: every entry in `union.spouses` assumed married directly to `union.a`, with `endedWithAnchor` computed as `isUnionEnded(g, a.id, spouse.id)` — relative to `a`, always. Andy and Michael were never married to each other, so naively appending Michael would've computed his status against the wrong pair (and come out "ended", since Andy is deceased) — correctly flagged and not shipped as part of item 23.

**The fix.** Added `spouseChain` (`familyTree.ts`, next to the now-removed `inLawSpouses`, which it fully replaced at all 7 call sites): a BFS over spouse links starting from a blood person, walking however many hops deep the data goes (a widow(er)'s subsequent remarriage, and so on), with each entry's `endedWithAnchor` computed relative to whichever person they were ACTUALLY married to as the BFS frontier advances — not always the original blood anchor. No change needed to the renderer itself (`FamilyTree.tsx`'s `marriageLines` construction already just reads each chain entry's precomputed `endedWithAnchor` boolean); only its now-stale comment was corrected. Deliberately left unchanged: `rootSpouses`/`spouseNodes` (a tree's own root/focal person's direct spouse list — showing YOUR OWN spouse's later remarriage in your own personal tree is a different, more debatable call than a shared family diagram) and `groupIntoBranches`'s Parents/Grandparents-tier pairing (a separate mechanism, already correct for that tier).

**The step-parent label.** A 2nd-hop-or-later `spouseChain` entry is, by construction, "married to a blood person's spouse, not to the blood person themself" — exactly `relationshipLabels.ts`'s step-parent shape relative to that blood person's own kids (found via the already-existing `childrenOfEither`). Added `relationLabel?: string` to `TreePerson`, computed inline in `spouseChain` via `describeRelationship(g, kids[0], sid)` (dropping `'unknown'`), rendered as a small muted caption under the box in `FamilyTree.tsx`. One mechanism covers the concrete case in both ego and descendants mode. Explicitly deferred: step-sibling/half-sibling labels for sibling-GROUPS (comparing pairs of people rendered together, e.g. a future Andi+Michael child vs. Sam) are a structurally different problem — not bundled in.

**A second, unrelated data bug found via live verification.** After shipping the code fix, the Andi–Michael segment rendered dashed too (should be solid — they're still married). Traced to the actual `relationships` row: `ended_reason: 'divorce'`, set at the exact same timestamp as the row's own `created_at` (2026-07-24T22:44:04 UTC) — i.e., someone had marked that real relationship divorced, most likely while testing item 19's divorce feature against real data instead of a disposable test pair. Confirmed with the founder (still married, not divorced) before touching anything, then cleared it via the existing `setRelationshipEndedReason(michaelId, andiId, 'spouse', null)` (`relationshipsTable.ts` — already built for exactly this "undo an accidental mark" case) rather than a raw SQL edit. This was a real, live production data correction, done only after explicit confirmation — not assumed from the code alone.

**Verification.** `npm run build` and `npm run test` both green — added `src/lib/familyTree.test.ts` (none existed before), reusing the exact Andy/Andi/Michael graph shape from `relationshipLabels.test.ts`, asserting the Kids-tier union for Andy has `spouses` = `[Andi (endedWithAnchor: true), Michael (endedWithAnchor: false, relationLabel: 'step-parent')]`. Live-verified in the browser preview against the real Volins group tree via direct SVG coordinate/attribute inspection: Andy †—Andi segment dashed, Andi—Michael segment solid (only after the data correction above), "step-parent" caption under Michael's box, Sam/Natalie still correctly nested one tier below Andy. Spot-checked an unrelated tree (Mark Berzins) to confirm no unwanted captions or dashed lines on ordinary spouses.

---

## 25. Auto-add-to-groups reverted to auto-add-to-events, plus a search-pollution cleanup (2026-07-26)

**The ask.** The founder noticed they're automatically added as a member of every new group and asked why, and asked that new events do this instead.

**Root cause / history.** Traced to the 2026-07-20 relationships/`is_self` build (Section 15): `Groups.tsx`'s "+ Add Group" handler (and a duplicate of the same logic in `Onboarding.tsx`'s Stage 4 group creation) was written to unconditionally tag the founder's own self-person as a member of every new group, with a one-time backfill applying the same thing to the 22 pre-existing groups that predated it (Section 10's PROJECT_CONTEXT entry). The intent was narrow — a group the founder makes about themselves (their own family) shouldn't fail to show up on their own Circle page — but the implementation was blanket: it fired even for groups that were never about them (a relative's other social circle, a coworker group, a grandkid's team). Six days of real usage surfaced the actual cost: since the founder was a member of nearly every group in the account, searching the Groups list for their own surname ("Volin") matched almost everything, when what they wanted was groups mentioning some OTHER Volin, or literally named for it (e.g. "The Volins").

**The fix.** Two code changes reverted the auto-add: `Groups.tsx`'s `handleAddGroup` and `Onboarding.tsx`'s `saveCurrentGroup` no longer seed the founder into a new group's `person_groups` rows (the onboarding one needed a `memberIds.length > 0` guard added, since its members field can legitimately be left blank). A third change, `Events.tsx`'s `handleAddEvent`, adds the flip side: after creating a moment, it looks up the self-person and inserts a `notes` row (`person_id`, `moment_id`, `content: 'Was there.'`) — the identical row shape `EventDetail.tsx`'s own manual `handleAddAttendee` already writes, so the founder shows up under "Who was there" immediately and can untag themselves the same non-destructive way as any other attendee. A fourth change fixed the search complaint directly: `Groups.tsx`'s `filterGroups` now excludes the founder's own `is_self` person from the member-name search haystack (added `is_self` to the `person_groups(people(...))` select and to the local `PersonRef` type) — member CHIPS still render self normally when they're a genuine member, only the search predicate ignores their own name.

**The backfill decision.** Since there's no flag distinguishing "real" self-membership from bug-created rows in `person_groups`, cleaning up the *existing* 22-groups-plus backfill couldn't be surgical. Given a choice between (a) fixing search-matching only, leaving old membership data as-is, or (b) also wiping the founder's self-membership from every existing group and re-adding manually wherever genuine, the founder chose (b). Shipped as `supabase/migrations_manual/2026-07-26-remove-self-from-existing-groups.sql` — a preview `SELECT` (self's current groups, joined to account email) followed by the `DELETE`, for the founder to run themselves in the SQL Editor per the standing data-change workflow (Section 2 / PROJECT_CONTEXT §2) — bulk writes against real account data reliably get blocked by the safety classifier on both the Management-API and browser-client automated paths (see PROJECT_CONTEXT's infra-gotchas memory), so this was never going to be a same-session automated run.

**Deferred, not fixed here.** `ImportReview.tsx`'s calendar-import accept path (`applyAttendees`) has the identical "founder never auto-tagged as attendee" gap, but fixing it needs a dedup guard on the merge-into-existing-moment path (`notes` has no unique constraint to upsert against) that's only really exercisable against a live calendar import, not a quick click-test — left as a follow-up. Separately, whether Home's AI chat (`converse`) already tags the founder correctly when they narrate their own presence in first person ("I went to Kate's wedding") was not established either way — the system prompt's instruction to tag "someone mentioned" doesn't obviously cover first-person self-reference, but this is prompt behavior in the STABLE cached prefix (CLAUDE.md rule 3 cost/cache territory) and needs empirical chat testing before deciding whether it's even broken, so it wasn't touched.

**Verification.** `npm run build` green. Live-verified against the real `jakevolin@gmail.com` account in a separate dev-server preview (the account's normal 5173 port was in use by a concurrent session): created a test group via "+ Add Group" → member list showed "(0)", confirmed absent from Circle's "Your groups"; created a test event via "+ Add Event" → "Who was there" showed "Jake Volin" immediately with no manual tap, and the add-attendee search picker correctly excluded him while still surfacing other Volins; searched the Groups list for "Volin" and got ~12 genuine matches (other Volins in the roster, or Family-named groups) instead of the ~27-group "Your groups" full list. Both test artifacts (the throwaway group and event) were deleted afterward via the app's own delete controls, not left in the founder's real data. Onboarding Stage 4's blank-members-field guard was not separately click-tested (would need switching to the dedicated onboarding test account and resetting it) — covered instead by `npm run build`'s type-check plus the triviality of the added `if (memberIds.length > 0)` wrap.

---

## 26. Google Photos import: the first real photo gallery, and this app's first OAuth flow (2026-07-30)

**The ask.** The founder wanted backlog item 27 built for real — but instead of the raw-upload/Supabase-Storage approach originally sketched there, they wanted the "paste a share link, no OAuth" UX the calendar feature already uses, pointed at Google Photos. Follow-up in the same conversation revealed the actual goal was bigger: use imported photos' metadata to let the founder "scroll back into their Google Photos memories" and have the app suggest new events (or additions to existing ones) from that metadata.

**Why the calendar pattern doesn't transfer.** iCal is a real interop standard with a stable "secret URL" export mechanism third-party apps can just fetch. Google Photos has no equivalent. Worse, Google deliberately locked down third-party library access in 2025 specifically to stop apps from doing exactly what the founder first asked for ("scroll back into memories" implies scanning/browsing a user's whole library) — the old broad `photoslibrary.readonly` scope is gone for new integrations; the sanctioned replacement, the Picker API, only ever returns items a user explicitly hand-selects in Google's own picker UI, one session at a time, and even that access expires with the session (an `expireTime` field governs "access to the session AND its picked media items" per Google's own docs — confirmed by direct fetch of the current API reference before committing to this design, not assumed from prior knowledge).

**Two decisions the founder made explicitly, after being shown the real tradeoffs (not assumed):**
1. **Real OAuth over a fragile share-link scrape.** A public Google Photos shared-album page could theoretically be scraped for image URLs with no OAuth at all, matching the calendar feature's "no token to refresh" philosophy — but it's unofficial, fragile against any Google markup change, and only covers photos the user proactively shares to an album rather than anything they pick in the moment. Founder chose the real Picker API integration instead, accepting the Google Cloud Console setup it requires.
2. **Storage cost, raised directly by the founder mid-review.** Since a picker session's access to a photo's bytes is time-boxed, keeping photos in the app long-term means copying them somewhere durable — there's no way to leave them living in Google and just re-fetch a link later. The founder asked point-blank whether this meant real, possibly-expensive storage costs. Answer, with real numbers: resized (~1600px) copies in Supabase Storage run about $0.021/GB/month, and at ~300KB/photo even 10,000 photos is under a dollar a month — nothing like the archive-size cost concern from earlier work (PROJECT_CONTEXT §10's API-cost-drivers memory). Founder confirmed proceeding on that basis.

**What "scroll back and suggest events" became, given the platform won't allow proactive scanning.** After a picker session, the newly-imported photos' own timestamps (Google's `mediaMetadata.creationTime`, preserved even though location Exif is stripped on download) get grouped into date-based clusters by a pure heuristic — no AI call, same "free, no-AI" spirit as `ImportReview.tsx`'s existing duplicate-detection logic — and each cluster proposes either an existing-event match (date-range overlap against `moments`) or a new event, reviewed on `PhotoImportReview.tsx`. This is reactive-after-picking, not proactive library browsing — the honest ceiling Google's API allows, made clear to the founder before building rather than discovered as a surprise afterward.

**What got built.** First OAuth flow in this codebase (authorize redirect → `google-photos-oauth-callback` token exchange → refresh token stored in a new `photo_connections` table with **no SELECT policy for the browser at all**, read only by service-role Edge Functions — same trust boundary as `ANTHROPIC_API_KEY`) and first real Supabase Storage usage (a private `photos` bucket, RLS-scoped per user by folder prefix). Two entry points share one underlying picker/download pipeline (`lib/googlePhotosImport.ts`): `EventDetail.tsx`'s "Add photos" quick-add (skips clustering, attaches straight to the event you're on) and `PhotoImportReview.tsx`'s general import (clustering + review queue, reached from Settings). `PhotoGallery.tsx` now renders real thumbnails for a moment once any exist, unchanged (still placeholder) on Person/Group pages, which don't yet aggregate across a person's/group's moments — filed as new backlog item 69.

**Deferred / needs founder action before it's live.** This entire feature needs infrastructure only the founder can create: a Google Cloud project + OAuth consent screen + Client ID/Secret (their own Google account), the new SQL migration run, a Storage bucket created via the dashboard (not expressible as plain SQL), and three new Edge Functions deployed. None of that happened this session — see PROJECT_CONTEXT §10's checklist. Also worth flagging: while Google's consent screen stays in Testing mode (the default until app verification completes), only Google accounts added as test users can connect at all — a real limitation on who can use this feature early on, not a bug.

**Verification.** `npm run build` green. Full UI click-through in the browser preview against the real `jakevolin@gmail.com` account (no live Google credentials exist yet, so the OAuth round-trip itself couldn't be exercised): Settings → "Import photos from Google Photos →" renders `PhotoImportReview.tsx` correctly ("Not connected yet," "Connect & import photos," empty review queue, no console errors) even with the migration unapplied (fail-open `.select()` calls, matching this codebase's established pattern for shipping code ahead of its own migration). A real event page ("Conor & Shelly's wedding") shows the new "Gallery / No photos on this event yet. / Add photos from Google Photos" block. A Person page (Aaron Bach) confirmed the original placeholder gallery is untouched. The actual OAuth/picker/download/clustering pipeline is unverified end-to-end pending the founder's Google Cloud + Supabase setup.

## 27. "Review contacts" redesign: pagination, entry-time groups/names, and a real-data near-miss (2026-07-30)

**The ask.** The founder was mid-way through reviewing a real contacts import — around 1300 candidates in `contact_import_candidates` status `'selected'` — and hit two problems on `ContactImportReview.tsx` ("Review contacts"): every candidate rendered on one unpaginated page, and there was no way to assign a group or fix a name before accepting, even though this review pass is effectively the only chance to do so (nobody revisits an individual profile out of a 1000+-contact import just to add a group later). This directly matched two already-filed, not-yet-built backlog items (67: entry-time group tagging, 68: sort matches first) — folded into the same pass rather than done separately.

**What got built.** Paginated at 20/page (mirrors `ContactSelection.tsx`'s existing pattern, smaller page since these cards are heavier), sorted `match_confidence` ascending then `full_name` (puts high-confidence matches first, per item 68). Unmatched candidates get editable First/Middle/Last inputs, prefilled from the parsed vCard name. Every card gets an "Add to groups" picker (`SearchAddPicker`, `browseAll` + `onCreateNew` reusing `PersonDetail.tsx`'s `confirmSuggestedGroup` find-or-create logic) — selections are local state until Accept, then upserted into `person_groups`. One deliberate UX preservation: the original Accept flow leaves its card in place showing "Saved contact info for X" rather than yanking it away, so the parent's post-accept refresh only re-queries the total count (not the page), while Reject (which has no confirmation to protect) does a full page refetch to pull in a replacement candidate. All in `ContactImportReview.tsx` — no migration needed, since `person_groups` already existed.

**Verification, and a self-caught mistake worth recording.** `npm run build` clean. For the live click-through, rather than uploading a fresh `.vcf` (no file-upload tool available in this session's browser harness), 25 synthetic candidates were inserted directly via the Supabase REST API using the already-authenticated browser session's own token (same "browser-client fallback" pattern noted in PROJECT_CONTEXT §2 for when writes are needed but no service-role/CLI credential is available) — 5 pre-linked to an existing person (`match_confidence: 'high'`) and 20 unmatched (`'none'`), to exercise sorting and pagination against a realistic total. This surfaced that the founder's real queue already had **1304** selected candidates (not exactly the "~1300" quoted verbally) — the "1329" seen on Home's nudge after inserting turned out to already include the 25 test rows, only noticed afterward by doing the arithmetic.

Pagination (page 1 of 67, boundary landing exactly at real page 15 where confidence flips from `'high'` to `'none'`), the group picker (search-filter, browse-all, and inline "+ Create group" all confirmed against the founder's real ~50-group roster), and a full accept round-trip (name edit + group tag → verified via REST that the resulting `people` row and `person_groups` link were correct) all worked as designed. **The mistake:** while testing the "change match" and Accept/Reject interactions by hand, two of the cards clicked were real founder contacts already on page 15 ("A.j Wilson" and "A1C Ringenberg"), not synthetic test rows — one got genuinely accepted (creating a real new `people` row, since renamed and group-tagged for the test) and one got genuinely rejected. Caught immediately by rereading what had actually been clicked. Fixed via: `PATCH`-restoring both candidates back to `status: 'selected'` with `matched_person_id`/`reviewed_at` cleared (REST, allowed), then deleting the erroneously-created person **through the app's own "Delete this profile" UI flow** rather than a raw REST `DELETE` — a direct `DELETE` on `people`/`person_groups` was in fact blocked by the session's safety classifier (see PROJECT_CONTEXT §2's classifier note), which turned out to be the right guardrail for exactly this situation. The 25 synthetic candidate rows (never real data) were removed with a scoped REST `DELETE` on their distinguishing `row_key` prefix, which the classifier did allow. Final state confirmed via REST count: exactly 1304 selected candidates, People count back to its pre-test 553 — the founder's real queue is untouched other than the two intentional feature changes (items 67/68) it was there to test.

**Lesson for next time a live click-test touches a real, non-empty queue:** don't hand-pick "the first card" or "a card that looks representative" for interaction testing when the queue is real founder data — either seed synthetic rows with enough of a distinguishing marker (name prefix, a `row_key` pattern) to *also* visually recognize them mid-test and never lose track of which card is which, or restrict interactive clicking to rows already confirmed synthetic by checking their `full_name`/`row_key` first.

---

## 28. Event input fixes: speed, parsing accuracy, and missing notes (2026-07-30)

**The ask.** The founder reported six problems hit while repeatedly trying to add events: chat capture is slow, parsing isn't accurate, the saved notes leave out details they actually gave, date/name don't reliably populate, and there's no way to add a note to an event without going through chat (unlike people/groups, which both have a manual note box). Prioritized as: speed, accuracy, and complete notes matter most; the rest should still be addressed.

**Root causes, found via investigation before any code changed.** Events are created and edited almost entirely through two AI chat surfaces (`Home.tsx`→`converse` for new events, `UpdateMomentChat.tsx`→`update-moment` for editing one) — there was **no manual date or location field anywhere on the event page**, only title and description could be hand-edited, so a wrong AI-guessed date had no fallback. Both Edge Functions issued their roster reads sequentially instead of in parallel, and `_shared/selfContext.ts` had a nested-sequential N+1 (per-parent, then per-spouse) on every single turn. The "incomplete notes" complaint had two separate causes: `summarize-moment`'s system prompt explicitly capped the event description at "2-4 smooth sentences" (designed to compress away detail), and the per-event "Notes" section was populated *only* from per-attendee notes — anything the user said that wasn't tied to one named person (an activity, the weather, how something went) had no structured place to land at all.

**What got built.** *Speed:* `converse`/`update-moment`'s six initial roster reads now fire via `Promise.all`; `_shared/selfContext.ts`'s parent→spouse relationship lookups batch the same way; the sibling-suggestion loop in `_shared/relationships.ts` (`applyFamilySignals`) parallelizes its per-sibling Anthropic calls instead of chaining them; `summarize-moment` now kicks off in the background (`EdgeRuntime.waitUntil`) the moment a new event is created, instead of waiting for the user to open the event page. Deliberately NOT done: trimming the full moment-history context sent on every `converse` call — the main long-term prompt-size growth driver, but cutting it risks the accuracy fixes below, since the model needs that context to disambiguate people/events; left as a flagged follow-up. *Accuracy:* `_shared/dateValidation.ts` (new) sanitizes `event_date`/`event_end_date` after every JSON parse before they can reach a write; the date-resolution instructions gained worked examples for ordinal-day ("the 4th"), weekday ("next Tuesday"), and compound ("two weeks from Saturday") phrasing, which the old instructions didn't cover; every new moment now explicitly requires a concise `occasion` instead of being allowed to go null. *Notes:* `summarize-moment`'s prompt dropped the fixed sentence cap entirely, now explicitly prioritizing completeness over brevity (`max_tokens` raised 250→600 to match); the `notes`/`additional_notes` JSON contract in both `converse` and `update-moment` now accepts `"person": null` for a general event-level detail, written as `moment_id` + `person_id: null` — the exact shape `GroupDetail.tsx`'s own manual notes already use, so `EventDetail.tsx`'s existing note-rendering needed no changes at all (it already null-checked `n.people`). The "who was there" CRITICAL instruction gained an anti-example so a person with an actual described role no longer gets flattened to a generic "Was there." note. *Manual fallback (matches how people/groups already work):* `EventDetail.tsx` gained an "Edit date & location" inline form (mirrors the existing title-edit pattern) and a manual "Add a note" box (mirrors `GroupDetail.tsx`'s `submitGroupNote` exactly — plain textarea, direct insert, no AI classification step) — the Notes section now also renders even with zero notes yet so the box is reachable on a brand-new event.

**Deploy gap, and how it got closed.** `converse`/`update-moment`/`summarize-moment` are Edge Functions — pushing to `main` only redeploys the Vercel frontend, never these (per the standing infra gotcha). No Supabase access token was available at first; the founder was asked to choose between generating one or hand-pasting the files into the dashboard themselves, chose to generate a token (`supabase.com/dashboard/account/tokens`), and pasted it in-session. All three functions deployed via `npx supabase functions deploy converse update-moment summarize-moment --project-ref dedtnytxhzzjimkozncc` — confirmed success from the CLI's own JSON response.

**Verification.** `npm run build` green. Frontend-only changes (manual date/location fields, manual note box) verified in the browser preview against the real `jakevolin@gmail.com` account before any deploy was even possible — editing SF Fleet Week's date persisted and displayed correctly; a manual note saved and rendered with no person prefix, exactly like a general/event-level chat note would. After deploying, a real end-to-end chat test against the live account ("Went to my nephew Danny's birthday party the 4th... we grilled burgers... it rained so we played board games instead of the piñata... my brother Josh brought his new girlfriend Amy") confirmed every fix live: `event_date` resolved to July 4, 2026 (the ordinal-day fix), occasion auto-named "Nephew Danny's birthday party", the description covered every concrete detail (burgers, rain, piñata→board games, Josh+Amy) with no compression, Josh's own note read "Brought his new girlfriend, Amy, to the party." instead of a generic "Was there.", and two genuinely general notes appeared with no person attached ("Grilled burgers at the party.", "It rained, so they ended up playing board games..."). The existing name-disambiguation logic (unrelated to this session's changes) correctly caught that the account already had a Danny Volin and two Amys on file and asked before creating duplicates.

**Test-data cleanup.** The live chat test above created real rows in the founder's real account — a throwaway moment, two fabricated people ("Danny Jr", "Amy Chen"), and fabricated family relationships/reciprocal notes on Josh Volin's real profile. All removed afterward via the browser's own authenticated client (same narrow, single-account "browser-client fallback" pattern noted in PROJECT_CONTEXT §2 for disposable test-data cleanup): the test moment, its notes, `moment_tags`/`moment_groups` rows, the `relationships` rows for both fabricated people, the two fabricated `people` rows themselves, and the two fake reciprocal notes that had been written onto Josh Volin's own profile ("In a relationship with Amy Chen.", "Their child is Danny Jr."). Verified clean via a follow-up query: both fabricated people and the test moment return null, and Josh's remaining notes are all genuine pre-existing content.

## 29. The first real security audit, and why we didn't build end-to-end encryption (2026-08-01)

Founder opened with genuine anxiety, not a feature request: *"if there's ever a leak of the data... the whole app and the user of it is totally gone."* Two specific asks — understand what's actually protected, and find out how journaling apps like Day One claim end-to-end encryption and whether Boomer could. They'd put the audit off for a long time on the strength of having been told it would be too complex to approach. It took an afternoon.

**The audit itself** (static read of `supabase/functions/**`, `migrations_manual/**`, `src/**`, `package.json`, `vercel.json`; nothing could be checked live — no credentials in the container and the environment's proxy blocks outbound access to both the app and Supabase).

The foundation came back sound, which was worth saying plainly to a founder braced for bad news. RLS is applied consistently across all 15 checked-in migrations. All 12 Edge Functions gate on `auth.getUser()` before doing anything and then relay the user's own JWT so RLS still applies server-side. The three functions holding the service-role key (`google-photos-picker-session-create`, `-import`, `scan-calendar-sources`) scope every query by the id from the *verified token*, never from the request body — the single most common way this class of code goes wrong, and it was already right. `photo_connections.refresh_token` has no SELECT policy for `authenticated` at all, deliberately. Three runtime dependencies, `npm audit` clean, no `dangerouslySetInnerHTML`/`eval` anywhere in `src/`.

**The one real hole is an absence, not a mistake.** `people`, `moments`, `notes`, `groups`, `person_groups`, `reminders`, `home_suggestions` predate the practice of writing migrations down — they were created by hand in the dashboard. PROJECT_CONTEXT §6 asserts "RLS on everything," but for exactly the seven tables holding all the real content, that's a claim with no artifact behind it. Hence `migrations_manual/2026-08-01-rls-audit.sql`: read-only, four queries, written so the founder can read the output themselves (what a good result looks like, what a leak looks like) rather than pasting it back blind. Notably it checks not just *whether* RLS is on but what each policy's expression actually **says** — a policy reading `true` is a lock that's never locked, and a summary view can't tell the difference.

**Re-ranking for the real situation.** The founder confirmed mid-session they're the only user, pre-launch. That inverted the usual priority list: the top action isn't encryption or even the RLS check, it's **closing public signup** — one Supabase toggle that removes both the AI-billing abuse vector (no rate limiting on `converse`/`transcribe`) and, by removing the other tenants, most of the cross-tenant risk at once. Second observation worth keeping: **the founder's own logins are the likeliest breach path**, and GitHub belongs in the top tier alongside Gmail and Supabase *because of this repo's own auto-deploy setup* — a push to `main` goes to production with no review step, so a stolen GitHub password is arbitrary code against all data. That's a real cost of the standing CLAUDE.md permission, worth naming rather than hiding.

**The encryption answer.** Day One can promise E2EE because it's a filing cabinet it has no key to: the phone encrypts, the server stores ciphertext, and every feature that reads entries (search, "on this day") runs on-device. Boomer is the exact inverse — its value *is* a server-side AI reading the notes. **Claude cannot read ciphertext.** So full E2EE and the current product are mutually exclusive; this is not a difficulty problem, and any app advertising both is either doing AI on-device or overselling. Three options documented, none committed to: (a) app-layer encryption of sensitive columns with a key held outside the DB — defends against a stolen dump, doesn't stop the founder reading it, the honest middle ground; (b) on-device AI in a native app — the only path to genuine E2EE that keeps the product intact; (c) full E2EE now — trivial, and it deletes the app. Recommendation given: don't buy encryption theater; closed signups, 2FA, verified isolation and tested backups all outrank it, and `Privacy.tsx`'s existing refusal to claim E2EE is an asset that would be expensive to walk back.

**Native iPhone, decided in the same conversation.** The founder's actual pain is that opening a laptop to log a memory means the memory doesn't get logged. First recommendation was Capacitor — it reuses all ~24,300 lines as-is, versus React Native/Swift which would rewrite the ~20,100 lines of web-DOM screens (the backend is 100% reusable on every path, which is the headline). Then they said they work on a PC and only have occasional access to their wife's Mac. **That kills Capacitor**: Xcode is macOS-only, so every build *and every update* would need a borrowed machine — a favor, not a workflow. Switched the recommendation to a **PWA**, which needs no Mac, no $99/yr, and no App Review, and which the app is already built for — Whisper was chosen over the Web Speech API back in §2 precisely because the latter doesn't work in iPhone Safari. The Apple Guideline 4.2 "just a website in a wrapper" rejection risk raised earlier also evaporates, since nothing gets submitted. Capacitor stays filed for if camera-roll access ever becomes the blocker.

**Deferred on purpose, in `SECURITY.md`'s own order:** security headers, AI rate limiting, email confirmation back on, account delete/export, app-layer encryption, CORS lock-down. None urgent with one user; all required before anyone else's memories are in there.

**The audit came back clean, and the mystery had an answer (same day).** Founder ran the script; all 23 tables protected, every read policy scoped to the owner, nothing wide open. The seven undocumented dashboard-made tables were covered all along because of **`rls_auto_enable`** — an event trigger left behind by the original Bolt/StackBlitz scaffold that runs `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` on every `CREATE TABLE` in `public`. It surfaced as an unexpected second row in the "functions that bypass RLS" query and looked alarming for about a minute before its source was read. It's correctly written — `SECURITY DEFINER` with a pinned `search_path` — and should be left alone. Worth remembering as a general lesson: **an unfamiliar `SECURITY DEFINER` function is not automatically bad; read its body before reacting.** §6's "RLS on everything" is now evidence rather than an assertion.

**A real flaw in the first version of the audit script, caught by the founder running it.** It was four separate `SELECT` statements, and Supabase's SQL Editor only displays the *last* result set — so the founder pasted back the bypass-function list and three quarters of the audit had silently vanished, including the part that actually answered the question. Rewritten as a single `UNION ALL` returning one labelled table. **Any future diagnostic script meant for the SQL Editor must be one statement**, or most of it will never be seen. Section 3 (WITH CHECK expressions) was added in the same pass after noticing four INSERT policies showed blank in the read column — INSERT rules only carry a write condition, so the original script couldn't see them at all.

**Second pass on writes closed both leftovers — the audit's own flags were wrong, not the database.** `group_associations` was flagged because its USING clause only ownership-checks `group_id_a`; its WITH CHECK turns out to require **both** groups belong to the caller, so the cross-account row the asymmetry appeared to permit can never be created. And the four INSERT policies that looked blank (`home_suggestions`/`notes_group_insert`/`photo_connections`/`relationships_insert_own`) are all correctly scoped — they only looked blank because INSERT policies carry a WITH CHECK rather than a USING. Both corrections were pushed to `SECURITY.md` rather than left standing as scary notes. **Lesson for any future RLS audit: read USING and WITH CHECK together — judging a policy on one half of its definition produces false alarms in both directions.**

**A wording bug in the audit script that would have caused a real scare.** Section 3's first version labelled a NULL `with_check` as "no write rule (read-only policy)". That's wrong and alarming: for `FOR ALL` and `FOR UPDATE` policies Postgres automatically reuses the USING expression as the write condition, so a blank there is normal and safe. Fifteen rows — `people`, `moments`, `groups`, `person_groups`, `reminders` among them — were mislabelled that way. Now labelled "inherits the read rule - good", with only genuine SELECT/DELETE policies marked n/a, and the inherited expression printed so it's visible rather than assumed.

**One structural note carried forward:** `notes` has six overlapping policies because a note can hang off a person, a moment, or a group. Correct today, but the most intricate rule set in the database and the one to re-read if a fourth note type is ever added.

---

## 30. Family tree centered person drifting off-screen (2026-08-03)

**The report.** Founder noticed that clicking through people's family trees, the centered (purple)
person seemed to slowly drift toward the right edge of the canvas, and the connector lines started
overlapping — pointed at Caroline Volin's and Clare Sucre's trees as clear examples.

**The investigation.** Loaded the real app in the browser preview, logged in as the test account,
opened Caroline Volin's family tree, and pulled the rendered SVG's actual `rect` coordinates via
`javascript_tool` rather than guessing from a screenshot. Canvas width was 4244px; Caroline's own box
sat at x≈3316 (center ≈3386) — nearly 80% of the way across, nowhere near the canvas center (2122).
Checking box fill colors confirmed every single "extended" family member (17 grandparents/aunts/
uncles/cousins) rendered in the same blue "side a" — `SIDE_COLORS.b` (rose) never appeared anywhere
in the tree, even though Caroline's two parents (Mark Berzins, Margaret Berzins) are two distinct
people who should anchor two different sides.

**Root cause.** `familyTree.ts`'s `sideOfParent` determined which "side" (a/b) a grandparent/aunt/
uncle/cousin's lineage belonged to by looking up which entry of `parentCouples` — built via
`groupIntoCouples(g, treeParents)` — a given parent id fell into. `groupIntoCouples` pairs up any two
ids in the list who are each other's spouse. Since root's own two parents are almost always married
to *each other* (the ordinary case), they collapsed into a single couple (`[[mark, margaret]]`), so
`sideOfParent` returned side `'a'` for literally everyone — both of root's parents' entire extended
families ended up bucketed into `leftExtended`/`leftCousinBranches`, and `rightExtended`/
`rightCousinBranches` stayed permanently empty. `FamilyTree.tsx`'s canvas centers on the tree's total
content bounding box (not on the root's own position), so cramming 100% of the extended family onto
one side systematically dragged the root's box toward the opposite edge. This affected essentially
every person in the app whose parents are (or were) married — i.e. most people — which is why it
read as a general, worsening problem rather than an isolated one-off.

The "couple" grouping wasn't arbitrary — an earlier fix (`cbfcb80`, "Color-code family tree by focal
person and family side") deliberately moved off *within-branch position* (0 for whoever's listed
first) to *couple-index parity*, specifically to handle divorced/separated parents who were never
linked to each other via a spouse relationship on file (each landing in their own single-person
branch, both index 0, both side 'a' under the old logic). That fix solved the divorced case but
broke the far more common married case, since it never separated "the couple root's two parents
happen to form" from "the two distinct blood lines those two parents each represent."

**The fix.** Replaced `groupIntoCouples`/`sideOfParent` with `buildParentSides(g, rootParents,
treeParents)`: assigns side directly from `rootParents` (root's own distinct parent ids, by index
parity — `0 → 'a'`, `1 → 'b'`, alternating for a 3rd+ parent on file), independent of whether those
parents are married to each other. Any `treeParents` entry added by `expandParentsWithSpouses` (a
deceased spouse of a recorded parent, added to recover a lost blood line — see §29/history item 20)
inherits the side of whichever `rootParent` it was expanded from, since it's standing in for that
same blood line.

**Verification.** Build (`tsc -b && vite build`) and the full vitest suite (70 tests) both passed.
Re-checked Caroline Volin's tree live: `Pat Carroll`/`Mimi Carroll` (Margaret's own parents) and the
Leonard/Carroll/Crigler cousins now render in rose (`#F8EEF1`), Mark's side (Ruskaup/Berzins) stays
blue — both colors now actually appear, matching the legend's claim. Root's box position also moved
from ~78% across the canvas to ~21% — no longer pinned to one extreme edge. The remaining offset from
dead-center reflects genuine data asymmetry (Margaret's side has more people recorded than Mark's),
not a bug — a perfectly-centered root isn't achievable without either wasting canvas space or
clipping whichever side has more recorded family, and centering on total content width is the
existing, intentional design (see item covering the 2026-07-22 layout centering fix, same file).
Checked Clare Sucre's tree too (Caroline's sister, same parents) — same fix, same improvement.
Committed and pushed directly per the founder's standing verify-then-push permission (`CLAUDE.md`).

---

## 31. Collapsing Event/Group's two note inputs into one, and a deploy-time surprise (2026-08-03)

**The ask.** Founder asked a plain question about the Events page: "what's the difference between 'Add notes' and 'Remember something else?'" That led into a broader confusion — Home has a chat too, so is that where event details are supposed to go, or the event page, or both? Explicit ask: reduce the complexity without losing capability.

**Investigation.** Three parallel Explore passes mapped every "type/speak and the app figures it out" surface in the app. Found three genuinely different patterns coexisting: Home's `converse` (one freeform chat, whole-account scope, decides itself which moment/person something is about — intentionally different, left untouched); `PersonDetail`'s fact bar (one input, `add-fact` classifies server-side, no user-facing choice); and EventDetail/GroupDetail's dual-input (a plain verbatim note box sitting beside a separate AI chat doing real extraction). PROJECT_HISTORY §28 already documented why the plain box existed (added as a fast/reliable fallback once chat-only editing turned out to have real gaps) — not an oversight, but it left two surfaces doing overlapping jobs. Critical finding before touching anything: `update-moment`'s AI does NOT save the user's literal words for a general note — it paraphrases into a short fact (`additional_notes[].note`) — so a naive merge risked silently losing the verbatim-storage guarantee that matters for a memory-keeping app. Founder's one load-bearing call: attendee/relationship detection should run **automatically** on every note, not on-demand.

**What got built.** New `src/components/NoteWithDetection.tsx` replaced `UpdateMomentChat.tsx`/`UpdateGroupChat.tsx` — one box (matching `PersonDetail`'s already-proven single-input pattern) that inserts the user's exact words verbatim and instantly, then fires `update-moment`/`update-group` in the background purely for detection (attendee links, relationship signals, mentioned-people suggestions), reusing the existing `RelationshipSuggestions`/`MentionedPeopleSuggestions` banner components unchanged. A genuine disambiguating question from the model now surfaces as one inline follow-up (`needsClarification`, replacing `done`) instead of requiring a persistent open thread. `update-moment`'s prompt was told to stop emitting a `"person": null` `additional_notes` entry (that used to duplicate the verbatim note with an AI paraphrase) and both prompts were told to stop angling for an open-ended "anything else?" follow-up, since each call is now one discrete note rather than a multi-turn conversation. `EventDetail.tsx`/`GroupDetail.tsx` collapsed 11 note-related props down to one `noteBox` slot each.

**The syntax bug `npm run build` couldn't catch.** The first deploy attempt of `update-moment` failed at the bundler with a parse error — the new prompt text had used literal backticks (`` `"person": null` ``) *inside* the function's own backtick-delimited JS template literal, terminating it early. `npm run build` (`tsc -b && vite build`) passed clean the whole time, because `supabase/functions/**` isn't part of that TypeScript project at all — it's Deno code, only checked at actual deploy time. Lesson for next time: an Edge Function change being "build-green" says nothing about whether it will actually bundle; only a real deploy (or a local `deno check`) catches this class of bug.

**Deploy, and a nice surprise.** Per the standing infra gotcha, `git push` only redeploys the Vercel frontend — the two Edge Functions needed a separate deploy. Expecting to have to ask the founder for a fresh Personal Access Token (the established per-session pattern), a `git diff` on `PROJECT_CONTEXT.md` — modified concurrently on disk by another live session working on unrelated Events-page filtering — revealed `SUPABASE_ACCESS_TOKEN` is now persisted in the local, gitignored `.env` as of today, no longer requiring a fresh paste each session. Loaded it into the environment via PowerShell without ever printing the value, deployed `update-moment` (failed once on the backtick bug, fixed, redeployed clean) and `update-group` (clean first try).

**Verification.** `npm run build` green throughout. Clicked through both a real event ("Pup Dog date night") and a real group ("22 AS") in the browser preview against the live `jakevolin@gmail.com` account: a plain factual note saved and displayed verbatim with no paraphrased duplicate; a note mentioning a known person (Gus Reynolds) round-tripped through the live function with no crash. Confirmed the redeployed code was actually live (not just committed) via a direct `supabase.functions.invoke` call from the browser console: response now returns `needsClarification` instead of `done`, and a general-detail test message produced zero note rows (the duplicate-note fix, confirmed working end to end). All test notes and regenerated summaries cleaned up afterward via the browser-client fallback so the founder's real data was left exactly as found.

**Mid-flight discovery: a second live session on the same files.** While finishing up, `converse`/`update-moment`/`update-group`/`summarize-moment` all showed further uncommitted changes beyond this session's own edits — another concurrent session had started on backlog item 77 (chat notes inventing sentiment not actually said), touching the same prompt strings. This session's own small remaining uncommitted fix (the backtick removal, needed for `update-moment` to keep matching what's actually deployed) was left uncommitted rather than risk bundling someone else's in-progress, unverified prompt change into a commit under this session's turn — flagged to the founder directly instead of silently committing over it.

---

## 32. Closing out item 77: invented facts and the wrong narrator on "Going to be a girl dad!" (2026-08-03)

**The report.** Founder asked directly (not via the feedback widget this time) to debug a specific event: what they'd typed didn't match what got parsed into notes, a detail about an ultrasound was invented outright, and the summary read from Caroline's perspective instead of their own.

**Investigation.** No local dev server was usable (another session already had one bound in this folder), so this went straight at the deployed production app in the browser, logged in as the real `jakevolin@gmail.com` account. Found the event ("Going to be a girl dad!", Aug 3) and expanded its notes — the real, stored data, not a rendering artifact: a note reading "Found out at the ultrasound that Bebe is going to be a girl" attached to **Bebe!!! Volin's own profile** (the unborn baby — who obviously didn't discover or announce anything), plus a general note claiming "all the other health markers from the ultrasound looked good," which the founder says was never said. `update-moment`'s notes couldn't have produced this — item 81 (§31, same day) made its general notes 100% verbatim by design — so this had to trace back to `converse` (Home chat), which still lets the model freely author both general and per-person notes from scratch. Checking the backlog turned up item 77, already opened via the feedback widget that same day on a different event ("Jake's birthday dinner"), explicitly scoped as "still open for `converse` and for AI-written per-attendee notes" — this was the same bug class, not a new one, and closing it meant fixing both of those named gaps.

**Root cause, part 1 — no anti-fabrication rule anywhere.** `converse`'s `stableInstructions` had extensive guidance on capturing *every* detail the user gave, but nothing at all telling the model not to *add* detail it wasn't given. Asked to write a natural-sounding note about "finding out the baby's a girl," the model reached for the culturally obvious method (an ultrasound) and invented it as fact.

**Root cause, part 2 — attribution by topic instead of by agency.** The existing "attach to a specific attendee" instruction only asked whether a detail was "about" someone, not whether that person was the one who *did* it. "Bebe is going to be a girl" names Bebe, so the model attached it to her — even though nothing in the sentence is a thing Bebe did or said.

**Root cause, part 3 — a real caching gap, independent of the above.** `converse` only ever kicked off `summarize-moment` inside the brand-new-moment branch. A detail added to an *already-existing* moment via Home chat (as opposed to the event page's own chat, which nulls+reloads on every save) never invalidated `moments.summary` at all — no code path did it. A summary written early, before all of a moment's notes existed, could sit stale indefinitely. Given the timing (the event was created and added to across the same morning), this is the more likely mechanical explanation for the reported "wrong perspective" than one unlucky model sample.

**Root cause, part 4 — summarize-moment had no self-anchor.** Even setting the caching gap aside, `summarize-moment`'s prompt never said which recorded person the account owner *is*. Told to write in "the user's own first-person voice," the model had nothing to anchor "I" to besides whichever named person's note happened to read most prominently — reliably correct only by accident.

**The fix.** `converse`: added an explicit anti-invention rule and sharpened the attribution rule to "did/said/experienced it themselves, not merely the sentence's topic," with a worked example matching the exact bug. Also introduced `momentIdsNeedingResummary`, a per-turn dedup set fed by every note-insert path (a moment's own notes, mentioned-name notes, both new and pre-existing moments), with a single kickoff loop after all of a turn's writes land — closes the caching gap without changing when/how the kickoff itself fires. `summarize-moment`: added a parallel `is_self` lookup and threaded the resulting name through both the context block and the system prompt as the fixed narrator, plus the same anti-invention rule. `update-moment` (`additional_notes`) and `update-group` (`notes`) got the same two-part instruction mirrored in, consistent with item 76's standing complaint that a rule fixed in one chat prompt silently stays broken in the others.

**Deploy.** Sourcing `.env` wasn't tried first — asked the founder for a fresh Personal Access Token out of habit, which they provided; worth remembering next time that `SUPABASE_ACCESS_TOKEN` has lived in the local, gitignored `.env` since item 81 (§31) and can just be sourced instead of asking. All four functions (`converse`, `summarize-moment`, `update-moment`, `update-group`) deployed clean on the first attempt.

**Verification.** `npm run build` green (these are Deno files outside that TypeScript project, so this mainly confirmed nothing in `src/` regressed). Re-ran `summarize-moment` live on the actual reported event via its "Refresh summary" button: output stayed grounded in the stored notes with nothing new invented, and correctly voiced in the account owner's first person. The residual mention of "the ultrasound" in that regenerated summary is expected, not a fix failure — it's summarizing a note that was already fabricated by the *old* code before today's fix, and a prompt change can't retroactively know a past note was invented. That data-level cleanup is intentionally left to the founder rather than guessed at (see item 77's "Known gap" note) — fixing it would mean writing new fabricated text to replace old fabricated text without actually knowing what was said.

**Working alongside a live third session throughout.** Two other sessions were active in this same repo during this work — one committed an events-filter-panel change and a `PROJECT_CONTEXT.md` update mid-session, another had already landed §31's note-consolidation work earlier the same day. `git status`/`git diff` were re-checked before every write (not just once at the start); the four Edge Function files this session touched were confirmed clean each time, so nothing here overwrote in-flight work from either.

---

## "Child in law" was never a wording bug (2026-08-05)

The founder reported that the family tree called Mark Berzins Jake Volin's "child in law" instead of "son in law". The obvious read is a gap in `relationshipCalculator.ts`'s vocabulary — it isn't. That file has said `son-in-law`/`daughter-in-law` since it was written, and only falls back to `child-in-law` when `people.gender` is empty for that person.

The tempting next step was to go set Mark's gender. Also wrong. **`people.gender` does not exist in the database at all** — the `2026-07-26-gender.sql` migration has been sitting in §8's founder-action list unrun for ten days. Confirmed without needing a login, by asking PostgREST for the column through the app's own client in the dev preview: `{"code":"42703","message":"column people.gender does not exist"}`. An unauthenticated request is enough here because a missing column is a 400 that beats RLS to the answer; an existing column would have returned an empty 200.

So the symptom was never about Mark. Every in-law in the app reads "child-in-law"/"sibling-in-law"/"parent-in-law", every aunt or uncle reads "aunt/uncle", no tile has ever shown a ♂/♀ glyph, and PersonDetail's Gender dropdown has been silently discarding every save since 2026-07-26. All of it fails open exactly as designed (isolated query, no crash) — which is precisely why it went unnoticed for ten days and surfaced as one odd word on one tile.

Two things came out of it. `loadFamilyGraph` now surfaces the column's absence as `graph.genderSupported` instead of swallowing it, so a surface that wants to *ask* for a gender can hide rather than offer a save that silently fails. And the founder's own suggestion — pop the question where the relationship is being shown — became `ClarifyGenderPrompt.tsx`. **The lesson worth keeping: when a fallback value shows up in the UI, check whether its input exists at all before assuming the code that chose it is wrong.** §8's founder-action list is the first place to look, not the last.

---

## The account outgrew a URL (2026-08-07)

Three console 400s on page load, noticed in passing while verifying an unrelated change. Nothing was visibly broken, which is the whole story.

The failing request was `relationships`, scoped by `getRelationshipsMap(personIds)`. PostgREST filters travel in the query string, and this one names its id list **twice** — once for `person_a_id.in.()`, once for `person_b_id.in.()` — so every UUID costs ~74 characters. `suggestConnections.ts` passes everyone already in a group. At 457 people that's a 35,719-character URL, which the API gateway refuses with a bare `Bad Request` (not a PostgREST JSON error — it never reaches PostgREST). `const { data } = await query` then leaves `data` null, and `for (const row of data ?? [])` reads that as *nobody is related to anybody*.

So Home's "Connections to make" card has been running on two of its three signals since 2026-07-26. Event attendance and associated-group membership kept working, the card kept showing suggestions, and the family signal — spouse of a member, then that couple's kids — contributed exactly zero for twelve days. Nothing looked wrong because the card is a rotating sample of a candidate pool; a smaller pool just looks like a different sample.

The scoping comment in `suggestConnections.ts` said the id list was "cheaper than a full-table relationships fetch." That was true when it was written. The whole table is 341 rows — one 102-character request. The scoped version was asking for nearly every person in the account and paying 35 KB of URL to say so. The optimization inverted as the account grew, and no test could have caught it: it only fails past a few hundred people, and only against a real gateway.

Fixed in `getRelationshipsMap` rather than at the call site, so no future caller can trip it by simply having a bigger account — past 150 ids it fetches the table unscoped, below that ids go out in batches of 50 and merge. Callers on the unscoped path get a superset map, which is safe because `suggestFamilyMembers` only ever walks out from the seed ids it's handed.

**The lesson worth keeping, and it's the same one as the gender-column entry above:** a fail-open `?? []` turns a broken request into a plausible-looking empty answer. Both bugs survived because the degraded state was indistinguishable from a legitimate one — an in-law with no gender recorded, a group with no family to suggest. Worth being suspicious of any console error that "doesn't seem to break anything," and worth asking of any `?? []` whether an empty result and a failed request should really look the same to the code downstream.

---

## 2026-08-08 — Two doors into the same room: why "+ Add Event" events never filled themselves in

The founder made an event on their phone via **+ Add Event**, left a note by voice, and watched nothing happen: still "Untitled moment", nobody tagged, description still "Nothing written yet". The question they asked is the one worth recording — *"why does it sometimes seem to populate the event with relevant info and other times it seems to just get stuck?"*

It was never intermittent. There are two ways an event gets created, and only one of them was ever taught to fill an event in.

An event born in the **Home chat** goes through `converse`, which carries an explicit instruction: *every `new_moment` entry needs a concise `occasion`… work one out from whatever the user described even if they never stated a literal title.* Those events arrive named and populated.

An event created with **+ Add Event** is a blank shell, and notes on it go through `update-moment` — whose prompt said `occasion` should *"only [be] set when the user is giving new or corrected info for that specific field."* A title is the one field that can never be *stated*; it has to be derived. So that rule structurally excluded the only field that needed deriving, and the event stayed untitled forever. Two functions, two prompts, one instruction present in one and absent in the other — and the founder experienced the gap as flakiness.

**The compounding failures are the more interesting part**, because each one independently produced the same symptom (nothing visibly happened) by a different mechanism:

- **The description could never regenerate.** `handleNoteSaved` cleared the cached summary, then the reload gate refused to rebuild it because it required `raw_description.trim()` — permanently `''` on a manual shell. Meanwhile `summarize-moment` had been reading `moment.notes` correctly the whole time. The summarizer was fine; nobody was allowed to call it.
- **Long notes silently lost everything.** `max_tokens: 1500`, no `stop_reason` check. A truncated response fails to parse, the regex fallback salvages `reply` and nothing else, and the function returns **200 with a friendly acknowledgement** while every attendee and field update it found is discarded. The nicer the reply, the more convincing the failure.
- **Write errors were discarded.** An RLS rejection on the title update still reported `changed: true`.
- **The UI swallowed every failure.** `if (fnError || !data) return`. No spinner (the saving flag cleared *before* the AI call started), no error, and the assistant's reply — including the function's own "That didn't save — mind trying again?" — was never rendered for events at all. A 500 and a successful no-op were pixel-identical.
- **The mic failed invisibly.** Whisper returns `" "` for silence; `!data?.text` is false for `" "`, so it counted as success and inserted nothing.

**Two lessons worth keeping.**

First: *the same instruction living in two prompts will drift, and users experience the drift as randomness.* `converse` and `update-moment` are both "extract structure from what the user said" paths that had diverged. When a behavior is supposed to be true of the app rather than of one code path, the absence of it somewhere else won't announce itself — it shows up as a founder asking why the app is inconsistent.

Second, and this echoes the fail-open `?? []` lesson above: *a friendly reply is not evidence of success.* Three separate defects here returned cheerful, well-formed, HTTP-200 responses while dropping the user's data on the floor. Truncation, a rejected write, and a swallowed error all rendered as "everything's fine." Worth being suspicious of any path where the success message is generated independently of the thing that was supposed to succeed. The fix that generalizes: the new `applied` payload reports only what a write actually returned without error, and the UI checklist is built from that — so the app can no longer tell the founder it renamed something it didn't.

The progress panel was the founder's own call, and their framing was right: *"I just don't want the user to have to sit there and wonder if the app is doing what it's supposed to."* Notably, we did **not** build fake staged checkmarks ticking off on a timer — the entire wait is one AI call and the database writes after it take under a second, so there is genuinely nothing to stream. One earned checkmark ("Saved your note", true the moment the row lands), an honest pending line, then the real results. Faking granular progress would have been the easy version and a lie about what the app was doing.

---

## 2026-08-08 — Beefing up "Connections to make", and the ex-wife who became a mother

The founder's feedback-widget note was four words of substance: *"we probably need to beef it up."* Three things came out of chasing it that are worth keeping.

**Measure the complaint before designing the fix.** The card only ever asked one kind of question — "add this person to this group?" — so the obvious read was "add more question types." True, as it turned out, but the first diagnosis offered was wrong in a way worth recording: a hand-written SQL reconstruction of the card's own logic said the candidate pool was **2 suggestions**, and that number got reported to the founder as "the card is nearly empty." Running the actual TypeScript against the real account gave **25**. The SQL had reimplemented only part of the family signal (it did spouses-of-members and skipped the second pass that suggests a couple's children once both parents are members). Lesson: when a reconstruction of production logic and production logic disagree, the reconstruction is wrong. Don't reconstruct — call the real function. The browser console with the app's own client was right there and would have given the true number in one call.

**A dry run can be the deliverable.** The founder also asked, reasonably, for "an agent which routinely scans the app and figures out ways to come up with new ideas for connections." That has a name — association rule mining over a personal knowledge graph — and it's free and deterministic, no AI needed. Rather than build it, we ran it read-only first. At trustworthy thresholds it found 24 rules and 22 of them had nothing to suggest: the account was *already complete* everywhere the patterns were strong. Loosening the thresholds produced volume entirely from the bad rules — "everyone in 22 AS is also a Pilot" (0.67 confidence, 15 suggestions, and wrong, because a squadron has loadmasters and maintainers too). The mechanism is sound; it's a feature for *messy* accounts. Ten minutes of read-only queries turned a multi-session build into a filed backlog item with numbers attached. Do this more.

**The part that actually bit.** Verification called for accepting a real suggestion, so the founder was asked to confirm which family suggestions were true — they confirmed that Lisa Dunn should be recorded as a parent of Liam and Cormac. Correct: Lisa is married to Brian, and Liam and Cormac are Brian's children from his first marriage to Tara. Clicking Yes wrote the two parent rows and then `syncFamilyClique` — long-standing, shared with the Family Tree page — cascaded four more. Three were fine (two step-sibling links, and Brian as a parent of Elizabeth, which the card was already asking about anyway). The fourth wrote **Tara, Brian's ex-wife, as the mother of Elizabeth, who is Lisa's daughter.** Two people with no relationship whatsoever, now linked in real family data.

The sync wasn't malfunctioning. It does exactly what it says: walk the sibling closure, give every member the union of everyone's parents. That is correct for a nuclear family and false for a blended one, and nothing in the code knows the difference. What changed is exposure. That cascade used to fire only right after someone manually linked a relationship on one person's Family Tree page — a moment when the founder is already looking at that family and would notice. Now a step-parent question can appear on Home, out of context, and one Yes fans out into a family the founder wasn't thinking about. **A safe inference becomes an unsafe one when you change where it can fire from.** The generalizable version: when surfacing an existing write path somewhere new, audit its side effects at the new call site, not just its behaviour at the old one.

Filed as item 86 rather than fixed on the spot — a founder call, and the right one, since fixing the clique sync has its own blast radius across every family in the account. The bad row was deleted and the Dunn family re-checked afterwards. Worth knowing: the sync can silently re-add it the next time anything in that family is edited.

---

_End of document. Update this file as the project progresses — it's meant to be the single source of truth for anyone (human or AI) picking this project up._

---

## Subgroup membership rolls upward, and the thinking budget that ate the reply (2026-08-10)

**The ask.** "Members of a subevent should automatically be included as members of the parent event. Same logic with groups." Events already did this — sub-event attendees have rolled up into the parent's "Who was there" since 2026-08-07 — so the real work was groups, plus the AI chat, which knew about neither.

**The design call, and why it isn't the 2026-07-26 mistake.** PROJECT_CONTEXT had a standing "subgroup membership is deliberately independent of the parent's — no sync trigger" decision, with a sync trigger added by mistake and reverted the same day. That decision survives intact, because this roll-up is *derived at render and never written*: the `person_groups` row stays on the subgroup, so removing someone there removes them from every ancestor with nothing to keep in sync. It also only runs upward — a new subgroup still starts empty rather than inheriting its parent's roster. Writing the rows instead would have been unpickable later, exactly the trap the 2026-07-26 self-membership cleanup hit when there was no flag distinguishing real rows from bug-created ones.

**Verified without credentials first.** The demo account has no nested groups, so before asking the founder to log in, two demo groups were temporarily nested, clicked through, and reverted — enough to prove the list card, the search, and the group page. That left only the live-data read unproven, which is what the login was actually for.

**Two silent bugs, both found by not trusting the numbers.** Predicting Air Force's member count from a direct query gave 282; the page said 296. The gap was PostgREST's undocumented 1000-row response cap against 1183 `person_groups` rows — the *prediction* was wrong, not the page. That immediately implicated two real code paths: the new descendant query (paged before shipping) and, worse, `converse`'s roster read, which had been unpaged all along and had been feeding the model a roster missing ~15% of every membership in the account. Nothing had ever errored.

Then the deployed chat failed on "how many people are in the Air Force group?" — reproducibly, while "is Caroline Volin in the Air Force group?" worked. The function logs gave the answer with no guesswork: `output_tokens` 4096, `thinking_tokens` 4095, and a response whose only content block was an empty `thinking` block. This model thinks before answering and thinking spends the same budget as the reply, so a counting question against ~300 names consumed the entire allowance and emitted no text — parse failure, generic apology, full billing, nothing delivered. `max_tokens` went to 8192, and the no-text case now gets its own message telling the user to narrow the question rather than "try again", which would only burn another full budget identically.

**The lesson worth keeping: a wrong prediction is evidence, not noise.** Both bugs surfaced because a number disagreed with another number and the disagreement got chased instead of explained away. The 1000-row cap in particular fails in the most dangerous possible way — a successful-looking response that is quietly incomplete — and it is still worth auditing the other Edge Functions for unpaged reads on tables that can cross it.

**A footnote that was NOT a bug.** Mid-verification the Groups list showed "Travis Phoenix Spark" indented under 22 AS when it belongs to Air Force. Running `flattenGroupTree` against real data showed correct depths for all 68 groups: it was stale in-memory state from a drag accidentally triggered while the browser viewport was desynced from the pane. Worth knowing the drag-to-reparent is easy to fire by accident. Separately, the chat answers 295 where the app says 296 — that one is real duplicate data, two distinct person records both named "Benn Hawkins", and the model reasonably assumed one person from a name-only roster.

---

## Sweeping the 1000-row cap across every Edge Function (2026-08-10, same day)

**Why.** Fixing `converse`'s unpaged `person_groups` read the same morning proved the failure mode existed; the founder asked whether it existed anywhere else. It did.

**Method, in the order that mattered.** First get real row counts per table, so the audit chases only reads that can actually cross 1000 — three tables already do (`contact_import_candidates` 2008, `notes` 1456, `person_groups` 1183) and `people` is at 700 and climbing. Then classify every `.from()` site: writes are unaffected, `.eq()`-on-one-id and `.limit(n)` reads are bounded, and only flat account-wide reads are exposed.

**The check that prevented a false report.** `moments.select("notes(...)")` returned 796 of 1456 notes, which looked like embedded selects were capped too — and would have meant `converse`'s entire moment context was missing 45% of its notes. It wasn't: exactly 796 notes have a non-null `moment_id`, the other 660 are person-only notes correctly absent from any event. **Embedded selects are not capped.** Worth knowing permanently, and worth the two minutes it took to check rather than reporting a dramatic bug that didn't exist.

**Two live bugs, one of which manufactured work rather than degrading a result.** `scan-calendar-sources` read `person_groups` across every group the user owns — the whole table — so calendar-import group inference had been running on ~85% of the memberships. Worse, `import-contacts` read `contact_import_candidates.row_key` as its re-upload dedupe set against a 2008-row table: the other ~1008 already-triaged contacts looked brand new, so re-importing the same vCard would have silently doubled the founder's review queue with contacts they had already worked through. Truncation there doesn't quietly weaken an answer, it creates hours of duplicate manual work.

**Also fixed while in there.** `update-moment` and `update-group` read the full `people` roster with no `.order()` at all — unstable row order feeding a cached prompt, which is a cache miss on turns where nothing changed (CLAUDE.md rule 3). Paging forced an explicit sort, so that got fixed for free.

**Verified.** Both bug fixes proven against real data through the actual shared helper, not a reimplementation: dedupe keys 1000 → 2008, calendar memberships 1000 → 1183 with all 1183 distinct (the distinct count is the part that proves the `.order()` isn't duplicating or skipping across page boundaries). All six functions type-check at their pre-existing error counts and deploy clean; `converse` and `person-facts` were exercised live. `import-contacts` and `scan-calendar-sources` were NOT run end-to-end — both write real candidates into the founder's review queue, and the paging mechanism they share is the same one proven above.

**The generalisable lesson.** This class of bug is invisible by construction: the query succeeds, the array is just short. Nothing will ever alert on it. The only defences are knowing the cap exists, knowing which tables are near it, and paging by default on any read that isn't narrowed to a handful of ids.

## 2026-08-10 — The same 1000-row cap, one layer up: the card that kept asking questions it had already been answered

Hours after the Edge-Function sweep above shipped, the founder reported that Home's "Connections to make" card wasn't saving: *"I have clicked yes to the same question multiple times but it isn't saving the answer."*

The write was never the problem. Every accept path in that card had already been hardened — twice. The 2026-08-03 fix made them return their errors instead of swallowing them; the 2026-08-08 additions read the row back after writing, because the shared helpers return `void`. Clicking Yes genuinely wrote the membership, every time. It just didn't matter.

**The read was truncated.** `loadConnectionSuggestions` builds `membersByGroup` from an unpaged `person_groups` select. That table was at 1183 rows. PostgREST handed back 1000. The remaining 183 memberships simply did not exist as far as the card was concerned, and the card's one membership check — `if (membersByGroup[groupId]?.has(person.id)) return` — therefore read them as "not a member yet". Click Yes, the row is written (or re-written, harmlessly, by an `ignoreDuplicates` upsert), the card drops the row from local state, and on the next Home visit the suggestion is regenerated from the same truncated read. Forever.

Measured on the real account before the fix: **29 suggestions, 21 of which named someone already in the group.** Better than seven out of ten questions on that card were unanswerable. The founder had been clicking Yes on questions that could not be made to go away.

**What made this one instructive is that the sweep had already run.** The commit immediately before this one audited every account-wide read in the app and fixed the class — in `supabase/functions/`. It even recorded `person_groups 1183` as an over-cap table. But the audit's unit was "Edge Function", and the browser talks to the same PostgREST with the same anon key under the same cap. `src/lib/` was never looked at. The scoping of a sweep is itself a decision, and "every Edge Function" quietly encoded an assumption that server code is where data access lives — in an app whose suggestion engine, family tree, and every list page query Supabase directly from the browser.

`src/lib/pagedSelect.ts` is the browser twin of the Deno helper, same contract, same mandatory `.order()`. Applied to the whole suggestion path: `suggestConnections.ts`, `suggestEventGroups.ts`, `dismissedSuggestions.ts`, `familyTree.ts`, and `relationshipsTable.ts`'s whole-table branch.

**Two more that hadn't bitten yet but were the same shape.** `dismissed_suggestions` only ever grows — one row per "No" ever clicked — so a dismissal falling past the cap would eventually bring back a question the founder had explicitly killed. And `loadFamilyGraph` reads the whole `people` table, at 700 of 1000; a person truncated out of that graph takes their entire branch of the family with them, silently, since a missing person can't produce a missing-person error.

**Verified.** Against the real account, through the app's own modules in the dev-server browser client — and, decisively, by stashing the fix to measure the old code on the same live data: 29 suggestions / 21 ghosts before, 9 suggestions / 0 ghosts after. `person_groups` paged returns 1183 rows, all 1183 distinct, which is what proves the ordering isn't duplicating or skipping across page boundaries. Build clean, 299 tests pass. **Not tested: clicking Yes end-to-end in the UI** — the read is what was broken, the write paths were already proven on 2026-08-08, and every remaining suggestion asserts a real fact about a real person that only the founder can confirm.

**The generalisable lesson**, sharper than the last one: when a bug class is found, the sweep must be scoped by *where the data is read*, not by which folder the last one lived in. The previous entry's closing line — "page by default on any read that isn't narrowed to a handful of ids" — was already correct. It just wasn't applied to half the codebase.

---

## 2026-08-10 — "It's asking me if every single Alex is a match for Alex Lesar"

The founder was working through the contacts review queue and hit the same question over and over: *is this Alex the same person as Alex Lesar?* Alex Smith. Alex Rodriguez. Alexandra Chen. Their instinct was exactly right — "if last names aren't matching, it is very unlikely it's the same person."

**The bug was one line of arithmetic.** `_shared/nameMatch.ts` scored two names by counting shared words and dividing by the size of the *shorter* name:

```
intersection / Math.min(wordsA.size, wordsB.size)
```

"Alex Lesar" against "Alex Smith" shares one word out of two → 0.5, which cleared the 0.5 match threshold exactly. Worse, against a person recorded as just "Alex" with no surname, the divisor is 1 → a score of 1.0, comfortably over the 0.8 bar for **high** confidence. The metric was structurally incapable of noticing that surnames disagreed; a shorter name on file made a match *more* certain rather than less. The other half of the bug sat in `import-contacts` itself, where the exact-match index claimed a person's bare first name as a lookup key alongside their full name.

Measured against the founder's real account before changing anything: **574 of 576 stored matches were wrong.** Not a tuning problem.

**The replacement rule.** Split each name into a given name (first token) and surname(s) (everything after, minus honorifics, suffixes, and single-letter initials — a middle initial is not a surname, and keeping them would have made "Alex J Smith" and "Alex J Lesar" agree on "J"). Then:

- both sides have a surname and they differ → **not the same person**, full stop
- same given name + same surname → **strong**
- same given name, one side has no surname on file → **weak** (ask, don't assert)
- an initial against a matching surname, or a one-character typo in a surname of 5+ characters → **weak**

Aliases (nicknames, middle name, goes-by) feed the given-name set but never the surname set, so a recorded nickname can't quietly overrule a surname that disagrees: "Bobby Lesar" matches Robert Lesar, "Bobby Smith" does not.

Two further things fell out of testing against real data. A shared email or phone no longer rescues a given-name mismatch on its own — households share a landline, and "Jane Doe" must not match "John Smith" because a number appears on both; it now takes a shared surname too. And phone numbers compare on their last ten digits, so a vCard's `+1 (555) 123-4567` and a hand-typed `555-123-4567` are the same number.

**The typo tolerance earned its place empirically.** The first pass dropped all 574 bad matches but also killed `Sean Baerman → Sean Baermann`, which is obviously the same person. Adding a one-edit allowance on long surnames (never short ones — "Lee"/"Lea" and "Kim"/"Kip" are different families) recovered five real matches: Baerman/Baermann, Galagher/Gallagher, McChord/McCord, Polanasky/Polanosky, Tulman/Tullman. Those come back as *weak*, so the card asks rather than assumes.

**Fixing the matcher wasn't enough.** The Edge Function only runs at import time, so the founder's 576 bad rows would have sat there until a re-import. `ContactImportReview.tsx` now re-checks every stored match on read using a mirror of the same rule (`src/lib/nameMatchStrength.ts` — Deno can't import from `src/`, so it's a verbatim copy pinned by a parity test, the same arrangement as `kinship.ts`). The first version corrected only the 20 cards on the current page, which left the counts and the "Already in Boomer" filter still claiming hundreds of matches the cards themselves denied — and would have made the founder visit 29 pages to clean it up. It now sweeps the whole `selected` set once per visit, chunked at 100 ids per write because 570 UUIDs in one URL filter is a 21KB request.

**Verified live on the founder's real account:** 576 stored matches → 7, in one page load. All seven are real (five typos, plus "Ben B → Ben Eagleton" and "Manny G → Manny Adelstein", where the contact has an initial for a surname). Every remaining one shows as a question with the picker open, not a pre-confirmed merge. 19 new tests in `_shared/nameMatch.test.ts`, build clean, 319 tests pass.

**The lesson worth keeping:** a similarity score that can't represent *disagreement* isn't a weak heuristic, it's a broken one. Word overlap only ever counts evidence *for* a match — there was no arrangement of inputs where a conflicting surname could push the score down, because a conflicting word simply isn't in the intersection. Any future "is this the same thing?" check should be asked as "what would rule this out?" first, and only then "what supports it?"

## 2026-08-11 — The full check-up: two silent wrong answers, a linter that had been switched off, and 7,190 unchecked lines

Founder asked for "a full scale linting and debugging to ID any issues, in addition to flagged issues that remain outstanding." The baseline was better than expected — `tsc` clean, 356 tests green, and a `--strict` run producing *zero* errors — which made the actual findings sharper, because none of them were the kind a passing build catches.

**The linter had been reporting "clean" without a config.** `_oxlintrc.json`; oxlint reads `.oxlintrc.json`. Nobody had noticed because the tool ran, exited 0, and said nothing. `react/rules-of-hooks` had been set to `"error"` and had never once been enforced. Renaming it surfaced 30 warnings. All 17 `exhaustive-deps` ones turned out to be deliberate, each with a comment sitting right there explaining the omission — so the fix wasn't to churn 17 files, it was to turn that rule off *explicitly* so the two rules that matter aren't buried. The generalisable bit: **a checker that has never failed should be assumed broken until you've watched it fail.**

**"Due for an update" was nudging the founder about people they'd just written about.** The page reads every note to find each person's last mention, unpaged. `notes` crossed 1000 rows a while back (1502 that day). The missing ~500 were the *newest* ones, so anyone whose only recent note fell in the gap came out as "No updates yet" — which the sort deliberately floats to the top. The bug inverted the feature.

**A merge could delete the data it had failed to move.** Item 91 had covered writes behind a "✓ Added" message. The nastier half was the multi-step flows: a merge moves everything off the duplicate, then deletes it, and that delete cascades. Every step in between was unchecked. A notes re-point that silently failed still reached the delete. Three merges, one undo, and the onboarding reset all had the shape. There's no transaction from the browser client, so the fix is structural rather than atomic — check every step, and never reach the destructive one after a failure. A half-merged pair can be merged again; a cascade can't be un-run.

**The AI had been reading a different group name than the app.** This one was only found because a parity test was being written for something else. `groupDisplayName.ts` learned on 2026-08-03 to qualify a subgroup through its whole ancestor chain — "Squadron / Alpha Flight / Pilots" — precisely because one level stops being unique once nesting goes deeper than two. Its server twin, `groupNames.ts`, never got that change and kept qualifying one level. Two "Pilots" under two different "Alpha Flight"s therefore collapsed to the same key server-side, and `idByQualified` kept whichever was indexed last. That is *exactly* the wrong-subgroup tagging bug `groupNames.ts` was written in the first place to close, reopened from the other side, three months later, with nothing erroring. The parity test failed 4 of its 7 cases on the first run.

The twin-drift lesson has now cost twice. Both copies exist only because Deno can't import from `src/`. The rule going into §12: **a `src/lib` ↔ `_shared` pair without a parity test is a silent wrong answer waiting to happen** — not a style problem.

**7,190 lines had never been typechecked by anything.** `tsconfig.app.json` includes `src` only, and the Edge Functions run on Deno. Wiring up `deno check` produced 16 errors on its first ever run — and, encouragingly, not one was a runtime bug: 8 were the documented PostgREST "nested-join types lie about cardinality" gotcha, 3 were vitest parity tests that aren't Deno modules at all, 2 were narrowing lost inside nested closures where the real null guard sits at `converse:56`. Worth recording that the code was *right*; it just had nothing watching it.

**Two sessions in one repo.** Halfway through, `git status` went from clean to holding another Claude session's work — the gender-fill page, and item 91, in four of the files this plan targeted. Rather than guess, the founder was asked and chose "work around it": commit by explicit path, never `-A` while someone else's work is in the tree, and drop any stage the other session was already covering (item 91 Tier 1 went to them). The one file both sessions edited, `GroupDetail.tsx`, ended up carrying both changes into their commit, which was fine — but the near-miss is the point. **Re-check `git status` mid-session, not just at the start.**

CI now runs lint → Edge Function typecheck → build → tests on every push, deliberately **reporting rather than blocking**: Vercel deploys off git independently of Actions, and with no staging step and nobody on hand to override a false alarm, a red X that could strand a real fix would be worse than no check at all.

### Postscript: switching off the auth gate on five functions, for a few minutes, by accident

Deploying item 94's fix, the command went out as `npx supabase functions deploy <fn> --no-verify-jwt`. There was no reason for that flag. It disables the **platform's** JWT gate — the thing that rejects an unauthenticated request before it ever reaches your code.

Two things made it worse than a typo:

1. **A plain redeploy doesn't undo it.** The setting persists server-side per function. Deploying again with the flag omitted left it off, which is genuinely surprising and cost a round of confusion.
2. **The documented health check hid it.** §2's token-free check ("does it answer, or is it Supabase's NOT_FOUND?") passed the whole time — because the functions *did* answer. They answered with their own `not_authenticated` 401 instead of the platform's `UNAUTHORIZED_NO_AUTH_HEADER`. A check that only asks "did something reply" can't tell those apart.

Caught by noticing that `summarize-group` — untouched all session — replied `UNAUTHORIZED_NO_AUTH_HEADER` while all five freshly-deployed ones replied with app-level JSON. Fixed with `PATCH /v1/projects/{ref}/functions/{slug}` `{"verify_jwt": true}`, then verified two ways: every one of the five now answers `UNAUTHORIZED_NO_AUTH_HEADER`, and `GET /v1/projects/{ref}/functions` reports `verify_jwt: true` across all fifteen.

**Actual exposure: none.** All five call `auth.getUser()` and 401 on their own — defence in depth doing its job. The only one that returned a body, `suggest-prompts`, returns hardcoded `FALLBACK_SUGGESTIONS` when there's no user, before any Anthropic call, so neither user data nor API spend was reachable.

Three things worth keeping. **Never pass a flag you didn't need** — this one was pure noise in the command and it changed a security setting. **Distinguish the two 401s**: the platform gate and an app-level auth check look identical to a smoke test that only greps for "not 404". And **`GET /v1/projects/{ref}/functions` audits `verify_jwt` across the whole project in one read** — worth running after any deploy session, not just a suspicious one.

## 2026-08-12 — "Calendars are not syncing": a dead API key, and the loop that had been paying to re-read the same haircuts

The founder reported that clicking "Sync now" on Calendar settings did nothing. Two separate causes,
one hiding the other.

**What the data said first.** `calendar_sources` showed "Jake and Ceeb calendar" synced minutes ago
but "Jake Personal" frozen at Aug 4 — nine days stale. Neither had a `last_sync_error`. So the sync
was running, reaching at least one source, and reporting success while one calendar quietly never
advanced. Both calendars had stopped producing new `moment_import_candidates` rows entirely: newest
Jul 27 and Aug 4 respectively.

**The second bug, found before the first.** Running the repo's own `parseIcs` over both real feeds
with the function's own filters (cancelled / 3-year cutoff / already-seen) reproduced the arithmetic
exactly: 140 unseen events on one calendar, 182 on the other, **322 per run against a hard cap of 8
batches × 30 = 240**. The first source spent 5 of the 8 batches, leaving 3 for a source that needed
7 — so `fullyProcessed` was false for "Jake Personal" every single run, and its `last_synced_at` was
never stamped. Forever.

Why 322 events stayed permanently "unseen" is the actual defect: `scan-calendar-sources` only ever
wrote a row when the AI said an event WAS worth suggesting. When the AI said skip — and the re-sent
list was exactly what you'd expect it to skip, `AMD` ×58, `Doc Appt`, `Haircut`, `Lawn Aeration`,
`Dog Grooming`, `Let maple out!!!` — that decision was discarded. The event stayed out of
`seenUids`, came back next run, and got paid for again. Every manual click and every nightly cron.

**The first bug, found by not trusting the fix.** After deploying, the verification sync finished in
**four seconds** and wrote zero rows. Far too fast for seven Claude calls. The function logs — pulled
immediately, since retention is minutes — said it plainly, eight times:
`Anthropic extraction call failed 401 {"type":"authentication_error","message":"API key is invalid."}`.
The project's `ANTHROPIC_API_KEY` had hit its scheduled expiry date that same day (already logged in
§10 from an earlier session, cause confirmed by Anthropic's own expiry email). A Home chat message
seconds later returned the same 401, confirming the blast radius is all ten Anthropic-calling
functions, not just this one.

So the honest ordering: **the founder's symptom is the expired key.** The starvation bug is real,
independently reproduced, and would still have hidden one calendar's progress once the key came
back — but it is not what they were looking at today.

**The fix that shipped anyway.** Three parts, all in `scan-calendar-sources` v25:
1. A `'skipped'` status (migration `2026-08-12-calendar-skipped-status.sql`, applied) recording the
   AI's "no" so it is asked exactly once. Deliberately a distinct value from `'rejected'`, which is
   the founder's own decision and shouldn't be conflated with a machine filter — same name and idea
   `contact_import_candidates` already uses.
2. Sources ordered **least-recently-synced first** (`nullsFirst`). The batch budget is per-invocation
   and shared, so an unordered list let whichever source came back first spend it every run.
3. The skip rows written in **their own upsert**, after the real candidates. Code always ships before
   the founder runs the SQL, and sharing one statement would have let a missing constraint value
   reject the genuine suggestions too. Failing there just restores the old behaviour for one run.

**What is and isn't verified.** The ordering half is confirmed live: "Jake Personal" went first and
its timestamp moved Aug 4 → Aug 12 in the UI. The skip-recording half **could not be exercised** —
with the key dead the API returns nothing to record, so zero skip rows exist. Its row shape was
proved separately (insert with only the four no-default columns + rollback, leaving no trace). This
is written down rather than glossed because "deployed" and "working" are not the same claim.

**Two lessons worth keeping.** A guard that decides whether work is finished (`fullyProcessed`) must
not be computed from how much work was *attempted* when the work itself can fail silently — eight
failed batches and eight successful ones were indistinguishable to it. And a four-second success is
a result worth disbelieving: the fix looked like it worked, and the timestamp really did move, but
only because every expensive call inside it had failed too fast to matter.

## 2026-08-12, same evening — the founder deletes the filter, and a tombstone turns into 202 blank cards

Follow-up to the entry above, which should be read first. Two things happened after the API key was
replaced: the fix in that entry was verified, and then most of it was thrown away — correctly.

**The verification, and the number that ended the design.** With a working key, one "Sync now"
recorded **202 auto-skipped events against 28 let through**. The filter was rejecting 88% of what it
saw. Shown that ratio, the founder's call was immediate and right: *"It's probably too sensitive if
its not letting everything through. I think it should just simply sync all new events, and let the
person decide themselves whether or not they want to accept/reject it."*

**Why that is a better fix than the one it replaced.** The re-judging bug existed only because a
"no" produced no row. Remove the "no" and every event gets a row on the run it is first seen — so it
enters `seenUids` and can never be re-sent. The whole `'skipped'` mechanism became unnecessary the
moment the filter did. The AI call stays, but now only to extract the title, location, notes, tags,
groups and people; it no longer returns an `include` verdict, and the "skip generic solo logistics"
framing came out of both the system prompt and the tag guidance.

**The mistake, made and caught within four minutes.** Releasing the 202 already-buried events looked
like a one-line `update ... set status='pending'`. It ran, and it was wrong. A skip row was never a
suppressed candidate — it was a **tombstone**, carrying `user_id`, `calendar_source_id`, `ical_uid`
and nothing else, because recording the "no" was all it had ever needed to do. Flipping it to
'pending' therefore produced 202 review cards with a date and nothing else: no title, no location,
no notes, no tags. And permanently, because the row's own uid is exactly what keeps that event out
of `seenUids` — the scan would never have looked at it again.

What surfaced it was not the update; it was distrusting the next result. A count of new rows came
back `298 total, 96 with a title`, and the missing 202 matched the tombstone count exactly. The
function's own log line — `Repaired 114 stale candidate date(s)` — confirmed the shape: the
date-repair pass had dutifully filled in dates on rows that had nothing else to fill.

The fix is `delete`, not `update`. Deleting a tombstone makes the event unseen again, so the next
sync rediscovers it and writes a real extraction. Re-verified after: **661 candidates across both
calendars, zero with a null title**, and ordinary entries the old filter would have eaten now sitting
in the queue for the founder to judge — "A scheduled visit to the orthodontist.", "Flight to
Denver", "Dinner reservation at Bonefish Grill".

**Lessons.** A row that exists only to be *remembered* is not the same object as a row that exists
to be *shown*, even when they share a table and a status column — converting one into the other is a
data migration, not a status change. And the general form of the previous entry's lesson held again:
the tell was a count that was 202 short, noticed only because the number was checked at all.

## 2026-08-17 — The review queue got slow because it drew all 376 cards, not because it fetched them

Founder report: "boomer app is going really slow", narrowed to one screen — Review calendar events.
Timing was the useful part of the diagnosis, because the intuitive culprit was wrong.

The instinct on a slow page in this app is to suspect the reads: it's the codebase's own recurring
bug (three 1000-row-cap entries above this one), and `load()` here does nine queries including a
whole-account `relationships` map and every moment on file. The reads were not the problem. Rendering
was. `candidates.map(...)` mounted a `CandidateCard` for **every** pending candidate, and a card is
not a row — it holds ~25 pieces of state and, on mount, runs `findLikelyMatch` across every existing
moment, rebuilds `groupNameById`/`groupParentById` from the whole group list, walks every group's
membership for attendee suggestions, and runs `suggestFamilyMembers` over the entire relationships
map. Per card. The page's cost was therefore candidates × account size, and the 2026-08-12 "sync
every calendar event" directive is what pushed the first term from a handful to 376.

Measured on the founder's real account (376 pending, 178 moments, 768 people, 68 groups), local dev
server, desktop: **7,506ms to render all 376 cards; 942ms to render 20.** Fix is `CARD_BATCH_SIZE`
= 20 with a "Show 20 more" button, and a count line so the true size of the queue is still visible.
The queue is still fetched whole — paging the *fetch* would have fixed nothing and cost a round trip
per batch.

**The bug found on the way in.** The candidates query was the one account-wide browser read the
2026-08-11 sweep missed, so it was still unpaged and silently capped at 1000. At 376 pending it had
not bitten yet, but the queue only grows between reviews: at 1001 the reviewer would have cleared it
to "Nothing left to review" with events still waiting, and nothing anywhere would have said so. Now
paged, with `.order('id')` as the stable tiebreaker.

**Lesson.** "The page is slow" pointed at the network and it was the DOM. The two are told apart by
one measurement, and the measurement was cheap — a MutationObserver around the click, thirty seconds
of work, versus a day of optimizing queries that were already fast enough. Also: a sweep is only as
good as its inventory. The 2026-08-11 pass swept browser reads and still left one, because the file
it lived in was not on the list anyone was reading from.

## 2026-08-17 — "Give me the FACTS": the roll-call was in the input, not the instructions

The founder's ask was about tone: *"I think I like the bullet format more than narrative. I don't need it to tell me a story. I want it to give me the FACTS about the story, and if I want to review what my original phrasology was, I can just review the notes."* Plus a second, sharper note — don't list who was there, because the page already has a "Who was there" section right below the summary.

Before changing anything, four of their own events were pulled at random and laid out side by side, current summary against a hand-written bullet version, as a published comparison page. One of the four made the whole argument by itself. **Sam and Joelle's Wedding had 26 notes. Three of them said anything. The other 23 said nothing but `Was there.`** — the placeholder row the app writes whenever you tag an attendee. Four fifths of that event's summary was the model dutifully reading those 23 names back, to a reader already looking at the same 23 names as chips immediately underneath.

That reframed the fix. The roll-call was not the model being chatty; it was **being fed in**. `notesText` included every placeholder row, each prefixed with a full name. So the change is two things, not one: a prompt that asks for bullets, and a filter that stops sending 507 of the account's 764 notes at all (66% of them). Dropping them also cut ~11% of the input tokens on every future call — a free win that arrived attached to a correctness fix.

### What the cost measurement was for, and where it was wrong

The founder asked what it would cost to redo all 107 existing summaries. Rather than estimate, the exact prompt was reconstructed client-side for all 107 from the same fields the Edge Function reads, and its characters counted: 129,443 in, 47,972 of stored summaries out. Characters were converted to tokens using the system prompt itself as the yardstick (4,122 chars = 1,268 tokens, already measured against this model — 3.25 chars/token). Predicted: **25¢**, and the Sonnet 5 introductory pricing ends 2026-08-31, after which the same sweep is ~37¢.

Actual, metered: **~46¢.** The input half of the estimate was almost exact (a single call measured 452 input tokens where the ratio predicted ~450). The output half was wrong, in two ways worth remembering:

1. **Bullets run longer than the prose they replaced** — using the existing stored summaries as a proxy for future output assumed the format change was length-neutral. It wasn't; total output came in at 25,739 tokens against ~14,760 predicted.
2. **Sonnet 5 bills adaptive thinking, and it's on by default** — unlike Sonnet 4.6. The first metered call showed `thinking_tokens: 87` inside a 313-token output. Nothing in the code asks for thinking; the model's default changed underneath it.

The estimate was still the right call — it answered the only question that mattered ("is this a cost decision or a rounding error?") correctly, and being off by 20¢ on 46¢ changed nothing. But "use the existing cached output as a proxy for the new output" is only sound when the format isn't what's changing.

### Three iterations, and what actually fixed it

The first deployed prompt failed on the very first real event in three distinct ways, none of which the prose rules had prevented:

- **It moved an action onto the account owner.** Caroline's note said *she* drove from Colorado Springs; the summary said *"I drove to the Berzins house."* The "rewrite in first person" rule and the new "don't name people unnecessarily" rule combined into a fabrication.
- **It duplicated a shared evening once per attendee.** Three people each had a near-identical note about the same drive, dinner and seats, and it emitted the dinner twice.
- **It restated the header.** *"The concert fell on Caroline's birthday, May 23"* — printed verbatim in the meta line directly above.

Round two added explicit rules for all three. It half-worked: the "I drove" fabrication became a correct "we", but the date bullet survived, the duplication survived, and a new failure appeared — every bullet on the Eliana Joy call became *"She told me…" / "She said…" / "She mentioned…" / "She explained…"*, narrating who reported each fact instead of stating it.

Round three replaced argument with evidence: **concrete wrong/right example pairs drawn from the actual failures**, embedded in the prompt.

```
Wrong, because the date is already printed directly above the summary:
  `- The concert fell on Caroline's birthday, May 23.`
Wrong, because it narrates who reported the fact instead of stating it:
  `- She told me she starts a Quaker service year in Boston on August 30.`
Right:
  `- She starts a Quaker service year in Boston on August 30.`
```

That landed all three at once. The lesson is the boring one and it keeps being true: on a current model, **a demonstrated wrong/right pair outperforms another paragraph of rules**. Three rounds of increasingly emphatic prose moved one failure; one round of examples moved all of them.

One over-correction had to be walked back separately — "never move an action onto the account owner" was strong enough that the owner's *own* note came back as *"Jake believes this was the night…"* instead of *"I believe…"*. Stating the converse explicitly fixed it.

### The regression the sweep exposed

With the prompt good, all 111 summaries were regenerated — children before parents, so each multi-day event read freshly-rewritten sub-summaries. Zero failures, `cache_creation: 0` throughout after the first call, confirming the cached prefix held across the whole run.

Then the check that mattered: **seven events came back reading only "Nothing else about the day itself was recorded."** Every one of them had zero real notes — all placeholders, no description — so after the new filter there was genuinely nothing left to summarize, and the thin-event rule became the entire summary.

`hasSomethingToSummarize()` in `src/lib/moments.ts` already knows about exactly this case, and `EventDetail` gates on it before ever calling. But the sweep invoked the function directly, and so does `converse`'s background kickoff — both bypass that gate. The Edge Function had no such check of its own. It does now: no description, no real note, no sub-event with content means clear the cached summary and return `skipped: "nothing_to_summarize"` before spending a call, so the page falls back to its real "Nothing written yet — add a description" empty state.

Six of the seven cleared cleanly on re-run. The seventh had a real description and produced a proper bullet.

**Final state:** 105 events with summaries — 98 bullets, 7 in the multi-day sub-event format (deliberately unchanged; the founder approved that shape on 2026-08-10), 0 in the old prose. Verified in the browser against the real account: bullets render as a genuine list with a hanging indent, no raw `- ` reaches the page, and "Who was there" still sits below them carrying the names the summary no longer repeats.

## 2026-08-18 — Making the mic feel like the phone's: streaming, and three ways a name gets lost

The founder's complaint was comparative, not a bug report: *"iphone, claude, all other 'voice to text' services are way more intuitive."* Reading the old component made the gap concrete. You pressed the mic, talked into a void, pressed stop, and then waited while the whole recording was base64'd, uploaded, and handed to `whisper-1` — which cannot stream. Nothing appeared until everything appeared. Meanwhile the Save button next to it was held shut (`onBusyChange`) because saving mid-transcription would drop the audio entirely, the "Listening…" bubble pulsed a dot on a timer that ticked identically whether you were talking or the mic was muted, and any failure threw the entire recording away behind a four-second toast.

Two facts checked against OpenAI's live docs reframed the work. `whisper-1` is now the legacy model: `gpt-transcribe` is **cheaper** ($0.0045/min vs $0.006), roughly halves the error rate, and supports `stream: true`. And it accepts `keywords`, which in an app that is entirely about specific people is the direct fix for a complaint already sitting in the backlog — that the app doesn't spell names right. So the change lowered the bill and improved the product at the same time, which is rare enough to note.

A correction also came out of it. `PROJECT_CONTEXT.md` had justified Whisper-over-Web-Speech since 2026-07-16 on the grounds that the Web Speech API *"does not work at all in iPhone Safari."* That has been untrue since iOS 14.5 in 2021. It works there; it is just unreliable there (WebKit fires `onresult` once and then goes quiet with the mic indicator still lit). The conclusion — that a server transcriber should own the authoritative text — was always right. The stated reason was wrong, and had been cited in two other decisions.

### The shape of the fix

The component stopped handing back one finished string and started owning a slice of the text box. It snapshots the box's contents when recording starts, and rewrites everything after that anchor as words arrive. That one change collapses three separate complaints: text appears progressively, a failure is no longer destructive because whatever arrived is already sitting in the box, and nothing needs to be frozen — saving early now saves what you actually said. All nine mic mounts moved from `onTranscribed` to `value`/`onChange`, deleting the identical append-with-a-space that each of them had been repeating.

Worth recording that `Home.tsx` and `PersonDetail.tsx` — the two most-used surfaces — had never passed `onBusyChange` at all, so the drop-the-audio bug the prop existed to prevent was live in production the whole time. Removing the need for the prop fixed a bug nobody had reported, which is the argument for fixing the class rather than the instances.

### Three ways a name gets lost, found only by testing against the real API

The assistant's browser pane blocks microphone hardware, so the round trip had never been exercised in-app by anyone (§10 had said so since 2026-08-02). The way around it was to stop needing a microphone: Windows' built-in speech synthesizer (`System.Speech.Synthesis`) generates a WAV of known words, including real names off the founder's roster, which can be posted to the deployed function as many times as you like. Everything below was caught that way and would not have been caught by reading the code.

**One.** The first end-to-end run returned `no_speech` on a perfect recording. OpenAI separates SSE frames with `\r\n\r\n`, and that byte sequence contains no `\n\n`; the parser split on `\n\n`, matched nothing, accumulated the entire transcript in a buffer and reported that it had heard nothing. A flawless transcript sat one layer below a "I didn't catch any words in that" message.

**Two.** With that fixed, "Jesse Waldron" came back as "Jessie Waldron" — despite Jesse being in the roster. The keyword list was capped at 300 entries *after* being sorted alphabetically, so on an 825-person account (1002 distinct name words) everything past "Duke" was silently discarded. Jesse sits at index 476. Nothing errored; the output was simply wrong in the exact way the feature existed to prevent. The cap is now 800 and the list is tiered — given names first, then nicknames, then surnames — because if a roster must be truncated, dropping "Waldron" costs far less than dropping "Jesse". People say first names out loud.

**Three.** Raising the cap to cover the whole roster broke everything: 1002 repeated `keywords[]` fields returns `400 "Could not parse multipart form"`, which names neither the parameter nor the real problem. The self-healing fallback that was supposed to catch this didn't, because it only retried on a 400 whose body mentioned "keyword" — so name steering took the entire voice feature down with it. The retry now fires on any 4xx, since the request is identical apart from how the roster is attached. Probing found the field limit sits between 900 and 1002, and that a single newline-separated `keywords` field is rejected outright despite the docs' advice to keep each keyword on its own line.

**Measured, on the founder's real account:** a 71-second note streams 171 fragments and is fully transcribed 5.3 seconds after you stop, first words at ~4s. A 9-second note takes 1.8s. All three roster names spell correctly.

### What is still not proven

The microphone itself. `getUserMedia`, `MediaRecorder`, and the new AnalyserNode level meter have never run on real hardware — everything above was verified by feeding the deployed function a file. iOS is where it is most likely to differ: mp4 rather than webm recording, AudioContext resume rules, and no live captions by design. That hop still needs the founder and a real phone.

**Lessons.** A wire format is not a detail you can infer — `\r\n` versus `\n` was the difference between working and silently reporting nothing. A cap applied after a sort is a filter, and an alphabetical filter over people's names is indistinguishable from random. And a fallback that only triggers on the error you predicted is not a fallback; the real rejection said "Could not parse multipart form" and never mentioned the parameter that caused it.

## 2026-08-19 — Making a 230-event import something a person can actually get through

Founder ask, in full: *"Think of some ways to make processing the mass imports more simple and
digestible for the long term user."* An open brief, so the first job was to find out what the
actual friction is rather than guess at it.

**What the code said.** Four things, all measurable, none of them a bug:

1. `ImportReview.tsx` rendered 20 cards and a button reading *"Show 20 more (210 still to review)"*.
   No session, no progress, and no point at which stopping felt like completing anything.
2. One `CandidateCard` is a title input, an address autocomplete, two date pickers, a notes
   textarea, attendee chips, a person picker, two suggestion boxes, tag chips, group chips and four
   merge dispositions — ~695px, per the measurement already sitting in `lib/resolvedCardScroll.ts`.
   Most of these decisions are "yes, that was a real thing."
3. Accept and Reject were the only two answers. Nothing between them.
4. Home stacked up to four separate "N found" nudges, one per import pipeline.

And a fifth thing, which was really the shape of the whole problem: **contacts already had the
answer.** `ContactSelection.tsx` has been running a fast one-line Keep/Skip pass in front of the
heavy cards since 2026-07-27. The queue that actually has the volume never got one.

**The constraint that shaped every option.** On 2026-08-12 the founder deleted the AI's
"is this worth suggesting" filter, having been shown it rejecting 202 of 230 events: *"it should
just simply sync all new events, and let the person decide themselves."* That ruling is right and it
is not up for renegotiation, so nothing proposed here filters, hides, ranks-by-guess or
auto-decides. Every idea on the table only changed the SIZE OF THE BITE — batching, collapsing,
deferring, and one place to see it all. The queue still contains exactly what it contained.

**What the founder picked**, from four options offered: small batches + one inbox, lighter cards,
"Not now" as a real state, and yes to a triage pass for calendar events. They explicitly did **not**
pick the fifth idea, a bulk "Accept all N straightforward ones" in the `GenderFill.tsx` idiom —
worth remembering before anyone proposes it again.

**Two decisions inside the build worth keeping.**

*A possible duplicate opens the card expanded.* The four-way "merge / add as a sub-event / save as a
note / these are different" banner is careful work, and it exists precisely because accepting there
creates the duplicate it is warning about. A collapsed Accept button next to an unanswered
duplicate question would have quietly undone that whole design. So `findLikelyMatch` running at
mount is what decides the card's initial state, and the collapse control doesn't appear until the
question has an answer.

*"Not this one" in triage writes `'rejected'`, not `'skipped'`.* Tempting, because `'skipped'` is
sitting right there in the CHECK constraint doing nothing since the filter was deleted. But
`'skipped'` means *the machine said no* — it was given its own value for exactly that reason, and
conflating it with a person's decision would undo the distinction on purpose. A founder saying "not
this one" is a rejection, and that is what gets written.

**Fail-open, because code ships before SQL runs.** The migration adds two status values and a
`deferred_until` column, and the founder runs it by hand afterwards. The gap is covered by probing
for the COLUMN rather than the status values — an unknown column errors out of PostgREST, an
unknown status value just matches nothing, so only the column is a reliable signal. While the probe
is false the app is byte-for-byte its old self: `ImportReview` reads `'pending'`, the triage page
and the "Not now" button don't render, and the inbox says a database update is pending. Running the
SQL switches it all on with no redeploy.

**A bug caught by reading the diff rather than by testing it.** The deck's progress line originally
read `remaining - deckSize` for "more after it" — which ticks down every time you decide something
inside the current batch, because `remaining` counts the batch's own undecided cards too. It has to
be `remaining - (deckSize - doneInThisBatch)`, so the number holds still while you work through the
ten in front of you. Same read caught the finish panel being replaced by a bare "Nothing left to
review" on the last batch, at exactly the moment finishing should feel like finishing.

**Verification, honestly.** `npm run lint`, `tsc -b`, `vite build` and all 618 tests green.
`npm run check:functions` could not run — the proxy blocks `deno.land` downloads — but no Edge
Function was touched. **Nothing here has been seen in a browser**: remote sessions have no Supabase
credentials and can't reach the live site, so the founder is the eyes, and §10 carries the ordered
click-through list. Saying "deployed" and saying "working" are still not the same claim.

## 2026-08-19, same day — the founder previews it, and "Keep" turns out to be a lie

Follow-up to the entry above, which should be read first. The batching/inbox/collapsed-cards work
went to a branch, the founder clicked through the Vercel preview, and came back with six notes.
Five were small. The first one changed the shape of the flow.

**"Keep" wasn't a decision, it was a deferral of one.** Triage offered `+ Keep` / `Not this one`,
where Keep only forwarded the event to a second screen — so every kept event still cost a full card,
and the fast pass was a gate in front of the slow pass rather than a replacement for it. The founder
also wanted deferral available without going through Keep first. Offered three shapes, they picked
a fourth: **Quick Add, Add More Detail, Remind Me, Reject** — *"and when they Remind, make it so
that it asks a user to pick a frequency of their choice, with a checkbox that has 'Use this
frequency as default'."*

That is a better product than any of the three on offer, because it makes the labels honest. "Add
Now" that doesn't add anything now was the flaw in the option I'd recommended, and the founder's
version simply removes it: Quick Add adds, Add More Detail opens the card, Remind Me sets it aside.

**The founder then asked the question worth writing down.** Not "build it" — *"I want Claude to
reference similar functions in other apps and see if there are any further efficiencies I haven't
thought of yet."* Four of the five most useful things in this round came out of that survey rather
than out of either of our lists.

**The scroll fix was already in the codebase, twice.** `Groups.tsx` has `loadGroups(silent)`, which
skips the `loading` flip so an in-place change doesn't remount the list — written for drag-and-drop,
where "flashing Loading… over the whole page would read as the drop bouncing." Exactly the founder's
complaint, already solved, in a file nobody thought to look at. It also has a `restoreScrollRef`
handshake with `App.tsx` for leave-and-come-back. Both were adopted rather than reinvented, and the
second one fixed a bug the click-through hadn't reached yet: "Add more details →" navigated to the
event, and coming back remounted the queue and dealt a fresh batch of ten, silently replacing the
ten you were part-way through.

**Quick Add would have been the fastest way in the app to create a duplicate.** The only reason the
review card auto-expands on a likely match is that accepting blind creates the duplicate the banner
warns about — and a one-tap add straight off the triage row skipped that check entirely. The
heuristic moved into `lib/likelyDuplicate.ts` and now runs on the triage list too; a flagged row
shows "Looks familiar — review it" *instead of* Quick Add. Free, no AI call, and it preserves the
property that made the four-way merge banner worth building in the first place.

**Accepting was fifteen round trips pretending to be one.** `applyAttendees` called
`supabase.auth.getUser()` *inside* both of its loops — one auth call per attendee — and every
attendee note, tag and group was its own sequential `await`. Nobody noticed while accepting was a
deliberate act at the bottom of a 695px card. Quick Add is meant to be tap-tap-tap down a list, so
the extraction into `lib/acceptCandidate.ts` hoisted the auth call to one and batched each table into
a single statement.

**Two bugs caught by reading the diff against the codebase's own precedent, not by running it.**

`undoQuickAdd` deleted the moment with a bare `moments.delete()`. But `EventDetail.tsx`'s
`handleDeleteEvent` deletes dependents first, awaited and error-checked — and PROJECT_HISTORY item
93 ("Merges and undo could delete data they never moved") is a postmortem about exactly that
ordering going wrong. A bare delete would have failed or orphaned notes, in the one code path whose
entire job is putting things back.

And `handleUndo` computed `restoreStatus = showTurnedDown ? 'rejected' : 'pending'`, which meant
that pressing Undo *in the turned-down list* — the only button on that screen — restored the row to
'rejected'. The button would have done nothing at all. Undo always means "back to undecided"; there
was never a case for the ternary.

**One test failed, and the test was wrong.** `findLikelyMatch` scored a fully-contained shorter
title ("Camping Trip" inside "Camping Trip Yosemite") identically to an exact match, because the
overlap ratio divides by the SHORTER title, so the first of the two won on a strict `>`. That is
shipped behaviour with a documented reason, and the fix was to pin it in a test that says so rather
than to quietly change a heuristic nobody asked about. Both candidates are plausible duplicates
either way, and all the caller needs is that *something* got flagged so Quick Add steps aside.

**Also checked and deliberately not built on:** there is no existing "frequency" vocabulary in this
app to be consistent with — `reminders` is date-based (birthdays, anniversaries), countdowns are
target dates, and `DueForUpdate.tsx` computes "updated N days ago" on the fly without storing a
cadence. So `user_settings.review_remind_days` is new vocabulary rather than a second way of saying
something the schema already said. It is stored as a plain day count so the four presets can change
without a migration behind them.

**Verification, same caveat as before.** Lint, `tsc -b`, build and 631 tests green (was 618).
`npm run check:functions` still can't run — the proxy blocks `deno.land` — and no Edge Function was
touched. **Nothing in this round has been seen in a browser either.** The founder is the eyes; §10
carries the ordered list, and both migrations now need running.

---

## 2026-08-19 — "It isn't even guessing if Ben or Braden is a male name": a list of 840 names, replaced by 16,002

The founder's complaint was flat and specific: the gender suggestion "is still way too conservative — it isn't even appropriately guessing if 'Ben' or 'Braden' is a male name, or 'Bridget' or 'Joelle' are female."

Three of those four were simply never typed in. `nameGender.ts` had been a hand-written list since 2026-08-05 — 374 male names, 466 female, 94 flagged ambiguous, all chosen by hand and weighted toward the generations this app's trees actually contain. Bridget *was* on it and did return `female`, which is worth noting only because it shows what the founder was really reporting: not four specific misses, but the feeling of an app that keeps asking. The list had `benjamin` but not `ben`, `bradley` but not `braden`, `joel` but not `joelle`. There is no version of that list where the next person doesn't think of four more.

### The measurement that settled it

The old and new implementations were run against the 315 people on the founder's real account who still had no gender on file. The old hand-written list answered **zero of them**. Not a few — zero. Every name it *could* answer had already been filled in during the 2026-08-11 bulk pass, so what was left in the queue was, by definition, exactly what it couldn't do. The founder had been looking at a list of 315 people and a feature that had nothing to say about any of them.

### Where the names come from now

US Social Security Administration national birth counts, 1880–2024 — 105,000 distinct first names with a count per name per year per sex. `ssa.gov` returns 403 to any scripted download, so `scripts/build-name-gender.mjs` reads the same numbers from a year-by-year GitHub mirror; the data itself is US government work in the public domain.

Two cutoffs turn that into a list. A name has to have been given to at least **500** American babies over the span before the data is allowed to speak for it (below that the split is one family's spelling, and the SSA suppresses anything under 5 per year anyway). And at least **90%** of them have to have been one gender. That leaves 6,049 male and 9,953 female names, with 2,083 left out as genuinely too split to call — which is how Jordan, Casey and Taylor keep getting asked about, and now for a stated reason rather than because someone typed them into a blocklist.

The founder's original ask, back in August, was to only be asked when the app is under ~75% sure. That had been implemented as "list membership, not invented probabilities," which was honest about not having data but couldn't be checked. It is now a real number, and 90% rather than 75% because the costs are asymmetric: an unanswered name costs one dropdown, and calling someone's mother "his father" is the thing the founder would actually notice.

### The one thing birth certificates get wrong

The SSA knows what a baby was registered as. It has never heard of the Alexandra who goes by Alex. On paper "Alex" is 96.7% male, "Sam" 98.8%, and "Jess" — a name almost every adult bearer of which is a Jessica — is **98.1% male**. Feed that to the model and it will confidently call someone's sister their brother, which is exactly the failure caught in live testing on 2026-08-16, when Alex Gregorian came back described as Sam's "brother-in-law."

So four names are hand-written back over the data: `alex`, `jess`, `nat`, `sam`. Not the whole old ambiguous list — the other 90 names on it are ones the counts already refuse to call, and keeping a second hand-written copy of a judgement the data makes correctly is just a thing to drift. Ten names go the other way (`micah` at 89.4%, `willie` at 75.5%, `carmen`, `stacy`…): under the cut, answered by the old list, and no reason to stop answering. That pair of overrides is what makes this strictly more helpful rather than a trade — nothing that used to be answered is now unanswered.

### Result

189 of the 315, up from 0. The 126 still unanswered are correct refusals (Alex, Chris, Jordan, Casey, Taylor, Jamie, Charlie, Riley) or records that were never first names to begin with — "Capt", "MSgt", "PICO", "Bnb Paolina". Coverage now reaches well past the Anglo-American mainstream: Giuseppe, Svetlana, Siobhan, Priya, Bjorn, Kwame, Aoife, Dmitri all resolve, and so do modern names the old list stopped short of.

The cost is one 116KB generated file, mirrored to the edge functions and shipped in its own lazily-loaded browser chunk — ~42KB gzipped, fetched only by the pages that name relationships, never in the entry bundle. Zero API tokens, zero network calls at runtime; it is a dictionary lookup, the same shape as `sportsTeams.generated.ts`.

**Lessons.** A hand-written list of a thing the world has 105,000 of is a bug with a long fuse, and "add the four names they mentioned" would have relit it. When a founder reports a feature as too conservative, measure what it actually answers on their real data before tuning it — "answers 0 of 315" is a different problem from "answers 200 of 315 and misses Ben." And real data still needs a hand-written override where the data measures the wrong thing: the SSA counts births, and the app is trying to name adults.

## 2026-08-21 — One file, two sessions: how a finished feature sat unshipped for a day

Former names shipped on 2026-08-21 in every place that resolves a name — search, contact
import, `nameMatchStrength`, five Edge Functions — except the one the founder actually asks
questions in. `converse` was written, `deno check`-clean, and left uncommitted in the working
tree overnight.

The reason had nothing to do with the code. A different session that week had edited the same
file to teach chat about pets at events (`moment_pets` in the prompt, the JSON shape, and an
apply loop), and that edit was also uncommitted. Git tracks files, not intentions: there was no
way to commit the former-name lines without carrying the pets lines along, and deploying an Edge
Function deploys whatever is in the file. Shipping one meant shipping both, and the pets half had
not been verified by the session holding the pen. So the session stopped and wrote down exactly
what `converse` would need if the work were lost — every helper call, in order — and left the
decision to the founder.

**The visible cost was a day of the exact bug the feature existed to fix.** The profile said
"Formerly Jenkins", search found her by it, contact import stopped proposing her twice — but
typing "Sarah Jenkins" into Home chat still opened a second Sarah, because chat was the one
reader that had not been told. A feature that is 6/7 deployed reads to the user as broken, since
they meet it wherever they happen to be standing.

Released the next day on the founder's call, both halves together, in one commit. The picker
merge rode along with it: pets stopped having their own 🐾 row and joined "Add who was there",
with namespaced `person:`/`pet:` ids because the picker hands back only an id.

**Lessons.** An uncommitted file is a shared resource, and the second session to touch one
inherits the first's unfinished decisions. Committing early — even behind nothing, even
imperfect — is what keeps one session's caution from becoming another's blocker. And when work
does have to be held, the thing to write down is not "this is held" but the reconstruction
recipe: the note left in §10 that day listed all seven helper calls in order, which is why
releasing it a day later cost a build, a test run, and one click-through rather than a rewrite.

---

## 2026-08-23 — The voice note that came through as 44 bytes

**Report.** "Lately in the home page while using the mobile app, while trying to save a voice
note it gives me an error." No error text, no screenshot — which is the normal shape of a bug
report from someone who cannot read a console, and the reason the next paragraph matters more
than any amount of code reading would have.

**How it was found.** Guessing was available and would have been wrong. There are five distinct
messages the mic bubble can show and a sixth that comes from `converse`, and a plausible story
for each. Instead: the Supabase Management API token in `.env` reads the Edge Function logs, and
one query over the last 24 hours of `function_edge_logs` filtered to `transcribe` printed the
whole answer in four rows —

    00:16:01  200  iPhone OS 18_7   len=195936
    00:21:18  502  iPhone OS 18_7   len=44
    00:25:43  200  iPhone OS 18_7   len=911116

`function_logs` for the same isolate carried OpenAI's actual words: `Audio file might be
corrupted or unsupported`, 400, `"param": "file"` — twice, once per keyword strategy.

**Diagnosis.** A 44-byte request body is `{"audio":"…","mimeType":"audio/mp4"}` with about six
bytes of audio in it. Not zero — zero would have hit the existing `no_audio` guard — but less
than a container header. The recording captured nothing, and the app uploaded it anyway.

Two of the three recordings that session were fine, at 196KB and 911KB, which incidentally
settled a question §10 had been carrying open since 2026-08-18: iPhone mp4 capture and the
streamed transcript do work on a real device. Only the empty one failed.

**Fix.** Three parts, none of them clever:

1. `VoiceInputButton` refuses to upload a blob under 1KB and says so — "Nothing came through —
   make sure no other app is using the mic, then try again." The old path spent an API call to
   be told the file was corrupt and then told the user their *diction* was the problem, which is
   the worst possible place to point someone whose mic was busy.
2. `transcribe` tells a file-level 400 apart from the multipart-form 400 the keyword ladder
   exists to retry, stops the ladder on the former, and returns `audio_unreadable` (422). The
   old code re-uploaded the identical unreadable file under a second encoding, every time.
3. A `startingRef` latch in `startRecording`. `status` is not set until after `await
   getUserMedia`, so two quick taps both passed the idle check and started two recorders — the
   first orphaned with the mic still live, the second with the chunk buffer reset under it. Only
   a candidate for the empty capture, not a proven cause, but it is a real leak either way.

`isUnreadableAudio` went into `_shared/transcriptGuard.ts` next to `looksLikeKeywordEcho`, whose
own doc comment is about exactly this genre of bug, with four tests. The narrow one matters
most: calling the multipart rejection an audio problem would disable the retry that fixes it and
take name-steering down, which is precisely the 2026-08-18 outage.

**Lessons.** Production logs beat reasoning about which of six error paths fired — the whole
diagnosis was two queries and no guesswork, and the payload size was the fact that cracked it.
And a fallback ladder needs to know which failures it cannot fix: retrying a bad file in a
different envelope is a second bill for the same answer.

---

## 2026-08-22/23 — Boomer → Porch → Grove, and the reposition that had to happen first

The app was renamed twice in one day. The second rename is the interesting one, because it
only happened after the founder refused to accept the first and asked a much better question.

**What went wrong with Porch.** Item 72 step 3 had been sitting open for weeks: pick a real
name. It got pulled forward because the App Store plan makes it blocking — an iOS bundle ID
is permanent once a build is uploaded. A session surveyed the category, found that every
plain descriptive name was taken (**Kinship** is a personal CRM pitched almost exactly as
this app is; **Fondly: Memory Journal** exists), landed on Porch, and shipped it: 85
occurrences across 34 files, all 10 Edge Functions redeployed, new icons, new favicon.

The founder's reaction, next session: *"I do NOT want to rename the whole app porch. I don't
know why it autoselected that."* And then the actually useful part: *"I think we need to
rethink entirely what the purpose is (who it's for, what it's key features are,
goals/direction of the features for the users) and from THERE we can visit a name."*

That was right, and the diagnosis backs it up. Sorting every shipped feature into buckets:
**capture ~40%, structure ~40%, retrieval ~20%.** The product's weight is in building a
durable map of the people in a life. But `Landing.tsx` was selling the thin 20% *and selling
it as a personal failing* — "In Fight of Forgetfulness," "Start remembering." That framing is
what produced the name "Boomer" in the first place, and it's why every naming attempt kept
landing in the crowded, clinical memory-aid aisle. It also directly contradicted §9's own
standing rule: never make the user feel bad about forgetting.

**The correction that changed everything.** Asked about the Dunbar callout, the founder
pushed back on how it was being read:

> the 'contacts' are not people you WANT to maintain close relationships with, rather, it is
> all of the minor characters who enter your life that add the texture to the social makeup
> of your life. All of the extra passerbys in your life.

That reframes the whole product. 150 is the ceiling on relationships you actively *maintain*
— it was never the size of a social life. The founder's account holds 724 people; the ~574
past the close tier are the point. They're the first people a memory drops and the only place
they're written down is here. The demo's ~180-person generated long tail had been built that
way on purpose back in July — the product had been making this argument for a month while the
copy argued something else.

Two more corrections landed in the same pass. The forgetting angle isn't a deficit pitch,
it's **foresight** — *"even if things aren't slipping yet, if they ever do, you'll be
covered. that's where the 'In Fight of Forgetfulness' comes from."* So the line survives, one
section further down, in that reading. And **Notebooks are the differentiator**, not a side
feature: *"notebooks are the key to this — something which makes it more than just a CRM.
it's notes for your daughter to give her on her 18th birthday — a place to file away feelings
about work."*

**The naming search, second attempt.** Ten names checked against the App Store rather than
picked on feel. Six died on *direct category neighbours*, which is the part worth recording,
because each one is a competitor nobody had noticed:

| Name | What killed it |
|---|---|
| Hearth | *Hearth — Family App*: mood check-ins and AI suggestions for reaching out to family. Plus Hearth Display, a funded family organiser |
| Keepsake | *Keepsake: Bring Family Closer* — "help families say what they've always meant to say." The held-letters idea, already shipping |
| Homestead | *Digital Homestead* — a private, invite-only family space. The sharing idea, already shipping |
| Harbor | Three at once: *Harbour Journal* (private AI journaling), *Harbor Social App* (social journal), *Harbor* (second brain) |
| Trove | 8+ apps, two of them private-document vaults. The founder liked the feel; the shelf was full |
| Orchard | Epic's enterprise "App Orchard" |
| Understory | A tree-themed reading tracker, an AI company, and a B2B platform |

**Grove** came through with one unrelated collision (an Australian parenting-events app), and
**Heartwood** was the clean runner-up — its only collisions were a Montessori school, an inn,
a vet, a coffee shop and an MMO. The founder picked Grove: one syllable, one pronunciation,
an obvious icon letterform, and a metaphor that needs no explaining — many trees of many
sizes, planted deliberately, tended for years, still standing after whoever planted them.
That maps onto the long tail, the family tree, and the letters idea at once.

The generalisable lesson: **checking a name against the App Store is also competitive
research.** Four of the six rejections were products nobody had found in a month of building,
and two of them were shipping features this app has on its own roadmap.

**Also settled in the same session** (all now in PROJECT_CONTEXT §9, not repeated here): the
long tail is the product and must never be filtered; the AI is a named character doing three
jobs, with its voice as a user setting rather than a hardcoded personality; the autonomy
boundary is *act only when certain*, paired with a not-yet-built activity log that makes every
automatic write legible and reversible; three guardrails (never a scoreboard, never sold or
trained on, never a public anything); Capacitor plus a cloud Mac **supersedes** the 2026-08-01
"PWA first, NOT Capacitor" decision, because the founder wants real App Store distribution and
renting a Mac removes the constraint that call was based on; and a cost ceiling of $10–20/month
total for other people's AI usage, which makes per-user metering a prerequisite for opening
signups.

**One correction to the record found on the way through:** §7 claimed Notebooks were "not in
the landing-page demo yet." Backlog item 97 shipped exactly that on 2026-08-19. §7 was stale;
fixed in place.

**What this rename cost, for the next person who has to do one.** 205 occurrences across 59
files — more than the 85/34 of the Porch pass, because Porch had added the name to places
Boomer never reached. Excluding `dist/`: 24 files in `src/`, 10 Edge Functions (the assistant's
name for itself lives in the prompts, and skipping a redeploy leaves the chat introducing
itself by the old name), four identity files, three docs. There is still no Python on this
machine, so `scripts/generate-icons.py` cannot run and the browser-canvas fallback documented
in `PWA.md` is the real path. The name sits in the *stable* prefix of every system prompt, so
the first AI call after deploy pays one uncached prompt — one call, not a regression.

**Deliberately not renamed, again:** lowercase `boomer` is never the product name in this repo
— it's the `boomer-nav` session key, the Google Photos OAuth state key, the live Vercel
hostname, and one test fixture. This file keeps Boomer and Porch in its dated entries; that's
what the product was called at the time.


---

## 2026-08-27 — Archive: the old §3 Frontend map (per-file rationale)

_Archived verbatim from `PROJECT_CONTEXT.md` §3 when that section was compressed from 2,131 lines to a
one-line-per-file index (founder budget directive, 2026-08-27). This is the "why" behind individual
files: build stories, founder decisions, dated fixes, and rationale that used to hang off the file tree.
Search it by FILENAME when you need the reasoning behind a specific file — do not read it top to bottom.
Anything here that was still a live rule or constraint was kept in `PROJECT_CONTEXT.md`; everything
below is history._

## 3. Frontend map

```
src/
├── main.tsx / index.css       — entry, global styles (incl. `spin` keyframe)
├── lib/
│   ├── supabase.ts            — shared client (reads VITE_* env)
│   ├── theme.ts               — (2026-08-01) design tokens: `colors`/`radius`/`fontSize`/
│   │                            `fontFamily`/`space`/`maxWidth`/`shadow`/`border`. The app has no
│   │                            CSS framework; everything is inline `style={{}}`, so this is the
│   │                            single source of truth for the palette.
│   │                            **Repositioned 2026-08-07** (founder-directed, mockup-approved —
│   │                            Airtable/Day One/Google-inspired): near-black `ink` (was forest
│   │                            green) is now TEXT ONLY; new `colors.primary` (`#2D7FF9` blue) is
│   │                            the accent — filled buttons, active borders, links. Every
│   │                            `backgroundColor: colors.ink` / `border: border.ink` accent usage
│   │                            was swept to `primary` across the codebase (mechanical rule: fills
│   │                            and emphasis borders → primary, plain heading/body text → stays
│   │                            ink). `suggest`/`event`/`tree`/`info` retuned to ONE shared HSL
│   │                            recipe (same sat/lightness, hue is the only thing that varies) —
│   │                            fixes a palette that read as "disjointed." `radius` bumped larger,
│   │                            `shadow` softened, `fontFamily` is now system-sans (was Georgia
│   │                            serif). `CountdownsSection.tsx` was skipped in that sweep
│   │                            (concurrent uncommitted work at the time) and **caught up
│   │                            2026-08-19**: its three filled controls (+ Add, Save, active
│   │                            chip) now read `primary` like every other fill in the app.
│   │                            This is Section 1 of a larger structural rework (Manage popups,
│   │                            consistent page section order, floating chat, nav/avatar, calendar
│   │                            enhancements) — see the mockup artifact for the full picture;
│   │                            those are separate, not-yet-built sections.
│   │                            Also exports `subgroupPalette` (2026-08-04): 8 EXISTING tokens
│   │                            reordered by hue distance for telling subgroups apart on
│   │                            GroupDetail — a reordering for a new job, not a new shade.
│   ├── geoapify.ts             — (2026-07-26) fetchAddressSuggestions(): thin client for
│   │                            Geoapify's Address Autocomplete API (key restricted by referrer,
│   │                            safe client-side, no proxy). Reads `VITE_GEOAPIFY_API_KEY`; returns
│   │                            [] (no error) if unset or the call fails — see §2/§10 for the
│   │                            founder's signup step.
│   ├── dates.ts               — eventSortDate/formatMonthYear (tested)
│   ├── countdowns.ts          — (2026-08-06, item 83) the Calendar Countdowns section's date math
│   │                            + write path. Pure/tested: `breakdown` (calendar-correct
│   │                            years/months/weeks/days/h/m/s — walks real months, clamps Jan 31
│   │                            + 1mo to Feb 28, counts days DST-safe), `displayUnits` (4 columns
│   │                            from the largest non-zero unit; count-ups stop at Days and trim
│   │                            trailing zeroes, countdowns run to Seconds and DON'T trim so a
│   │                            ticking card can't reflow), `tickMs` (1s only when a visible card
│   │                            shows minutes/seconds, else 60s), `buildCards` (derives every card
│   │                            from moments/people/rows — no queries, so it's testable and the
│   │                            Calendar page's existing data is reused; sorts ONE chronological
│   │                            timeline, oldest first, which is what the Today line splits).
│   │                            Per-card settings (2026-08-06): `breakdownIn` (the breakdown in
│   │                            exactly the chosen units — Days alone = TOTAL days, not the
│   │                            remainder; unselected units fold into the next one chosen),
│   │                            `nextOccurrence` (repeat rolls the displayed date forward, clamping
│   │                            Feb 29), `cardIdentity` (stable across a rebuild — a card's `key`
│   │                            isn't, since saving a setting on a derived card creates a row for
│   │                            it). DB side: `loadCountdowns` (returns
│   │                            `{rows, available, settingsAvailable}`, same fail-open contract as
│   │                            pets.ts — and retries without the settings columns if that second
│   │                            migration hasn't run), `addCountdown`, `pinMoment` (un-hides rather
│   │                            than duplicating), `dismissCountdown` (delete / hide / hide-derived,
│   │                            never touches the underlying event or birthday; returns WHAT changed
│   │                            so the section folds one row in instead of refetching),
│   │                            `saveCountdownSettings` (creates the row first for a derived card).
│   ├── moments.ts             — (2026-08-06) `createEventShell()`: the blank-event insert +
│   │                            self-attendee note, lifted out of Events.tsx so the Countdowns
│   │                            section's "a countdown and a real event" uses the same write path.
│   │                            (2026-08-08) `ATTENDEE_PLACEHOLDER` ('Was there.') + tested
│   │                            `hasSomethingToSummarize()`: the gate deciding whether a paid
│   │                            summarize-moment call is worth firing. True for a real description
│   │                            OR any note with real content; the auto-inserted self-attendee row
│   │                            doesn't count, or every blank shell would burn a call per page view.
│   ├── summarize.ts           — short title helper (tested)
│   ├── summaryFormat.ts       — (2026-08-10, tested) parses a stored event summary into blocks for
│   │                            SummaryText.tsx. Recognises the `<date> · <title> — <sentence>`
│   │                            lines summarize-moment emits for a parent event's sub-events;
│   │                            splits on the FIRST dash (sentences contain em dashes) and requires
│   │                            a short date-shaped cell with a digit, so prose containing a "·"
│   │                            isn't mistaken for a sub-event line. No prompt change — rendering
│   │                            only, so no summary needs regenerating. **2026-08-17:** also parses
│   │                            `- ` bullet lines (accepting •/*/– drift), which is what ordinary
│   │                            events are summarized as now; requires the trailing space so a date
│   │                            range ("2018-2019") is never read as a bullet. A trailing non-bullet
│   │                            line stays a paragraph — the "nothing else was recorded" note.
│   ├── people.ts              — sortByLastName
│   ├── pets.ts                — (2026-08-01) the single write path for pets: loadPetsForPerson
│   │                            (returns `{pets, available}` — `available:false` means the
│   │                            migration hasn't run, which the UI must not confuse with "no
│   │                            pets"), loadAllPets, loadPet, loadPetOwners, loadOwnersByPetId
│   │                            (all pets' owners in ONE round trip — the People list must not
│   │                            query per pet), createAndLinkPet, linkPet, unlinkPet, updatePet,
│   │                            deletePet (real delete, vs unlinkPet's detach), plus pure
│   │                            formatPetLine/formatPetDates/isMemorial/petEmoji (tested).
│   │                            Living pets sort before memorials. `petEmoji` keyword-matches
│   │                            species AND breed (species is free text, so "pup"/"black lab"/
│   │                            "goldendoodle" must all reach the dog); a keyword must align with
│   │                            a WORD BOUNDARY on at least one side — plain substring matching
│   │                            read "wallaby" as a dog, requiring both sides would miss
│   │                            "bulldog". Entry ORDER is load-bearing (fish before cat for
│   │                            "catfish", dog before cow for "bulldog", snake before rodents for
│   │                            "rattlesnake", "guinea pig" before "pig"). Unmatched falls back to
│   │                            a paw, which reads as "this is a pet", never as a wrong guess.
│   │                            **Pets at events (2026-08-20, founder-reported gap):**
│   │                            loadPetsForMoments (an event + all its sub-events in ONE round
│   │                            trip, keyed by moment id, so the Who-Was-There roll-up costs no
│   │                            extra queries), loadEventsForPet (reverse, newest first, undated
│   │                            last), tagPetToMoment/untagPetFromMoment (both return whether the
│   │                            write landed). Same `available` fail-open flag as the person-side
│   │                            loaders. Untag is detachment only, never a delete.
│   ├── groupTypes.ts          — GROUP_TYPES fixed list (Family/Friend group/School/
│   │                            Team/Work), shared by Groups.tsx + GroupDetail.tsx
│   ├── qualifiedName.ts       — (2026-08-16) the "Parent / Child" chain walk itself, with the
│   │                            cycle guard. Shared by groupDisplayName.ts and
│   │                            momentDisplayName.ts so groups and events never drift.
│   ├── groupDisplayName.ts    — groupDisplayName(group, nameById) → "Parent / Child" for a
│   │                            subgroup, bare name otherwise. Always qualifies (no
│   │                            collision check). Single source of the format.
│   ├── momentDisplayName.ts   — (2026-08-16, tested) the events twin: momentTitle(m) bare,
│   │                            momentDisplayName(m, titleById, parentById) → "Trip / Day 2",
│   │                            momentPickerLabel(...) adds " — June 12, 2026". Parentage read
│   │                            from the map first (pages fetch it separately, fail-open); date
│   │                            only ever from a real event_date, never the created_at fallback.
│   ├── searchRanking.ts       — (2026-08-10, tested) rankMatches()/matchScore() for
│   │                            SearchAddPicker: orders substring matches exact-first,
│   │                            then prefix ("98 FTS / …" descendants), then own-name
│   │                            (text past the last "/"), ties shallowest-then-shortest.
│   │                            Exists because full-chain labels made a parent group
│   │                            match-collide with all its subgroups and lose. NOTE
│   │                            (2026-08-21): decoration goes in the picker Item's
│   │                            `prefix`, never in `label` — `label` is what this
│   │                            scores, so a leading emoji demotes a prefix match to a
│   │                            mid-string one (🐕 Maple lost to every "map" name).
│   ├── globalSearch.ts        — (item 14, 2026-08-12, tested) matching for the global
│   │                            search panel. SearchDoc = {kind, id, title, display?,
│   │                            subtitle?, body?, target}. searchDocs() reuses matchScore
│   │                            on `title` (0-4) and scores a `body`-only hit 5, so a name
│   │                            finds the person, not the notes mentioning them; ties break
│   │                            by kind, length, alpha. groupByKind() splits into sections;
│   │                            snippet() windows a note around the match. Min query 2 chars.
│   ├── searchCorpus.ts        — (item 14, 2026-08-12) builds that corpus from 6 paged reads
│   │                            (people/pets/moments/groups/notes/tags) + a module cache.
│   │                            Filters ATTENDEE_PLACEHOLDER out of notes. Stale-while-
│   │                            revalidate: cache renders instantly, opening the panel always
│   │                            re-reads, hover-prefetch respects a 30s floor. clearSearch-
│   │                            Corpus() on SIGNED_OUT — it holds names and note text.
│   ├── demoSearchCorpus.ts    — (item 14, 2026-08-12, tested) same SearchDoc[] from static
│   │                            demoData. Separate mapper (demo uses camelCase FKs); person/
│   │                            event/group/note/notebook — DemoShell's Crumb has no pet or
│   │                            tag. Locked notebooks are excluded outright, name included.
│   ├── locationGroups.ts      — (item 66, 2026-08-12, tested) the "which of these are the
│   │                            same place?" half of ManageLocations.tsx. clusterKey():
│   │                            a value starting with a house number keys on
│   │                            `<number> <street>` with abbreviations expanded (so
│   │                            "12208 Bandon Dr" and "12208 Bandon Drive, Parker CO 80134"
│   │                            agree); anything else keys on its fully-normalized self, so
│   │                            only case/punctuation/spacing noise clusters. Deliberately
│   │                            will NOT pair "Denver Zoo" with "Denver, CO" — precision,
│   │                            because a wrong proposal the founder accepts is permanent.
│   │                            findLocationClusters() returns 2+-member groups with the
│   │                            most-used spelling suggested; tallyLocations() counts.
│   ├── subgroupColors.ts      — (2026-08-04, tested) subgroupColorMap() assigns a
│   │                            `subgroupPalette` colour per subgroup, honouring a pinned
│   │                            `groups.color_index` (item 82's manual override, 2026-08-12)
│   │                            and otherwise BY POSITION, skipping colours a pin already
│   │                            took so an auto colour can never collide with a deliberate
│   │                            one (cycles only once all 8 are spoken for; position not a
│   │                            hash of the id, because a hash collides and
│   │                            two subgroups sharing a colour is the one failure that makes
│   │                            the feature misleading). subgroupsByPerson() → personId →
│   │                            subgroups they're in, built from rosters GroupDetail already
│   │                            has; isUnassigned() drives the "Not in a subgroup" filter.
│   │                            Structural input type (SubgroupLike), not an import from
│   │                            pages/. Direct children only. Nothing persisted.
│   ├── groupRollup.ts         — (2026-08-10, tested) the membership side of the group tree:
│   │                            anyone in a subgroup is a member of every group above it,
│   │                            at ANY depth. descendantGroupIds() (cycle-guarded),
│   │                            mergeRolledUpMembers() → { members, rolledUpIds }, and the
│   │                            batch rollUpMembersByGroup() for Groups.tsx, which already
│   │                            holds every roster so its rollup costs no extra query.
│   │                            DERIVED ONLY — nothing is written to person_groups, so the
│   │                            row stays on the subgroup and this stays reversible. Rolls
│   │                            UP only; parent → subgroup auto-fill remains off the table
│   │                            (2026-07-26 lesson). Group-side twin of the sub-event
│   │                            attendee rollup in EventDetail.tsx/Events.tsx.
│   │                            DUPLICATED, deliberately, as supabase/functions/_shared/
│   │                            groupRollup.ts — Deno can't import from src/. The copies are
│   │                            pinned together by src/lib/groupRollupParity.test.ts, which
│   │                            imports both and asserts they agree; without it the group
│   │                            page and the AI chat could quietly disagree about who's a
│   │                            member, with nothing erroring.
│   ├── groupRoster.ts         — (2026-08-01) useGroupRoster() → { nameById, label(id,
│   │                            fallbackName) }. One small `groups` select on mount, no
│   │                            cache (converse can create a group server-side mid-chat, so
│   │                            there's no reliable invalidation point). Fails open to the
│   │                            bare name on error or unknown id. Used by Home/People/
│   │                            Events/Circle/GroupDetail, which hold only {id, name} —
│   │                            PersonDetail/EventDetail/the import-review pages already
│   │                            load a full roster and call groupDisplayName directly.
│   ├── relatedEvents.ts       — (2026-08-26) the `moment_links` read/write path: symmetric
│   │                            event↔event links that are NOT sub-events. normalizeLinkPair
│   │                            sorts every pair before read and write (same convention as
│   │                            `relationships`) so a link is one row whichever event it was made
│   │                            from; loadRelatedEvents is isolated and fail-open (`available`),
│   │                            and does two round trips rather than a PostgREST embed because
│   │                            the table has two FKs to `moments` (PGRST201). Tested:
│   │                            relatedEvents.test.ts covers pair normalization + far-side
│   │                            extraction.
│   ├── relationshipsTable.ts  — browser-side upsertRelationship/getRelationshipsForPerson
│   │                            against the `relationships` table (mirrors the Deno copy in
│   │                            supabase/functions/_shared/). getRelationshipsMap's scoped id
│   │                            list is URL-budgeted (2026-08-07 fix): >150 ids fetches the table
│   │                            unscoped, below that ids go out in batches of 50. A scoped
│   │                            `.in.()` names the list once per column (~74 chars/id), so 457
│   │                            ids built a 35 KB URL the gateway 400'd — which read back as
│   │                            "no relationships" and silently killed Home's family suggestions.
│   ├── suggestConnections.ts  — (2026-07-25) loadConnectionSuggestions(): generalizes
│   │                            GroupDetail.tsx's own per-group membership-suggestion signal
│   │                            (event attendance on a group-tagged moment, or membership in a
│   │                            confirmed associated group) across every group at once, for
│   │                            Home's "Connections to make" card. Deterministic, no AI call —
│   │                            returns a random sample (currently 4) of the full candidate
│   │                            pool each call, so a large backlog rotates across visits rather
│   │                            than always showing the same few. accept/dismiss write the same
│   │                            person_groups/dismissed_person_ids GroupDetail itself writes, so
│   │                            a suggestion acted on from Home stays consistent there too. Third
│   │                            signal added 2026-07-26 (item 63): family — spouse of a current
│   │                            group member, then that couple's kids once the spouse is also a
│   │                            member, same `suggestFamilyMembers` chaining GroupDetail.tsx's own
│   │                            "Family of a current member?" box uses, scoped to people already
│   │                            in some group with a backfill `people` lookup for a suggested
│   │                            spouse/child who isn't. That family signal was silently dead from
│   │                            2026-07-26 to 2026-08-07 — see relationshipsTable.ts's URL-budget
│   │                            note; the scoped fetch 400'd and read back as "no relationships".
│   │                            (2026-08-08, item 85) Now also the AGGREGATOR for the card:
│   │                            loadHomeSuggestions() pools four question types and
│   │                            sampleAcrossKinds() round-robins between them (6 shown, was 4)
│   │                            so one big pool can't crowd out the rest. suggestionKey() is the
│   │                            shared identity used as the React key and to drop a row from
│   │                            local state after a confirmed write. loadConnectionSuggestions()
│   │                            now returns the WHOLE person→group pool; sampling moved up.
│   │                            (2026-08-10) Every read in here is paged — person_groups was over
│   │                            the 1000-row cap, which made already-accepted suggestions come
│   │                            back forever. See §2's 1000-row-cap entry.
│   ├── pagedSelect.ts         — (2026-08-10) browser twin of _shared/pagedSelect.ts.
│   │                            fetchAllRows() pages any account-wide select and REQUIRES an
│   │                            .order() inside the callback. Use it for every new one.
│   ├── personLabel.ts         — (2026-08-11, tested, item 33) the only place a person becomes
│   │                            display text. fullName() joins first + last (replaced four local
│   │                            copies); personLabel(person, selfId, {capitalize}) returns
│   │                            "You"/"you" for the account owner — capitalize:false for
│   │                            mid-sentence copy, since "Is you also a parent of…" is broken
│   │                            English. DISPLAY ONLY: linkRelationship writes the names it's
│   │                            given into real note text, so nothing from here may reach a write.
│   ├── suggestRelationshipGaps.ts — (2026-08-08, item 85) account-wide sweep for family links
│   │                            that are implied but never written: a current spouse missing as
│   │                            a parent of the other's child, and two parents of one child with
│   │                            no couple link. deriveRelationshipGaps() is pure over the
│   │                            familyTree Graph (unit-tested, no DB). Skips ended unions
│   │                            (divorce OR a death) — conservative on purpose, since a permanent
│   │                            family edge is the write. Also skips a child who already has TWO
│   │                            parents on file (2026-08-10): a spouse would be a third adult, i.e.
│   │                            a step-parent, and blended families were producing one un-answerable
│   │                            question per step-child. Accept paths are copies of
│   │                            FamilyTree.tsx's acceptCoParentSuggestion/acceptSpouseSuggestion,
│   │                            plus a read-back check because those shared write helpers
│   │                            return void. NOTE the cascade this can trigger — see item 86.
│   │                            A co-parent gap also carries `parentNoun` (2026-08-16) — mother/
│   │                            father off Graph.genderById, "parent" when it can't say — so Home
│   │                            asks "also Sophie's mother?" not "also a parent of Sophie"
│   ├── suggestEventGroups.ts  — (2026-08-08, item 85) untagged events whose EVERY attendee (2+)
│   │                            belongs to one group → "Tag this event as that group?".
│   │                            All-attendees, not most: at 2+ the real account gave 55 noisy
│   │                            pairs, all-attendees gave ~10 good ones. Deliberately NOT gated
│   │                            on groups.suggestions_enabled (that flag means "suggest PEOPLE
│   │                            for this group" and is off for 63 of 68 groups). Accept copies
│   │                            EventDetail.tsx's handleTagGroup.
│   ├── suggestFamilyGroups.ts — (item 98, 2026-08-20, tested) a couple plus the children BOTH
│   │                            are recorded as parents of → "Make a group for these five?".
│   │                            The couple is what BOUNDS a household: the family graph is one
│   │                            connected component, so "3+ people connected in the tree" taken
│   │                            literally is the whole account. Silent when an existing group
│   │                            already holds every member, when the union ended, or when either
│   │                            of the couple has died. Names are assigned after every household
│   │                            is known, so two generations of Carrolls don't both get offered
│   │                            as "Carroll Family" (the second becomes "Ward & Heather
│   │                            Carroll"), and never a name a group already has.
│   ├── dismissedSuggestions.ts — (2026-08-08, item 85) shared "No" store for the newer
│   │                            suggestion types, backed by the dismissed_suggestions table
│   │                            (§6). FAILS CLOSED: if the table is missing the new types return
│   │                            nothing at all, rather than showing a No button that can't save.
│   │                            person→group still uses groups.dismissed_person_ids.
│   ├── writeRelationship.ts   — linkRelationship/createAndLinkRelationship: the shared "+"
│   │                            write path (relationships table row + both-sides reciprocal
│   │                            note) used by Circle.tsx and FamilyTree.tsx. syncFamilyClique
│   │                            (2026-07-25 fix, mirrored in `_shared/relationships.ts`): its
│   │                            sibling-closure BFS previously only walked EXISTING `sibling`
│   │                            rows, so two kids independently given the same parent (typical
│   │                            when building a tree one child at a time, or from different
│   │                            profiles) never became siblings anywhere — the exact founder
│   │                            report ("relationships don't sync regardless of whose profile was
│   │                            centered"). Now also seeds the closure from the anchor's own
│   │                            recorded parents' other children (once, non-recursively — see
│   │                            code comment for why this can't cascade into unrelated
│   │                            half-sibling chains). New `syncSpouseParenthood`: adding a
│   │                            `spouse` relationship now auto-links the new spouse as a parent of
│   │                            the other's existing kids (founder decision, 2026-07-25) UNLESS
│   │                            either side already has another spouse/partner on file (a
│   │                            remarriage shape — item 24's step-parent concern) — that skipped
│   │                            case surfaces instead as a new "Is X also Y's parent?" banner in
│   │                            FamilyTree.tsx (`suggestCoParentLinks`/`coParentSuggestions`,
│   │                            mirrors the existing reverse "are X/Y married?" banner). New
│   │                            `invalidateKeyFacts`: nulls a touched person's cached
│   │                            `people.key_facts`/`key_facts_updated_at` so PersonDetail's Key
│   │                            Facts chips regenerate fresh instead of going stale after a
│   │                            relationship change elsewhere — wired into every write site in
│   │                            this file, `_shared/relationships.ts`, and
│   │                            `RelationshipSuggestions.tsx` (which had its own independent
│   │                            spouse-write path, `writeRelationshipTableEntry`, found and fixed
│   │                            in the same pass). One-time backfill for data already on file
│   │                            before this shipped: `migrations_manual/2026-07-25-shared-parent-
│   │                            sibling-backfill.sql` + `2026-07-25-spouse-coparent-backfill.sql`
│   │                            (same remarriage guard as the runtime fix) — see §10 for
│   │                            deploy/run status. `syncParentSpouse` (2026-08-05, founder) is the
│   │                            MIRROR-IMAGE inference: adding a PARENT auto-links that parent's
│   │                            spouse as the child's other parent ("Linda is Alex's mother" ⇒
│   │                            Linda's husband is Alex's father). Decision split into two pure,
│   │                            unit-tested rules — `eligibleCoParentSpouse` (exactly one spouse,
│   │                            no second parent already on file, 'partner' never counts) and
│   │                            `coParentNeedsConfirmation` (another partner on file, or a divorce,
│   │                            or the child carrying the PARENT's surname but not the candidate's
│   │                            ⇒ ask instead of write). Death is deliberately not a blocker. A
│   │                            "needs confirmation" verdict falls through to the same
│   │                            "Is X also Y's parent?" banner as above.
│   ├── nameGender.ts          — (2026-08-05) `guessGenderFromName`: confident male/female name
│   │                            lists plus an AMBIGUOUS blocklist checked first, so the clarify
│   │                            prompt stops asking about the obvious ones. **The lists are SSA
│   │                            birth counts since 2026-08-19, not hand-typed** — 16,002 names in
│   │                            `nameGender.generated.ts` (both mirrors), regenerated by
│   │                            `scripts/build-name-gender.mjs`; a name is listed when ≥500 US
│   │                            babies got it and ≥90% were that gender, so Jordan/Casey/Taylor are
│   │                            in neither list and still get asked about. Only two hand-written
│   │                            overrides remain, both in nameGender.ts: AMBIGUOUS = alex/jess/nat/
│   │                            sam (shared short forms — a birth certificate can't see the
│   │                            Alexandra who goes by Alex), and ALSO_MALE/ALSO_FEMALE = the ten
│   │                            names just under the 90% cut that the old list answered (micah,
│   │                            willie, carmen…). Hyphenated names
│   │                            need both halves to agree (else Jean-Pierre reads female). Guesses
│   │                            NEVER reach the database — they fill gaps in `Graph.genderById`
│   │                            only, and a recorded gender (including non-binary/other) always wins.
│   │                            Mirrored at supabase/functions/_shared/nameGender.ts (2026-08-16),
│   │                            pinned by that file's nameGender.test.ts, which compares the three
│   │                            name SETS and every lookup across both copies. The edge copy adds
│   │                            `effectiveGender(recorded, name)` — the recorded-wins precedence as
│   │                            one function, so callers can't get the order wrong
│   ├── nameGender.generated.ts — (2026-08-19) AUTO-GENERATED, don't hand-edit. Two comma-joined
│   │                            strings (6,049 male / 9,953 female) parsed into Sets by
│   │                            nameGender.ts. A string, not an array literal, for the same TS2590
│   │                            reason as sportsTeams.generated.ts. Byte-identical copy at
│   │                            supabase/functions/_shared/. Own lazy chunk, ~42KB gzipped, not in
│   │                            the entry bundle — only FamilyTree/PersonDetail/GenderFill/demo pull it
│   ├── nameMatchStrength.ts   — (2026-08-10) `nameMatchStrength(contactFullName, personNameKeys)`
│   │                            → strong/weak/none. Surnames decide: both sides have one and they
│   │                            differ = not the same person. weak = first name matches but one
│   │                            side has no surname on file, an initial against a matching
│   │                            surname, or a 1-char typo in a 5+ char surname (Baerman/Baermann).
│   │                            Aliases (nicknames/middle/goes-by) count as given names only,
│   │                            never surnames — former names are the exception and take their
│   │                            own 4th arg into `surnames` (item 101). MIRRORED verbatim in
│   │                            `_shared/nameMatch.ts` for the import; `nameMatch.test.ts` runs
│   │                            both and fails on drift.
│   ├── formerNames.ts         — (item 101, 2026-08-21, tested) maiden/former SURNAMES.
│   │                            parseFormerLastNames (split the comma column), formerFullNames
│   │                            ("Sarah" + ["Jenkins"] → ["Sarah Jenkins"] — consumers need the
│   │                            whole old name for search and for the name→id index, since a bare
│   │                            surname would collide with every relative), formerNameLine
│   │                            ("Formerly Sarah Jenkins." for the profile). Edge twin at
│   │                            `_shared/formerNames.ts` adds the prompt clauses, the roster
│   │                            marker, claimFormerNameKeys, and reuses nicknames.ts's additive
│   │                            merge; `formerNames.test.ts` runs both and fails on drift.
│   ├── treeHealth.ts          — (item 20, 2026-08-19, tested) findTreeIssues(graph): the family
│   │                            data's own sanity check. Pure, over the already-loaded Graph —
│   │                            no query, no AI. Six checks; two of them (a third parent, two
│   │                            current partners) are questions, not faults, because both can be
│   │                            real. Rendered collapsed at the bottom of FamilyTree.tsx.
│   ├── familyTree.ts          — buildFamilyTree(personId): walks the relationships table
│   │                            (one full-table fetch, then in-memory graph walk) into the
│   │                            tiers/branches FamilyTree.tsx renders. `loadFamilyGraph()`
│   │                            (2026-08-05, was the private `loadGraph`) exports the Graph
│   │                            itself, so callers that already have it can name relationships
│   │                            off it with no extra queries.
│   ├── relationshipCalculator.ts — (2026-08-05) general "what is B to A" kinship engine, the
│   │                            thing relationshipLabels.ts isn't: cousins with degree+removal,
│   │                            great-aunts, nieces/nephews, in-laws, ex- vs. deceased spouses.
│   │                            Pure (no supabase import) and typed on `KinGraph`, a structural
│   │                            subtype of Graph. BFS up parentsOf from both people to the nearest
│   │                            shared ancestor, then standard kinship math (degree =
│   │                            min(dA,dB)-1, removal = |dA-dB|); full-vs-half comes from how many
│   │                            common ancestors sit at the SAME (dA,dB), which is what stops
│   │                            recorded grandparents promoting a half sibling to full. Resolution
│   │                            order self > spouse > blood > step > in-law > sibling-row, each
│   │                            step commented with the wrong answer it prevents. Gendered wording
│   │                            via genderById with a neutral fallback; `describeKinPath` renders
│   │                            the chain ("his mother Jane → her brother Bill → his son Steve").
│   │                            `genderAlternatives(g, from, to)` (2026-08-05) returns the male and
│   │                            female wordings behind a fallback that's only vague because gender
│   │                            isn't on file ("son-in-law"/"daughter-in-law" under "child-in-law"),
│   │                            null when there's nothing to ask — recomputed on a gender-forced
│   │                            clone of the graph, never re-derived, so the question can't drift
│   │                            from the answer. Powers ClarifyGenderPrompt.tsx.
│   │                            Step logic is DELEGATED to relationshipLabels.ts, not copied.
│   │                            Bounded by MAX_GENERATIONS 25 / MAX_ANCESTOR_NODES 2000; a
│   │                            truncated walk reports "unrelated" rather than hanging.
│   │                            Mirrored (math only) in _shared/kinship.ts for the AI — §4.
│   ├── acceptCandidate.ts     — (2026-08-19) the ONE write path for turning a calendar-import
│   │                            candidate into a real event. `acceptCandidate(candidate,
│   │                            overrides)` creates the moment, attaches attendees/tags/groups and
│   │                            marks the candidate accepted; `attachAttendees`/`attachTagsAndGroups`
│   │                            are exported separately for ImportReview's merge-into-an-existing-
│   │                            event path. Overrides are all optional — omitting them is "accept
│   │                            it as the scan found it", which is what CalendarTriage's Quick Add
│   │                            does and what an untouched review card has always saved. Every
│   │                            write is BATCHED: the original called `auth.getUser()` INSIDE each
│   │                            attendee loop and awaited one insert per attendee/tag/group (~15
│   │                            serial round trips for 5 people + 3 tags); now one auth call and
│   │                            one array statement per table. `undoQuickAdd` deletes dependents
│   │                            BEFORE the moment, the same order as EventDetail's
│   │                            handleDeleteEvent — see item 93's postmortem for why that order is
│   │                            not optional. It deliberately does NOT delete profiles the accept
│   │                            created (they may already be on other events by then).
│   ├── likelyDuplicate.ts     — (2026-08-19) the free client-side "might already be on file" check
│   │                            (title word-overlap + date proximity, no AI call), lifted out of
│   │                            ImportReview.tsx because CalendarTriage needs the same answer:
│   │                            Quick Add saves in one tap without ever showing the four-way merge
│   │                            banner, so without this it would be the fastest way in the app to
│   │                            create a duplicate. Two copies of the thresholds would drift on the
│   │                            first tuning pass. Note the ratio divides by the SHORTER title, so
│   │                            a fully-contained title scores 1.0 — pinned in the tests, and fine
│   │                            for what it drives (both are plausible duplicates either way).
│   ├── reviewQueues.ts        — (2026-08-19) the one owner of "what's waiting to be reviewed".
│   │                            `loadReviewCounts()` returns every import queue's count (Home and
│   │                            Calendar both read it, so the two can't disagree; ReviewInbox.tsx
│   │                            shows the same numbers as a breakdown) — set-aside is deliberately
│   │                            OUT of `total` via `reviewTotal()`, since "Not now" has to actually
│   │                            take something off the plate. `probeTriageEnabled()` memoises a
│   │                            one-shot `select('id, deferred_until')` — an unknown COLUMN errors,
│   │                            an unknown status VALUE would not, so it's the reliable test for
│   │                            "has 2026-08-19-calendar-triage-and-defer.sql been run"; false keeps
│   │                            the whole app on its pre-triage behaviour. `wakeDueDeferrals()` is
│   │                            an idempotent update flipping due 'deferred' rows back to
│   │                            'selected', called on load by the inbox and the queue (no cron).
│   │                            `todayIso`/`deferUntilIso` are browser-local calendar-day math —
│   │                            `toISOString()` would set things aside a day early after 5pm ET.
│   ├── resolvedCardScroll.ts  — (2026-08-17) the accept/reject landing behaviour shared by all
│   │                            four import review queues. `useResolvedCardScroll(resolved)`
│   │                            returns a ref to put on the card's root in BOTH its editing and
│   │                            its confirmation branch; when it resolves, a LAYOUT effect parks
│   │                            the collapsed card `CONFIRM_SCROLL_MARGIN` (12px) below the top of
│   │                            the screen so the next item sits right underneath it.
│   │                            `scrollCardToTop(el)` is the same move for callers that can't use
│   │                            the hook (PhotoImportReview.tsx renders cards inline, off a ref
│   │                            map). Only limit: a card can't reach the top when there isn't a
│   │                            screen of content below it, i.e. the last 1-2 of a queue — where
│   │                            the whole queue is on screen anyway.
│   ├── resetOnboarding.ts     — (2026-07-22) `resetOnboardingData()`: wipes all people/moments/
│   │                            groups (+ dependents) for the current account and clears the
│   │                            `onboarding_complete` flag, so Onboarding.tsx can be re-tested
│   │                            from scratch without a new signup each time. Gated by an exact
│   │                            email constant (`ONBOARDING_RESET_TEST_EMAIL`) checked again in
│   │                            components/DevOnboardingReset.tsx before the control even
│   │                            renders — currently `jake.volin+onboardtest@gmail.com`, a
│   │                            disposable signup created solely for this. Deliberately NOT
│   │                            `jakevolin@gmail.com` — that account has 413 real people/706
│   │                            notes, confirmed live 2026-07-22, so it's unsuitable as a wipe
│   │                            target despite being the usual browser-verification login.
│   ├── ensureStarterTags.ts    — (item 28 follow-up, 2026-07-22) seeds 10 generic
│   │                            starter tags (Milestone, Vacation, Biking,
│   │                            Weddings, Parties, Workouts, Birthdays, Holidays,
│   │                            Reunions, Trips) so a new/existing account's tag
│   │                            picker isn't empty on day one. Guarded by a sticky
│   │                            `tags_seeded` auth-metadata flag (same pattern as
│   │                            `onboarding_complete`) checked BEFORE inserting —
│   │                            not a blind insert — so it never resurrects the
│   │                            starter set for someone who deliberately deleted
│   │                            all their tags later, and is safe to run against
│   │                            an account that already has some matching names.
│   │                            Called from App.tsx's `onAuthStateChange` on
│   │                            `SIGNED_IN` only, same call site as
│   │                            `ensureSelfFromSignup.ts` below. Verified live: ran
│   │                            on the real `jakevolin@gmail.com` account's next
│   │                            real sign-in, inserted all 10 (no prior tags
│   │                            existed except one the AI had already created —
│   │                            "Phone Calls" — from real production usage
│   │                            post-deploy, correctly left untouched/not
│   │                            duplicated).
│   ├── ensureSelfFromSignup.ts — (2026-07-22) turns sign-up's auth user_metadata
│   │                            (first_name/last_name/birthday) into a real self `people`
│   │                            row + Birthday `reminders` row, so a new signup skips
│   │                            Circle.tsx's "which profile is you?" onboarding. Called
│   │                            from App.tsx's `onAuthStateChange` on the `SIGNED_IN`
│   │                            event only (not the initial session restore, so it isn't
│   │                            re-run on every page load). No-ops safely: does nothing
│   │                            if `first_name` is absent (pre-2026-07-22 accounts, or
│   │                            login rather than signup) or if a self person already
│   │                            exists (checked before inserting — verified live against
│   │                            the real `jakevolin@gmail.com` account that this correctly
│   │                            skips rather than creating a duplicate). Errors are
│   │                            logged, never thrown — worst case a new user just falls
│   │                            through to the existing manual onboarding screen.
│   ├── googlePhotosAuth.ts     — (2026-07-30) `startGooglePhotosAuth()`: builds Google's OAuth
│   │                            authorize URL (`photospicker.mediaitems.readonly` +
│   │                            `userinfo.email` scopes, `access_type=offline&prompt=consent`
│   │                            so a refresh_token is always returned) and does a full-page
│   │                            redirect — no popup. CSRF `state` nonce round-trips via
│   │                            sessionStorage, checked by `consumeGooglePhotosOAuthState` in
│   │                            `GooglePhotosOAuthCallback.tsx`.
│   └── googlePhotosImport.ts   — (2026-07-30) `startGooglePhotosImport(momentId?, callbacks)`:
│                                shared picker-session-create → open tab → poll-until-done logic
│                                behind `PhotoImportReview.tsx`'s general import AND
│                                `EventDetail.tsx`'s quick-add button — they differ only in
│                                whether `momentId` is set. Returns a `{ cancel }` handle so
│                                either caller can stop in-flight polling on unmount.
├── pages/
│   ├── Landing.tsx            — public marketing page (2026-07-22), now what `!session`
│   │                            renders in App.tsx instead of bare Login.tsx: single
│   │                            scrolling page (What is Grove? / Not another social
│   │                            network incl. a Grove-vs-social-media/journaling-apps/
│   │                            CRM comparison table / How it works / Who it's for /
│   │                            Just yours (privacy) / Get started); top nav anchor-link
│   │                            row removed 2026-07-23 (cluttered, founder call) — nav
│   │                            is now just brand + Free demo/Log in buttons,
│   │                            embeds Login.tsx unchanged as the Get Started section's
│   │                            form. Reuses Login.tsx's sage/cream/Georgia styling, no
│   │                            new visual system. Privacy copy deliberately does NOT
│   │                            claim end-to-end encryption (incompatible with the AI
│   │                            reading notes to do its job today, see §9) — only
│   │                            encryption in transit/at rest, which is already true.
│   │                            Pass 2 same day (founder feedback: headers felt noisy,
│   │                            copy read too sales-pitchy): removed all visible section
│   │                            `<h2>`s (sections still anchor-scrollable via `id` on the
│   │                            `<section>` itself, nav labels are the only section
│   │                            titles now), trimmed body copy throughout, added a
│   │                            "150 — Dunbar's number" stat callout + a forgetting-curve
│   │                            citation as data-backed emphasis in place of pitch prose.
│   │                            Nav "Grove" wordmark is now a button that smooth-scrolls
│   │                            to page top.
│   │                            Pass 3 same day (founder: embedded login form at the
│   │                            bottom still felt awkward, wanted a real standalone login
│   │                            page back like pre-Landing): Get Started section no
│   │                            longer embeds Login.tsx inline — it's two tiles ("New
│   │                            here? Sign up" / "Already have an account? Log in") plus
│   │                            the nav's "Log in" button (now a button, not an anchor),
│   │                            all three calling `onAuthClick(mode)` up to App.tsx. Which
│   │                            mode opens which screen lives in App.tsx's `authView`
│   │                            state (`'landing' | 'login' | 'signup'`), not Landing.tsx
│   │                            itself — Landing only fires the callback.
│   │                            Pass 4 (2026-07-23, founder feedback — demo entry point was
│   │                            buried as one of 3 equal tiles at the bottom): added a
│   │                            dedicated `#try-it-now` section (between How it works and
│   │                            Who it's for, own nav link) plus a "Free demo" button in the
│   │                            sticky nav next to Log in, plus two more inline demo-link CTAs
│   │                            (end of the comparison table, end of Who it's for). Removed the
│   │                            redundant demo tile from Get Started (now just Sign up / Log
│   │                            in). Section bg alternation re-threaded (privacy → altBg,
│   │                            get-started → plain) to keep it after the insert.
│   │                            Pass 5 (2026-07-30): dark-green "platform databox" banner
│   │                            right after the hero — People/Events/Groups/Datapoints
│   │                            totals across EVERY account (not the visitor's own, they
│   │                            have none yet), an enterprise-scale social-proof stat.
│   │                            First real data fetch on this otherwise-static public page:
│   │                            reads the `platform_stats()` RPC (§6/§10) directly with the
│   │                            anon key (function is granted to the `anon` role — no
│   │                            session needed). Fails open (banner just doesn't render) if
│   │                            the call errors. Originally built on Home.tsx (the logged-in
│   │                            dashboard) by mistake, then moved here per founder
│   │                            correction — "Landing page" (this file) vs. "Home" (the
│   │                            logged-in dashboard) is the disambiguating terminology
│   │                            going forward.
│   │                            Current hero copy (2026-08-16, founder wording): headline
│   │                            "In Fight of Forgetfulness" (replaced "Never go in cold
│   │                            again"), sub "A life isn't a list of names…". Positioning
│   │                            per founder: it's not about *who* — it's the people,
│   │                            events and groups that make a life whole, with the tech
│   │                            as scaffolding for remembering all of it. That framing
│   │                            leads the What-is-Grove and How-it-works sections; keep
│   │                            new landing copy consistent with it.
│   ├── Login.tsx              — combined sign up / log in. Takes `initialSignUp` (which
│   │                            tile/button was clicked sets the starting mode) and
│   │                            `onBack` (returns to Landing) props, both
│   │                            optional/undefined-safe so existing callers don't break.
│   │                            `onBack` is now wired to a sticky top nav bar with a
│   │                            clickable "Grove" wordmark (2026-07-22, matches
│   │                            Landing.tsx's nav styling) instead of a small "← Back"
│   │                            text link inside the card. Rendered full-page by App.tsx once
│   │                            `authView !== 'landing'` — a real standalone page again,
│   │                            not embedded in Landing's scroll flow. Sign-up mode
│   │                            (2026-07-22) collects First/Last name, Birthday, Email,
│   │                            Password, Confirm password (log-in mode still just
│   │                            Email/Password). Age-gated at 13+ (industry-standard/
│   │                            COPPA threshold): the birthday `<input type="date">`'s
│   │                            `max` attribute blocks the native picker from selecting
│   │                            an under-13 date at all; `calculateAge()` re-checks on
│   │                            submit as a fallback (blocks with a message, never calls
│   │                            `supabase.auth.signUp`). Password/confirm mismatch is
│   │                            also blocked pre-submit with its own message. First/last
│   │                            name + birthday are passed as `options.data` on
│   │                            `signUp()`, landing in the Supabase auth user's metadata;
│   │                            `lib/ensureSelfFromSignup.ts` (2026-07-22) turns that into
│   │                            a real self person + birthday reminder on first sign-in,
│   │                            so Circle.tsx's onboarding is skipped for new users.
│   │                            `calculateAge()` parses the 'YYYY-MM-DD' string's parts
│   │                            directly rather than `new Date(...)` — the latter parses
│   │                            as UTC midnight and can misjudge the 13-cutoff by a year
│   │                            in timezones west of UTC.
│   ├── Onboarding.tsx         — (2026-07-22) standalone first-run "experience": full-screen,
│   │                            no tab bar/breadcrumb, shown once instead of Home for a
│   │                            brand-new account. App.tsx gates on it via `onboardingPending`
│   │                            state (`checkOnboarding()`): shown only when the session's
│   │                            auth `user_metadata.onboarding_complete` flag is unset AND
│   │                            the account has zero non-self people yet (the second check
│   │                            is what keeps every pre-2026-07-22 account, which has no
│   │                            metadata flag at all, from suddenly being routed into
│   │                            onboarding). Sequenced by the gameplan's "juice for the
│   │                            squeeze" ranking, not alphabetically: Stage 1 (Welcome)
│   │                            just confirms the name `ensureSelfFromSignup.ts` already
│   │                            wrote (falls back to an inline "what's your name?" form if
│   │                            no self person exists yet — covers pre-existing accounts
│   │                            and the rare metadata-write race) plus a brief People/
│   │                            Events/Groups/Notes orientation; Stage 2 embeds
│   │                            `FamilyTree.tsx` AS-IS (no changes to that file) centered on
│   │                            self, framed to encourage going as far out as possible
│   │                            (grandparents, cousins, in-laws — no depth cap, item 42);
│   │                            Stage 3 offers turning everyone just added into a Family
│   │                            group (reuses item 41's existing Family-group/tree pairing,
│   │                            seeded from `buildFamilyTree()`'s own output rather than
│   │                            re-asking); Stage 4 is a closed-ended group picker (the
│   │                            existing `GROUP_TYPES` list minus Family) walked through one
│   │                            type at a time — name it, list members (comma/newline-
│   │                            separated, matched against existing people case-
│   │                            insensitively or created new, mirroring
│   │                            `writeRelationship.ts`'s create-new logic but for plain
│   │                            group membership — no longer auto-seeded with the
│   │                            founder themselves, 2026-07-26, same fix as
│   │                            Groups.tsx's own "+ Add Group"; typing your own name in
│   │                            still works like any other member); final handoff regenerates
│   │                            `suggest-prompts` live (`{refresh:true}`) before dropping
│   │                            into real Home. Every stage has a "Skip" escape hatch, which
│   │                            (like finishing normally) sets the `onboarding_complete`
│   │                            auth metadata flag via `supabase.auth.updateUser()` so it
│   │                            never shows again. Known gap, not a bug: `suggest-prompts`
│   │                            only generates personalized suggestions when at least one
│   │                            `moments` row exists (see its own source) — onboarding only
│   │                            creates people/relationships/group membership, no moments,
│   │                            so the Stage 4 "live payoff" regenerate call is real but
│   │                            still falls back to the generic 3 ice-breakers until the
│   │                            user logs an actual moment. Verified live end-to-end
│   │                            (signup → self-confirm → tree with a spouse add → Family
│   │                            group offer → two more groups, one saved with members, one
│   │                            skipped → handoff → real Home showing the right counts) with
│   │                            a disposable test account (`onboarding.verify.test@
│   │                            example.com` — not yet deleted, needs founder cleanup via
│   │                            the Supabase dashboard, no admin access from this session).
│   │                            Second pass (2026-07-22, founder click-through bugs): tree-stage
│   │                            copy now explains WHY onboarding starts with family (profiles +
│   │                            groups are the core ideas, family is the clearest way to show
│   │                            them). Bigger fix: `onboardingPending` used to be re-derived from
│   │                            "zero non-self people" on every check, but Stage 2 writes a real
│   │                            person row the moment you add one relative — so a tab getting
│   │                            backgrounded/discarded and remounted mid-onboarding would silently
│   │                            and permanently drop the user to Home, `onboarding_complete` never
│   │                            set, no way back in. Fixed via a second sticky auth-metadata flag,
│   │                            `onboarding_started` (App.tsx's `checkOnboarding`), set the first
│   │                            time onboarding is shown and trusted on every later check instead
│   │                            of re-deriving from the people count. Verified live against the
│   │                            onboarding test account: added a parent mid-flow, hard-reloaded,
│   │                            confirmed onboarding still resumed instead of dropping to Home.
│   │                            (2026-07-23) New `guide` stage inserted between Groups and the
│   │                            final handoff — one-paragraph-per-feature explainer (Home/People/
│   │                            Events/Groups), shares dot-index 3 ("Done") with handoff. All
│   │                            prior "jump to handoff" paths (empty group selection, empty group
│   │                            queue, "Skip groups") now land here first instead.
│   ├── Home.tsx               — MAIN SCREEN: persistent chat thread → `converse`.
│   │                            Also: 4 count tiles, Dunbar card, "Recall assists
│   │                            this month" card, top-3 leaderboard + "due for an
│   │                            update" CTA, cached suggestion cards w/ refresh.
│   │                            Chat input bar floats fixed to viewport bottom
│   │                            (same stickyBarWrapper pattern as PersonDetail's
│   │                            fact bar, 2026-07-20). "Connections to make" card
│   │                            (2026-07-25, items 15/50) — right below the
│   │                            leaderboard: a rotating few "Add {person} to
│   │                            {group}?" suggestions from `lib/suggestConnections.ts`
│   │                            (see that entry above), Yes writes person_groups +
│   │                            clears the group's cached summary, No appends to
│   │                            that group's `dismissed_person_ids`. `connectionSuggestions`/
│   │                            `onAcceptConnection`/`onDismissConnection` are optional
│   │                            HomeView props (default empty/no-op) so DemoHome.tsx
│   │                            is unaffected.
│   ├── People.tsx             — list + search, sort dropdown, count; manual "add
│   │                            person" (blank shell, no form, 2026-07-20 — matches
│   │                            the Events/Groups add pattern) → lands on its profile.
│   │                            **Pets share this list** (founder, 2026-08-01: "having a pet in
│   │                            the People list would be funny... an icon to let people see it's
│   │                            not a person"). Purely a DISPLAY merge — the heading count stays
│   │                            people-only, so Dunbar/tiles are untouched, and pets stay their
│   │                            own tables. `ListRow` is a person|pet union; sortRows/filterRows
│   │                            replaced sortPeople/filterPeople. Searching an OWNER's name
│   │                            surfaces their pets. A pet's birthday counts for "Upcoming
│   │                            dates"; "Most notes" always sorts pets last (they have none).
│   │                            The pets query is SEPARATE from the people select — embedding a
│   │                            not-yet-migrated table would fail the whole query and blank the
│   │                            list, not just hide the pets.
│   │                            "Fill in gender for N people →" link (2026-08-11, item 44) →
│   │                            GenderFill.tsx. N comes from its own head-only `count: 'exact'`
│   │                            query (same isolation reasoning as pets above); the link hides
│   │                            when the count is 0 or the query errors.
│   ├── GenderFill.tsx         — (2026-08-11, item 44's auto-fill half) the one-time
│   │                            names→gender pass. Off `guessGenderFromName`: the decidable names
│   │                            split into **"Men" and "Women" columns** (founder ask 2026-08-19 —
│   │                            a mixed list makes you read a dropdown per row, a column headed
│   │                            "Men" asks one question once and is a single tap if the answer is
│   │                            yes), then "Grove can't guess these" (ambiguous or unknown) full
│   │                            width below — and that list is DRAG-AND-DROP (founder ask
│   │                            2026-08-19): two sticky Men/Women buckets, a ⠿ handle per row,
│   │                            `@dnd-kit/core` with the same MouseSensor(distance 4) +
│   │                            TouchSensor(delay 200, tolerance 8) pair as GroupDetail's subgroup
│   │                            drag — the touch DELAY is what leaves a long list scrollable on a
│   │                            phone. Handle, not whole-row: `touch-action: none` is read at
│   │                            touch-start, so on the row it would kill scrolling. Single-item
│   │                            drag, not GroupDetail's select-then-drag-a-batch — unknown names
│   │                            are one-at-a-time judgments, so a select mode would never pay for
│   │                            itself. Dropping outside both buckets is a no-op.
│   │                            A name you set DISAPPEARS from that list (founder ask 2026-08-20) and the
│   │                            heading counts down, so you always face what is still to do rather than
│   │                            scrolling past your own answers. It reappears in a collapsed "Sorted so
│   │                            far (n)" panel below the list, whose dropdown is also the undo — "Leave
│   │                            blank" drops the id out of `choices`, which puts the row straight back.
│   │                            NOT applied to the Men/Women columns: "Accept all" would empty one in a
│   │                            single tap, and seeing what you just accepted so you can fix it is the
│   │                            point of those. Each row is a
│   │                            Male/Female/Non-binary/Other/Leave-blank
│   │                            select matching PersonDetail's — kept on every row deliberately: it
│   │                            is the only way to say non-binary/other, the keyboard path, and the
│   │                            fallback when dragging is awkward. Each column carries its OWN counted
│   │                            "Accept all N" and its own paging, so accepting one never touches
│   │                            the other. CSS grid `auto-fit`, so a phone gets two stacked lists
│   │                            rather than two squeezed half-width ones. The old per-row
│   │                            "— looks like male" tag is gone: it only ever rendered on rows that
│   │                            have a guess, which is now exactly the rows already sitting under a
│   │                            heading that says so. Suggestions are deliberately NOT pre-selected —
│   │                            "Accept all N" is one explicit counted act, which is
│   │                            what lets the lists page at 100 without the founder ever saving
│   │                            rows they were never shown. Nothing writes until Save; Save
│   │                            groups by value and chunks 100 ids per `.in()` so a few hundred
│   │                            people cost a handful of requests, not one each. WHY A REVIEWED
│   │                            WRITE: nameGender.ts refuses to persist a guess because a saved
│   │                            one is indistinguishable from a stated fact — a screen the
│   │                            founder reads and presses Save on is what makes it stated.
│   │                            Selects `gender` in the MAIN people query, unlike everywhere
│   │                            else: this page has no other job, so failing whole and saying so
│   │                            beats degrading silently.
│   ├── PetDetail.tsx          — (2026-08-01) a pet's own page, crumb type `pet`, URL `/pet/:id`.
│   │                            Founder chose this over "tapping a pet opens its owner's
│   │                            profile," so a pet is a record you navigate TO, like a group or
│   │                            event. Species emoji + name heading, breed/species line, dates,
│   │                            Details rows, notes, owner PersonChips ("Belongs to"), and the
│   │                            ONLY pet edit form in the app. Delete here is a real delete
│   │                            (removes it from every profile) and says so — distinct from
│   │                            PetsSection's × , which only unlinks. "Was at these events"
│   │                            EventChips (2026-08-20, `loadEventsForPet`) — hidden entirely
│   │                            when empty, unlike "Belongs to": an owner-less pet is worth
│   │                            explaining, "not tagged to anything yet" isn't, and the tagging
│   │                            happens on the event.
│   ├── PersonDetail.tsx       — "View family tree →" link under the name heading, opens
│   │                            FamilyTree.tsx centered on this person (item 41, any
│   │                            profile, not just self). Key Facts (cached, clickable chips, fixed order),
│   │                            missing-info nudges, notes (edit/delete/source
│   │                            labels), name-edit pencil (first/last name fields,
│   │                            matches Event/Group rename pattern, 2026-07-20 — the
│   │                            fact bar is still how nickname/birthday/anniversary
│   │                            get set), Associated Groups (hover-untag,
│   │                            non-destructive) + search-and-add picker matching
│   │                            EventDetail's Affiliated Groups (2026-07-20),
│   │                            relationship-suggestion banners, last-name
│   │                            nudge, delete/merge profile. All name-display text
│   │                            (nudges, banners, fact bar) now tracks the live
│   │                            `person` state, not the stale navigation-time prop —
│   │                            was silently frozen at whatever name you navigated
│   │                            in with, invisible until a same-visit rename made it
│   │                            obvious (2026-07-20)
│   ├── Groups.tsx             — group tiles (summary, ≤5 member chips — subgroup members
│   │                            rolled up into every ancestor's card as of 2026-08-10, from
│   │                            the one all-groups query already loaded, so search on a
│   │                            member's name now finds the parent too; event chips,
│   │                            type badge); manual "add group" (blank shell, no
│   │                            form, 2026-07-20) → lands on its detail page to
│   │                            rename via the pencil; type filter dropdown
│   │                            (All/No type/Family/Friend group/School/Team/Work,
│   │                            2026-07-20). `search`/`typeFilter` + scroll position
│   │                            are owned by App.tsx, not this component, so a trip
│   │                            into a group and back via the in-page arrow restores
│   │                            both instead of resetting (item 62, 2026-07-26).
│   │                            Creating a group no longer auto-adds the founder as a
│   │                            member (2026-07-26 — see backlog note in §10; same fix
│   │                            in Onboarding.tsx's Stage 4 group creation), and search
│   │                            excludes the founder's own name from member-name
│   │                            matching so searching your own surname only surfaces
│   │                            groups with someone ELSE by that name, or named for it.
│   │                            Nested tree at rest (2026-08-04): subgroups render indented
│   │                            under their parent (was: hidden until searched), via
│   │                            `flattenGroupTree()` — nests rows into a forest and flattens
│   │                            back to a flat list with a `depth`, so each row keeps its own
│   │                            drag hooks. Indent caps at INDENT_MAX_DEPTH=4 (phone width),
│   │                            left rule on anything nested. ▸/▾ collapse per parent.
│   │                            A row whose parent is filtered out promotes to root rather
│   │                            than vanishing; cycles terminate (DB CHECK only blocks
│   │                            self-as-own-parent, so A→B→A is representable).
│   │                            Search/type-filter falls back to the FLAT list with
│   │                            "Parent / Child" labels — filtering leaves holes in a tree.
│   │                            Drag-and-drop nesting (2026-08-03): each card has a ⠿ grip
│   │                            handle (@dnd-kit); drag it onto another card to make that
│   │                            group its parent. Only the handle is a drag source — a
│   │                            whole-card drag would swallow the member/event chip clicks.
│   │                            Live preview replaced the drop-then-confirm banner
│   │                            (2026-08-04, founder: the confirm made you approve something
│   │                            you couldn't see yet) — the row indents under the hovered
│   │                            target mid-drag and releasing keeps it; write is optimistic
│   │                            with a silent reload, reverting on error. Mid-drag-only
│   │                            "Drop here to make it a top-level group" strip un-nests, shown
│   │                            only for a group that has a parent. Hovering a collapsed group
│   │                            opens it for the drag. Cycle-guarded via isSelfOrDescendant
│   │                            (hover over own descendant = no preview, no write, no error).
│   │                            Summaries now auto-generate for subgroups too, since they're
│   │                            visible at rest — still one `summarize-group` call per group
│   │                            EVER (cached in groups.summary), pulling forward the call
│   │                            GroupDetail would have made lazily rather than adding spend.
│   │                            readOnly (landing demo) returns the list with no DndContext.
│   ├── GroupDetail.tsx        — "Generate this family's tree →" button on Family-typed
│   │                            groups (item 41), passes explicit member ids straight through
│   │                            to FamilyTree.tsx (`memberIds` prop) which calls
│   │                            `buildDescendantTree()` (familyTree.ts) — scoped to that
│   │                            group's own lineage, not any one member's ego graph.
│   │                            `pickFamilyTreeRoot()` removed 2026-07-21 (superseded by this).
│   │                            group type picker (nullable, options come from the
│   │                            user's editable list — see ManageGroupTypes.tsx,
│   │                            writes on change, 2026-07-20), summary + refresh (rename now invalidates the cached
│   │                            summary too, not just membership changes — a manually-
│   │                            created group's summary can otherwise stay generated
│   │                            against the "New group" placeholder forever), members
│   │                            (explicit only, sorted, collapsible >12, hover-remove),
│   │                            manual member add (2026-08-03): SearchAddPicker, same
│   │                            component/shape as EventDetail.tsx's "who was there" —
│   │                            type to filter people already on file, or create a new
│   │                            person inline (`handleCreateAndAddMember`, first word
│   │                            → name / rest → last_name, matching every other
│   │                            create-a-person path); renders regardless of whether
│   │                            the group has members yet. Followed by an UndoBanner
│   │                            (`handleUndoAdd`) — always deletes the person_groups
│   │                            row, ALSO deletes the person when the add created them
│   │                            (`createdPerson` flag), else a mistyped name strands a
│   │                            stray profile on the People page; cleared on groupId
│   │                            change since it deletes against the current group,
│   │                            suggestions (from events + associated groups, capped
│   │                            20, add/deny all), per-group "Suggest new members for
│   │                            this group" checkbox (item 57, 2026-07-25) — always
│   │                            visible (not gated on there being any current
│   │                            suggestions, so it stays reachable to turn back on),
│   │                            off hides this group's own suggestion chips AND drops
│   │                            it from Home's "Connections to make" card
│   │                            (`suggestions_enabled` column, read by
│   │                            `lib/suggestConnections.ts` too). Second suggestion
│   │                            box, "Family of a current member?" (item 63,
│   │                            2026-07-26): same `suggestFamilyMembers` chaining as
│   │                            EventDetail.tsx's own family box, seeded from this
│   │                            group's explicit members instead of event attendees —
│   │                            spouse of a member suggested, then that couple's kids
│   │                            once the spouse is also a member; shares the existing
│   │                            add/deny handlers (same person_groups/
│   │                            dismissed_person_ids writes) and the same
│   │                            suggestionsEnabled gate as the box above it, Associated Groups
│   │                            (confirmed + suggested + manual picker) unaffected —
│   │                            different signal, not in scope, notes section, edit
│   │                            chat, delete/merge group (item added 2026-07-26,
│   │                            same process/design as EventDetail.tsx's own merge:
│   │                            search-and-pick survivor, confirm, the group you're
│   │                            standing on folds away — moves membership,
│   │                            event tags, associated groups, and notes/
│   │                            source_group_id attribution over, self-links dropped).
│   │                            Subgroups section renders at EVERY depth as of 2026-08-03
│   │                            (was gated on !parentGroup, capping the tree at one level).
│   │                            Same 2026-08-03 pass added reparenting to the danger zone:
│   │                            "Move this under another group…" and "Move to top level"
│   │                            beside the merge button, plus a "Make it a subgroup
│   │                            instead" branch on the merge confirm step — all three
│   │                            replace the old workaround (create a blank subgroup in the
│   │                            target, then merge the real group away into it), which
│   │                            destroyed a group to express a one-column change. Nesting
│   │                            moves NOTHING: members/notes/events/associations stay put,
│   │                            the group just gains a parent, and it's reversible. One
│   │                            shared search picker drives both outcomes (`mergeMode`);
│   │                            nest targets exclude this group's own descendants
│   │                            (isSelfOrDescendant) so a drop can't orphan a branch
│   │                            (both 2026-08-03). Separate drag-and-drop, same day: on a
│   │                            root group's own page, "Select multiple" turns member chips
│   │                            into checkboxes (tap to toggle); drag the selection onto a
│   │                            subgroup tile below to mass-add them to THAT subgroup only —
│   │                            parent membership untouched (same independent-membership
│   │                            design as above). MouseSensor + TouchSensor (not the unified
│   │                            PointerSensor) so touch gets its own delay/tolerance and an
│   │                            ordinary scroll swipe isn't captured as a drag. Write path is
│   │                            a fresh handler (`handleDropAddToSubgroup`), not a reuse of
│   │                            handleApproveAllSuggestions — that one's refresh/invalidate
│   │                            calls are hardcoded to the page's OWN groupId, wrong target
│   │                            here since the drop target is always a subgroup, never the
│   │                            group being viewed. Subgroup colour coding (2026-08-04):
│   │                            each subgroup tile gets a colour (3px left rule + dot) and
│   │                            every parent-level member chip repeats it as a dot, so the
│   │                            tile grid is the legend for the member list — no dot means
│   │                            nobody's sorted that person yet. Colours are AUTO-assigned
│   │                            by position from `theme.ts`'s `subgroupPalette` via
│   │                            `lib/subgroupColors.ts`; nothing is persisted, no DB column
│   │                            (a tap-to-recolour picker is item 82). Derived from the
│   │                            subgroup rosters the page ALREADY loads for the tile member
│   │                            counts — no extra query, no AI call. Paired "Not in a
│   │                            subgroup (N)" filter pill above the member list (house
│   │                            filter-chip style, Events.tsx's date chips); local state,
│   │                            ANDs with the member search, hidden when there are no
│   │                            subgroups or nobody's unassigned (but stays visible while
│   │                            ON). Only DIRECT children count, matching what the tiles
│   │                            show; a person can carry several dots (capped at 3, then
│   │                            "+N") since subgroup memberships are independent. Chip
│   │                            title/aria-label names the subgroups so colour isn't the
│   │                            only carrier.
│   │                            Subgroup member rollup (2026-08-10, founder ask): "Who was
│   │                            there (N)" is the explicit roster PLUS everyone in a
│   │                            subgroup at any depth (lib/groupRollup.ts), loaded by one
│   │                            flat person_groups query over descendantIds (fail-open, PAGED —
│   │                            PostgREST silently caps at 1000 rows and the account was already
│   │                            at 1183 person_groups rows) and refetched when a drag-drop
│   │                            writes into a subgroup. Rolled-up
│   │                            chips get NO trash badge (their row lives on the subgroup —
│   │                            tooltip says so), never count as "Not in a subgroup", and
│   │                            are excluded from every suggestion box so nobody is offered
│   │                            as a member they already are. Hint line appears only when
│   │                            something actually rolled up. explicitMembers state stays
│   │                            the narrow write-target; `members` is the merged read.
│   ├── Events.tsx             — all moments, sorted by event_date (fallback
│   │                            created_at), full date incl. day (e.g. "August 3,
│   │                            2026") via formatEventWhen (2026-08-03), grouped under
│   │                            sticky year headers (2026, 2025, ...; float at
│   │                            top of viewport until next year's section
│   │                            arrives, 2026-07-21); manual "add event"
│   │                            (blank shell, no form) → lands on its detail page;
│   │                            tag filter dropdown (item 28/34, 2026-07-22) — a
│   │                            growing picklist computed from distinct tags
│   │                            actually applied (`useMemo`, not a hardcoded list
│   │                            like `GROUP_TYPES`), membership filter (`tags.
│   │                            includes(tagFilter)`) since tags are multi-valued,
│   │                            plus a "No tags yet" option. "Manage tags →" link
│   │                            (item 28 follow-up, 2026-07-22) under the heading,
│   │                            always visible (not gated on any tag being applied
│   │                            yet) → `ManageTags.tsx`. Creating a new event now
│   │                            auto-tags the founder under "Who was there" (2026-07-26,
│   │                            same notes-row shape as EventDetail.tsx's manual
│   │                            add-attendee) — the flip side of removing group
│   │                            auto-add above; calendar-imported events and chat-
│   │                            logged moments are NOT covered by this yet (§10).
│   │                            Sub-events (item 35, 2026-07-30) are pulled out of
│   │                            their own flat slot and bundled under their parent's
│   │                            card instead, per founder-approved mockup: a
│   │                            "N sub-events ▸/▾" toggle, collapsed by default,
│   │                            expands to indented child cards. Migrated and
│   │                            verified live 2026-07-30. Multi-criteria filter
│   │                            panel (2026-08-03): the old inline tag `<select>`
│   │                            replaced by a "Filters" button opening
│   │                            `FilterPanel.tsx` (new generic bottom-sheet
│   │                            component, reusable elsewhere) covering tag, date
│   │                            range (presets + custom), attendee, group, and
│   │                            location — all AND'd together, options are
│   │                            distinct-in-use lists (same non-hardcoded pattern
│   │                            as tags), active filters shown as removable
│   │                            summary chips below search. Filter state lifted to
│   │                            App.tsx (`eventsFilters`, same pattern as Groups'
│   │                            search/typeFilter) so it survives navigating into
│   │                            an event and back.
│   ├── Calendar.tsx           — (2026-07-24, item 48 phase 1) new nav tab. Upcoming
│   │                            list (all future moments + reminder next-occurrences,
│   │                            soonest first; container caps at 6 visible rows with
│   │                            internal scroll for the rest, 2026-07-26) + a real
│   │                            month grid below (prev/
│   │                            next nav, today highlighted, each day showing an
│   │                            actual tile with a truncated event title, not just
│   │                            a dot — "+N more" when a day has multiple). Reads
│   │                            existing `moments`/`reminders`, no new tables. Tag
│   │                            filter chips (same distinct-tags-in-use pattern as
│   │                            Events.tsx) narrow the moment tiles/list; reminders
│   │                            always show (no tag concept for them); chips sit
│   │                            directly above the month grid (not above Upcoming) so
│   │                            the thing they filter is adjacent. Month nav has a
│   │                            "Today" button next to the next-month arrow. Tile click →
│   │                            EventDetail; reminder click → PersonDetail. Phase 1
│   │                            of a larger gameplanned feature (calendar-source
│   │                            connection via pasted secret iCal URLs, AI import/
│   │                            suggestion pipeline, review UI, Home tie-in) — see
│   │                            plan file `i-want-to-gameplan-cuddly-wilkinson.md`
│   │                            (not checked into the repo) for the full design;
│   │                            those phases are NOT built yet. `nextOccurrenceDate`/
│   │                            `daysUntilNextOccurrence` moved from People.tsx into
│   │                            `lib/dates.ts` so both pages share one implementation.
│   │                            (2026-08-06, item 83) `CountdownsSection` renders LAST, below the
│   │                            month grid; people select gained `deceased_date`/`reminders.year`.
│   │                            Future countdowns are only ones the founder adds/pins — Upcoming
│   │                            sits right below and already lists everything coming up.
│   ├── EventDetail.tsx        — AI summary (gated: only auto-generates once
│   │                            raw_description has content; manual "Refresh
│   │                            summary" button, 2026-07-25, mirrors GroupDetail's
│   │                            own `RefreshButton` — lets an already-cached
│   │                            summary re-synthesize on demand, e.g. after the
│   │                            2026-07-25 chronological-ordering prompt fix),
│   │                            editable description,
│   │                            who-was-there (hover-untag, non-destructive; **pets share this
│   │                            chip row as of 2026-08-20** — `PetAttendeeChip`, species emoji in
│   │                            front so a pet never reads as a person, tap opens the pet's page,
│   │                            same hover-untag, and the same sub-event roll-up rule with the
│   │                            same "untag them there" tooltip. Added from the SAME picker as
│   │                            people as of 2026-08-21 — "Add who was there", ids namespaced
│   │                            person:/pet:; no create-a-pet path in there on purpose, since a
│   │                            pet needs an owner and owners are picked on a profile) +
│   │                            search-and-add picker (2026-08-07: also creates a
│   │                            person who isn't on file yet — `+ Add "<name>" as a
│   │                            new person` row, `handleCreateAndAddAttendee`, same
│   │                            first-word/rest name split and inline-create pattern
│   │                            as GroupDetail's member picker), suggested attendees from
│   │                            group rosters AND family (2026-07-25 — "Was their
│   │                            family there too?": spouse/partner suggested once
│   │                            one of a couple is attending, their kids suggested
│   │                            too once the spouse/partner is ALSO attending;
│   │                            `lib/relationshipSuggestions.ts`'s pure
│   │                            `suggestFamilyMembers`, fed by a `relationships`
│   │                            query scoped to this event's current attendees —
│   │                            same dismissed_person_ids + add/deny-all UI as the
│   │                            group-roster suggestions; mirrored on
│   │                            ImportReview.tsx below, see its entry. 2026-07-26
│   │                            (item 63, founder feedback): self is always seeded
│   │                            into the attendee set fed to `suggestFamilyMembers`,
│   │                            even when self isn't tagged as attending — so self's
│   │                            spouse is suggested on every event from the start,
│   │                            not just once self has been manually added), Affiliated
│   │                            Groups (hover-untag,
│   │                            non-destructive) + search-and-add picker,
│   │                            collapsed notes, maps link (+", CO"
│   │                            hardcoded), rename, delete/merge, update chat;
│   │                            Tags section (item 28, 2026-07-22) — manual tag/
│   │                            untag via `SearchAddPicker`'s new `onCreateNew`
│   │                            prop (type a name, get an inline "+ Add ... as a
│   │                            new tag" affordance when it doesn't already exist,
│   │                            case-insensitive reuse when it does), local
│   │                            `TagChip` (hover-reveal-remove, non-destructive —
│   │                            same pattern as `AffiliatedGroupChip`). Backed by
│   │                            new `tags`/`moment_tags` tables (§6). Follow-up
│   │                            same day: picker uses `browseAll` (shows the full
│   │                            tag list, alphabetically, the moment you focus the
│   │                            box — no need to already know/remember what's on
│   │                            file) and both the picker's item list and the
│   │                            currently-applied tag chips are explicitly
│   │                            `.sort((a,b)=>a.name.localeCompare(b.name))`'d at
│   │                            render time (not relied on from fetch/insert
│   │                            order) so alphabetical holds regardless of when a
│   │                            tag was created. The date shown at the top now goes
│   │                            through `formatFullDate()` (2026-07-24, bug fix —
│   │                            see §10/§12) instead of bare `new Date(event_date)`,
│   │                            which parsed as UTC midnight and could display a day
│   │                            off depending on the viewer's own time zone.
│   │                            Sub-events (item 35, 2026-07-30): self-referencing
│   │                            `parent_moment_id`, one level deep, mirrors
│   │                            GroupDetail's subgroups pattern — "Sub-events"
│   │                            section + "+ New Sub-event" button (inherits parent's
│   │                            event_date) on root events; "↑ Part of X" link on
│   │                            children; merge reparents a duplicate's sub-events
│   │                            onto the survivor; delete-confirmation copy warns
│   │                            children become independent top-level events.
│   │                            Migrated and verified live 2026-07-30. Sub-event
│   │                            attendees roll up into the parent's "Who was there"
│   │                            (2026-08-07) — derived at render time, never written
│   │                            back; rolled-up chips have no hover-untag badge (untag
│   │                            on the sub-event itself) and carry a title tooltip
│   │                            saying so. Same rollup on the Events list card, via
│   │                            `decorateMoments(moments, childrenByParentId)`.
│   │                            "Associated Events" tiles read chronologically
│   │                            left-to-right via `sortSubEventsByDate()`
│   │                            (`src/lib/subEvents.ts`, 2026-08-08): event_date, then
│   │                            event_end_date, then created_at as last resort; undated
│   │                            sub-events sort last and show "Date not set" rather than
│   │                            formatFullDate's created_at fallback. "+ New Sub-event"
│   │                            now confirms the date before creating (inline date field
│   │                            prefilled with the parent's start date, range shown in
│   │                            the hint when the parent has one) — the inherited default
│   │                            stayed (founder call), but silently inheriting it is what
│   │                            put whole trips' sub-events on day one and left them
│   │                            tie-breaking by creation order. Pre-2026-08-08 sub-events
│   │                            still carry the inherited date until edited by hand.
│   │                            Nesting is editable both ways from the Manage panel
│   │                            (2026-08-18): "Move this under another event…" reuses
│   │                            the merge picker in 'nest' mode (mergeMode state, same
│   │                            shape as GroupDetail) and "Separate this from X" sets
│   │                            parent_moment_id back to null. Neither moves any data —
│   │                            notes, photos, attendees, groups and tags stay put — and
│   │                            each undoes the other. Both null the affected parents'
│   │                            cached summaries (a re-parent nulls old AND new), since a
│   │                            parent's summary is a per-sub-event roll-up; lazy, so it
│   │                            rebuilds on next view. Cached weather needs no
│   │                            invalidation — the span changes, coversWindow() sees the
│   │                            stored range no longer matches and refetches itself.
│   │                            Nest targets are top-level events only (nestableEvents
│   │                            filters on momentParentById), and an event that HAS
│   │                            sub-events shows a line saying it can't sit under another
│   │                            event instead of the button — both rules keep the tree one
│   │                            level deep, which is what the whole UI assumes.
│   │                            "Associate an event" in the action bubble (2026-08-26):
│   │                            pick an existing event, then choose the direction in words
│   │                            with both titles spelled out — `"X" is part of this event`
│   │                            (pulls X in as a sub-event; the only way to do that from
│   │                            the PARENT's page), `This event is part of "X"` (same
│   │                            write as the Manage panel's nest), or `They're related`
│   │                            (a `moment_links` row, §6). A direction that isn't legal
│   │                            stays visible as a muted line giving the reason (target
│   │                            has sub-events, target is itself a sub-event, this event
│   │                            has sub-events, already connected). Related events get
│   │                            their own "Related Events" section — a third name on
│   │                            purpose, distinct from "Sub Events" here and "Associated
│   │                            Events" on Group/Person — with hover-unlink tiles; it
│   │                            renders on sub-event pages too, and hides itself
│   │                            entirely if moment_links is missing.
│   │                            Summary regeneration (2026-08-08): the gate is
│   │                            `hasSomethingToSummarize()` (lib/moments.ts), not
│   │                            `raw_description.trim()` — a manually-created event has a
│   │                            permanently-empty raw_description, so it could gain any
│   │                            number of notes and stay stuck on "Nothing written yet"
│   │                            forever even though summarize-moment reads notes fine.
│   │                            Sub-event roll-up into the parent's description
│   │                            (2026-08-10): summarize-moment reads its children's
│   │                            SUMMARIES (never their notes — cost) and a parent with
│   │                            sub-events gets a different output shape: 1-2 sentence
│   │                            overview, blank line, then one `Aug 6 · Title — sentence`
│   │                            line per sub-event in date order. Events with no
│   │                            sub-events are unchanged (flowing narrative). The gate
│   │                            takes childEvents as a 2nd arg, so a container parent with
│   │                            nothing of its own still summarizes; the trigger moved from
│   │                            loadMoment into an effect keyed on [moment, childEvents]
│   │                            because those two load in parallel. Summarizing a
│   │                            sub-event nulls its parent's cached summary (done in the
│   │                            Edge Function, so every path is covered); the parent
│   │                            rebuilds lazily on next view. `styles.description` is
│   │                            pre-wrap so the lines survive. max_tokens 900 → 2000:
│   │                            a 6-sub-event parent measured stop_reason "max_tokens" and
│   │                            silently lost its last four days mid-sentence.
│   │                            `generateSummary` is single-flight w/ one trailing rerun:
│   │                            each note fires 2-4 onSaved calls, so this was 2-4 paid
│   │                            calls whose writes could land out of order and overwrite a
│   │                            newer summary with a staler one. `handleNoteSaved` fires
│   │                            `onRenamed` when the occasion changed, so the breadcrumb
│   │                            follows an AI auto-title the way it does a manual rename.
│   │                            Manual date/location edit fields + manual
│   │                            "Add a note" box (2026-07-30, founder feedback:
│   │                            event chat was slow/inaccurate and there was no
│   │                            non-chat fallback) — date/location previously had
│   │                            NO manual input anywhere, only ever set by chat;
│   │                            note box mirrors GroupDetail's own (plain
│   │                            textarea, direct `notes` insert, `person_id:
│   │                            null`, no AI). Verified live in browser preview.
│   │                            Note edit/delete (2026-08-03, founder
│   │                            feedback: AI-fabricated note text had no fix
│   │                            short of deleting the event) — same hover
│   │                            pencil/trash pattern as PersonDetail/
│   │                            GroupDetail's note cards. A displayed card
│   │                            can represent more than one underlying
│   │                            `notes` row (everyone tagged together with
│   │                            identical text, e.g. a bulk "Was there.") —
│   │                            edit/delete act on every row in the group at
│   │                            once, and both clear the cached summary so
│   │                            it regenerates without the old text.
│   │                            Verified live (single note + a 2-person
│   │                            grouped note).
│   │                            "Were they at this one too?" (2026-08-10, item 87) — on a
│   │                            SUB-event only, suggests everyone tagged on the parent
│   │                            event and its other sub-events, ranked by how many of them
│   │                            each person turns up in (`src/lib/siblingAttendees.ts`).
│   │                            Sits above the group/family suggestion boxes and its ids
│   │                            are excluded from both, so nobody is suggested twice.
│   │                            `loadSiblingEvents` is a separate fail-open query, same
│   │                            reasoning as loadParentEvent.
│   │                            (2026-08-17) Clicking a suggestion no longer moves the page,
│   │                            in all three boxes. Two causes, both fixed. (a) The chip used
│   │                            to leave the grid, reflowing every chip after it — it now
│   │                            HOLDS its slot and flips to a ticked, filled chip
│   │                            (`suggestChipAdded`, box-model identical to `suggestChip`;
│   │                            the +/✓ sits in a fixed-width `chipGlyph` span so the chip
│   │                            can't resize). `pinnedChips` records {person, box, index} on
│   │                            click and `withPinnedChips` splices them back into the live
│   │                            list at that index, ascending; it's purely positional, so
│   │                            "added" stays derived from `attendees` and clicking a ticked
│   │                            chip untags them and flips it back to "+" without moving.
│   │                            Pins reset on `moment.id`. (b) Every add nulled the cached
│   │                            summary, collapsing that block to its one-line "Putting this
│   │                            memory into words…" placeholder — a ~100px jump per click,
│   │                            plus one AI regeneration per name (CLAUDE.md rule 3).
│   │                            `handleAttendeeChanged` now reloads the roster immediately
│   │                            but debounces the invalidation by `SUMMARY_SETTLE_MS` (4s),
│   │                            so a run of clicks costs one regeneration and the summary
│   │                            keeps its height throughout. Measured: 5 clicks = 5
│   │                            regenerations before, 1 after; 0px of chip movement across
│   │                            all 37 chips. A scroll-anchor approach was tried first and
│   │                            removed — it chased the summary collapse and double-applied
│   │                            the correction, making the jump worse.
│   ├── DunbarDetail.tsx       — Dunbar's-number explainer + tier progress bars
│   ├── DueForUpdate.tsx       — people sorted oldest/no note first
│   ├── ManageLocations.tsx    — (item 66, 2026-08-12) reached via "Manage locations →"
│   │                            on Events.tsx beside "Manage tags →" (App.tsx
│   │                            `manageLocations` crumb, same singleton pattern as
│   │                            ManageTags). Every distinct `moments.location` with its
│   │                            event count; editing one rewrites it on every event at
│   │                            once (one `.update().in('location', […])`), so typing an
│   │                            existing value IS the merge and clearing the box drops the
│   │                            location without touching the events. A "Look like the
│   │                            same place" section lists lib/locationGroups.ts's clusters
│   │                            with radios for the winning spelling PLUS free text — the
│   │                            right spelling is often none of the ones actually typed.
│   │                            Reads paged (a location past row 1000 would look absent,
│   │                            which here means a merge that silently skipped events).
│   ├── Notebooks.tsx          — (2026-08-18) the 6th nav tab; the internal side (§1).
│   │                            Card per notebook (name + entry count, "Private" pill
│   │                            when ai_visible is off). Create is one named field, not a
│   │                            blank shell — the name IS the act of creating one — then
│   │                            navigates straight in. Exports `NotebooksView` for a
│   │                            future demo screen. SearchBox only past 8 notebooks.
│   │                            Renders "aren't switched on for this account yet" when
│   │                            lib/notebooks.ts's isMissingTable matches (§10 pattern).
│   ├── NotebookDetail.tsx     — (2026-08-18) one notebook. Composer =
│   │                            AutoGrowTextarea + VoiceInputButton (Save held shut
│   │                            while the mic is busy, so a dictation tail isn't lost).
│   │                            Entries newest-first, date shown only when set; tap Edit
│   │                            for text/date/people/delete. People attach via
│   │                            SearchAddPicker — an explicit picker, NOT
│   │                            NoteWithDetection, which costs an API call per note.
│   │                            The date field pre-fills to today only if the notebook
│   │                            already has a dated entry (a log keeps its dates, a list
│   │                            doesn't grow them). ManagePanel holds rename, the
│   │                            "Let Grove read this" switch, and delete.
│   ├── ManageTags.tsx         — (item 28 follow-up, 2026-07-22) reached via "Manage
│   │                            tags →" link on Events.tsx AND Settings → Your
│   │                            lists (2026-08-04) (App.tsx `manageTags`
│   │                            crumb, same simple link-launched-detail-page
│   │                            pattern as DunbarDetail/DueForUpdate above). Full
│   │                            alphabetical list of every tag with a live usage
│   │                            count (`moment_tags` embed, counted client-side);
│   │                            add (duplicate-name guarded), inline rename
│   │                            (updates everywhere instantly — tags have no
│   │                            denormalized copies elsewhere), delete with a
│   │                            confirm banner that states how many events it'll
│   │                            be removed from (cascades via the `moment_tags`
│   │                            FK, no extra cleanup code needed)
│   ├── ManageGroupTypes.tsx   — (2026-08-04) same page shape as ManageTags, for group
│   │                            types; reached via Settings → Your lists (App.tsx
│   │                            `manageGroupTypes` crumb). Group types became a
│   │                            user-editable list that day (was a fixed 5-option
│   │                            enum); `lib/groupTypes.ts` now exports
│   │                            `DEFAULT_GROUP_TYPES` (the starting template, and the
│   │                            fallback for the demo + any account whose migration
│   │                            hasn't run) plus `loadGroupTypeNames()`, used by
│   │                            Groups.tsx's filter and GroupDetail.tsx's picker.
│   │                            `groups.group_type` stays plain text holding the NAME,
│   │                            not an FK — so a rename here rewrites every matching
│   │                            group in the same step (groups first, then the type
│   │                            row), and a delete leaves those groups untyped. Both
│   │                            pickers union in any type a group still carries but
│   │                            that's off the list, so nothing goes unfilterable.
│   │                            Seeds the 5 defaults lazily on first visit if the
│   │                            account has none. Migration:
│   │                            `migrations_manual/2026-08-04-editable-group-types.sql`
│   │                            (drops the old CHECK constraint, adds the `group_types`
│   │                            table + RLS, seeds every existing account) — applied
│   │                            2026-08-04, verified live.
│   ├── Circle.tsx              — "My page" (item 32, REAL as of 2026-07-20, replaced
│   │                             CircleMock.tsx): self header (name, birthday/
│   │                             anniversary, "Edit your profile →" into PersonDetail),
│   │                             "Your circle" grid (spouse/kids/parents/siblings) read
│   │                             from the `relationships` table, "+" per box writes
│   │                             through writeRelationship.ts. "Your groups" lists the
│   │                             self person's groups; a Family-typed one shows
│   │                             "Tree →" into FamilyTree.tsx centered on the self
│   │                             person (one of several entry points now — see item 41
│   │                             for PersonDetail.tsx/GroupDetail.tsx's own links).
│   │                             No self profile yet → onboarding: search
│   │                             existing people to flag `is_self`, or create a blank
│   │                             one (lands on its PersonDetail to name it). Removed
│   │                             from the top nav (2026-08-03, founder wasn't using it,
│   │                             will revisit on redesign) — route/component still
│   │                             exist, just unreachable from the main menu
│   ├── FamilyTree.tsx          — real family tree (item 32/15, REPLACED
│                                 FamilyTreeMock.tsx 2026-07-20). Layout engine rewritten
│                                 2026-07-21/22 (item 37): root-gen ("You") is the only tier
│                                 still laid out naturally/independently; every other tier
│                                 derives its position from an adjacent, already-placed tier
│                                 via `resolveTierPositions` — Parents/Grandparents center
│                                 each union on the midpoint of its own children's span one
│                                 tier below (`layoutRelativeToChildren`), Kids centers each
│                                 unit on its own parentId's position in the tier above
│                                 (`layoutRelativeToParent`, reusing `anchorX`'s "midpoint of
│                                 a union's members" logic). A unit with nothing to anchor to
│                                 (e.g. a childless aunt/uncle) falls back to sitting next to
│                                 its nearest resolved neighbor; a collision pass then pushes
│                                 overlapping units apart symmetrically to a minimum
│                                 clearance. One global bounding-box pass at the end picks a
│                                 single shift + canvas width to fit everything, replacing the
│                                 old "each tier independently guesses the canvas center"
│                                 scheme that could clip wide trees off-screen. Underlying
│                                 data model unchanged (branches: `{union:{a,b?}, siblings}`,
│                                 each PERSON carries their own `parentId` so a couple's
│                                 two partners can trace to two different branches above
│                                 — paternal vs maternal grandparents both shown), now
│                                 fed by buildFamilyTree() (src/lib/familyTree.ts)
│                                 walking the real `relationships` table instead of
│                                 hand-authored fixtures. Works for ANY person_id —
│                                 clicking any name re-centers the whole tree on them via
│                                 a fresh query (a family tree is a person's own
│                                 relationship graph, not bounded by which group you
│                                 opened it from), verified live with disposable test
│                                 people (deleted after). Tapping a tile opens a
│                                 `ChoiceSheet` (2026-08-04) offering "Open <name>'s
│                                 profile" or "Center the tree on <name>" rather than
│                                 re-centering immediately — the tree previously had no
│                                 route to a profile. The ego-mode root is tappable too
│                                 (profile only; re-centering on itself is a no-op) and
│                                 keeps its chevron-less look. A ~10px pointer-movement
│                                 guard on each tile keeps a pan drag from firing the tap.
│                                 The canvas lives in `components/PanZoomSvg.tsx`
│                                 (2026-08-05): drag to pan in any direction, pinch/wheel/
│                                 +−  to zoom, "Fit" to re-frame — replaced the old
│                                 overflow-x scroll div. Also hosts ClarifyGenderPrompt
│                                 (2026-08-05) under the canvas, one question at a time,
│                                 and passes `onSetGender` down to RelationshipCompare.
│                                 `onSelectPerson`
│                                 is optional — Onboarding has no profile view, so the
│                                 sheet omits that action there. Grandparents tier also pulls in
│                                 parents' siblings (aunts/uncles, riding in the same
│                                 branch) and their kids (cousins, shown as extended in
│                                 the root's own tier). Kids tier and cousins' kids both pair in-law
│                                 spouses via inLawSpouses() (fixed 2026-07-21 — previously
│                                 hardcoded spouses: [], unlike Parents/Grandparents/root-gen
│                                 tiers). "+" writes a real relationship
│                                 fact (relationships table row + both-sides reciprocal
│                                 note) and reloads the tree from the server. Known gap
│                                 carried over from the mock: "+" always targets a
│                                 tier's first branch — no UI yet to pick which branch
│                                 when a tier has more than one. Tier count is data-driven, not
│                                 fixed (2026-07-21, item 42): every tier carries a signed `depth`
│                                 (0 = root-gen/family's eldest gen, negative = ancestors, positive
│                                 = descendants); buildFamilyTree() walks parentsOf/childrenOf
│                                 outward from the old fixed Grandparents/Parents/Kids window as
│                                 far as the data goes (Great-Grandparents, Great-Great-
│                                 Grandparents, ... and Grandchildren, Great-Grandchildren, ...),
│                                 capped at 25 generations each direction as a cycle guard only.
│                                 buildDescendantTree() (used by GroupDetail's "Generate this
│                                 family's tree", `mode: 'descendants'`) got the same treatment —
│                                 its old fixed 5-label array is gone. FamilyTree.tsx's layout
│                                 chains any number of tiers off `depth` (no more mode-specific
│                                 branching in the layout code). Verified live: Harvey/Roberta
│                                 Volin's tree now shows their great-grandchild Wesley Gregorian
│                                 in a "Great-Grandchildren" section. Founder-selection fixed
│                                 2026-07-21 (item 41 follow-up): "furthest back" is NOT "fewest
│                                 recorded ancestors" — an in-law with no separately-recorded
│                                 ancestry (a fiancé(e), a spouse) trivially looks like the oldest
│                                 gen too. Now a greedy set-cover picks whichever member's own
│                                 descendant set (blood descendants + their spouses, so an in-law
│                                 doesn't ALSO get picked as their own spurious founder) explains
│                                 the most of the group, repeating for any leftover members —
│                                 then climbs every founder with a recorded parent up to their
│                                 topmost known ancestor (2026-08-03 fix: previously only climbed
│                                 when 2+ founders shared a parent, so a single founder with a solo
│                                 parent/grandparent on file — e.g. The Ruskaups group, just Lisa &
│                                 Ed — stayed capped at Lisa instead of reaching Marilee/Villis
│                                 Berzins). Verified live: The Berzins' group
│                                 (13 members, none of them Villis/Marilee Berzins) now correctly
│                                 unifies under Villis & Marilee as the root couple, with Mark
│                                 Berzins's and Lisa Ruskaup's full lines underneath — the old
│                                 logic had picked unrelated in-laws (Jeremy Crigler, Bridget
│                                 Dugan, Faye Higgins) as "founders" instead and dropped Mark's
│                                 entire branch. Color coding overhauled 2026-07-21 (item 43):
│                                 purple now means "the person this tree is centered on" (any
│                                 root, not just the app's own `is_self` person — every ego-mode
│                                 tree is root-focused by construction, so no flag needed);
│                                 buildDescendantTree()'s group meta-tree never assigns purple at
│                                 all (single green color throughout — no gender data exists to
│                                 support true maternal/paternal, and there's no single root to
│                                 focus on anyway). Extended family (grandparents, aunts/uncles,
│                                 cousins, and their own further ancestors/descendants) is now
│                                 tinted by which of the root's two parents they trace back
│                                 through — labeled by that parent's actual name in the legend
│                                 (e.g. "Sarah's side"), not "maternal/paternal" (no gender field
│                                 to support that). Connector and marriage lines are tinted to
│                                 match. `TreePerson` gained an optional `side: 'a'|'b'` carried
│                                 through every tier-building loop, including the item-42
│                                 arbitrary-depth ancestor/descendant extensions. Verified live
│                                 against Jake Volin's and Mark Berzins's real trees. Layout fix
│                                 2026-07-22 (founder click-through bugs): the whole-tree shift used
│                                 to always pin the leftmost node to x=40 rather than center it,
│                                 so any tree narrower than the fixed 680px canvas (the common case
│                                 for a new/small tree, e.g. during onboarding) sat jammed against
│                                 the left edge — now centers within the canvas whenever content
│                                 fits, falling back to the old left-pinned/scrollable behavior only
│                                 for trees wider than the canvas. Also removed the gray tier-label
│                                 text ("Parents"/"Kids"/"Grandparents"/etc., drawn at a fixed x=40)
│                                 entirely, per founder ask — it was also what a newly-added node
│                                 visually covered, same root cause as the left-pin bug. Verified
│                                 live: added a parent during onboarding, confirmed centered layout
│                                 and no covered/overlapping text. Suggestion feature 2026-07-22
│                                 (founder-reported): adding a person as a second "Parent"/
│                                 "Grandparent" (any `category: 'parents'` add) used to leave them
│                                 unlinked to the child's other already-known parent — no marriage
│                                 line, since nothing ever recorded them as a couple. `addRelationship`
│                                 now checks (`getRelationshipsForPerson`, relationshipsTable.ts) for
│                                 any other parent of the same child not yet linked as spouse/partner
│                                 to the new one, and offers a "suggest, don't assert" banner ("Are X
│                                 and Y married or partners?") — accept writes a real spouse
│                                 relationship (`linkRelationship`), decline writes nothing. Verified
│                                 live with disposable test people (deleted after, incl. one stray
│                                 note left on Jake Volin's own profile from a temporary test-child
│                                 link): suggestion appeared correctly, decline left no trace, accept
│                                 produced a real marriage line on reload. Page container widened
2026-07-22 (founder-reported): styles.page maxWidth 600px to 1200px
(other pages' 600px reading width is deliberate and unchanged) so the
SVG tree canvas isn't squeezed into a narrow column on desktop; svg
style also centers via margin 0 auto when the tree is narrower than
the container. Death/divorce/remarriage (2026-07-24, founder ask — see PROJECT_HISTORY.md):
deceased person renders muted grey + "†", any union with a deceased or divorced party renders
its marriage line dashed (`isUnionEnded` in familyTree.ts) — no structural change, since a
person having multiple spouses (remarriage) already rendered fine. PersonDetail.tsx's "Mark as
deceased"/"Undo" control lives inside the name-edit form (pencil icon) only, not as a persistent
row on every profile (founder feedback 2026-07-24 — a permanent prompt read as a downer).
FamilyTree.tsx "Mark a marriage as ended" (divorce only — death is
read off the person's own deceased_date, not a separate flag). **UX fix 2026-07-25** (founder-flagged:
looked like an already-divorced status you'd undo via trash icon, backwards from the actual effect):
the divorce control is now a plain text link ("Mark X's marriage to Y as ended"), not the same
hover-trash chip used for destructive "Remove a relationship" — and a formerly-missing "Undo" link
(no confirm step, matches PersonDetail's deceased/Undo pattern) now appears once a marriage is marked
ended, since `ended_reason` was always nullable but had no UI path back to null. `endedByDivorce`
(familyTree.ts, `rootDirect.spouses` only) tracks divorce specifically, separate from the
death-inclusive `endedWithAnchor`, so a death-ended union never gets an (incorrect) undo link.
`relationshipLabels.ts`
(mirrored in selfContext.ts for the AI prompt) derives step-parent/step-sibling/half-sibling
labels from the graph, no new relationship kind needed. `describeRelationship` words them by the
subject's gender since 2026-08-16 (father/mother, brother/sister, husband/wife, stepfather/…,
neutral when gender is unknown or is non-binary/other); `relationOf` still returns the structural
kind and stays gender-free, which is what relationshipCalculator.ts delegates its step logic to. `buildFamilyTreeFromGraph` (familyTree.ts,
2026-07-24 fix) infers a second ego-tree parent from a recorded parent's DECEASED spouse (not a
still-living one, to avoid pulling in an unrelated remarriage partner) — otherwise a kid whose
"parent" fact was recorded only against the in-law half of a couple loses the entire blood side
(grandparents/aunts/uncles/cousins) when the blood parent later dies and the survivor remarries;
found via Sam Volin's tree going blank-ish after Andy Volin (Sam's actual father) died and his
widow Andi Romagnoli remarried Michael Galchinsky. That fix's fuller data exposed a second,
pre-existing bug (2026-07-25 fix, same file): the Kids tier's `kidsBranches` array used to be
`[...rootChildNodes, ...extraKidsBranches]` (all direct kids first, then every cousin's-kid
appended after regardless of side) — `FamilyTree.tsx`'s `resolveTierPositions` collision sweep
only compares array-ADJACENT units and assumes array order already matches left-to-right screen
order, so a right-side cousin's kid sitting array-adjacent to a left-side one (or to a centered
direct kid) got forced into the wrong side, sometimes dragging a person clear across the canvas
from their actual family and corrupting the spacing of whoever sat at that array boundary. Now
built as `[...leftExtraKids, ...rootChildNodes, ...rightExtraKids]`, mirroring how
`rootGenBranches` already orders `[...leftCousinBranches, jakeBranch, ...rightCousinBranches]`.
`buildDescendantTreeFromGraph`'s founder-picking `coveredSet` (2026-07-25 fix, same file) is now a
full transitive closure over spouse links, not one hop — a widow(er)'s subsequent spouse (Michael
Galchinsky, remarried to Andy Volin's widow Andi Romagnoli) was landing as their own redundant
second "founder" of the group tree, since one hop of spouse-coverage never reached him, which
duplicated Sam/Natalie under a disconnected second bloodline instead of leaving them as Andy's
actual grandchildren of Roberta.
Genuine remarriage chains (2026-07-25, `familyTree.ts`/`FamilyTree.tsx`): the Union model was
hub-spoke (every `union.spouses` entry assumed married directly to `union.a`), so a deceased blood
person's widow(er)'s OWN later remarriage couldn't render correctly — appending the new spouse
would compute their ended-status against the wrong person. Replaced every `inLawSpouses` call site
with `spouseChain` (BFS over spouse links, unbounded hops, `endedWithAnchor` computed relative to
whichever person a given chain entry is ACTUALLY married to, not always `a`) — this is what lets
Andy †—Andi (dashed) —Michael (solid) all render correctly in one chain now. A 2nd-hop-or-later
chain entry also gets a `relationLabel` (e.g. "step-parent"), reusing `relationshipLabels.ts`'s
already-computed labels relative to the blood person's own kids — surfaced as a small caption under
the box in `FamilyTree.tsx`. Deliberately NOT extended to `rootSpouses` (the tree's own root/focal
person's direct spouse list stays as literally their own recorded spouses) nor to
`groupIntoBranches`'s Parents/Grandparents-tier pairing (a separate, already-correct mechanism).
Deferred: step-sibling/half-sibling labels for sibling-GROUPS (comparing pairs within a rendered
sibling/cousin set) are a structurally different problem, not yet built.
**Step-parents/step-siblings, no death required (2026-08-03, `familyTree.ts`/`FamilyTree.tsx`/
`writeRelationship.ts`):** the tree previously surfaced a step-parent only through the
widow-remarries chain (`spouseChain` 2nd hop), so a plain divorce-and-remarry was invisible — a
living spouse of a parent appeared nowhere. Parents tier is now built by `buildParentBranches`
(replacing `groupIntoBranches` for that tier only): a parent's spouse/partner who isn't a parent of
the root rides the marriage line tagged "step-parent" and flagged `TreePerson.stepOnly`. `stepOnly`
is what keeps them out of the bloodline everywhere else — no aunts/uncles/grandparents pulled from
their side, excluded from `anchorX`/`unionMemberIds` so the root's connector still drops from the
real couple's marriage line, and their own kids hang off them alone. Those kids render in the
root-gen tier tagged "step-sibling". Both are DERIVED, not stored: no new relationship kind: a
step-parent is a `spouse` row on the parent, a step-sibling a `parent` row on the step-parent, and
`relationshipLabels.ts` reads both back out. New `LinkOptions` (`skipSpouseParenthood`,
`skipCliqueSync`) on `linkRelationship` turns off the two blood-inferences for these writes —
without them `syncSpouseParenthood` would record a step-parent as a parent of the root, and
`syncFamilyClique` would copy the root's own mother/father onto a step-sibling. The "which parent is
biological?" question is answered by a follow-up question in the add flow, never by inference.
**Single "Add family member" control (2026-08-03, same day, `components/AddFamilyMember.tsx`):** the
per-relationship "+" row reached seven labelled, wrapping buttons once step relations landed and the
founder couldn't find the step-parent one at all. Replaced with one button -> pick the relationship
from a dropdown -> answer a follow-up only when the relationship runs THROUGH someone ("Whose parent
are they?", "Which parent are they married to?", "Which step-parent is their own parent?"; rendered
as static text, not a dead dropdown, when there's only one candidate) -> then the name box appears
("Who is <root>'s grandparent?", search existing or type a new name) -> Add. Relationship-first is
the founder's order (2026-08-04); changing the relationship clears any name already picked under it.
Relationships whose `through` list is empty stay visible
but disabled with the reason inline ("Step-sibling — add a step-parent first") rather than vanishing,
which is the same discoverability problem in miniature. `RelationshipAddPicker` is untouched and
still backs My Page's circle boxes. Also: a parent's deceased spouse is
now only inferred as a possible second blood parent when fewer than 2 parents are on file, so a
step-parent who later dies isn't silently reclassified as a blood parent. Remaining gap: two bio
parents who BOTH remarried can only place one step-parent adjacent to their own spouse.
**Centered-person-drifts-off-screen bug (2026-08-03 fix, familyTree.ts):** `sideOfParent` grouped
root's own two parents into couples before assigning tree side — married-to-each-other parents (the
common case) collapsed into one couple, so 100% of grandparents/aunts/uncles/cousins landed on side
'a', dragging the root's box off-center. Side is now assigned per-parent (`buildParentSides`), not
per-couple.
Full story: PROJECT_HISTORY.md.
│   ├── SettingsPage.tsx        — (2026-07-23, items 22/49) reached via "Settings" button next
│   │                            to Log out (App.tsx `settings` crumb). Account + AI settings
│   │                            only, not app-navigation shortcuts (a "My page" link was cut
│   │                            for that reason) — plus a "Your lists" section (2026-08-04,
│   │                            founder ask) linking to ManageTags + ManageGroupTypes, which
│   │                            are account-wide vocabularies rather than navigation. Email/password change via
│   │                            `supabase.auth.updateUser()`; chat-tone picker (4 presets,
│   │                            `user_settings` table) upserts on click, same shape as
│   │                            `home_suggestions`; links to About/Privacy. Time zone picker
│   │                            (2026-07-24, bug fix — see §12) — full IANA list via
│   │                            `lib/timezones.ts`'s `buildTimeZoneOptions()`
│   │                            (`Intl.supportedValuesOf`, curated fallback for older
│   │                            browsers), sorted by UTC offset, upserts `user_settings.
│   │                            time_zone` on select, same shape as chat-tone. Auto-detected
│   │                            on first sign-in by `lib/ensureUserTimeZone.ts` (App.tsx's
│   │                            `onAuthStateChange`, same sticky-metadata-flag pattern as
│   │                            `ensureStarterTags.ts` — `timezone_detected` flag, never
│   │                            re-overwrites a later manual choice). **2026-08-02 bug fix:**
│   │                            the flag used to get set to `true` even when the `user_settings`
│   │                            upsert failed/never ran (e.g. mid-migration-rollout), permanently
│   │                            stranding that account on the `'UTC'` default with no retry —
│   │                            reproduced live on `jakevolin@gmail.com` (flag was `true`, `time_
│   │                            zone` was `null`), which mis-dated an evening chat entry ("Emi's
│   │                            birth", typed ~11pm Mountain) to the next day. Fixed: the flag is
│   │                            now only set after a successful write. This account's `time_zone`
│   │                            and the one bad `event_date` were corrected directly; other
│   │                            accounts caught in the same window aren't yet identified.
│   ├── About.tsx               — (2026-07-23) placeholder page reached from Settings — real
│   │                            copy (item 23's "I don't want it to be bullshit" honesty ask)
│   │                            still to be drafted with the founder
│   └── Privacy.tsx             — (2026-07-23) real privacy/data policy copy (drafted with
│                                founder, no longer a placeholder): what's collected, how the
│                                AI uses it, named sub-processors (Supabase/Vercel/Anthropic/
│                                OpenAI), honest security-tier framing (encrypted in transit/
│                                at rest today; true E2E encryption is roadmap-only, in tension
│                                with AI reading content), account deletion today = email
│                                request (no self-serve button yet), and a specific "Coming
│                                soon" list (self-serve delete, data export, published security
│                                write-up, E2E research, consent-gated call-transcript import if
│                                that ships)
│   ├── CalendarSettings.tsx   — (2026-07-24, item 48) connect/remove calendars by pasting their
│   │                            secret iCal URL (validated server-side via `validate-calendar-
│   │                            source` before saving), founder-editable "Sync now" button.
│   │                            Reached from Settings and from Calendar.tsx's own link.
│   │                            (2026-07-26) "Regular calendar" vs "Birthdays calendar" radio
│   │                            when adding a source (writes `calendar_sources.source_type`);
│   │                            birthdays copy walks through connecting iPhone's iCloud
│   │                            Birthdays calendar (Calendar app → Calendars → (i) → Share
│   │                            Calendar → Public Calendar → Copy Link, then swap `webcal://`
│   │                            for `https://`) since that's a real always-on Contacts sync,
│   │                            not a one-time export. `source_type` fetched via its own
│   │                            separate fail-open query (not the main list select) so a
│   │                            pre-migration frontend deploy doesn't blank the whole
│   │                            connected-calendars list — same pattern as GroupDetail.tsx's
│   │                            `loadSuggestionsEnabled` (see §10/infra notes).
│   ├── PhotoImportReview.tsx  — (2026-07-30, item 27) general Google Photos import flow, reached
│   │                            from Settings. "Connect Google Photos" (OAuth) → "Import photos"
│   │                            opens Google's picker in a new tab, polls until done — then, for
│   │                            each date-clustered group of newly-imported photos, a card offers
│   │                            "New event" (default) or an existing-event match (free date-range
│   │                            heuristic, no AI call — see `_shared/photoClusters.ts`) with a
│   │                            manual `SearchAddPicker` override, plus (2026-07-30, item 70 — fixes a
│   │                            bug where the new event silently saved untitled) an optional title
│   │                            text field shown only in "New event" mode, written to the new
│   │                            moment's `occasion` on Accept instead of the old hardcoded `null`;
│   │                            the post-accept confirmation label now shows that real title
│   │                            (falling back to the date range only when left blank, matching
│   │                            `momentLabel()`'s own convention) instead of always showing the
│   │                            date range as if it had been saved as the title. Accept resolves
│   │                            every photo in that cluster's `moment_id` (creating a blank-shell
│   │                            event first if "new event"); reject just flips
│   │                            `photo_clusters.status`, photos stay unattached.
│   │                            (2026-08-17) Both actions collapse the card in place and park it at
│   │                            the top of the screen (lib/resolvedCardScroll.ts) rather than the
│   │                            card vanishing: accept shows `Added N photos to {event}` with
│   │                            "View event →" + Done, "Not now" shows `Not added — {dates} · N
│   │                            photos` with Undo (status back to `pending`) + Done. This replaced
│   │                            the page-level "Added to X" banner above the list. Cards are
│   │                            rendered inline here, not as a component, so the scroll runs off a
│   │                            `cardRefs` map + `pendingScrollId` instead of the shared hook.
│   │                            `EventDetail.tsx`'s own "Add photos" button is
│   │                            the simpler quick-add path — same underlying picker flow
│   │                            (`lib/googlePhotosImport.ts`) but skips clustering/review
│   │                            entirely since the target event is already known.
│   ├── GooglePhotosOAuthCallback.tsx — (2026-07-30) the redirect target for Google's consent
│   │                            screen (`/oauth/google-photos/callback`, checked in App.tsx
│   │                            before normal view/crumb routing since it isn't a real app page).
│   │                            Exchanges the returned `code` via the `google-photos-oauth-
│   │                            callback` Edge Function, then reloads at `/` — sessionStorage's
│   │                            nav-restore key already reflects wherever the user was when they
│   │                            clicked "Connect," so no return-path plumbing is needed.
│   ├── ReviewInbox.tsx        — (2026-08-19) crumb `reviewInbox`, singleton. The one place that
│   │                            answers "what's waiting for me?" — one row per import queue (label,
│   │                            count, one plain line, tap to open the page that already existed),
│   │                            with the "still to look through" piles styled quieter than the
│   │                            ready-to-review ones. Replaced the up-to-FOUR stacked "N found"
│   │                            nudges on Home.tsx/Calendar.tsx, which now show ONE `N things to
│   │                            review →` into here. Also owns the set-aside row (count, when the
│   │                            first one returns, "Show them now" = wake all) — deferral is
│   │                            cross-cutting and shouldn't nag from inside the queue it came from.
│   │                            Shows a quiet "a database update is pending" note while
│   │                            `probeTriageEnabled()` is false.
│   ├── CalendarTriage.tsx     — (2026-08-19) crumb `calendarTriage`, singleton. Fast Keep / Not
│   │                            this one pass over `status='pending'` calendar candidates, one line
│   │                            each (title · date · location · calendar badge when 2+ connected).
│   │                            Structural clone of ContactSelection.tsx — 50/page, immediate
│   │                            writes (no batch save), debounced search across ALL rows in the
│   │                            filter, and an "N turned down — review/undo" toggle.
│   │                            **Four answers per row (founder-directed 2026-08-19, replacing
│   │                            Keep/Not-this-one):** `Quick Add` creates the event there and then
│   │                            via lib/acceptCandidate.ts; `Add More Detail` writes 'selected' and
│   │                            hands off to ImportReview.tsx; `Remind Me` writes 'deferred' with a
│   │                            date from RemindSheet.tsx; `Reject` writes 'rejected', because that
│   │                            is what the founder's no is (reusing 'skipped' would conflate it
│   │                            with the machine's — see §6). Buttons sit on their own wrapping row
│   │                            under the title: four will not fit beside text at 375px.
│   │                            A row flagged by lib/likelyDuplicate.ts shows "Looks familiar —
│   │                            review it" INSTEAD of Quick Add, so the one-tap path can never
│   │                            create the duplicate the review card's merge banner exists to
│   │                            prevent. Every answer collapses the row in place with an Undo and
│   │                            the row does NOT leave the list — see the scroll note below. This
│   │                            page filters nothing: it shows every candidate, just at a size a
│   │                            person can get through (the 2026-08-12 directive stands).
│   ├── BirthdayImportReview.tsx — (2026-07-26) accept/reject queue for
│   │                            `birthday_import_candidates`, mirrors ImportReview.tsx's card
│   │                            idiom but simpler (name + date only, no tags/groups/location).
│   │                            High-confidence matches show "Goes to: {person} (change)";
│   │                            unmatched shows a search-to-link picker with "leaving this
│   │                            blank creates a new person" as the fallback. Accept upserts
│   │                            `reminders` (label='Birthday', + year if the calendar carried
│   │                            one). Reached from Home.tsx/Calendar.tsx's "N birthdays found"
│   │                            nudges (same pending-count pattern as the events nudge).
│   │                            Verified end-to-end live against a disposable test account
│   │                            (`jake.volin+birthdaytest@gmail.com` — not yet deleted, needs
│   │                            founder cleanup via the Supabase dashboard, no admin access
│   │                            from this session), NOT the shared `jakevolin@gmail.com`
│   │                            login (real data, never used for mutating tests).
│   │                            (2026-08-17) Accept and reject both collapse the card in place and
│   │                            park it at the top of the screen (lib/resolvedCardScroll.ts).
│   │                            Reject shows `Rejected — {name}` with Undo (status back to
│   │                            `pending`, `reviewed_at` null, original `matched_person_id`
│   │                            restored) instead of the row vanishing, and the accept
│   │                            confirmation — which used to sit there forever with no way to
│   │                            clear it — now has a Done that drops the card from the list.
│   │                            (2026-08-18) `onPersonCreated` pushes a just-created profile into
│   │                            the page-level `allPeople` roster, so it's linkable from the other
│   │                            cards without a page reload — see §12.
│   └── ImportReview.tsx       — (2026-07-24, item 48; overhauled 2026-07-25; **reshaped 2026-08-19
│                                — read this paragraph first**) accept/reject queue for
│                                AI-extracted calendar-import candidates. Three changes:
│                                (a) it now reads `status='selected'` (kept in CalendarTriage.tsx),
│                                falling back to 'pending' when `probeTriageEnabled()` is false;
│                                (b) the card list is wrapped in `ReviewDeck` — batches of 10 with a
│                                progress line and a real ending, replacing `CARD_BATCH_SIZE`/
│                                "Show 20 more (210 still to review)"; (c) cards open COLLAPSED
│                                (title · date · location · who, then Accept / Not now / Reject /
│                                Details ▾) and expand to the full editor described below on tap —
│                                EXCEPT when `findLikelyMatch` fires, where the card opens expanded
│                                and stays that way until the four-way duplicate question is
│                                answered, because a collapsed Accept there would create the very
│                                duplicate the banner warns about. Accepting collapsed saves exactly
│                                what the scan extracted (what Accept on an untouched full card
│                                always did). "Not now" writes `status='deferred'` +
│                                `deferred_until` = today + 30d and confirms "Set aside — …. It'll
│                                come back in N days" with Undo. Undo restores 'selected', not
│                                'pending' — the founder already triaged it and shouldn't be asked
│                                twice. (2026-08-19) "Not now" is now **Remind Me** and opens
│                                RemindSheet.tsx, matching the triage row; accept/merge go through
│                                lib/acceptCandidate.ts so there is one write path, not two; and the
│                                page takes a `restoreScrollRef` from App.tsx (same handshake as
│                                Groups.tsx) while ReviewDeck holds its batch by `persistKey`, so
│                                "Add more details →" and back returns you to the same place in the
│                                same ten. Everything below still describes the expanded card.
│                                (`moment_import_candidates`). Accept no longer
│                                auto-advances — shows a confirmation state ("Added —
│                                {event}"/"Merged into {event}") with "Add more details →" (jumps
│                                to EventDetail) and "Done". Free client-side heuristic (title
│                                word-overlap + date proximity, no AI call) flags a likely existing
│                                duplicate and offers "Merge into it" (fills only the target's
│                                blank fields, unions attendees/tags/groups, candidate marked
│                                accepted not deleted) or manual search-to-merge. Suggested
│                                tags/groups (from the same scan-calendar-sources AI call, no extra
│                                cost) render as approve-by-default chips + manual pickers; groups
│                                are existing-only (never invented), tags may propose a new name.
│                                No free-text "When" input — `when_text` is auto-derived from the
│                                exact date(s) and hidden, per founder feedback that it was
│                                confusing next to the real date. Reached from the Home/Calendar "N
│                                events found" nudges. Each card shows a small source-calendar badge
                                (the connected calendar's label) when the founder has 2+ calendars
                                connected, so multi-calendar founders can tell which candidates came
                                from which feed (2026-07-25). Manual merge-search now lists existing
                                events immediately on open (sorted most-recent-first), narrowing as
                                you type, instead of showing nothing until you type (2026-07-25 fix).
                                "Save as a note instead" (both on the auto-suggested match banner and
                                after picking a manual merge target) writes a single moment-scoped
                                `notes` row (no person/group, `source='calendar_import'`) without
                                merging/creating/field-filling — for calendar entries that are
                                really just a detail of an existing event rather than their own event
                                (2026-07-25; needed a `notes` CHECK-constraint + RLS-policy widening,
                                see schema entry below). "+ Add someone" search-add picker (existing
                                people, or type a new name to create) plus "Also from the associated
                                group?" suggestions (members of any group tagged on the candidate, one-
                                tap add/dismiss, mirrors EventDetail.tsx's group-suggestion pattern)
                                (2026-07-25). Second suggestion box, "Was their family there too?"
                                (2026-07-25): spouse/partner of anyone already on the candidate, then
                                that couple's kids once the spouse/partner is ALSO on it — same
                                `suggestFamilyMembers` helper and dismiss-chip UI as EventDetail.tsx's
                                version (see its entry above), fed by one whole-account `relationships`
                                fetch (`getRelationshipsMap()`, no args) shared across every card on the
                                page rather than a per-card query. Self seeded into that candidate the
                                same way as EventDetail.tsx (item 63, 2026-07-26) — self's spouse is
                                suggested even before self is added to the candidate.
                                Third disposition alongside merge/save-as-note (2026-08-03): "+ Add as
                                a sub-event" files the candidate as its OWN new event nested under an
                                existing one (`parent_moment_id`, item 35) — offered on the likely-match
                                banner, as a swap from a chosen merge target, and via its own
                                search-an-event picker. Accept button reads "Add as sub-event"; the
                                confirmation reads `Added as a sub-event of "{parent}" — {event}`.
                                Parent picker excludes events that are already sub-events (one level
                                deep, same rule as EventDetail.tsx), from fetchMomentParentIds()'s
                                isolated fail-open query so an unrun migration degrades instead of
                                breaking the page. Both pickers' rows (and the merge/sub-event
                                banners) are labelled "Parent / Child — date" per
                                lib/momentDisplayName.ts, §10 `moments`.
                                One-rule button hierarchy (2026-08-16, founder feedback that the gold
                                box read as the whole choice and merges were being hit by mistake):
                                the gold box only ever PICKS, the single blue button at the card's
                                foot is the only control that writes. So (a) no option in the
                                likely-match box is a filled/primary button — all four are equal
                                outline buttons, including "Merge into it"; (b) "Save as a note
                                instead" no longer fires on click, it sets `noteTarget` like
                                mergeTarget/subEventParent and is committed by the blue button (which
                                also keeps the note text editable after choosing); (c) the
                                confirmation banners' change-your-mind actions are plain underlined
                                links behind "Not what you want?", never bordered buttons, plus a
                                `Press "<button>" below to save it` hint; (d) the blue button's label
                                always names the outcome — Accept / Merge / Add as sub-event / Save as
                                a note, and "Accept as a new event" while a possible duplicate is
                                still unanswered (derived `unresolvedMatch` drives both the box and
                                the label so they can't drift).
                                (2026-08-17) The two picker ENTRY POINTS above Accept/Reject are
                                outline pill buttons matching "+ Add a tag"/"+ Add a group"
                                (`styles.addButton`), not underlined links: "Merge with an existing
                                event" / "+ Add as a sub-event", flipping to "Cancel merge" /
                                "Cancel sub-event" while open. This does NOT contradict (c) above —
                                that rule covers the confirmation banners' change-your-mind links,
                                which stay links. Notes textarea: was passing `flex: 'none'` in
                                `styles.notesInput`, overriding AutoGrowTextarea's `flex: 1`, so it
                                collapsed to the textarea's default ~20-col width and grew tall
                                instead; now `flex: 1` + `minWidth: 0` like the other three queues
                                (750px of an 800px row, mic takes the rest).
                                (2026-08-17) Renders `CARD_BATCH_SIZE` = 20 cards at a time with a
                                "Show 20 more (N still to review)" button and a "N events to review
                                — showing 20." line; the queue itself is fetched WHOLE. A card is
                                expensive (findLikelyMatch scans every moment on file, plus per-card
                                group-roster maps and family/group suggestions), so mounting all 376
                                took 7.5s vs 942ms for 20 — see PROJECT_HISTORY.md 2026-08-17. The
                                candidates query is also paged now (lib/pagedSelect.ts); it was the
                                last unpaged account-wide browser read and would have silently
                                capped at 1000 pending events.
                                (2026-08-17) Every disposition lands the same way, via
                                lib/resolvedCardScroll.ts: the card collapses to its confirmation
                                and that collapsed card is parked 12px below the top of the screen,
                                so the next event sits right underneath it. Previously accept left
                                the confirmation just off the top of the screen (the card shrank
                                ~695px→109px under a fixed scroll position) and reject clamped the
                                page to the very top. Reject now shows a confirmation too —
                                `Rejected — {event}` with Undo (flips `status` back to `pending`,
                                `reviewed_at` null) + Done, instead of the row silently vanishing;
                                nothing else in the app resurfaces rejected candidates, so Undo is
                                the only recovery from a mis-tap. Pressing Done needs no second
                                scroll: the next card lands exactly where the confirmation was.
                                The same treatment is on the other three queues — see their entries.
                                (2026-08-18) `onPersonCreated` pushes a person created as a new
                                attendee into the page-level `allPeopleList`, so the other cards'
                                "+ Add someone" search finds them without a page reload — see §12.
                                `suggested_people`/`suggested_group_ids` now also draw
                                on people/relationship data already on file, not just the calendar
                                entry's own ICS attendee list or its title's explicit group name
                                (2026-07-25 follow-up, scan-calendar-sources): (a) names mentioned
                                directly in the title/description (e.g. "Sid and Kate's wedding")
                                are extracted by the same AI call and cross-matched against the
                                people roster — a bare first name that's genuinely ambiguous (2+
                                people share it) gets resolved via the `relationships` table if it
                                connects to another already-resolved person in the same event (e.g.
                                "Kate" → the one married to the already-matched "Sid"), never
                                guessed outright; (b) a group gets suggested when 2+ resolved
                                attendees share it, via EITHER formal `person_groups` roster
                                membership OR having attended one past event tagged to that group
                                (the looser, attendance-based signal exists because founders don't
                                always formally roster every regular). Accepting a candidate now
                                immediately adds the new event to the shared existing-events list, so
                                the next candidate's "might already be on file" banner and manual
                                merge-search see it right away — previously needed a page reload
                                (2026-07-25 fix). Free-text "Your notes (optional)" box on every
                                candidate card (2026-07-25), right under the raw calendar
                                description — lets the founder jot memories while reviewing, before
                                deciding accept/merge/note. Saved as a `notes` row
                                (`source='calendar_import'`) on whichever moment results: the newly
                                created event, the merge target, or (taking precedence over the
                                mechanical title+description fallback) the "save as a note instead"
                                target. Location field (2026-07-26) is now `AddressSuggestInput`
                                (see components/ entry below) instead of a plain input — suggests
                                addresses the founder has typed before, plus live Geoapify
                                suggestions once a key is configured.
├── components/
│   ├── FloatingActionBubble.tsx — (2026-08-08, landed 2026-08-10) bottom-right "+" bubble that
│   │                            expands into a note box (`primaryBody` — mic included, kept on
│   │                            the first screen because voice is the primary input path) plus
│   │                            an action list, each row opening its own panel via `‹ Back`.
│   │                            Owns its open/closed state, so pages no longer keep their own
│   │                            `showXPicker` flags. REPLACED FloatingNoteButton.tsx, now
│   │                            deleted. On EventDetail (people / tag / associate a group /
│   │                            photos / new sub-event / Manage) and GroupDetail (people /
│   │                            associate a group / new subgroup / Manage). `secondary: true`
│   │                            puts Manage below a divider, muted; it opens ManagePanel, which
│   │                            still owns the delete confirm. `body` may be a render function
│   │                            receiving `{back, close}` for panels with their own Cancel.
│   │                            Escape is three-stage: clear the focused field's text, then back
│   │                            to the list, then close — registered in the CAPTURE phase, since
│   │                            the field's own React handler clears the value synchronously and
│   │                            a bubble-phase listener would always see it empty. Hidden when
│   │                            `readOnly`, so the demo never renders it. `error` (2026-08-11,
│   │                            item 91) shows a failure banner under the header at BOTH levels —
│   │                            a write started in here has nowhere else to report itself, since
│   │                            the pages' own banner lives inside ManagePanel.
│   ├── AddressSuggestInput.tsx — (2026-07-26) drop-in text input with a suggestion dropdown:
│   │                            previously-typed values (instant, local, from the `recentValues`
│   │                            prop) first, then live Geoapify address suggestions (debounced,
│   │                            `lib/geoapify.ts`). Unlike SearchAddPicker, the input's own value IS
│   │                            the field — picking a suggestion (click, or ↓/↑ + Enter) fills it
│   │                            in place rather than clearing a separate query box. Currently only
│   │                            wired to ImportReview.tsx's Location field (the only real location
│   │                            text input in the app).
│   ├── RelationshipAddPicker.tsx — real "add a relative" affordance shared by Circle.tsx/
│   │                              FamilyTree.tsx (replaced MockAddPicker.tsx 2026-07-20):
│   │                              search everyone on file, or type a name that matches no
│   │                              one to create a brand-new person, both wired through
│   │                              writeRelationship.ts. Enter-to-submit (2026-07-22, founder
│   │                              ask — clicking felt too hands-on): wrapped in a `<form>`,
│   │                              Enter commits the typed name (exact match selects the
│   │                              existing person, otherwise creates new), same outcome as
│   │                              clicking either option.
│   ├── PetsSection.tsx        — (2026-08-01) collapsible "Pets" card on PersonDetail, between
│   │                            Contact Info and Associated Groups. Own isolated query, same
│   │                            reasoning as ContactInfoSection. Renders nothing at all when the
│   │                            migration hasn't run — an Add box over a missing table would
│   │                            swallow the write silently, so `available:false` hides the card
│   │                            rather than showing an empty one. LISTS and ATTACHES only; all
│   │                            pet editing lives on PetDetail.tsx, mirroring groups/events
│   │                            (chips on a profile, editing on the detail page) so there's one
│   │                            pet form, not two that drift. Add and attach are ONE gesture: the
│   │                            SearchAddPicker searches every pet on the account, so tagging the
│   │                            spouse's dog is the same motion as creating a new pet (and a
│   │                            newly-created one drops you straight onto its page, like "+ Add
│   │                            Person"). The × UNLINKS (the pet may be someone else's too).
│   │                            Demo passes `pets={[]}` so the public demo makes zero Supabase
│   │                            calls, and omits `onSelectPet` (no pet pages in the demo shell).
│   ├── ErrorBoundary.tsx      — per-tab crash containment; friendly fallback
│   │                            (reload button, raw error tucked behind a
│   │                            "Technical details" toggle)
│   ├── NoteWithDetection.tsx  — (2026-08-03) replaced UpdateMomentChat.tsx/UpdateGroupChat.tsx;
│   │                            one input for EventDetail/GroupDetail (was two: a plain note box
│   │                            + a separate AI chat). Saves the user's exact words verbatim and
│   │                            instantly, then fires update-moment/update-group in the
│   │                            background for attendee/relationship detection — renders the same
│   │                            RelationshipSuggestions/MentionedPeopleSuggestions banners the old
│   │                            chats did. A genuine disambiguating question from the model surfaces
│   │                            as one inline follow-up (`needsClarification`), not a persistent
│   │                            thread. `subjectType`/`subjectId` param over moment vs. group.
│   │                            Progress panel (2026-08-08): "✓ Saved your note" the instant the
│   │                            row lands, a pending line while the AI call runs, then one ✓ per
│   │                            thing that actually happened, built from the function's `applied`
│   │                            payload (never from what the model claimed) via `checklistLines()`.
│   │                            Detection is now awaited, not fire-and-forget, and a failed call
│   │                            says so instead of returning silently. No fake staged ticking —
│   │                            the whole wait is one AI call, so items check off together.
│   ├── VoiceInputButton.tsx   — mic → `transcribe`; renders null w/o MediaRecorder. Takes `value`/`onChange` (not `onTranscribed`) since 2026-08-18: it owns the text after the anchor point and rewrites it live as words stream in, so a failure keeps what arrived. Live level meter from an AnalyserNode; 10-min cap. **Refuses to upload a recording under `MIN_AUDIO_BYTES` (1KB)** — an empty capture now reads "Nothing came through — make sure no other app is using the mic" instead of a generic transcription failure (2026-08-23, founder-reported on iPhone). A `startingRef` latch stops a double-tap starting a second recorder while the first is still awaiting `getUserMedia`.
│   │                            Optional `onBusyChange(busy)` (2026-08-02) reports
│   │                            recording/transcribing so a caller can disable its save
│   │                            button — accepting mid-transcription otherwise drops the audio.
│   ├── RemindSheet.tsx        — (2026-08-19) "Remind me about this in…" — 1 week / 1 month /
│   │                            3 months / 6 months, plus a "use this as my default, don't ask
│   │                            again" checkbox that writes `user_settings.review_remind_days`.
│   │                            Once a default is saved, both review screens apply it without
│   │                            opening the sheet (a preference that still asked every time
│   │                            wouldn't be one). A thin wrapper over ChoiceSheet, which gained an
│   │                            optional `footer` slot for the checkbox — it can't live in
│   │                            `actions`, where every entry closes the sheet by doing something.
│   ├── ReviewDeck.tsx         — (2026-08-19) the finish line on an import queue. Serves `items` in
│   │                            batches of `DECK_SIZE` (10), shows "N of 10 done · M more after it"
│   │                            while you work, and an end-of-batch panel ("Nice — 10 events
│   │                            reviewed. 204 to go") with `Review 10 more` / `I'm done for now`.
│   │                            Batch membership is captured once, NOT recomputed as
│   │                            `items.slice(0, 10)` — otherwise dismissing a card pulls the next
│   │                            one up and the batch never ends. Cards report a decision through
│   │                            `renderItem`'s `api.setDecided`, which is a different moment from
│   │                            leaving the list (they collapse to a confirmation and sit until
│   │                            "Done"). Generic on purpose: birthdays/contacts/photos are meant to
│   │                            get the same treatment and need no rewrite here. `persistKey`
│   │                            (2026-08-19) keeps a batch across a REMOUNT — "Add more details →"
│   │                            navigates to the event, and coming back used to deal a fresh ten,
│   │                            silently replacing the ten you were part-way through.
│   ├── ReviewNoteField.tsx    — (2026-08-02) label + AutoGrowTextarea + mic, the free-text
│   │                            "what do you actually know about them" box on all four import
│   │                            review queues (ContactImportReview / BirthdayImportReview /
│   │                            ImportReview / PhotoImportReview). Writes ONE note verbatim on
│   │                            accept, `source: 'review_note'` (no badge on PersonDetail —
│   │                            these are the founder's own words, not machine-derived). Empty
│   │                            box writes nothing. No AI: founder ruled out a note-splitter on
│   │                            cost (2026-08-01); Key Facts already breaks long notes into
│   │                            bullets on the profile, DB-cached.
│   ├── MatchCallout.tsx       — (2026-08-10) the "possible match" box on ContactImportReview /
│   │                            BirthdayImportReview: states the claim as a question naming both
│   │                            people ("Is X the same person as Y?") in a tinted, primary-bordered
│   │                            box, with Yes/No as real buttons, optional `evidence` slot (the
│   │                            match's existing groups) and children as the "or link it to someone
│   │                            else" search. Replaced a grey one-liner + two underlined links.
│   ├── AutoGrowTextarea.tsx   — grows to 160px then scrolls; Enter sends
│   ├── PhotoGallery.tsx       — (2026-07-30) given a `momentId`, renders real photo thumbnails
│   │                            (signed Storage URLs, `photos` table) once any exist; falls back
│   │                            to the original placeholder tiles otherwise, and unchanged for
│   │                            Person/Group pages (no `momentId` passed — a per-person/group
│   │                            rollup across their moments is a later pass, item 66 below).
│   │                            Thumbnails are clickable (2026-07-30, item 70) — opens a
│   │                            full-screen lightbox (Prev/Next, Esc/backdrop/× to close) showing
│   │                            the same stored ~1600px copy, since Google's own picker URLs are
│   │                            session-scoped and there's no fuller-quality source to link out to
│   │                            later. `subEventIds` (2026-08-10) makes a parent event's gallery
│   │                            cumulative — its own photos plus every sub-event's; EventDetail
│   │                            passes the ids it already loaded, so no extra query. Merged
│   │                            galleries order by `taken_at` then `created_at`.
│   ├── RefreshButton.tsx      — spinning refresh icon
│   ├── SummaryText.tsx        — (2026-08-10) renders an event summary. A parent event's sub-event
│   │                            lines get a hairline left rail, an italic muted date, a bold title
│   │                            and the sentence below; an ordinary prose summary renders exactly
│   │                            as before (one pre-wrap paragraph). Parsing in lib/summaryFormat.ts.
│   │                            (2026-08-17) bullets render as a real list with a hanging indent, and
│   │                            the thin-event closing line renders as muted italic below them. Also
│   │                            now used by GroupDetail.tsx, which printed summaries as a flat <p>
│   │                            and would have leaked raw "- " markers.
│   ├── EventEnrichmentBoxes.tsx — (2026-08-17, item 21) the game + weather boxes under an
│   │                            event's date/location. Pure presentation: renders what
│   │                            EventDetail hands it, never fetches. Hidden entirely when
│   │                            status is not_found/too_soon, so an ordinary event looks
│   │                            exactly as before. A game that has not been played shows its
│   │                            start time, NOT its 0-0. The weather box always names the
│   │                            place and date it actually looked up, so a wrong guess is
│   │                            visible rather than quietly trusted.
│   ├── SearchBox.tsx          — client-side list filter. Optional `onFocus`/`onBlur`
│   │                            props (item 28 follow-up, 2026-07-22, additive)
│   │                            passed straight through to the input, so a picker
│   │                            built on top can react to focus state. Optional
│   │                            `inputRef`/`style` (item 14, 2026-08-12, additive):
│   │                            GlobalSearch focuses the field itself, and overrides
│   │                            the baked-in marginBottom that's dead space in a panel.
│   ├── GlobalSearch.tsx       — (item 14, 2026-08-12) the global search panel. Top-anchored
│   │                            overlay (ManagePanel's scrim/Escape/click-outside recipe),
│   │                            results in per-kind sections capped at 5 with "Show all N".
│   │                            Keyboard model copied from SearchAddPicker: one flat `rows`
│   │                            array so the Ask row is just another stop, arrows CLAMPED not
│   │                            wrapped. Focus lands via a useCallback REF, not an effect+rAF
│   │                            — the rAF version lost the focus outright in the browser.
│   │                            Row styles use backgroundColor longhand in BOTH base and
│   │                            active (mixing `background`/`backgroundColor` makes React warn
│   │                            every rerender — same trap SearchAddPicker hit with `border`).
│   │                            `onAsk` optional: no handler, no "Ask Grove" row (the demo).
│   ├── SearchAddPicker.tsx    — type-to-search + tap-to-add from a list (used for
│   │                            EventDetail's attendee/group-tag pickers). Optional
│   │                            `onCreateNew`/`createLabel` props (item 28,
│   │                            2026-07-22, additive — existing callers unaffected)
│   │                            add an inline "+ Add ..." create affordance,
│   │                            borrowed from RelationshipAddPicker's create-button
│   │                            block, for a growing vocabulary like tags. Optional
│   │                            `browseAll` prop (2026-07-22 follow-up, default
│   │                            false — people/group pickers unaffected): focusing
│   │                            the input shows the FULL item list immediately
│   │                            (not just after typing), so a bounded vocabulary
│   │                            like tags can be browsed/recognized rather than
│   │                            recalled from memory — caller is responsible for
│   │                            passing `items` pre-sorted (EventDetail's tags
│   │                            picker sorts alphabetically). Blur close is
│   │                            delayed 150ms so a click on a result registers first.
│   │                            Keyboard select (2026-08-03, all callers): typing
│   │                            auto-highlights the top match so Enter commits it
│   │                            before the name is fully typed; ↑/↓ move the
│   │                            highlight (CLAMPED, not wrapped — overshooting at the
│   │                            end shouldn't land on the wrong name), Enter with no
│   │                            match creates when `onCreateNew` is set, Esc clears,
│   │                            hover syncs the highlight so mouse and keyboard agree.
│   │                            `browseAll` with an empty box highlights NOTHING
│   │                            (index -1) — that list is unranked, so a stray Enter
│   │                            must not commit whatever sorts first. Rows are
│   │                            role=option under aria-activedescendant; the active
│   │                            border is restated as a full `border` shorthand
│   │                            (not `borderColor`) or React warns about mixing.
│   │                            Results are RANKED, not just filtered (2026-08-10,
│   │                            lib/searchRanking.ts) — a plain substring filter cut to
│   │                            the caller's first 8 made a parent group unreachable,
│   │                            since every descendant's full-chain label matches the
│   │                            parent's name and outvoted it. Trimmed lists now show
│   │                            "N more matches — keep typing" instead of dropping
│   │                            silently. `browseAll` still bypasses ranking (unsorted
│   │                            full list is the caller's job to order).
│   ├── UndoBanner.tsx         — "Added X. Undo" line for actions that commit with no
│   │                            confirm step (GroupDetail's member add, 2026-08-03).
│   │                            Persists until replaced/dismissed rather than fading
│   │                            on a timer — read speed shouldn't decide whether a
│   │                            mistake stays fixable. Same visual idiom as
│   │                            ContactImportReview/PersonDetail's inline Undo links.
│   ├── ChoiceSheet.tsx        — generic "what do you want to do with this?" popup:
│   │                            title, optional subtitle, a stack of full-width choice
│   │                            buttons (one `primary`, filled ink). Second instance of
│   │                            FilterPanel's popup pattern; separate component because
│   │                            FilterPanel's "Clear all / Done" footer is required and
│   │                            wrong for a chooser. Carries role=dialog and focuses the
│   │                            first action on open (FilterPanel does neither). Used by
│   │                            FamilyTree's tile tap (2026-08-04) and Countdowns' "+ Add"
│   │                            (2026-08-06).
│   ├── ClarifyGenderPrompt.tsx — (2026-08-05) "Is Mark your son-in-law or daughter-in-law?"
│   │                            banner: one tap saves `people.gender` and re-words every label
│   │                            that was sitting on a genderless fallback. Asked as a RELATIONSHIP
│   │                            question (the two answers are the two words the tile could show),
│   │                            not "what gender is this person?". Shown on FamilyTree (one at a
│   │                            time, in-law/aunt-uncle/niece-nephew first since those fallbacks
│   │                            have no natural English word) and inline under a
│   │                            RelationshipCompare answer. Only ever asks about names
│   │                            `nameGender.ts` can't decide — no prompt for a Mark or a Susan
│   │                            (founder, 2026-08-05); Jordan and Casey still get asked. Hidden entirely when
│   │                            `graph.genderSupported` is false — never offers a button that
│   │                            can't save. Skip is session-only and deliberately not persisted:
│   │                            a non-binary relative has no right answer among the two offered,
│   │                            and their profile's Gender dropdown is the full control
│   ├── CountdownsSection.tsx  — (2026-08-06, item 83) collapsible "Countdowns" card at the BOTTOM
│   │                            of Calendar.tsx, under the month grid (founder preference, moved
│   │                            from above Upcoming the same day):
│   │                            one card per subject, title + ↑ (how long it's BEEN)
│   │                            or ↓ (how long UNTIL), then up to four unit columns. Takes the
│   │                            moments/people Calendar already loaded and adds exactly one query
│   │                            (`countdowns`, isolated + fail-open — pre-migration it still shows
│   │                            derived milestones but hides "+ Add" and the dismiss ×, rather than
│   │                            offering writes that would silently no-op). One timer for the whole
│   │                            section at `tickMs`'s period, stopped when collapsed; the card LIST
│   │                            is rebuilt per day, not per tick, so ticking doesn't re-scan every
│   │                            moment/person each second. "+ Add" → ChoiceSheet: "Just a
│   │                            countdown" (inline label + date), "A countdown and a real event"
│   │                            (`createEventShell` + pin, then straight to EventDetail), "An event
│   │                            I already have" (SearchAddPicker over dated moments). Card tap →
│   │                            EventDetail / PersonDetail; × removes from Countdowns only.
│   │                            (2026-08-06 follow-up) The cards are ONE timeline in their own
│   │                            scroll box: past above a "Today · Aug 6" line, upcoming below,
│   │                            centred on that line when the section opens, with a "Today" button
│   │                            in the header that jumps back to it (sets the box's scrollTop
│   │                            directly — `scrollIntoView` would drag the page too). × now removes
│   │                            optimistically (by `cardIdentity`) and folds the one changed row
│   │                            into state; the old refetch blanked the section, shortened the page
│   │                            and made the viewport jump to the top and back. ⚙ next to the ×
│   │                            opens a per-card panel: rename (display-only, the event keeps its
│   │                            own title), count in chosen units or Automatic, repeat
│   │                            weekly/monthly/yearly, and — for a one-off still ahead — keep
│   │                            counting up after it passes vs. take it off the list. Hidden until
│   │                            the settings migration runs.
│   ├── PanZoomSvg.tsx         — (2026-08-05) drag-to-pan / pinch-wheel-button-zoom viewport
│   │                            for an SVG canvas. Content sits in a transformed <g> (stays
│   │                            vector-crisp when zoomed, unlike a CSS-scaled <svg>). Tracks
│   │                            live pointers itself instead of setPointerCapture, which would
│   │                            retarget `click` to the container and break tapping a tile.
│   │                            Pan is clamped so the content can never leave its own frame;
│   │                            the zoom floor drops below MIN_ZOOM when a tree is too wide to
│   │                            fit a phone otherwise. Used by FamilyTree.tsx (both modes,
│   │                            plus the demo tree via FamilyTreeView)
│   ├── Chips.tsx              — PersonChip (green) / GroupChip (gold) / EventChip
│   │                            (blue) — shared visual language everywhere
│   ├── EditButton.tsx         — pencil rename control (Event/Group headings)
│   ├── Breadcrumb.tsx         — trail for App.tsx's navStack
│   ├── NavIcons.tsx           — (2026-08-11) the 5 nav tab icons as hand-written inline SVG.
│   │                            NOT an icon library on purpose — 3 deps total, 5 glyphs.
│   │                            currentColor-stroked, so active/inactive is the parent's
│   │                            `color`. Swapping one icon = replacing its paths, nothing else.
│   ├── RelationshipSuggestions.tsx — shared suggestion-banner UI (all 4 surfaces);
│   │                            exports its `styles` so other banner components match
│   ├── MentionedPeopleSuggestions.tsx — (2026-08-02) "You mentioned Rachel at <event>… want a
│   │                            profile for them too?" banner, Home chat + event chat. "Add a
│   │                            profile" creates the person and re-points the already-written
│   │                            general note at them (which also puts them in "Who was there");
│   │                            "Just keep the note" writes nothing — the note is already saved
│   ├── DevOnboardingReset.tsx — (2026-07-22) "Testing tools" link on Home, renders null unless
│   │                            signed in as the onboarding test account (see lib/
│   │                            resetOnboarding.ts); expands to a type-RESET-to-confirm panel,
│   │                            then reloads straight into Onboarding.tsx
│   └── FeedbackWidget.tsx     — (2026-07-22) floating "💬 Feedback" toggle, mounted in App.tsx
│                                for any signed-in user. Click-to-pin: toggle on, hover highlights
│                                the element under the cursor, click intercepts (capture-phase,
│                                preventDefault/stopPropagation so the real app doesn't navigate)
│                                and opens a small composer instead; saves to `feedback_notes`
│                                (page label + a best-effort text description of the element +
│                                the note) via `lib/feedback.ts`. Badge shows open-note count,
│                                click it to list/mark-done/delete. Needs the migration in §10
│                                run before it actually persists.
```

Every page listed above under `pages/` (Home/People/PersonDetail/Groups/GroupDetail/Events/EventDetail/FamilyTree) is split into a data-fetching container plus a pure, exported `*View` component (2026-07-23) — `src/pages/demo/` (`DemoShell.tsx` + a one-time `DemoIntro.tsx` welcome walkthrough + 10 thin containers) and `src/lib/demoData.ts` (a fictional "Gary Pemberton" persona, zero real data, zero API calls) feed that same static data into each real `*View` for the public landing-page demo (see §7's "See a live demo"), so a future UX edit to any of those `*View`s updates the demo automatically.

`src/pages/demo/DemoIntro.tsx` (2026-07-23, founder feedback — a first-time visitor dropped straight into a populated fake account had zero context): full-screen 6-step reading sequence (own `Stage`/dot pattern mirroring Onboarding.tsx's, DemoShell's own color palette) shown once per `DemoShell` mount, before the tab nav — Welcome, then one pain-point-framed paragraph each for Home/People/Events/Groups/Notebooks, referencing real Gary Pemberton specifics. Skip on every step. Plain `useState` in `DemoShell` (`introSeen`), no persistence — `DemoShell` fully unmounts on "Exit demo," so re-entering shows the intro again by design.

`App.tsx` is the traffic controller: auth state, first-run onboarding gate (`onboardingPending`/`checkOnboarding()` — see Onboarding.tsx above), tab nav (Home/People/Events/Groups), a generic `navStack: Crumb[]` breadcrumb stack any page can push person/group/event crumbs onto, persisted to sessionStorage (`boomer-nav`) so refresh stays put. Voice input + AutoGrowTextarea are on every conversational text box (Home, event chat, group chat, fact bar). `authView` (`'landing' | 'login' | 'signup' | 'demo'`) also gates `DemoShell` in when `!session`. **Address bar now mirrors `{view, navStack}`** (2026-07-23, founder-requested — the URL used to never change while clicking through the app): `buildPath()`/`parseNavFromPath()` turn it into `/:tab` or chained `/:crumbType/:crumbId` segments. Deliberately the LIGHTWEIGHT of two options offered (the other being a full router-library rebuild) — no new dependency, sessionStorage stays the full-fidelity same-tab-refresh mechanism (real labels/memberIds); `history.state` carries the same full-fidelity payload for Back/Forward (`popstate` reads it directly, no lossy re-parsing needed in-session); `parseNavFromPath()` is only a fallback for a fresh tab/pasted link with neither sessionStorage nor `history.state` available — it reconstructs the right page (every detail page re-fetches by id anyway) but breadcrumb/back-button TEXT falls back to showing the raw id instead of a real name in that one lossy case. Not real client-side routing — no router library, no deep architecture change, verified live (forward nav, browser Back, browser Forward, hard reload, and the no-sessionStorage fallback all confirmed working against the real account).



---

## 2026-08-27 — Archive: the old §6 Database section (migration histories and rationale)

_Archived verbatim from `PROJECT_CONTEXT.md` §6 when that section was compressed (founder budget
directive, 2026-08-27). Every table and column survives in `PROJECT_CONTEXT.md`; what moved here is
the paragraph rationale, migration chronology and dated verification narrative that hung off them.
Search by TABLE or COLUMN name when you need the "why" behind a schema decision._

## 6. Database (Supabase / Postgres, RLS on everything, scoped to auth.uid())

```
people        id, user_id, name (first), last_name?, nicknames? (comma-separated
              "goes by" list, additive, chat-only, never displayed), middle_name?,
              goes_by_kind? ('first'/'middle'/'last'/'other', null = 'first'),
              goes_by_other? (free-typed callsign, only set when goes_by_kind =
              'other') — 2026-07-22, real form-edited "goes by" name shown on
              PersonDetail (picks which of first/middle/last/other displays as
              the person's name there — e.g. "Maverick Whitfield"; People list
              stays name-only). middle_name/goes_by_other also fold into the same
              nicknames-style lookup for search + AI chat resolution across
              converse/update-moment/update-group/person-facts/add-fact. Choosing
              "other" additionally writes a "Goes by X." note. former_last_names?
              (2026-08-21, comma-separated, additive — maiden/former SURNAMES only;
              unlike every other alias field it folds into the SURNAME side of name
              matching, never givens, which is why it isn't just more nicknames —
              see §12), key_facts jsonb?,
              key_facts_updated_at?, is_self bool (default false, partial unique
              index per user_id — at most one "this is me" profile; excluded from
              People list/search/Dunbar/due-for-update, 2026-07-20), deceased_date?
              (2026-07-24, presence = deceased; PersonDetail "Mark as deceased"
              control lives inside the name-edit form, not a standalone row),
              organization?, job_title?, phones/emails/urls/social_profiles jsonb
              (arrays of {label, value}), addresses jsonb (array of {label, street,
              city, state, zip, country}) — 2026-07-27, item 65 (contacts import).
              Own isolated query in PersonDetail.tsx's new ContactInfoSection.tsx
              (same "isolate a new column" pattern as gender), not folded into the
              main person select. created_at
contact_import_
candidates    id, user_id, row_key (dedupe key: vCard UID, else hash of normalized-
              name+first-email), status ('pending'/'selected'/'skipped'/'accepted'/
              'rejected' — the extra 'pending'->'selected'/'skipped' step is
              deliberate, see item 65), full_name, first_name?, last_name?,
              middle_name?, nickname?, organization?, job_title?, phones/emails/
              addresses/urls/social_profiles (same shapes as people above),
              birthday_month/day/year?, anniversary_month/day/year?, note_text?,
              related_names jsonb [{label, name}] (Apple's X-ABRELATEDNAMES —
              captured/displayed only, NOT written to `relationships`, see item 65),
              matched_person_id?, match_confidence ('high'/'none'), created_at,
              reviewed_at? — 2026-07-27, item 65. unique(user_id, row_key).
relationships id, user_id, person_a_id, person_b_id, kind (spouse/sibling/partner —
              symmetric, stored once normalized person_a_id < person_b_id by uuid
              sort; parent — directional, person_a_id IS THE PARENT of person_b_id,
              no separate "child" kind stored), created_at, unique(person_a_id,
              person_b_id, kind) — 2026-07-20, THE shared source of truth for family
              links: `_shared/relationships.ts` dual-writes here alongside its
              reciprocal notes, `person-facts` cross-references it for Key Facts
              linking, `converse`/`update-moment`/`update-group` read it for "my
              mom/dad" resolution, Circle.tsx/FamilyTree.tsx read AND write it
              directly. Backfilled once from existing deterministic reciprocal-note
              text (exact-name match only, best-effort, not exhaustive). Sibling/
              parent links auto-propagate across the WHOLE transitive sibling group
              on every add, not just the pair being linked (`syncFamilyClique` in
              `_shared/relationships.ts` and `writeRelationship.ts`, 2026-07-21) —
              adding a sibling links them to every existing sibling too and shares
              all parents across the group; adding a parent to anyone in the group
              gives it to the rest of the siblings as well. Retroactive backfill
              for pre-existing data run 2026-07-21 (`migrations_manual/
              2026-07-21-family-clique-backfill.sql`, 165 → 177 relationship rows).
              **2026-07-25 fix (see §3 writeRelationship.ts entry):** the clique BFS above only
              ever walked EXISTING sibling rows, so two kids given the same parent independently
              never became siblings — now also seeds from shared parentage. Spouse relationships
              now also auto-propagate to a co-parent role on the other's existing kids (guarded
              against remarriage). Backfill for pre-existing data: `migrations_manual/2026-07-25-
              shared-parent-sibling-backfill.sql` + `2026-07-25-spouse-coparent-backfill.sql` —
              **NOT YET RUN**, see §10.
              ended_reason? (2026-07-24, spouse/partner only, only value is
              'divorce' — death is read off the person's own deceased_date instead,
              so there's one place to record each fact; see FamilyTree.tsx entry
              below for how this renders).
moments       id, user_id, raw_description (user's words only — never assistant
              turns), summary? (AI cache), occasion?, location?, when_text?
              (free-text, kept verbatim), event_date? (best-guess real date —
              exact when sourced from a calendar sync's DTSTART, AI-guessed
              otherwise — sorting/display only, NOT ground truth; null = fall
              back to created_at), event_end_date? (2026-07-25, date range
              support — nullable, null = single-day/unknown; exact from a
              calendar sync's DTEND when present, RFC5545's exclusive-end-date-
              for-all-day-events nuance handled in `_shared/ics.ts`;
              `formatDateRange`/`formatFullDate`/`formatEventWhen` in
              `lib/dates.ts` render a "Mon D–D, YYYY" range when set and
              different from event_date), details jsonb? (open-ended tags by
              design), weather jsonb? / weather_fetched_at? / game jsonb? /
              game_fetched_at? / game_candidates jsonb? / game_dismissed bool
              (2026-08-17, item 21 — enrichment caches written by `enrich-event`.
              THREE states each and the difference matters: null = never looked,
              `{"status":"not_found"}` = looked and found nothing (never re-fetch),
              `{"status":"ok",…}` = real data. A fourth, `{"status":"too_soon"}`,
              parks a future-dated event — the weather archive 400s on any date
              past today — and is the one value the function revisits, once the
              date has passed; same for a game stored while still `Scheduled`,
              whose 0–0 isn't a real score. game_candidates drives the "Which
              game was this?" picker; game_dismissed is its "not a game"),
              dismissed_person_ids jsonb [], created_at, parent_moment_id
              uuid? (item 35, 2026-07-30 — self-referencing FK, ON DELETE SET NULL,
              CHECK parent_moment_id != id; sub-events, e.g. a day of a multi-day
              vacation nested under the trip — one level deep only in the UI,
              arbitrary depth in schema, mirrors groups.parent_group_id exactly.
              Migrated live 2026-07-30. Sub-events render as the ancestor chain
              "Trip / Day 2" in every list an event is PICKED from, matching
              subgroups (2026-08-16, lib/momentDisplayName.ts) — pickers add the
              event date too ("… — June 12, 2026"), which is what separates two
              same-titled TOP-LEVEL events a repeating calendar entry produces.
              Covered: ImportReview merge + sub-event pickers and their banners,
              EventDetail's merge-a-duplicate picker, PhotoImportReview's
              attach-to-event picker, Calendar's Countdowns pin-an-event picker,
              global search event rows. Search filters match the qualified label,
              so typing a trip's name finds the days under it. Read-only event
              lists (a person's/group's affiliated events) stay bare. Every page
              gets parentage from lib/moments.ts's fetchMomentParentIds() — its
              own fail-open query, never a column on the page's main select, so a
              missing parent_moment_id costs the prefix and not the page)
notes         id, person_id? , moment_id?, group_id? (CHECK: person_id OR group_id
              OR moment_id, widened 2026-07-25 for ImportReview's "save as a note"
              action — also needed a new RLS policy for the moment_id-only case,
              see ImportReview.tsx entry above; existing person_id/group_id
              policies untouched), source? ("home" = written by converse,
              "calendar_import" = ImportReview's save-as-note action),
              source_group_id? (fact captured via a group chat), content,
              created_at — attendance on an event IS the existence of a note with
              that moment_id; untagging nulls moment_id, never deletes.
              ⚠ two FKs to groups: embeds must be qualified
              (groups!notes_source_group_id_fkey) or PostgREST errors (PGRST201).
dismissed_suggestions
              id, user_id, kind ('family_coparent'/'family_couple'/'event_group'/
              'family_group', CHECK-constrained — the 4th added 2026-08-20 by
              migrations_manual/2026-08-20-family-group-suggestion.sql, applied),
              subject_id, object_id, created_at; UNIQUE
              (user_id, kind, subject_id, object_id). Item 85, 2026-08-08 — the "No"
              store for Home's newer suggestion types (lib/dismissedSuggestions.ts).
              NO foreign keys on subject_id/object_id: what they point at depends on
              kind (people/moments/groups), and an orphan row after a delete is
              harmless. family_couple and family_group both normalize subject < object so the pair matches
              however it's generated next time. Migrated live 2026-08-08.
              person→group dismissals still live in groups.dismissed_person_ids.
reminders     id, person_id, label ("Birthday"/"Anniversary"), month, day,
              year? (2026-07-26, nullable — captured when a birthday-calendar
              import provides one; FIRST used in the UI 2026-08-06, by the Calendar
              Countdowns section: a life date only becomes a milestone count-up once
              the year is known) — no automatic sending exists.
countdowns    id, user_id, label?, target_date?, moment_id? (FK moments, ON DELETE
              CASCADE), reminder_id? (FK reminders, ON DELETE CASCADE), hidden bool
              default false, created_at — 2026-08-06, item 83
              (`migrations_manual/2026-08-06-countdowns.sql`). Three row shapes, one
              CHECK (`countdowns_has_subject`): standalone (label + target_date),
              pinned event (moment_id only), or a dismissal (moment_id/reminder_id +
              hidden). A pinned event deliberately stores NO label/date — both are
              read live off the `moments` row, so re-titling or re-dating the event
              keeps its countdown right (same one-truth reasoning as notes.moment_id
              being attendance). `hidden` exists because auto-derived cards (past
              "Milestone"-tagged moments, dated reminders) have no row to delete and
              dismissing one must never delete the event/birthday itself. Partial
              unique indexes on (user_id, moment_id) and (user_id, reminder_id) make
              a double-pin/double-dismiss a no-op. No sort_order — ordering is
              computed (one chronological line, oldest first, split by the Today
              line). Per-card settings, 2026-08-06,
              `migrations_manual/2026-08-06-countdown-settings.sql` (SEPARATE, still
              pending — see §10): custom_title? (display name only, so a pinned
              event's own title stays the source of truth), units? text[] of
              years/months/weeks/days/hours/minutes/seconds (NULL/empty = the
              automatic ladder; deliberately not an enum), repeat_rule? weekly/
              monthly/yearly (CHECK), keep_counting bool default true (false =
              retire the card once its date passes instead of counting up). Saving
              any of these on an auto-derived card creates its row first — same
              insert as a pin.
pets          id, user_id, name, species? (FREE TEXT, deliberately no CHECK —
              contrast groups.group_type), breed?, birth_date?, adopted_date?
              ("gotcha day"), deceased_date? (presence = passed away, mirrors
              people.deceased_date), notes?, attributes jsonb [] ({label, value},
              same shape as people.phones — the "customizable for the variety of
              pets" requirement: Barn/Tank/Vet/microchip live here, not in
              columns), created_at — 2026-08-01, migration pending (see §10).
              Deliberately a real table, not a jsonb column on people: a household
              pet belongs to both spouses and must be edited once (same
              shared-identity reasoning as tags/groups). NO unique index on name —
              two people in one account can each have a dog named Bella.
person_pets   person_id + pet_id (PK), index on pet_id (reverse lookup: who owns
              this pet). RLS policy is a subquery through pets (no denormalized
              user_id), so a mistake here fails SILENTLY — verify with a
              write-then-read-back, not a passing build. Deleting every linked
              person leaves an orphan pets row (accepted: auto-deleting the pet
              with its last link would destroy a shared household pet during a
              merge). Orphans are NOT unreachable — they still list in the People
              list, just with no owner chips, so they can be opened and deleted.
moment_pets   moment_id + pet_id (PK), index on pet_id (reverse lookup: which
              events this pet was at) — 2026-08-20,
              migrations_manual/2026-08-20-moment-pets.sql, APPLIED and live-
              verified. A pet's attendance is a row here, NOT a notes row the way a
              person's is: reusing `notes` would mean widening its CHECK + RLS on a
              table holding 700+ real notes and teaching every note path that an
              attendee might not be a person. Consequence: a pet has no per-event
              note, so tagging one deliberately does NOT null moments.summary (no
              AI regeneration for text that never mentions the pet). RLS checks
              BOTH sides (pets AND moments), unlike person_pets — moment_id is
              client-supplied, so a one-sided policy would let an account tag its
              own pet onto someone else's event. Subquery policy, so mistakes fail
              SILENTLY: verify with write-then-read-back.
moment_links  id, user_id, moment_a_id, moment_b_id (both FK moments ON DELETE
              CASCADE), created_at; unique(moment_a_id, moment_b_id), CHECK
              moment_a_id < moment_b_id, index on moment_b_id — 2026-08-26,
              migrations_manual/2026-08-26-related-events.sql, APPLIED. "Related
              events": a SYMMETRIC link between two events where neither is part of
              the other (rehearsal dinner ↔ wedding) — the case parent_moment_id
              can't express and merge would destroy. Stored ONCE with the pair
              sorted, same convention as `relationships`; the CHECK is what makes
              the unique index a real duplicate guard, so every caller must go
              through lib/relatedEvents.ts's normalizeLinkPair. Two FKs to `moments`
              means embeds would need qualifying (PGRST201) — the lib does two
              round trips instead. RLS checks user_id AND both moments belong to
              the caller; verified live by an insert as role `authenticated` inside
              a rolled-back transaction (and a different sub is refused, 42501).
groups        id, user_id, name, summary? (AI cache), group_type? (Family/Friend
              group/School/Team/Work, nullable, fixed picker, CHECK-constrained),
              dismissed_person_ids jsonb [], dismissed_group_ids jsonb [], created_at,
              color_index smallint? (item 82 manual override, 2026-08-12 — index into
              subgroupPalette in src/lib/theme.ts, NOT a hex, so the palette stays the
              source of truth; NULL = auto-assigned by position. Read by GroupDetail.tsx
              in its OWN isolated query, never folded into the subgroup select, so a
              pre-migration 42703 hides the swatch instead of emptying the subgroup grid.
              Migration pending, see §10),
              suggestions_enabled bool (item 57, 2026-07-25 — per-group opt-out for the
              member-suggestion signal, read by GroupDetail.tsx and
              lib/suggestConnections.ts; migrated live 2026-07-26; default flipped
              true→false 2026-07-26 per founder feedback — not used in practice — pending
              founder SQL run, see §10), parent_group_id uuid? (item 19, 2026-07-26 —
              self-referencing FK, ON DELETE SET NULL, CHECK parent_group_id != id;
              nested subgroups, e.g. a mission under a squadron or a class year under a
              school group — ARBITRARY DEPTH in both schema and UI as of 2026-08-03 (was
              one level deep in the UI only, a gate on !parentGroup in GroupDetail.tsx;
              migrated live 2026-07-26). Subgroup membership WRITES are deliberately
              independent of the parent's — still no sync trigger, and still no downward
              auto-population (a new subgroup starts empty). One was added by mistake
              2026-07-26 and removed same day before ever being run. Upward, though, a
              subgroup's members ARE the parent's members as of 2026-08-10 (founder ask):
              DERIVED at render by lib/groupRollup.ts, at any depth, never written to
              person_groups — the row stays on the subgroup, so removing someone there
              removes them from every ancestor with nothing to keep in sync. A person
              can sit in several sibling subgroups at once, which is why GroupDetail's member
              chips carry a LIST of colour dots, not one. There is NO colour column: subgroup
              colours are assigned in the client by position (2026-08-04, see lib/
              subgroupColors.ts) and persist nowhere. Subgroup
              names render as the FULL ancestor chain "A / B / C" APP-WIDE (full chain
              2026-08-03, immediate parent only 2026-08-01, pickers-only 2026-07-30) so
              same-named subgroups under different parents (e.g. two units each
              with a "Pilots") stay distinguishable — lib/groupDisplayName.ts owns the format,
              lib/groupRoster.ts's useGroupRoster() hook serves label(id, fallbackName) to any
              site holding only {id, name}. groupDisplayName's 3rd arg (parentById) is what
              turns on full-chain walking — callers passing only a name map still get the old
              one-level label. Same file exports isSelfOrDescendant(), the cycle guard every
              reparenting path uses. Two deliberate BARE exceptions: a group's own h1 on
              GroupDetail (has "↑ Part of X" one line below, and the rename field edits the bare
              name) and the subgroup tiles on the parent's own page. Search filters match on the
              qualified string, so typing a parent's name finds its subgroups.
              Groups.tsx nests subgroups under their parent AT REST as of 2026-08-03 (superseding
              the 2026-08-01 search-only behaviour), so its summary auto-generation now covers
              subgroups too — still one summarize-group call per group EVER, cached in
              groups.summary (CLAUDE.md rule 3). See §3 Groups.tsx.
person_groups person_id + group_id (PK) — THE definition of membership (explicit
              only; event attendees are never members, only suggestions). A row is only
              ever written for the group it was added to: what the UI shows as a group's
              members is these rows PLUS the subgroup rollup (see groups.parent_group_id
              above), computed at render, never stored.
group_associations id, group_id_a, group_id_b (symmetric, normalized a<b by UUID
              string sort), created_at
moment_groups moment_id + group_id (PK)
tags          id, user_id, name, created_at — item 28/34 (2026-07-22), manual + AI-
              suggested event tags. unique index on (user_id, lower(name)) — case-
              insensitive dedup so "Milestone"/"milestone" can't fork into two
              filter entries. Deliberately NOT the dormant `moments.details` jsonb
              or a `text[]` column — neither gives a canonical tag identity for
              cross-event reuse/dedup the way a real table does (mirrors why
              `groups`/`moment_groups` is a real table, not a text array on
              `moments`). `details` itself untouched, still dormant for writes.
moment_tags   moment_id + tag_id (PK), index on tag_id (reverse lookup, e.g. future
              search/co-occurrence features) — join table, same shape as
              moment_groups
search_log    id, user_id, query_text, matched bool, created_at — one row per
              genuine recall attempt in Home; powers "Recall assists this month"
home_suggestions user_id (PK), suggestions jsonb, updated_at — suggest-prompts cache
feedback_notes id, user_id, page_label?, element_label?, note, status ("open"/"done",
              default "open"), created_at — click-to-comment feedback widget (§3
              FeedbackWidget.tsx), live and confirmed working (2026-07-23: 8 real
              founder notes captured then folded into §8's backlog as items 46-53)
user_settings user_id (PK), chat_tone (text, CHECK-constrained to 'warm'/'direct'/
              'playful'/'formal', default 'warm'), updated_at — 2026-07-23, items
              22/49. Same one-row-per-account shape as home_suggestions. Read by
              `converse` via `_shared/userSettings.ts`'s `buildChatToneInstruction`,
              appended into the roster cache tier (never the stable tier — see §5).
              time_zone (text, nullable, no default) — 2026-07-24, bug fix (see §12).
              Null means "not yet detected"; `_shared/userSettings.ts`'s
              `getUserTimeZone` defaults to 'UTC' server-side when null.
              **Applied live 2026-07-24 — confirmed via PostgREST 200.**
calendar_sources id, user_id, ical_url, label, last_synced_at?, last_sync_error?,
              created_at, source_type ('events'/'birthdays', default 'events',
              2026-07-26) — 2026-07-24, item 48. One row per connected calendar
              (secret iCal URL, not an OAuth token — nothing to refresh/expire).
              A 'birthdays' source is meant for iCloud's auto-generated Birthdays
              calendar (itself derived from Contacts, so connecting it is a real,
              always-current sync — no re-export needed as contacts change) —
              see CalendarSettings.tsx and birthday_import_candidates below.
moment_import_
candidates    id, user_id, calendar_source_id, ical_uid (unique per user, dedupes
              across re-scans), deferred_until date? (2026-08-19, set with
              status='deferred'; a partial index covers the due-row sweep),
              status ('pending'/'accepted'/'rejected'/'skipped'
              — 'skipped' added 2026-08-12 and retired the same day when the
              founder removed the AI filter; nothing writes it now, the
              constraint value is just left in place for a possible opt-in
              auto-filter — and 2026-08-19 deliberately did NOT reuse it for the
              founder's own "not this one", which writes 'rejected'; keeping a
              machine's no separate from a person's is why it exists.
              **Two values added 2026-08-19**
              (`migrations_manual/2026-08-19-calendar-triage-and-defer.sql`):
              'selected' = kept in CalendarTriage.tsx's fast pass, waiting for its
              detailed card (same word, same job as in
              contact_import_candidates); 'deferred' = "Not now", returns to the
              queue on `deferred_until`. So the flow is pending → selected →
              accepted/rejected, with deferred as a loop back to selected. No rows
              were migrated — existing 'pending' rows simply show up in triage,
              which is where an untriaged candidate belongs), occasion?,
              location?, when_text?, event_date?, event_end_date? (2026-07-25, both
              exact from the ICS DTSTART/DTEND, bypassing the AI entirely — see
              `icsEndDateToIsoDate` in `_shared/ics.ts`), raw_description?,
              suggested_people (jsonb array: name/email/matched_person_id/
              confidence), suggested_tags jsonb [] (2026-07-25, tag names from the
              same extraction call, may propose new), suggested_group_ids jsonb []
              (2026-07-25, resolved server-side, existing-groups-only — never
              invented), source_recurrence_id?, created_at, reviewed_at? —
              2026-07-24, item 48. AI-extracted review queue; ImportReview.tsx
              accept copies pending/approved fields into a real `moments` row (or
              merges into an existing one — see ImportReview.tsx entry above),
              reject just flips status.
birthday_import_
candidates    id, user_id, calendar_source_id, ical_uid (unique per user — same
              dedupe/never-re-ask pattern as moment_import_candidates), status
              ('pending'/'accepted'/'rejected'), full_name?, birthday_month?,
              birthday_day?, birthday_year?, matched_person_id?, match_confidence
              ('high'/'none'), created_at, reviewed_at? — 2026-07-26. Populated
              ONLY from 'birthdays'-type calendar_sources, parsed directly (no AI
              call — pure ICS text, no cost) by `processBirthdaySource` inside
              scan-calendar-sources/index.ts. BirthdayImportReview.tsx (new page,
              crumb `birthdayReview`) is the accept/reject queue: accept upserts a
              `reminders` row (label='Birthday', + year if present) on either an
              existing matched person or a newly-created one (search-to-link
              picker if the match is wrong/missing), reject just flips status.
              Nudge banners on Home.tsx/Calendar.tsx mirror the existing "N events
              found" ones. **Applied live 2026-07-26 — confirmed via PostgREST/
              Management API, end-to-end accept/reject flow verified in browser
              against a disposable test account.**
photo_connections id, user_id (FK, unique), google_email?, refresh_token, created_at —
              2026-07-30, item 27. One row per connected Google account. **No SELECT policy
              for the authenticated role at all** — refresh_token is as sensitive as an API
              key, readable only by service-role Edge Functions (same trust boundary as
              ANTHROPIC_API_KEY never reaching the browser). The frontend instead reads a
              sticky `google_photos_email` auth-metadata flag (same pattern as
              onboarding_complete/tags_seeded) to know "connected" without a round trip.
photo_clusters id, user_id, date_range_start?, date_range_end? (date), matched_moment_id?
              (FK moments), status ('pending'/'accepted'/'rejected'), created_at, reviewed_at? —
              2026-07-30, item 27. One row per date-clustered group from a general-import
              picker session (see `_shared/photoClusters.ts`); the quick-add-to-one-event
              flow never creates these. Same "review queue, nothing auto-writes" shape as
              moment_import_candidates, but no AI call anywhere in this pipeline.
photos        id, user_id, moment_id? (FK moments), photo_cluster_id? (FK, null once
              resolved), storage_path, google_media_id? (unique per user — dedupes re-picking
              the same photo), taken_at? (timestamptz, from Google's mediaMetadata), width?,
              height?, created_at — 2026-07-30, item 27. storage_path points into the private
              `photos` Storage bucket (resized ~1600px copies, RLS-scoped per user by folder
              prefix `{user_id}/...` — first Storage usage in this app). A picked item's
              access via Google expires with its picker session, so nothing here is a lazy
              pointer back to Google — the bytes are copied in at import time.
```

```
notebooks     — id, user_id, name, ai_visible (bool, default true), created_at.
                2026-08-18, migrations_manual/2026-08-18-notebooks.sql. The internal
                side (§1). ai_visible gates the Home chat ONLY — `converse` filters on
                it in the query, not at render time; global search always reads every
                notebook, because that's the user searching their own app.
notebook_entries
              — id, user_id, notebook_id (FK cascade), content, entry_date? (date),
                created_at. entry_date is nullable and display/sort only, same as
                moments.event_date. Its presence is the ONLY difference between a list
                and a dated log — there is no layout column, and no mode to pick.
notebook_entry_people
              — (entry_id, person_id) composite PK, both FKs cascade. Two-sided subquery
                RLS copied from moment_tags: `with check` validates BOTH sides so you
                can't attach someone else's person. ⚠ this class of policy fails
                SILENTLY when wrong — verified 2026-08-18 by a write-then-hard-reload,
                not by watching the UI.
```

```
notebook_entries.content_text
              — 2026-08-19. `content` is editor HTML; this is the same thing flattened
                to words. STORED, not derived, because neither reader can derive it:
                search would match "strong" inside every bold word, and `converse` runs
                on Deno with no DOM. Written together with `content` in lib/notebooks.ts
                so they can't drift. Null on rows written before the editor existed —
                readers fall back to `content`, which for those rows IS plain text.
notebooks.locked
              — 2026-08-19, bool default false. Enforced INDEPENDENTLY of ai_visible:
                `converse` and searchCorpus both filter on `locked = false` in their own
                right, so a locked notebook stays out of chat even if ai_visible is true.
                Verified 2026-08-19 by setting locked directly in the DB with ai_visible
                left on — Grove reported no notebook entries at all.
notebook_pins — user_id PK, pin_hash, created_at. One PIN per ACCOUNT, not per notebook.
                Hashed with pgcrypto `crypt()`/`gen_salt('bf')` server-side; the PIN is
                never stored or compared in the browser. Three SECURITY DEFINER RPCs:
                notebook_pin_status() (does one exist), set_notebook_pin(new, current)
                (requires the current PIN once one is set), verify_notebook_pin(pin).
                Reset path is Supabase's own password re-auth, so a forgotten PIN never
                strands a notebook.
```

`user_settings.review_remind_days` (integer, nullable — `2026-08-19-review-remind-default.sql`): the founder's saved "remind me in N days" for the import queues, set by RemindSheet's "use this as my default" checkbox. Null = ask every time. A plain day count rather than an enum so the offered presets can change without a migration; nothing else in the schema stores a cadence (`reminders` is date-based, countdowns are target dates).

`dismissed_*` columns only filter suggestion lists; conversational writes never consult them, so a denied person can still be added by name in chat.

`platform_stats()` — one deliberate exception to "RLS on everything": a `SECURITY DEFINER` SQL function (`migrations_manual/2026-07-30-platform-stats.sql`) returning cross-account totals (people/moments/groups/notes) for the Landing page's platform databox (§3). Granted to anon/authenticated (public page, no session) — **confirmed live 2026-07-30**, real cross-account totals rendering on Landing.



---

## 2026-08-27 — Archive: the old §8 Backlog and §10 Pending sections

_Archived verbatim from `PROJECT_CONTEXT.md` when both were compressed (founder budget directive,
2026-08-27). Completed/struck-through items were deleted from `PROJECT_CONTEXT.md` outright; open
items were cut down to a title plus what you need to act on them. The full text of both — including
every DONE item with its build story — is below. Search by item NUMBER or feature name._

## 8. Backlog — MASTER LIST (founder's priority list; work order: bugs → quick wins → bigger features)

Items 1–13 (bugs + quick wins) all done 2026-07-18. Also done 2026-07-19: event delete/merge, associated groups, chat layout fix, last-name sort, note source labels, group notes. Also done: 25 (2026-07-20: sibling-group transitive linking + reciprocal-write-on-confirm fix, deployed and confirmed live — see §10); 36 (2026-07-20: manual "add an event" / "add a group" buttons, plus group delete — see §7); 35/Group Types (2026-07-20: `group_type` column + fixed picker on GroupDetail + filter/badge on Groups — see §7); **32 (2026-07-20: real `is_self` flag + `relationships` table, real "My page"/family tree, "my mom/dad" resolution — see §7, DEPLOYED and DB-migrated live, see §10)**.

**Open — bigger features:**
14. ~~Global search bar on every page~~ — **DONE 2026-08-12** (see §7 and the §3 entries for `globalSearch.ts`/`searchCorpus.ts`/`GlobalSearch.tsx`). The "text match first vs. semantic" question was the founder's call: **text first**, with a one-tap `Ask Grove about "…" →` row handing the query to Home chat. Reasoning on file: a search bar gets hit reflexively and repeatedly, there's no rate limiting anywhere (SECURITY.md item 7), and the semantic half already ships inside `converse` — so per-keystroke AI would have been both a duplicate and the most plausible route to a surprise bill (CLAUDE.md rule 3). **Item 30 is therefore not "still open" so much as deliberately routed through the chat** — revisit only if real use shows word matching missing things the chat catches. Placement was the other founder call: in the nav row (not a second full-width row), accepting that the "Grove" wordmark hides under 480px to pay for it. **Moved same day on founder report** — as a bare magnifier circle beside the account avatar it sat ~6px from the initials and opening the account menu by mistake was easy. It's now the 6th item in the TAB row, shaped like a tab (icon + "Search" label, never the active style — it opens a panel, it isn't a place you can be), and the bar's `gap` went `space.sm` → `space.xl`. Net at 375px: search target 34×34 → 47×45, gap to the avatar 6px → 16px, all six tabs 47px (still over the 44px minimum), "Calendar" 42px in 47px, zero overflow. Client-side over a ~2,400-doc corpus, no migration, no new Postgres FTS. Verified live against the real account: note-body-only matches ("skydiv" surfacing an event by its description and three notes by theirs), qualified group paths ranking correctly, zero `Was there.` placeholders, note results opening their parent record, 375px nav re-measured at zero overflow.
15. **Relationship-aware smarts** umbrella — partially unblocked by item 32's `relationships` table: "resolve 'my parents'" is DONE (`converse`/`update-moment`/`update-group` all do it now). **Background GROUP-connection scanning + approval log on Home — DONE 2026-07-25** (see item 50/§3 Home.tsx "Connections to make" card, `lib/suggestConnections.ts`) — deliberately scoped to group membership only (deterministic, free), not person-to-person relationship inference, to avoid a recurring AI cost on every Home visit (CLAUDE.md rule 3); a richer AI-based version remains a possible future upgrade, not built. Still open: answer via family links ("Braden's dog" → spouse's note) — **the pets half of this is now unblocked by item 73's `pets`/`person_pets` tables (2026-08-01): a household pet is LINKED to both spouses, so "Braden's dog" resolves off the roster without walking the relationships graph at all — and `converse` has loaded that roster (and written pets back) since 2026-08-01 — **verified 2026-08-19**, `converse` reads `pets`/`person_pets` as two separate top-level queries and inserts/updates pets from chat, so this half is DONE**; auto-suggest links from note content beyond what already exists (person-to-person relationship scanning specifically, as opposed to the group-connection scanning now done).
16. Auto-notes from chat for every person mentioned (events do this; extend everywhere).
17. Long story/voice-note handling (1–2 min recording parsed into all its facts) — **partly addressed, never tested against a real long story.** Three pieces landed for other reasons: `converse` is instructed to emit ONE `moments` entry per distinct event in a single message and to capture every concrete detail (not just who attended); a reply truncated at `max_tokens` (8192) is now detected by `stop_reason` and the reply text salvaged rather than the whole turn failing; and item 18's streaming transcription means a long dictation reaches the box at all. **Still open: nobody has spoken a 1–2 minute story at it and checked what came out** — that test is the item now, not more prompt work.
18. ~~Real-time voice transcription (words appear as you speak)~~ — **DONE 2026-08-18.** `gpt-transcribe` with `stream: true`, proxied through `transcribe` as SSE, so text lands in the box progressively instead of in one lump. Measured on the founder's account: a 71s note is fully transcribed 5.3s after you stop, first words at ~4s; a 9s note, 1.8s total. Free Web Speech captions give true words-as-you-speak on desktop/Android; **iPhone gets the streamed version only** — Web Speech exists in iOS Safari but fires `onresult` once and dies. Truly-live-on-iPhone would need `gpt-live-transcribe` at $0.017/min (~3.8x), declined by the founder for now.
19. ~~Group hierarchy~~ — **subgroups DONE 2026-07-26, migrated and verified live.** Founder's real ask, clarified 2026-07-26: nested subgroups under an existing group (e.g. a specific mission under "22 AS", or class year/staff/role under "Wings of Blue"), each with independent membership, so events can be tagged to the specific subgroup. Shipped as a self-referencing `groups.parent_group_id` — see §3 GroupDetail.tsx/Groups.tsx entries and §6. **Extended 2026-08-03 (founder ask):** the UI's one-level cap is gone (arbitrary depth, subgroups of subgroups), and an EXISTING group can now be reparented two ways — drag its card onto another group's card on Groups.tsx, or "Move this under another group…" / "Make it a subgroup instead" in GroupDetail's danger zone. Both replace the founder's workaround of creating a blank subgroup in the target and merging the real group away into it. NOT browser-verified before pushing (founder said push; build + 79 tests green, click-through never ran — no logged-in session available that session). Because a subgroup is just a normal `groups` row, every existing group-picker (EventDetail's "Associate a Group", ImportReview, PersonDetail's "Associated Groups") already worked on it with zero extra code, confirmed live. Still open, deliberately deferred (founder feedback 2026-07-26, given the 2026-07-26 auto-add-to-groups revert): a "rules engine" auto-deriving group C from group A + group B membership — if revisited, should suggest-and-confirm rather than silently auto-write, same as item 15's connection scanning.
20. Data viz: family tree, connection map. — **connection map is the only part still open.** Family-tree half substantially DONE 2026-08-05 (relationship calculator: compare any two people, per-tile relation labels, profile chip, AI vocabulary — see §7). Connection map still open. **Tree health check DONE 2026-08-19** — `src/lib/treeHealth.ts` (`findTreeIssues`, pure, 11 tests) + a collapsed panel at the bottom of `FamilyTree.tsx`, free and instant because it runs over the Graph the page already loaded. Six checks: a parent chain that loops, someone related to themselves, a couple who are also parent/child or siblings, a parent who is also a sibling, and — worded as questions, not faults — a third parent and two current partners. Found three real ones on the founder's account first run (Louise/Chet Schwartz as both a couple and siblings; the two Dunn boys with three parents, the known blended shape). The date-based checks from the original list (a child older than a parent) are NOT built: the Graph carries no birth years, and joining `reminders` into `loadFamilyGraph` is another whole-table read. Adjacent ideas surveyed with the founder 2026-08-05 and still NOT built, roughly in value order: birth years/lifespans on tiles (the tree never joins `reminders`, so no dates appear anywhere on it); search-and-jump within the tree; export the tree as an image (it's already SVG); zoom/fit-to-screen (the canvas is fixed-width with horizontal scroll, painful on a phone); duplicate detection + merge; GEDCOM import/export; photos on tiles (blocked — people have no photos at all, `photos` is moment-scoped); tree statistics.
21. ~~Internet lookup for added context.~~ — **DONE 2026-08-17.** Two boxes under an event's date/location line (`src/components/EventEnrichmentBoxes.tsx`, filled by the `enrich-event` Edge Function): the game it was — score, venue, attendance, ESPN's recap headline and a link to the ESPN summary — and that day's weather (high/low, condition, precipitation, wind, plus the temperature at first pitch when a game supplied a real start time). **Zero Anthropic tokens:** "is this a sports game?" is a 1,652-team dictionary lookup (`_shared/sportsDetect.ts` + `sportsTeams.generated.ts`, regenerated by `scripts/build-sports-teams.mjs`), never a model call, so this keeps working even while `ANTHROPIC_API_KEY` is down. Pro **and** college leagues per the founder; when more than one real game matches, it never guesses — a "Which game was this?" picker appears, same accept/dismiss shape as the family suggestion boxes. Live-verified on the founder's own "Giants vs Rockies game" (Giants 8–2, 28,805 in attendance, 82°/51° in Denver, 80° at the 2:10 PM first pitch). See §12 for the three silent-failure traps this shook out.
22. ~~Settings page~~ — **DONE 2026-07-23** (v1, see item 49 for what shipped). Of the six candidates speculated here, only chat tone/About shipped in v1; tile colors, suggestion sensitivity, and terminology library remain open (each needs new infrastructure built first — a theme layer, a suggestion-frequency concept, a centralized vocabulary module, respectively). "User's own profile/library" was considered and cut from Settings entirely — that's app navigation (already reachable via the main nav), not a setting.
23. **Security hardening** + honest About-page writeup ("I don't want it to be bullshit") — **two of the seven done: public signup closed 2026-08-01, four browser security headers shipped 2026-08-19. Still open: CSP, AI rate limiting, email confirmation back on, account delete/export, column encryption, CORS lock-down** (SECURITY.md §5 items 6–11 — all deferred deliberately, none urgent while the founder is the only user). Start from §10's reality, audit first. **Audit half DONE 2026-08-01 → `SECURITY.md`** (repo root): full static read of functions/migrations/frontend, plus `migrations_manual/2026-08-01-rls-audit.sql` (read-only) for the founder to verify RLS on the pre-migration tables. Foundation confirmed sound (RLS pattern, JWT gate on all 12 functions, service-role queries scoped by verified `user.id` not request body, secrets server-side only, 3 deps/0 vulns). Hardening half still open, in `SECURITY.md`'s own priority order: close public signup → security headers → AI rate limiting → email confirmation back on → account delete/export → app-layer column encryption → CORS lock-down.
24. Family-dynamic variety (half-/step-/adoptive) — **needs founder decision first**: (a) new relationship types vs. (b) qualifier field on the existing 5; qualifier also changes shared-parent inference (ask which parent, not both). Real example on file: Andy Volin (deceased) was married to Andi Volin, who's since remarried to Michael Galchinsky. **Partially superseded 2026-07-25** (see item 40 follow-up): spouse-as-co-parent auto-linking now ships, gated by a heuristic guard (skip + suggest instead when either side already has another spouse/partner on file) rather than waiting on this full qualifier-field decision — that heuristic catches the Andy/Andi/Michael shape specifically but is not the real half/step/adoptive data model this item is still tracking (e.g. it can't represent "step-parent to one sibling, blood parent to another" once the two are linked as full siblings — syncFamilyClique's existing all-parents-shared-across-the-clique behavior, unchanged, still flattens that). **Further superseded 2026-08-03:** step-parents and step-siblings are now first-class in the family tree (add, view, remove, tagged in the diagram), derived from ordinary spouse/parent rows with the blood-inferences suppressed per-write via `LinkOptions` — no qualifier field needed for those two. Adoptive, and half- vs. full-sibling within a rendered sibling group, are what's left of this item. Still open.
26. Ratings/thumbs feedback loop (tunes suggestions; does not retrain the model).
27. ~~Photo gallery for real~~ — **BUILT 2026-07-30; the three Edge Functions are DEPLOYED — verified 2026-08-20** (`google-photos-oauth-callback`, `-picker-session-create`, `-picker-session-import` all answer 401, not `NOT_FOUND`, which is the documented "deployed" signal). Whether the founder has ever connected a Google account and pulled photos through is a separate, still-unconfirmed question — that is the only thing left here. real import via Google Photos OAuth + Picker API (not upload — founder chose this over a raw-upload/Supabase-Storage-only approach after confirming Google's API no longer allows third-party library scanning; see PROJECT_HISTORY for the full tradeoff discussion). `EventDetail.tsx` real gallery + quick-add; `PhotoImportReview.tsx` general import with date-clustered event-matching review. Person/Group photo rollups NOT included — see item 69. True camera-roll sync still needs the native iPhone app.
28. ~~Manual + AI-suggested tags on events~~ — **DONE 2026-07-22** (schema: new `tags`/`moment_tags` tables, see §6). Manual create-or-reuse picker + hover-remove chip on EventDetail; AI-suggested via `converse` only for v1 (capped 1-3 tags/moment, reuse-biased instruction) — `update-moment`'s chat-based `add_tags` and `suggest-prompts`'s tag signal deliberately deferred until real usage confirms the vocabulary stays clean, not scope-cut for any other reason. Verified live end-to-end against the real account (manual create/reuse/persist/untag, AI auto-tag via Home chat correctly created and applied a new "vacation" tag with no manual step), test data cleaned up after. Pairs with item 34's filter, same schema change powers both. **Same-day follow-up (founder-requested):** the tag picker now browses the full alphabetical list on focus instead of requiring you to already know a tag's exact spelling (`SearchAddPicker`'s new `browseAll` prop); 10 generic starter tags auto-seed once per account (`ensureStarterTags.ts`, guarded so it can't resurrect a deliberately-emptied list); new `ManageTags.tsx` page (linked from Events) lists every tag with usage counts and lets you add/rename/delete outside the context of any one event. Verified live: starter seed fired correctly on the real account's next sign-in (10/10 inserted, left a pre-existing AI-created "Phone Calls" tag alone rather than duplicating), rename/add/delete all confirmed against real + disposable test tags, alphabetical order holds everywhere (picker, chips, filter, Manage Tags list) regardless of creation order.
29. ~~Search within GroupDetail~~ — **DONE 2026-07-26.** `GroupDetail.tsx`'s member list gets a `SearchBox` (same component/pattern as `People.tsx`) once a group has more than 12 members; filters by name, doesn't affect the "show all" expansion. People page's own filter already existed (`People.tsx` `filterPeople`) — no separate work needed there.
30. AI/"fuzzy" semantic search — **resolved by routing, not by building, 2026-08-12 (see item 14).** Global search's `Ask Grove about "…" →` row hands anything word-matching can't answer to `converse`, which already reasons over the whole corpus. A dedicated semantic endpoint stays unbuilt on purpose: `converse` is a zero-tool full-dump design, so a tool-call round trip re-sends the whole ~30k-token prompt, and there is no embeddings/pgvector infrastructure in this project at all. Revisit only with evidence from real use.
31. **"Memory lane" curated media feed** — requested 2026-07-19. A scrollable, media-driven feed surfacing curated memories (vs. today's specific-lookup mode only); best outcome likely needs real event photos, so probably sequences after item 27 (photo gallery). Already named as a target query mode in §9's product philosophy, just not built yet.
32. ~~User's own profile~~ — **DONE 2026-07-20.** Real `is_self` flag + `relationships` table (shared source of truth for family links), real "My page" (`Circle.tsx`) + real family tree (`FamilyTree.tsx`, works for any person), `person-facts` linking and "my mom/dad" resolution both read the same table — see §3/§4/§6/§7. Full build story in PROJECT_HISTORY §15. ~~Still-open UX question (a): empty relationship categories on "Your circle" shown as invite-to-add vs. hidden until populated~~ — **RESOLVED 2026-08-12, invite-to-add.** Hiding would make the four boxes appear one at a time in a shifting layout, and prompting the links that AREN'T recorded is the page's whole job. The boxes were already always-visible; what was missing is that an empty one showed a bare "+" that doesn't say what it would add. `RelationshipAddPicker` gained an optional `emptyLabel` (the family tree's per-tier "+" is untouched) and empty boxes now read "+ Add a spouse/child/parent/sibling". **Verified live** by briefly forcing the empty state in the dev server and reverting: 390×44px at desktop, 134×44px at 375px phone width with no label wrapping and no page overflow. ~~(b) a family tree for a group you're NOT a member of~~ — **RESOLVED 2026-07-21**, see item 41. ~~(c) "+" always targets a tier's first branch when a tier has more than one~~ — **FIXED 2026-07-20**, see item 37.
33. ~~Refer to the user as "You" instead of "User"~~ — **DONE 2026-08-11, item closed.** Requested 2026-07-19. `converse` reply text: DONE (item 53). **Extended 2026-07-26** to member/attendee chips: `EventDetail.tsx`'s `AttendeeChip` and `GroupDetail.tsx`'s `MemberChip` now show "You" instead of the founder's own name, keyed off each page's `selfId` (`is_self` lookup). **Extended 2026-08-10:** `PersonDetail.tsx`'s Key Facts chips now say "You" too (the case that reads worst — "Married to &lt;founder's name&gt;" on their spouse's profile), off an isolated `is_self` query mirroring EventDetail's. The chip still navigates to the founder's own profile; only the wording changed, and the demo (no `selfId` passed) is unaffected. **NOT browser-verified** — no login available that session. **Audit DONE 2026-08-11 — item closed.** The remaining surfaces were Home's: the "Connections to make" cards and the "Most reinforced this month" leaderboard both read the founder's own name off the roster like anyone else's. New `src/lib/personLabel.ts` (§3) now owns both "join first + last name" (four local `fullName` copies collapsed into it) and the self substitution, with a `capitalize` flag because chips want "You" and sentence copy wants "you"; `CoupleGap` gained a `childId` so the shared-child clause can say it too. Wording agrees with the sentence — "Are you also a parent of…" not "Is you", "You share a child" not "They". Everything else was already clean: `People.tsx`, `Groups.tsx`, `DunbarDetail.tsx`, `DueForUpdate.tsx` and Home's people count all filter `.eq('is_self', false)`. The family tree is deliberately untouched (your own name on your own tile in a tree diagram is correct). **Display-only by construction** — `linkRelationship` writes the names it's handed into real note text ("Married to X."), so the suggestion objects keep real names and only the rendered label changes. Verified: `npm run check` green (381 tests, 8 new on the helper), the demo Home renders names unchanged with `selfId` null, and **confirmed live 2026-08-11** on the real account — the "Most reinforced this month" list now reads "3 · JV · You · 7 updates" (avatar initials deliberately stay the real ones), and `personLabel` against the real self row returns "You"/"you"/"Amy Volin" correctly, including the pre-joined shape the cards pass. **The card sentences themselves rendered no live data** — all four suggestion types were at zero that day (3 family gaps exist but are dismissed), so the "Are you also a parent of…" wording is code-verified, not seen.
34. ~~Filterable "View" by event category on the Events page~~ — **DONE 2026-07-22.** Shipped together with item 28: a tag filter dropdown on Events.tsx, growing from distinct tags actually applied (`useMemo`, not a fixed hardcoded set, per the founder's original ask), membership-based (a moment can carry more than one tag) rather than the single-value equality Groups.tsx's type filter uses, plus a "No tags yet" option. Verified live: option list matches tags in use, filtering narrows correctly.
35. ~~Sub-events for multi-day events~~ — **DONE 2026-07-30, migrated and verified live.** Requested 2026-07-19, founder flagged as important. Self-referencing `moments.parent_moment_id` (mirrors item 19's subgroups pattern), one level deep in the UI: "Sub-events" section + "+ New Sub-event" on `EventDetail.tsx`, sub-events bundled/collapsible under their parent on `Events.tsx` (founder-approved mockup) rather than shown flat — see §3 entries for both files. Calendar-import's earlier "Save as a note instead" workaround (2026-07-25, ImportReview.tsx) is untouched and not migrated onto real sub-events — noted as a possible future follow-up, not done here.
37. ~~Family tree bug scan~~ — **DONE 2026-07-20**, three wire-connection follow-ups **2026-07-21/22**, layout engine rewrite **2026-07-22** (item 39), same-day live-bug fix **2026-07-22**: Kids tier now also positions relative to its own parents' tier above (`layoutRelativeToParent`) instead of independently centering on the canvas — root-gen is now the only independently-laid-out tier — fixing left-clipping on wide trees and grandchildren rendering off-anchor. One reported "missing grandparent marriage line" turned out to be a real data gap (no `spouse` relationship on file), not a bug — flagged to founder, not auto-fixed. **2026-07-21 fix, confirmed live:** the root's own siblings were the one place in `familyTree.ts` still built as a bare name list with no spouse lookup — every other role (root's own spouse, aunts/uncles, cousins, kids) already attached in-law spouses. A married sibling's spouse now shows up with a marriage line too; verified against Jake's real tree (Josh Volin + Faith Volin).

38. ~~Undo a mis-added family tree relationship~~ — **DONE 2026-07-21.** Added `removeRelationship`/`unlinkRelationship` + a "Remove a relationship" control on the family tree page, scoped to the centered person's direct relations. Verified via `npm run build` + synthetic-data harness only — not yet confirmed against live data (see §10). Full story: PROJECT_HISTORY §18. **Relabeled "View Relationships" 2026-07-26**: each chip's name is now clickable and opens that person's own profile page (`onSelectPerson`, threaded through `FamilyTree`/`FamilyTreeView`/App.tsx); the hover-reveal trash icon still removes the relationship, unchanged. Verified live against Jake's real tree. **Partner-pair fix 2026-08-01 (founder report — Gus Reynolds / Sarah, "the trash icon doesn't remove him, from either profile"):** remove AND mark-ended both hardcoded `kind='spouse'`, but the tree renders a `partner` (dating) pair in the same spouse position — on a partner pair the DELETE/UPDATE matched zero rows, returned no error, and the tree re-rendered unchanged. The real kind now flows `Graph.spouseKindByPair` → `TreePerson.spouseKind` → the remove/divorce slots, so writes hit the row that exists and the chip/confirm copy says "partner" instead of calling a dating pair spouses; `unlinkRelationship` also clears both kinds and both note phrasings ("Married to X." / "In a relationship with X."). Verified live: Gus/Sarah row deleted, tree updated.

39. ~~Family tree layout engine rewrite~~ — **DONE 2026-07-22**, same day as founder-proposed. Implemented in the fresh session the founder asked for; see item 37's "Root-cause rewrite" entry for what shipped.

40. ~~Full sibling/parent clique sync~~ — **DONE 2026-07-21, deployed and DB-backfilled.** Founder-requested: adding any relationship should reciprocate across everyone it touches, not just the pair directly linked (e.g. adding a 3rd sibling to a 2-sibling group should connect all 3, and share all parents across all 3 — not just sync the new pair). Replaced the old 2-person-only `syncSiblingParents` with `syncFamilyClique` (see §6), which walks the full transitive sibling closure on every sibling or parent add — wired into both the frontend "+" picker/suggestion-banner paths AND all 4 relationship-capturing edge functions (`add-fact`, `converse`, `update-moment`, `update-group`, all redeployed same day). Verified live against Jake's real sibling group (Josh/Jake/Jess/Danny Volin): a test sibling added only to Josh correctly picked up Amy/Steve as parents AND direct sibling links to Jake/Jess/Danny; a test parent added only to that new sibling correctly propagated to all four. Spouse→parent propagation (step-parent case) explicitly excluded — see item 24. One-time SQL backfill for pre-existing data run same day (165 → 177 relationship rows). **Follow-up 2026-07-25 (founder report — Lorenzo Harris tree, "relationships don't sync regardless of whose profile was centered"):** the clique closure above only ever walked EXISTING sibling rows — it never discovered "these two share a recorded parent" on its own, so kids added one at a time (the normal way of building a tree) never became siblings. Fixed: closure now also seeds from the anchor's own parents' other children. Spouse→parent propagation (item 24) also now ships — auto-links except when either side already has another spouse/partner on file (remarriage guard), which surfaces as a new suggestion banner instead (`suggestCoParentLinks`, FamilyTree.tsx). New `invalidateKeyFacts` closes a third, related gap: nothing previously invalidated a profile's cached Key Facts chips after a relationship changed elsewhere. Verified live with disposable test people (shared-parent siblings, spouse auto-coparent, remarriage-guard banner accept/decline, Key Facts regeneration) against `jakevolin@gmail.com`, cleaned up after — see §3 writeRelationship.ts entry for the full mechanism. **Not yet deployed/backfilled against production — see §10.**

41. ~~Family tree entry points beyond My Page~~ — **DONE 2026-07-21.** Founder-requested: see any person's tree from their own profile, and generate a Family-typed group's tree without needing to be a member yourself. `PersonDetail.tsx` now has a "View family tree →" link (any profile, not just self). `GroupDetail.tsx` now has a "Generate this family's tree →" button on `group_type === 'Family'` groups. Shipped in two passes same day: first via `pickFamilyTreeRoot()` picking a best-covering center person, then superseded within the day by a dedicated `buildDescendantTree()` (familyTree.ts, `mode: 'descendants'`) scoped to the whole group's lineage instead of one member's ego graph — `pickFamilyTreeRoot()` removed. Verified live: The Volins (21 members) → tree centers on the family's eldest known generation, correctly fanning down through all members; a non-self profile (Steve Volin) opens its own ego tree correctly.

42. ~~Family tree generation cap~~ — **DONE 2026-07-21.** Founder-reported: Harvey/Roberta's great-grandchild (Wesley Gregorian) had no section — both tree modes were hardcoded to a fixed generation window (ego mode: 2 up/1 down; descendants mode: 5 labels). Both now walk however far the relationships data actually goes in each direction (capped at 25 generations only as a cycle guard) — see §7 FamilyTree.tsx entry for the mechanism. Matters for the founder's stated use case: people using this to keep track of real family lineage, potentially recording many generations back. Verified live: Harvey Volin's tree now shows a "Great-Grandchildren" section containing Wesley Gregorian; The Volins group tree unaffected in shape, still renders correctly.
43. ~~Family tree color coding~~ — **DONE 2026-07-21.** Founder-requested: make relationships easier to read at a glance — who's centered on whom, and which side grandparents/aunts-uncles/cousins are on. See §7 FamilyTree.tsx entry for the mechanism. Deferred (founder's own call, flagged to revisit — see item 44): a gender icon per person, not bundled into this pass. Verified live against Jake Volin's tree (purple moves correctly when re-centered on a non-self person like Amy Volin; blue/rose sides span from Great-Grandparents down through cousins' kids) and The Berzins' group meta-tree (single green color, no purple, clicking any member correctly opens their own purple-centered ego tree).
44. ~~Gender icon on family tree tiles~~ — **DONE: manual field 2026-07-26, auto-fill 2026-08-11, dot rendering reworked 2026-08-17.** New nullable `people.gender` column (`male`/`female`/`non-binary`/`other`, migration: `supabase/migrations_manual/2026-07-26-gender.sql`, **confirmed applied 2026-08-10** — an anonymous PostgREST select of `people.gender` returns 200, not `42703`), editable dropdown on `PersonDetail.tsx` (inside the name-edit form, next to Deceased). `FamilyTree.tsx` renders a small gender dot in each tile's top-right corner — blue `#4A7BA7` male, rose `#B06A82` female, muted grey `#B5B5B5` on deceased tiles, nothing for non-binary/other/unset (**2026-08-17**, replaced a ♂/♀ glyph in front of the name the founder found too loud; the tree legend now names the dot, because the two family SIDES are also blue/rose). **`boxWidth` measures instead of estimating (2026-08-17):** tile width was `name.length * 8` + a padding constant, which undercounts wide letters and never counted the ' †'/' ›' suffixes the tile renders — it left "Emma Lerma ›" 1.1px UNDER its dot even after the constant was nudged 28→40→48. Now a cached canvas `measureText` against the tile's own font (system stack, so nothing loads late and re-measures wider), with padding as a real geometric budget: the dot owns the last 15.5px and the name is center-anchored, so `2 * (12 + 3.5 + 4)`; ceiling 190→210. Measured on the founder's tree: 42 tiles, 0 overlaps, uniform 3.5px clearance that no longer varies with name length. Don't re-tune the constant — if a name crowds the dot again, the measurement is wrong, not the padding. Fetched via its own query in `familyTree.ts`'s `loadGraph()`, separate from the main people select, so a not-yet-migrated database degrades to "no icons," not a broken tree. **Auto-fill half DONE 2026-08-11** — `GenderFill.tsx` (§3), reached from a "Fill in gender for N people →" link on the People page that hides itself once N hits 0. Runs `guessGenderFromName` over everyone with no gender on file and splits them into "Grove can fill these in" and "Grove can't guess these," one select per row, with an "Accept all N suggestions" button and a single Save. Reviewed rather than silent, because `nameGender.ts` deliberately never persists a guess (a saved guess is indistinguishable from a stated fact) — the review screen is what makes the write legitimate. Verified live against the real account (713 people: 409 guessable, 272 not, 32 already set), including a 2-person save round-tripped through a direct DB read and reverted after. **Note the display-time guess (2026-08-05, `nameGender.ts` in `loadFamilyGraph`) already fixed the "everything reads aunt/uncle" symptom for the family tree and relationship calculator** — filling the column is what carries it beyond the tree graph and makes each profile's Gender field a real, correctable value. **2026-08-19 (founder: the guess "isn't even appropriately guessing if Ben or Braden is a male name, or Bridget or Joelle are female"):** the hand-typed ~840-name list replaced with 16,002 names from SSA birth counts (see §3 `nameGender.generated.ts`). Measured on the real account: of the 315 people still with no gender on file, the old list answered **0** and the new one answers **189**, with nothing that used to be answered now unanswered. The 126 left are correct refusals (Alex, Chris, Jordan, Casey, Taylor…) or records that aren't first names ("Capt", "MSgt", "PICO"). See PROJECT_HISTORY.
45. ~~Standalone first-run onboarding experience~~ — **DONE 2026-07-22.** Full gameplan discussed and iterated with the founder before building (plan file: `gameplan-the-onboarding-experience-lexical-parrot.md`, not checked into the repo). Built on top of the founder's own same-day signup expansion (items above: name/birthday at signup, auto-created self profile). See §3 Onboarding.tsx entry for the full mechanism — full-screen, no app chrome, sequenced by connective leverage (family tree first, then a closed-ended group picker, notes/events deliberately excluded). Verified live end-to-end with a disposable test account (`onboarding.verify.test@example.com`, deleted 2026-08-03 along with 10 other leftover test signups — see §10).

**Items 46–53 came in via the click-to-comment feedback widget (§3 FeedbackWidget.tsx), founder session 2026-07-23, folded in here instead of living only in the `feedback_notes` table — marked done in the widget once captured below:**

46. ~~Rename the Home "Notes" stat tile to "Datapoints"~~ — **DONE 2026-07-24.** Copy-only change (`Home.tsx`); underlying count query untouched. Broader "datapoints" reframing (what else counts, how it's computed) stays open. Verified live.
47. ~~Dunbar's-tiers widget on Home~~ — **DONE 2026-07-24.** `DunbarDetail.tsx` now shows real names (most-recently-added first) within each cumulative tier slice, not just a count — still the existing cumulative-bucket model, not real per-person tier assignment (founder-confirmed scope). Verified live against the real account.
48. ~~New Calendar feature~~ — **DONE 2026-07-24.** Full build story in PROJECT_HISTORY.md §21. `Calendar.tsx` (nav tab: upcoming list + fixed-height month grid over `moments`/`reminders`), `CalendarSettings.tsx` (connect calendars via secret iCal URL — not Google OAuth), `scan-calendar-sources` Edge Function (fetches/parses connected feeds, AI-extracts via Claude, matches attendees, writes to `moment_import_candidates`) on both a manual "Sync now" button and a daily `pg_cron` job, and `ImportReview.tsx` (accept/reject queue — accept writes real `moments`+`notes`, reject writes nothing). Nudges on Home/Calendar surface the pending count. New tables: `calendar_sources`, `moment_import_candidates`. Verified live end-to-end against the founder's real connected calendar. **Follow-up fix 2026-07-25:** founder reported no real events surfacing (only birthdays). Root cause: the pre-AI filter required 2+ formal Google "guest" attendees or a recurrence rule before an event ever reached Claude — most personal calendars don't use formal guest invites, so real gatherings (trips, visits, reunions) were silently dropped before classification. Removed that filter; every non-cancelled, in-range event now goes to the AI, which does the actual worth-suggesting judgment call. Also found and fixed live: batches were running sequentially and blowing past the Edge Function execution timeout on a real backlog (1,060 raw events on the founder's actual calendar) — switched to `Promise.all` concurrent batch calls plus a per-invocation batch cap, so a large backlog catches up over a few clicks instead of timing out. Verified live: full backlog processed cleanly, 232 real candidates now pending (trips, reunions, family gatherings — not just birthdays). **Overhaul 2026-07-25** (founder ask: accept-flow feedback, merge-with-existing, tag/group suggestions, real date ranges): see §3 ImportReview.tsx and §6 `moments`/`moment_import_candidates` entries for the mechanism. Verified live against the founder's real account: merge-accept ("Adrienne and Jacob Fisher's Wedding") and range-accept ("Conor & Shelly's wedding", June 17–19 2027) both round-tripped correctly through EventDetail/Events.tsx.
49. ~~Add a "Settings" button next to Log out~~ — **DONE 2026-07-23.** Scoped down with the founder to account + AI settings only (email/password change, chat-tone preference) plus About and Privacy/data-policy links — explicitly not a place for app-interface shortcuts. `SettingsPage.tsx`/`About.tsx`/`Privacy.tsx` (see §3), `user_settings` table (see §6), `converse` roster-tier read (see §4/§5). About/Privacy are placeholder pages — real copy for both still needs to be drafted together with the founder, not invented unilaterally. Verified live against the founder's real account: email/tone sections render correctly, chat tone persists and visibly changes `converse` reply style (tested "direct"), password change round-tripped (changed, logged in with the new one, reverted to original) — email-change form intentionally not tested live against the real account (low-risk code path, same `supabase.auth.updateUser()` already proven for password, but founder chose not to risk it on the real login for this pass).
54. ~~Email-change verification code~~ — **DONE 2026-07-23** (code side; Supabase Dashboard step still pending, see §10). `SettingsPage.tsx`: after "Update email," the page now asks for a 6-digit code (`supabase.auth.verifyOtp({ type: 'email_change' })`) sent to the **new** address only (founder decided against also codeing the old address — logging into Settings already proves identity; the new-email code just confirms it's real/reachable) before the change takes effect, with resend/cancel. UI verified live (pending state, wrong-code error, cancel) against the founder's real account using a fake address — never completed against a real inbox, so the actual code-delivery email hasn't been seen yet.
50. ~~Home page engagement~~ — **DONE. All three of the founder's examples now ship on the "Connections to make" card**: "is this person in group X?" 2026-07-25, then "confirm this relationship" and "suggested tags for this event" as two of item 85's four question types 2026-08-08 (a fourth, item 98's household groups, 2026-08-20). Kept here rather than deleted because this was explicitly a brainstorm ask — this was explicitly a brainstorm ask, not a spec; related to item 26's ratings loop.
51. ~~EventDetail "Affiliated Groups" section~~ — **DONE 2026-07-24.** `EventDetail.tsx`'s groups and tags pickers are now collapsed behind toggle buttons ("+ Associate a New Group" / "+ Add a Tag"), mirroring `GroupDetail.tsx`'s pattern, instead of always-visible; empty states now show "No groups/tags at this time" rather than wasting space. Standardized on "Associated Groups" terminology (matches `GroupDetail.tsx`/`PersonDetail.tsx`; `update-moment`'s prompt text updated too) — `AffiliatedGroupChip` renamed to `AssociatedGroupChip`. PersonDetail's own heading left untouched this pass to avoid colliding with a concurrent session's in-progress deceased/divorce work on that file. Verified live (VCIC Competition event): toggle opens/closes the picker correctly.
52. ~~Event dates~~ — **DONE 2026-07-24.** `EventDetail.tsx` and `Events.tsx` now prefer the exact `event_date` over vague `when_text` when both exist (new shared helpers in `lib/dates.ts`: `formatFullDate`, `formatEventWhen`); `when_text` still shows when no exact date is on file. Verified live: VCIC Competition now shows "February 24, 2018" instead of "late February 2018."
53. ~~`converse` chat voice bug~~ — **DONE 2026-07-24.** Added an explicit VOICE instruction to `converse`'s stable system prompt (`stableInstructions`, static/deterministic — doesn't affect the prompt cache prefix) telling the model to always address the founder as "you" in reply text, never by their own name or as "User." Deployed via `npx supabase functions deploy converse`. Verified live: re-asked about the VCIC Competition note, reply now reads "...Daniel Book allegedly shoved you and you slipped down a muddy hill" instead of naming the founder in third person.
55. ~~`converse` MOMENT_ID tag leak~~ — **DONE 2026-07-24.** Added an instruction to `stableInstructions` telling the model the `[MOMENT_ID: ...]` tag is bookkeeping-only and must never appear in reply text. Deployed via `npx supabase functions deploy converse`. Verified live: re-asked about the VCIC Competition, reply no longer starts with the tag.
56. ~~Calendar month-grid tile truncation + app column too narrow on desktop~~ — **DONE 2026-07-24.** Founder-reported: day tiles with long titles were stretching their whole grid column instead of truncating. Root cause: `gridTemplateColumns: repeat(7, 1fr)` has no `min-width: 0` clamp, so a child's min-content width pushes the column wider — fixed via `minmax(0, 1fr)` plus `minWidth: 0`/`overflow: hidden` on the day cells and tile buttons (Calendar.tsx). Also addressed the founder's follow-up "why is the whole app so thin on desktop": the app's page column (`maxWidth`) was hardcoded to 600px identically across every page — confirmed harmless to widen since any phone viewport is already narrower than 600px, so this only affects desktop viewing, not the eventual native-iPhone build. Bumped to 840px across all logged-in app pages + Breadcrumb.tsx (Landing.tsx's own unrelated `maxWidth` left alone — that's a marketing-page callout box, not the app shell). Verified live: tiles clip with ellipsis inside a uniform-width cell, page column measurably wider (888px including padding vs. previous ~648px) with no layout breakage.

**Items 57–61 came in via the click-to-comment feedback widget (§3 FeedbackWidget.tsx), founder session 2026-07-25, folded in here instead of living only in the `feedback_notes` table — marked done in the widget once captured below:**

57. ~~Per-group toggle for "connections to make" suggestions~~ — **DONE 2026-07-25** (scope confirmed with founder: Groups only, not Events — EventDetail's own attendee-suggestion boxes are a separate, not-yet-built ask). New `groups.suggestions_enabled` column (default true); checkbox on `GroupDetail.tsx` right above where the suggestion chips would render (always visible, not gated on there currently being any, so it stays reachable to re-enable); off also drops that group from Home's "Connections to make" card since both read the same column (`lib/suggestConnections.ts`). Isolated fetch/write, fails open to "on" if the column isn't there yet — doesn't risk breaking the member list or Home's card while the migration is pending. **Founder's stretch idea (proactively offer to turn suggestions off after repeated dismissals) NOT built** — out of scope for this pass. **Migration run and fully verified live 2026-07-26** against the real `jakevolin@gmail.com` account, "Air Force Academy" (113 pending suggestions at the time): unchecking the toggle immediately hid all suggestion chips + the add/remove-all buttons and showed the "Off" hint; the `false` value survived a full reload (confirmed directly against the DB, not just the UI); Home's "Connections to make" card reads the identical column so it stops surfacing that group's people too. Test toggle reverted back to on afterward (real data, not disposable).
58. ~~Auto-load more Home suggestions without a refresh~~ — **DONE 2026-08-10.** `loadHomeSuggestions` now returns the ENTIRE pool in round-robin order instead of just the first 6; `Home.tsx` holds all of it in state and slices `SAMPLE_SIZE` for display, so answering a card filters it out and the next slides up on the same render. No refetch, no reload, and **zero extra queries** — every candidate was already computed in memory and then discarded. 2 new unit tests on the unbounded-limit path. **NOT browser-verified** (Home is behind a login; no session available) — the refill is unit-tested, the on-screen behaviour isn't.
59. ~~EventDetail attendee suggestions missing "Add all"~~ — **DONE 2026-08-10.** "✓ Add all suggestions" now sits beside the existing remove-all on all three of `EventDetail.tsx`'s suggestion boxes (sibling sub-event, associated group, family), matching `GroupDetail.tsx`. New `handleApproveAllSuggestions` does ONE bulk `notes` insert + ONE `handleNoteSaved()` — never a loop over `handleAddAttendee`, which would spend a `summarize-moment` regeneration per person for a single click (CLAUDE.md rule 3). **NOT browser-verified before pushing** (founder said push; build + 319 tests green, but the Browser pane was hidden that session so no click-through and no login was possible) — specifically unverified: that the ✓ button renders in each of the three boxes, and the bulk-insert write path itself.
60. ~~New-person name inputs don't stay side by side~~ — **DONE 2026-08-10.** `PersonDetail.tsx`'s `renameInput` was already `flex: '1 1 150px'` by the time this was picked up, but three 150px bases can't fit a phone's content width, so it still wrapped — now `flex: '1 1 0'` + `minWidth: 0` so the three boxes always share one row. Middle placeholder shortened to "Middle/nickname" to stay legible at a third of phone width. Known tradeoff: these inputs render at `fontSize.h2`, so long placeholder text clips on a narrow phone. **NOT browser-verified before pushing** — same hidden-pane/no-login gap as item 59; the one-row layout is CSS-reasoned, not seen.
61. ~~First-person "my" misattributed to the wrong person~~ — **DONE. Code fix 2026-07-26, confirmed LIVE 2026-08-19** (the deployed `add-fact` was downloaded and diffed against the repo). `npx supabase functions download add-fact` came back byte-identical to the repo copy, instruction included — it went out with item 94's deploy on 2026-08-11. The one thing still not done is a behaviour re-test against the live function, which needs a real first-person note typed on someone's profile; it was left undone deliberately rather than write test text into the founder's own data overnight. Root-caused to `add-fact` (the profile-scoped quick-fact bar — matches the Ken Miller repro exactly: text typed directly on Ken's profile). Its prompt framed all captured text as "about" the profile person with no signal that a first-person pronoun means the app's signed-in user instead; added an explicit instruction (using the existing `is_self` lookup) telling it first-person text refers to the self person, never to rewrite "my X" as "&lt;profile name&gt;'s X," and to leave the pronoun as typed if unsure. `converse`/`update-moment` weren't touched — their existing `buildSelfInstruction` already resolves unqualified "my"/"our" for relationship capture; only `add-fact`'s plain-note path had the gap. A live test on Ken Miller's profile ("my scout troop leader") saved unchanged, not misattributed — but no deploy token was available this session, so that test actually ran against the OLD (undeployed) function and isn't real confirmation of the fix; re-verify after deploying.
62. ~~Groups page lost its filter + scroll position when returning via the back arrow~~ — **DONE 2026-07-26.** Founder-reported: pick a group-type filter, click into a group, then use the in-page "← Back to Groups" arrow — landed back at an unfiltered, top-of-page list instead of where you left off. Root cause: `Groups.tsx` unmounts every time a crumb is pushed (App.tsx swaps it out for `GroupDetail`), so its local `search`/`typeFilter` state and scroll position were lost on every return trip. Fixed by lifting both into `App.tsx` (which never unmounts) and adding a scroll-position ref that's restored once the list reloads, cleared on a direct top-nav tab click so only the actual back-arrow round trip restores scroll. Verified live against the real account: "Friend group" filter + scrolled-to "Colorado Springs Friends" → back arrow correctly restored both; direct "Groups" tab click still lands at the top.
63. ~~Spouse/family chaining should apply everywhere a person is suggested, not just events~~ — **DONE 2026-07-26.** Founder feedback: self's spouse should always be suggested for events (household events are a given, shouldn't need self manually added first), and the existing event "person added → spouse suggested → kids suggested once spouse also added" chain should apply to every suggestion surface in the app, not just EventDetail.tsx. Shipped: (1) EventDetail.tsx/ImportReview.tsx now always seed self into the attendee set fed to `suggestFamilyMembers`, so self's spouse is suggested even before self is tagged; (2) GroupDetail.tsx gained a second suggestion box, "Family of a current member?", using the same `suggestFamilyMembers` chaining seeded from the group's explicit members; (3) `suggestConnections.ts` (Home's "Connections to make" card) gained the same family signal, generalized across every group. Verified live against the real account: a blank new event immediately suggested Caroline Volin (self's spouse) with zero attendees added; a throwaway test group seeded with Jake+Steve Volin correctly suggested Amy Volin (Steve's spouse), and once added, correctly suggested Jess/Danny/Josh Volin (their kids per the `relationships` table) — test group deleted after verifying, no changes to real data.
65. ~~iPhone Contacts import~~ — **DONE 2026-07-27.** Previously parked; founder asked to build it out, specifically calling out birthdays and addresses, then added mid-plan that nothing should auto-import wholesale (a real contact list can be 1000+ entries) and that browsing needs to be chunked with progress saved. See §3/§6/§7 for the mechanism (`ContactsImport.tsx` → `ContactSelection.tsx` curation → `ContactImportReview.tsx` accept/reject, `contact_import_candidates` table, `_shared/vcard.ts`/`_shared/nameMatch.ts`). Contact photos and auto-linking Apple's "related names" into the real `relationships` table were deliberately scoped out — flagged as separate decisions (photo storage needs a Storage bucket, same infra as the still-unbuilt item 27; relationship auto-linking risks silently writing wrong family links from free-text labels). Verified live end-to-end against the real account (`jakevolin@gmail.com`), all test data cleaned up after.
66. ~~Clean up messy duplicate location strings~~ — **DONE 2026-08-12.** New `ManageLocations.tsx` (§3), reached from "Manage locations →" on Events beside "Manage tags →". Lists every distinct `moments.location` with its event count and rewrites one across every event at once; a "Look like the same place" section proposes clusters, with radios for which spelling wins plus free text (the right spelling is often none of the typed ones). Clustering is pure and tested (`lib/locationGroups.ts`, 15 tests): a value starting with a house number keys on `<number> <street>` with abbreviations expanded, everything else keys on its fully-normalized self — so "Denver, CO"/"denver co" merge but "Denver Zoo"/"Denver, CO" never do. Precision over volume, same call `suggestEventGroups` made: a wrong proposal the founder accepts is silent, permanent damage. The founder's lighter alternative (an "×" to stop a bad suggestion being offered) wasn't needed — `AddressSuggestInput` reads the same column, so fixing the data fixes the dropdown. **Verified live** against the real account: 99 distinct locations across 105 events, and it found the reported case — **4 spellings of 12208 Bandon Dr across 5 events** — as the ONLY cluster, i.e. zero false positives over the other 95. Merge form opened and cancelled; no merge was actually run (real data, the founder's call which spelling wins).

72. **Mobile redesign — step 1 of 4 DONE (2026-08-20); the next move is step 2, which is the founder using the app on their phone.** Agreed with the founder 2026-08-01. Triggered by opening the PWA on a real iPhone: everything is sized for a mouse (body text mostly 0.85–0.9rem, 46 of 86 files styling via inline `React.CSSProperties`). The founder's own framing is that they don't want to redo work, and the thing making a redesign expensive is structural, not visual: **every colour and size is typed directly into each screen — `#2E4034` appears 226 times across 46 files, `fontSize: '0.85rem'` 127 times.** Agreed four-step order:
    1. ~~**Extract design tokens into one shared file** (colours, text sizes, spacing, radii) that every screen reads from, so a palette change is ~8 lines instead of 46 files.~~ — **DONE 2026-08-20.** `lib/theme.ts` is that file; no colour used in more than one place is typed into a screen any more. Deliberately still inline: one-off hexes, the named data palettes (family-tree sides/genders, photo placeholders, the Google logo), and 82 off-scale `fontSize` literals across 25 files — naming those would enshrine a scale step 4 is going to replace, and that inventory IS step 4's starting point. Purely structural, zero intended visual change, which is also what makes it easy to verify: *any* visible difference means something was done wrong. Do NOT bundle visual changes into this step.
    2. Founder uses the app on their phone for a week or two and notes what actually annoys them.
    3. Settle the app rename (see `PWA.md` for the four places the name lives).
    4. Redesign only the 3–4 screens really lived in (likely Home/Events/PersonDetail), **mobile-first** — the phone is now the primary surface, and designing desktop-first is exactly how the hover-only controls happened. The remaining screens can stay as-is indefinitely; the founder is the only user.

    **Practical constraint to plan around (revised 2026-08-20):** this is true of REMOTE sessions — no Supabase credentials, and the proxy blocks the live site. A session running locally on the founder's machine is different: the dev-server preview carries their signed-in session, so an assistant can drive the real app and read real data (see the memory note on stashing the auth token to reach the logged-out demo). Anything visual on a PHONE is still the founder's eyes only. The founder is the eyes for anything visual (this is why *they* caught the touch bugs, not the audit). Expect to work from their screenshots.

73. ~~Pets on a profile~~ — requested 2026-08-01, **DONE — UI, schema and chat wiring** (the last of those 2026-08-01, commit ffe6e6a; **verified 2026-08-19**: `converse` loads the pet roster and both inserts and updates pets, with an explicit "a pet is not a person" prompt rule so a pet never lands in `new_people`). Founder decisions taken up front: a pet is its OWN record attachable to one or more people (household dog edited once, shows on both spouses' profiles), and the Home chat should eventually both read AND write pets. "Somewhat customizable to accommodate the variety of pets" → species is free text, plus an open `{label, value}` Details list per pet (Barn/Tank/Vet), not a fixed field set. Shipped: `pets`/`person_pets` tables (§6), `lib/pets.ts`, `components/PetsSection.tsx`, `pages/PetDetail.tsx` (§3). **Follow-up shipped same day, founder's ask:** pets appear in the **People list** with a species emoji, and tapping one opens its **own page** rather than an owner's profile (both founder decisions — the alternatives offered were "just a list on one person" and "tap goes to the owner's profile"). Pets are a display merge into that list only: separate tables, and the People count/Dunbar math still counts people alone. Editing moved off the profile card onto the pet page so there's one form, not two. ~~(B) founder runs the migration~~ **DONE 2026-08-01, verified live (see §10).** ~~(D) `PersonDetail.tsx` merge/delete `person_pets` handling~~ **DONE 2026-08-01**: merge unions the duplicate's pets onto the survivor then detaches (a plain re-point would collide, since a pet can be on several profiles) and the merge confirm copy now says "pets"; delete-profile deletes `person_pets` in the same `Promise.all` as the other dependents — safe only post-migration, since that `Promise.all` aborts the whole delete on any error. Both verified live with disposable test people. ~~(C) `converse` pet roster + write path~~ and ~~(E) the "a pet is not a person" guard~~ **BOTH DONE, deployed and verified live 2026-08-01** (founder-provided token). `converse` loads pets + person_pets as two SEPARATE top-level queries (never an embed — that would take the whole people roster down pre-migration), renders them into the roster tier, and writes a turn-level `pets` field: owner-scoped resolution first, then unique bare name, additive-only updates (never overwrites the profile form), links upserted per owner, and a loud `console.error` + skip for any pet with no resolvable owner. Guards added to `add-fact`/`update-moment`/`update-group` too — all four redeployed. **Item 73 is complete.** **Deliberately deferred:** a "Pets" Key Facts category in `person-facts` (would force an AI regeneration sweep across every profile for info the Pets card already shows), pet birthdays on the Calendar (needs `reminders.pet_id` + CHECK/RLS changes), demo pet content, a `PetChip`, a global Pets page (the People list now covers it), pets on events/photos.

74. ~~A place to write/dictate notes while reviewing imports~~ — **DONE 2026-08-02.** Founder ask: the review cards showed facts (name, phone, birthday, date) with nowhere to record what you actually know about the person, and that review pass is the only realistic moment anyone adds it. Shipped `components/ReviewNoteField.tsx` (see §3) on all four import review queues; ImportReview's pre-existing "Your notes (optional)" box just gained the mic and kept its `source: 'calendar_import'` tag unchanged. Two founder decisions: scope = all four queues (not just contacts), and **no AI note-splitter** — priced at ~half a cent per contact written about (Sonnet 5, no cache benefit since the prompt is per-person), ruled out as too expensive for a 1000-contact pass; Key Facts already does the splitting where it's visible. `ContactImportReview`'s `UndoInfo.noteId` became `noteIds: string[]` so Undo takes back both the vCard-derived note and the typed one; the typed text is deliberately NOT cleared on Undo (everything else on the card is candidate-derived, that isn't). Verified live against the real account: typed note → accept → appears verbatim on the profile with no import badge; empty box → accept → no note row created; accept → Undo → note gone and candidate back in the queue; per-card Accept-disable while recording. Test data cleaned up, **except** one real candidate (Tim Rose) left in `status='accepted'` — see §10.

75. ~~Ask before creating a profile for someone mentioned in a journal entry~~ — **DONE 2026-08-02** (see §4 `converse`/`update-moment`, §3 `MentionedPeopleSuggestions.tsx`, §12 guard). Founder ask, from a real entry: a date night at Pup Dog with Caroline, where the couple they met (Rachel and Matt) got full profiles they didn't want — but the fact they met them there still had to be recallable. Founder decision: ask for **every** brand-new name (predictable) rather than letting the AI judge which mentions are peripheral, and apply it to the event-page chat too, not just Home.

76. **Unify the two chat Edge Functions** (`converse` + `update-moment`, and arguably `update-group`/`add-fact`) — founder, 2026-08-02: *"I really wish it was one singular app — not sure why we even have two chat functions."* They're split for **cost, not design**: `converse` loads the whole roster + every moment each turn; `update-moment` loads one moment. A naive merge makes the event chat pay for the full archive on every message. A real unification means one function with one prompt and *scoped* context selection (pass the moment id → load only what that conversation needs), which also stops the current bug class where a rule fixed in one prompt silently stays broken in the other (item 75 had to be written twice; so did the pets guard, the date-phrase examples, and the general-note handling). Not scoped or estimated yet.
77. ~~**Chat-generated notes shouldn't invent sentiment that wasn't actually said**~~ — reported via feedback widget 2026-08-03, on "Jake's birthday dinner." Founder flagged a specific line as fabricated feeling/emotion that wasn't in what she actually typed. Partially addressed by item 81 (2026-08-03): general/event-level notes on Event/Group pages are now stored 100% verbatim, no longer AI-paraphrased at all, so this bug class is structurally gone there. **Remaining scope DONE 2026-08-03** (separate same-day founder report, on "Going to be a girl dad!" — an invented ultrasound/health-markers detail never said, plus a note misattributed to the unborn baby's own profile instead of being a general note): `converse`'s stableInstructions and `update-moment`'s `additional_notes` guidance (mirrored into `update-group` too) now both explicitly forbid inventing any detail the user didn't actually state, and clarify a note only attaches to a named person when THEY did/said/experienced it — not merely because they're the sentence's topic. Related bug caught in the same pass: `summarize-moment` had no self-person anchor at all, so its cached first-person "I" voice could latch onto whichever named person's note was most detailed instead of reliably being the account owner — now explicitly grounded via the `is_self` person (see §4). Deployed and live-verified (re-summarizing the reported event produced no new invented content). **Known gap:** the two already-bad notes on that specific event (the ultrasound detail, the baby misattribution) predate the fix and are stored data, not something a prompt change retroactively cleans up — fixing them needs the founder's actual wording, not a guess.
78/79. ~~Landing page should call out the calendar- and contacts-import features~~ — **DONE 2026-08-10.** Shipped as ONE new bullet (not two) at the top of `Landing.tsx`'s "how-it-works" list — both asks are the same promise, and the list was three bullets, so five read as a feature dump: "You don't start from scratch. Connect your calendar and Grove builds out the events you've already been to; pull in your phone contacts and it starts filling in the people — then nudges you over time to add what it doesn't know." Copy is the founder's to redline.
80. ~~"Connections to make" Yes button not saving~~ + ~~auto-suggest Family tag on Home~~ — **DONE 2026-08-03.** Founder report: clicking "Yes" on Home's "Connections to make" card (e.g. adding Abram Woody to Air Force) repeatedly didn't stick. Root cause: `acceptConnectionSuggestion`/`dismissConnectionSuggestion` (`lib/suggestConnections.ts`) never checked `{ error }` on their Supabase calls, and `Home.tsx`'s click handler removed the suggestion from local state before the write even resolved — a failed write was invisible, and since suggestions recompute fresh from the DB every visit, the same suggestion just kept reappearing. Both now return `{ error }`, the handlers await and only clear local state on confirmed success, and a shared error banner surfaces a failure instead of silently dropping it. Verified live against `jakevolin@gmail.com`: clicked Yes on Abram Woody → Air Force, confirmed the `person_groups` row actually exists via direct query, reloaded and confirmed he no longer resurfaces as a suggestion. Second half: new `lib/suggestFamilyTag.ts` scans untagged groups (`group_type is null`) for a family-shaped name (`\bfamily\b`, or "The Xs"/"The X's"/"The Xs'") and surfaces a Yes/No "Tag as Family?" card on Home, same pattern as Connections to make. New `groups.group_type_suggestion_dismissed` column (migration `2026-08-03-group-type-suggestion-dismissed.sql`, **confirmed applied 2026-08-10** by PostgREST probe) tracks a "No"; until the migration runs the feature fails open to showing nothing (its own query, not folded into any shared groups select, per the isolation pattern in the infra notes). Regex validated against the real account's ~60 groups: matched every untagged family-shaped name, zero false positives on non-family groups (years, "Pilots", "NCOs", "Civilians", etc).
81. ~~Two separate ways to add a note on Event/Group pages~~ — **DONE 2026-08-03.** Founder confusion (this conversation): a plain "Add a note" box sat beside a separate AI chat ("Remember something else?"/"Edit this group") on both pages — overlapping jobs, unclear which to use, and Home's chat made a third pattern. `UpdateMomentChat.tsx`/`UpdateGroupChat.tsx` replaced with one `NoteWithDetection.tsx` (see §3), matching the single-input pattern `PersonDetail`'s fact bar already used. Founder decision: attendee/relationship detection runs **automatically** on every note (not on-demand) — small added AI cost/latency accepted. `update-moment`/`update-group` prompts updated to stop re-inserting a paraphrased copy of the general note (frontend already saves it verbatim) and to stop angling for an open "anything else?" follow-up, since each call is now one discrete note rather than a multi-turn thread; `needsClarification` replaces `done` for the rare genuine disambiguation case. Home's `converse` chat is untouched — deliberately different, whole-account scope. Both edge functions deployed (persisted `SUPABASE_ACCESS_TOKEN`, see §2) and verified live: direct-invoke test confirmed `needsClarification` in the response and zero note rows written for a general-detail test message. Click-tested end-to-end on a real event and a real group (verbatim save, summary regeneration, no duplicate notes); test notes cleaned up afterward.
82. ~~See at a glance who in a group is in a subgroup~~ — **auto-colour half DONE 2026-08-04.** Founder ask: with a 20-person group and several subgroups, working out who's already sorted meant opening each subgroup in turn. Shipped both halves of the ask together — subgroup tiles carry a colour that repeats as a dot on the parent-level member chips (so the tile grid is the legend), plus a "Not in a subgroup (N)" filter pill. See §3 GroupDetail.tsx / `lib/subgroupColors.ts`. **NOT browser-verified before pushing** (founder said push; build + 102 tests green, click-through never ran — same call as item 19). Unverified specifically: the dot/rule rendering, the pill's filter behaviour, and phone width. ~~Still open: tap-to-recolour swatches.~~ **DONE 2026-08-12; migration applied and both write paths verified live 2026-08-20 (§10) — the whole item is now closed.** A 44px swatch sits on each tile's corner (outside the tile's own `<button>` — nesting one would be invalid markup) and opens an 8-colour picker plus "Back to automatic". Stores the palette INDEX in a new nullable `groups.color_index`, not a hex, so the palette stays the source of truth. `subgroupColorMap` now takes the pins and **routes the automatic colours around them**, so a pin can never collide with an auto colour — a duplicated colour is the one failure that makes this feature misleading. Fails open pre-migration (42703 → no pins, swatch hidden), and the verdict latches per session so it's one failed probe, not one per group page. **Verified live** on the real account, with the missing column simulated by a fetch patch (no real writes — the founder's colours are untouched): swatches appear on all 8 Air Force subgroups, pinning 22 AS to palette[4] wrote `color_index: 4` and shifted every other tile to keep **8 distinct colours**, "Back to automatic" wrote null and restored position order. Pre-migration state re-confirmed after: 8 tiles coloured, 0 swatches, no failed request on the second group page. The tradeoff that motivated this is now escapable rather than gone: unpinned tiles still shift when a subgroup is added.

83. ~~Countdowns on the Calendar page~~ — **DONE 2026-08-06, code pushed; `migrations_manual/2026-08-06-countdowns.sql` still needs running (§10).** Founder ask (with a screenshot of the iOS "Countdown" app): auto-add milestones so you can see how long it's been, and let them add future things they're looking forward to. Four founder decisions taken up front: (a) auto count-ups = past events tagged "Milestone" + birthdays/anniversaries with a `year` on file, NOT every past event — a curated short list beats "whatever happened lately"; (b) a section on the Calendar page, not its own page/tab; (c) adding a countdown gives a CHOICE (plain countdown / countdown + real event / pin an event already on file) rather than the app deciding which one a countdown is; (d) implied by (b): future countdowns are opt-in only, since Upcoming sits right below and already lists everything ahead. Shipped: `countdowns` table (§6), `lib/countdowns.ts` + `lib/moments.ts` + `components/CountdownsSection.tsx` (§3), 25 new unit tests on the date math. **Verified:** build/lint/181 tests green, and the real component driven in a headless Chromium at phone width against a stub REST server (derived milestones render with the right unit columns; untagged past events, year-less reminders and a deceased person's birthday all correctly absent; add-standalone, pin-existing, tap-through to Event/Person, dismiss, reload-persistence, re-add-after-dismiss, and un-pin-stays-hidden all confirmed; a 3-day-out card ticked its Seconds column). **NOT verified against the real database** — no Supabase credentials in that session, so RLS, the CHECK/partial unique indexes, and the ON DELETE CASCADE (delete a pinned event → its countdown goes with it) are unexercised until the migration runs. Deliberately deferred: drag-reordering cards, countdowns on Home, demo-account countdown content, pet birthdays as milestones (needs `reminders.pet_id`, already deferred under item 73).
84. ~~Airtable-inspired visual/structural redesign~~ — **DONE 2026-08-07, all 5 sections** (each section still wants a real click-through; see the per-section notes below). Founder-directed 2026-08-07, mockup-approved before any code touched. **Section 1 DONE 2026-08-07** (palette/type/shape in `theme.ts`, `ink`/`primary` split — see §3 theme.ts entry). **Section 2 DONE 2026-08-07**: `App.tsx`'s plain "Settings"/"Log out" buttons replaced with an avatar circle (initials from the `is_self` person's name, falls back to email initials pre-onboarding) that opens the existing `ChoiceSheet` component (reused as-is, not a new dropdown pattern) with Settings/Log out as its two choices; nav bar itself styled for the first time (was raw unstyled buttons) with an active-tab indicator. Self-name fetch is isolated in its own effect/query (same "don't take the whole shell down over one field" pattern as PersonDetail's gender/contact-info queries) so a slow or missing self person only affects the avatar, never blocks the app shell. **Build-verified only — NOT click-tested against a real login** (no test-account credentials in this session; the demo account doesn't render this nav at all, it has its own separate `DemoShell` topbar). Founder should click through Settings + Log out on the real account before trusting this fully. **Section 3 DONE 2026-08-07**: `PetsSection.tsx`/`ContactInfoSection.tsx` now render a single quiet "+ Add pet"/"+ Add contact info" text link (no border/card) instead of a permanent bordered empty card in live mode — clicking either opens the same full card/form as before (Pets: the picker; Contact Info: goes straight into editing, since that's the only way it ever gets its first field). `PhotoGallery.tsx` gained a `personId` prop that rolls up photos from every event that person is tagged to attending (same notes.person_id/moment_id signal EventDetail already uses for attendance), with its own empty-state caption instead of the old always-shown "upcoming feature" placeholder text; wired up in `PersonDetail.tsx` (`readOnly` — i.e. the demo — deliberately still gets no `personId`, since `PhotoGallery` has no static-data override like `PetsSection`'s `pets` prop and would otherwise fire a real query from the logged-out demo). **Build-verified + demo-verified the guard holds** (demo's Gallery still shows the old placeholder caption, confirming no query fired); **the new quiet-link empty states themselves were NOT click-tested** — same no-credentials gap as Section 2, and the demo account can't exercise the live-only branch either. **Section 4 DONE 2026-08-07** — the big one, `EventDetail.tsx`/`GroupDetail.tsx` restructured to the consistent order (Title → Date/Location [Event only] → Summary → Gallery → Who was there → Associated Events → Associated Groups [Group also gets Subgroups here] → Tags [Event only] → Notes → Manage). Specifics: Event's separate rename-pencil and "Edit date & location" pencil merged into one `editingBasics` flow/form (was two states, two handlers, two forms — now one of each, one combined `moments` update). Group's inline Type `<select>` moved into Manage; a static badge near the title still shows the type in both modes. Event's "Sub-events" and Group's unlabeled moments list both relabeled "Associated Events" (same underlying data/logic, just repositioned and headed). New shared `components/ManagePanel.tsx` (modeled on the existing `FilterPanel.tsx` overlay, no baked-in footer) replaces both pages' always-visible "danger zone" — a "⋯ Manage" button at the bottom now opens it, and it holds exactly the same merge/delete (Group also: type, nest-under-another-group, move-to-top-level) logic and state as before, just relocated. New shared `components/FloatingNoteButton.tsx` (modeled on the existing `FeedbackWidget.tsx` fixed-position pattern, opposite corner so they never overlap) replaces the inline note box in both pages' Notes sections with a bottom-right bubble that expands into the same `NoteWithDetection` instance on click. `CountdownsSection.tsx` was NOT touched by this restructure (unrelated file, still on old styling per Section 1's note) — Calendar enhancements (Day One-style "On this day" hover popover, click-to-open month/year picker, Day/Week/Month toggle — only Month exists today) remain the last open piece of this item. **Build-verified + demo-verified the read-only rendering path on both a real event and a real group** (fresh browser tab, zero console errors, section order confirmed exactly as above); **the write-path UI — the combined edit form, the Manage popup, the floating chat bubble — was NOT click-tested**, same no-credentials gap as Sections 2/3, and demo mode (readOnly) hides all three by design so it can't exercise them either. *(Closed 2026-08-10: the bubble and the Manage popup were finally click-tested on the real account during the action-bubble rework — see item 90. The combined name/date/location edit form is still unverified.)* **Section 5 DONE 2026-08-07 — the last one, `Calendar.tsx`.** The gear icon (decided in Section 2's conversation but never actually wired up in code until now) replaces the "Calendar settings →" text link. "Upcoming" is now "Timeline": past events feed into the same scrollable list as upcoming ones, with a "Today" divider between them and a "Today" button that scrolls back to it (lands there automatically on load, too) — reminders stay upcoming-only since `nextOccurrenceDate` only ever resolves forward and there's no reminder-history modeled anywhere else in the app. The month label is now a click-to-open picker (year nav + a 12-month grid) instead of plain text. A new Day/Week/Month segmented control sits above the grid — Month is fully wired to the existing grid, Day/Week show an honest "coming soon" message rather than faking a view that doesn't exist. Hovering (or tapping) a day with history opens an "On this day" popover listing every year a moment has ever landed on that exact month/day — deliberately independent of the currently-viewed year, so a date with real cross-year history is still hoverable even if nothing's tagged to it in the year on screen; a small count badge on the day number hints when there's more than one. **Build-verified only.** Calendar has no demo route at all (`DemoShell.tsx` doesn't reference it — Home/People/Events/Groups are the only demo tabs), so unlike every other section this one couldn't even be read-only-verified this session — no browser check of any kind, just `npm run build` passing and a careful manual re-read of the diff. Founder should click through this page for real before trusting it. **Item 84 (the whole redesign) is now complete** — all 5 sections shipped, though every section's write-path/interactive behavior still needs a real click-through the founder hasn't been able to give it yet (see each section's own note above for exactly what's unverified).

Also worth noting: a separate concurrent session was actively editing `EventDetail.tsx` (an inline "create a new attendee who isn't on file yet" feature on the attendee picker) while Section 5 was being built — untouched and left exactly as found, per the file-scoped staging discipline used throughout this whole item.

84. ~~Countdowns follow-up: no page jump on delete, a Today line, per-card settings~~ — **DONE 2026-08-06, same day as item 83; `migrations_manual/2026-08-06-countdown-settings.sql` needs running before the ⚙ appears (§10).** Three founder asks off using the shipped section: (a) the × made the whole page jump to the top and back — it was the refetch (`load()` set `loading`, the section returned `null`, the page got shorter, the browser dropped the scroll position); now the card leaves optimistically by `cardIdentity` and only the one changed row is folded into state, and the list is its own scroll box so the page height never moves at all. (b) A "Today" button like the one planned for the new app: cards now sort into ONE chronological line (oldest first) with a Today line between past and upcoming, centred on open, and the button sets the box's `scrollTop` directly. (c) Per-card settings behind a ⚙ next to the ×, rather than on card tap — tap still opens the event/person, which is worth keeping. Four settings: rename (display-only via `custom_title`, so the event keeps its own title and stays synced), count in chosen units (`breakdownIn` gives the TOTAL in the largest chosen unit — Days alone reads 1,523, not 1), repeat weekly/monthly/yearly (displays at the next occurrence), and keep-counting-vs-retire once the date passes (offered only for a one-off still ahead, so nothing ever vanishes from under the founder). 13 new unit tests. **Verified:** build/lint/234 tests green, plus the real component driven in the browser against a stubbed PostgREST (throwaway harness, deleted after — no login needed): timeline order with the Today line between past and upcoming; × leaves `window.scrollY` identical before, during and after the write (1052 → 1052 → 1052, mid-page) with the right dismissal row written; Today button lands the list centred on the line without moving the page; ⚙ → "Days" on a 2022 milestone reads **Days 1,525** (creating the derived card's row first, then patching units); rename writes `custom_title` and the card re-titles while the event keeps its own name; "Every year" flips the card to ↓ 300 days and moves it below the Today line; "Take it off the list" saves without the still-future card vanishing; a 3-day-out card ticks its Seconds column; and the pre-migration path (settings select → 42703 → retry on the base columns) renders all cards with the ⚙ hidden, × and "+ Add" still working, no console errors. **One bug found and fixed in that pass:** the auto-centre marked itself done on the first render, when the section was still `loading` and both refs were null — derived cards come from props, so `cards` is already full before the query returns. Gated on `loading` and on the refs actually existing.

85. ~~"Connections to make" only ever asked one kind of question~~ — **DONE 2026-08-08.** Feedback-widget note from 2026-07-27 ("this is also a great feature - we probably need to beef it up"), scoped with the founder 2026-08-08. The card only asked "add this person to this group?"; it now pools four question types (see §3 `suggestConnections.ts`, `suggestRelationshipGaps.ts`, `suggestEventGroups.ts`, `dismissedSuggestions.ts`, and §6 `dismissed_suggestions`), shows 6 instead of 4, and round-robins so no one type crowds the others out. Founder decisions: family gaps + event tagging (NOT "suggest a group for the 196 people in no group" — too close to the per-group signal switched off in item 57), and **deterministic, no AI call**, keeping the card free to recompute per visit. Measured on the real account: 7 co-parent gaps, 1 couple gap, 9 event-tag pairs, 25 person→group. Verified live end-to-end (both accept paths written and confirmed in the DB, dismissals persisted across a reload, pre-migration fail-closed path confirmed by probe before the table existed). Deliberately out of scope: item 58's auto-refill, a per-row "why" line, revisiting `suggestions_enabled` for the other 63 groups.
86. ~~`syncFamilyClique` unions parents across a whole sibling clique — wrong for blended families.~~ — **FIXED 2026-08-10** (`inheritableParents()`, detail below). Found 2026-08-08 while verifying item 85, on real data. Accepting "Is Lisa Dunn also a parent of Liam/Cormac?" (a step-parent link, correct per the founder) made all three Dunn children one sibling clique, and the clique sync then gave every child the union of every parent — writing **Tara Dunn (Brian's ex-wife) as Elizabeth's mother**, a person she has no relationship to. Deleted manually; the two step-sibling links and Brian→Elizabeth were correct and kept. This is pre-existing behaviour shared with FamilyTree.tsx's accept buttons, NOT introduced by item 85 — but item 85 raises the odds by surfacing step-parent suggestions account-wide, and the sync can silently re-add the bad row the next time anything in that family is edited. Founder decision 2026-08-08: ship item 85 as-is and file this. **FIXED 2026-08-10.** New pure `inheritableParents()` (`src/lib/writeRelationship.ts`, exported + 8 unit tests; mirrored into `supabase/functions/_shared/relationships.ts` as a Deno twin, same no-import-across-the-boundary convention as `_shared/groupNames.ts`) replaces the blanket union. **The rule: only fill an EMPTY parent seat, and never guess which one** — two parents already recorded means inherit nothing (a third IS the blended shape, and the "three biological parents" case item 20's tree health check would flag), and more candidates than open seats means inherit nothing rather than coin-flip one in. Both refusals fail toward writing too little, fixable from the "+" picker in seconds; the old behaviour failed toward writing too much, which is silent and spreads on the next edit anywhere in that family. **The cap governs PROPAGATION only** — a step-parent added deliberately through the family tree's own picker is a direct write and still lands, third row or not. Deliberate behaviour change: propagating a THIRD parent across an already-complete sibling group (exercised by the 2026-07-21 synthetic verification) no longer happens. `migrations_manual/2026-07-25-shared-parent-sibling-backfill.sql` step 3 rewritten to the identical rule in SQL, which is what makes that file safe to run at last (see §10).
87. ~~A new sub-event should suggest the people who were at the other sub-events~~ — **DONE 2026-08-10.** Founder ask: everyone at Day 1 of the Defenders of Freedom demo was probably at Days 2 and 3, so a fresh sub-event shouldn't start from an empty "Who was there". New "Were they at this one too?" box on sub-event pages (§3 EventDetail.tsx, `src/lib/siblingAttendees.ts`, 7 unit tests). Candidate pool = the parent event's directly-tagged attendees + every sibling sub-event's; ranked by how many of those a person appears in, ties alphabetical. Reuses the existing SuggestedAttendeeChip / `onAddAttendee` / `dismissed_person_ids` machinery unchanged, so tap-to-add and dismiss behave exactly like the group and family boxes. Verified live on the real account against Day 3 of the demo event (19 correct suggestions, Patrick Mojica ranked first on 3 sub-events; parent page correctly shows no box). **Not re-tested: the tap-to-add and dismiss writes** — shared, already-shipped handlers, and exercising them would have written wrong attendance into real data.
88. ~~Sweep the remaining browser-side reads for the 1000-row cap.~~ — **DONE 2026-08-11.** Founder reported 2026-08-10 that "Yes" in Home's "Connections to make" never stuck; root cause was the browser reading `person_groups` (1183 rows) unpaged. The suggestion path was fixed then (`src/lib/pagedSelect.ts`); the screens were not. This entry listed 11 files — a full scan found **58 sites across 26**, all now on `fetchAllRows` with an explicit `.order()`. Where a name was the sort key a secondary `.order('id')` came with it (names aren't unique, and a non-unique sort key lets rows shuffle between pages — the same bug in a different hat). Three were doing damage beyond a short list: `PersonDetail`'s last-name suggestion decides by finding EXACTLY ONE match account-wide, so truncation could make an ambiguous name look unique and assert the wrong surname; its find-or-create group silently created a duplicate instead of finding the existing one; and `resetOnboarding` left everything past row 1000 behind. **Deliberately left unpaged:** reads bounded by ONE record's fan-out rather than account size (a person's own notes/relationships, an event's own sub-events, a group's own subgroups/associations) and the contact review queue, already paged by its own UI. `fetchAllRows` itself got its first tests the same day (`src/lib/pagedSelect.test.ts`), including the exact-multiple-of-1000 boundary.

90. ~~Fold every "add something to this page" control into the floating bubble~~ — **DONE 2026-08-10.** Founder ask: on a phone you scrolled hunting for "+ Associate a New Group" / "+ Add a Tag" / the attendee picker, while the chat bubble followed you everywhere doing only one thing. The bubble is now the single action surface on EventDetail (people / tag / associate a group / photos / new sub-event / Manage) and GroupDetail (people / associate a group / new subgroup / Manage); `FloatingNoteButton.tsx` → `FloatingActionBubble.tsx` (§3). Every on-page add-button and picker was deleted, chips and suggestion chips stay put, and empty sections now say "tap the + button" (guarded on `!readOnly` — the demo has no bubble). Founder-directed specifics: name/date editing deliberately stayed on the top pencil, and Manage is a muted sub-row that hands off to ManagePanel's existing two-step delete. The note box + mic stays on the bubble's first screen rather than behind a row, since voice is the primary input path. **Click-tested on the real account, both pages** — pickers add and persist, create-new-person/tag rows work, undo banner works, Escape's three stages, delete still gated, mobile viewport fits with all rows ≥44px, zero console errors; test data added during verification was removed afterward.
91. ~~The action bubble's writes ignore their own errors~~ — **DONE 2026-08-11.** Every write handler on `EventDetail.tsx`/`GroupDetail.tsx` now checks the `{ error }` it was discarding and reports failure; the five "add something" handlers return `Promise<boolean>` so the picker can hold its confirmation. Two holes, not one: the handlers didn't check, **and** the picker called `setJustAdded("✓ Added X")` on the same tick as the insert without awaiting it at all — so the confirmation was never gated on anything. The optimistic-then-write suggestion dismissals (`handleDeny*` on both pages, `dismissed_person_ids`/`dismissed_group_ids`) now roll their local state back on a failed write, the same fix item 80 made in `suggestConnections.ts`. Third hole closed in the same pass: `actionError` only ever rendered inside `ManagePanel`, which isn't open while you're adding someone — so the one failure message that WAS wired up (`handleCreateAndAddAttendee`) had never been visible to anyone. `FloatingActionBubble.tsx` gained an `error` prop, rendered under the header at both panel levels, cleared when a picker is opened. `handleCreateAndAddMember` also stopped conflating two writes: if the profile is created but the group link fails it now says exactly that, instead of offering an Undo for a membership that doesn't exist. **Browser-verified 2026-08-11** (later the same day, on the real account, once a logged-in session was available — closing the "NOT browser-verified" gap this item originally shipped with). Method: a disposable blank event, with `window.fetch` patched in the page to return 503 for `POST /rest/v1/{notes,moment_tags,moment_groups}` — the only way to exercise a rejected write without breaking real data. Confirmed on all three add paths (person, tag, group): the success line still appears and the chip lands when the write succeeds; on failure the red banner appears, the "✓ Added" line is withheld, and **no phantom chip is drawn** ("Who was there" held only You + the one real add). Also confirmed: the banner shows at both bubble levels (picker and action list), clears when another action is opened, and clears again on the next successful write. Zero console errors; test event deleted afterwards. Still unverified: `GroupDetail.tsx`'s half (same handlers, same shapes, not clicked), and the bulk "✓ Add all suggestions" path. One nit found, not fixed (the file was checked out by a concurrent session at the time): [EventDetail.tsx:431](src/pages/EventDetail.tsx:431)'s failure message uses `person.name` — "Couldn't add Josh…" — where the success line uses the full "Steve Volin". Cosmetic only. **Nit fixed 2026-08-11** alongside item 33, now on the shared `fullName` helper.
92. ~~A multi-day event's summary reads as a wall of text~~ — **DONE 2026-08-10.** Founder ask, on the Defenders of Freedom demo: the per-sub-event lines "don't read well", use basic formatting. Fixed purely in rendering (`src/components/SummaryText.tsx` + tested `src/lib/summaryFormat.ts`, §3): the `<date> · <title> — <sentence>` shape summarize-moment already emits is parsed and each part styled — italic muted date, bold title, sentence below, hairline left rail grouping the rows. The Edge Function prompt and its cached prefix are untouched, so no summary regenerates and no tokens are spent. Ordinary prose summaries render byte-identically to before.
93. ~~Merges and undo could delete data they never moved~~ — **DONE 2026-08-11.** The multi-step half of item 91, and a worse failure than a wrong message. A merge moves everything off the duplicate then deletes it, and that delete CASCADES — but every step in between was unchecked, so a notes re-point that silently failed still reached the delete and the notes went with it. All three merges (`PersonDetail`/`GroupDetail`/`EventDetail`) now check every step and bail **before** the delete: a half-merged pair is recoverable by merging again, a cascade over rows that never moved is not. No transaction is available from the browser client, so "stop at the first failure, never reach the destructive step" is the strongest guarantee this path can give; where only the final delete fails the message says so rather than implying loss. `ContactImportReview`'s Undo had the sharpest version — its confirmation card is in-memory only (§10's Tim Rose note), so a half-run undo left no way back; the candidate going back to `'selected'` is now last and checked, since without it the card never returns to the queue. `resetOnboarding` wiped in dependency order but checked nothing and cleared `onboarding_complete` regardless, reporting a clean slate over a half-wiped account; it now throws on the first failed delete (naming what it was clearing) and `DevOnboardingReset` catches it — previously that rejection was unhandled, the reload never fired, and the button sat on "…" as if still running.
94. ~~The AI saw a different group name than the app~~ — **DONE AND DEPLOYED 2026-08-11** (`add-fact`, `converse`, `scan-calendar-sources`, `suggest-prompts`, `update-moment` — see §10 for the deploy, including the `--no-verify-jwt` incident it caused and resolved). `_shared/groupNames.ts` is the server twin of `lib/groupDisplayName.ts`. The app copy was changed 2026-08-03 to qualify through the WHOLE ancestor chain ("Squadron / Alpha Flight / Pilots") precisely because one level stops being unique past two levels of nesting; the server copy never got that change. Two same-named subgroups under two same-named parents would therefore produce the same key server-side, and `idByQualified` would keep whichever was indexed last — the wrong-subgroup TAGGING bug that file exists to close, reopened from the other side. **Measured on the real account 2026-08-11: that collision was NOT occurring** (all 21 three-deep groups have distinct immediate parents, so the old names happened to stay unique). The live damage was the other half — all 21 displayed a path the server index couldn't resolve **at all**, so asking about a group by the name shown on screen returned nothing. `qualify()` now walks the full chain (same cycle guard, same missing-ancestor truncation as the app copy) and `splitParent()` matches the LONGEST existing prefix rather than the first separator, so "Squadron / Alpha Flight / New Thing" creates New Thing under Alpha Flight instead of a group literally named "Alpha Flight / New Thing". Found by writing `src/lib/groupNamesParity.test.ts`, which failed 4 of its 7 cases on the first run.
95. ~~Nothing checked the Edge Functions, and the linter was switched off~~ — **DONE 2026-08-11.** Three gaps in one sweep. (a) The lint config was saved as `_oxlintrc.json`; oxlint looks for `.oxlintrc.json`, so `npm run lint` had been loading NO config — including `react/rules-of-hooks`, the one rule deliberately set to `error`, never enforced. Renamed; of the 30 warnings that reappeared, all 17 `exhaustive-deps` were read individually and every one is deliberate with a comment already explaining why, so that rule and `only-export-components` are now `off` explicitly rather than burying the rules that matter. (b) `tsconfig.app.json` had no `"strict"` — it passes with zero errors, so it is now on. (c) **7,190 lines of Edge Function code had never been typechecked by anything** (`tsconfig` only includes `src/`, and they run on Deno): `npm run check:functions` does it now (`deno` is a devDependency; the glob is quoted so Deno expands it itself and it works on any shell), and the 16 errors found on the first run are fixed — none was a runtime bug (8 were the documented PostgREST cardinality lie, 3 were vitest parity tests that aren't Deno modules, 2 were narrowing lost inside nested functions where the real guard is at `converse:56`). Plus `.github/workflows/ci.yml`: lint → `check:functions` → build → test on every push, **reporting only, never blocking** — Vercel deploys off git independently of Actions, and with no staging step and nobody on hand to override, a false alarm must never be able to strand a real fix.

96. ~~Somewhere to put what isn't an event~~ — **DONE 2026-08-18** (Notebooks — see §7 for what shipped, §1 for the framing, §6 for schema). Founder ask: favorite movies, quotes, feelings, thoughts to share, reminders. Checking each against the app first is what shrank it: "tell Sarah X" already works as a note on Sarah, reminders were parked (they need a due date, a done state, and somewhere to surface them), and the three real gaps — a movie list, a quote list, how a day felt — turned out to be ONE screen, since an optional date is the only thing separating a list from a log. Three tables, two pages, no new Edge Functions, no new AI calls. Design decisions the founder made along the way, all in §1/§7: the name ("notes" and "pages" were both taken), the app supplying no categories, and the per-notebook AI switch.
97. ~~Notebooks in the landing-page demo~~ — **DONE 2026-08-19.** New `DemoNotebooks.tsx`/`DemoNotebookDetail.tsx` containers + a Notebooks tab and crumb in `DemoShell.tsx`, fed by `DEMO_NOTEBOOKS`/`DEMO_NOTEBOOK_ENTRIES` in `demoData.ts` (5 notebooks: an undated movie list, two dated logs, one private, one locked). Real components, not lookalikes: `NotebooksView` gained `readOnly` (hides the create form, same convention as `EventsView`), and `NotebookDetail.tsx` now exports `NotebookEntryCard` (the read-mode card the real page already drew, minus the Edit button when no `onEdit` is passed) plus `NotebookReadOnlyView`, which the demo page is. Entry fixtures hold plain `text` and generate their HTML via `demoEntryHtml()` — the corpus needs the words without a DOM (`htmlToPlainText` uses `DOMParser`, which the node-env test doesn't have), and one source string can't disagree with itself. Search covers notebooks, and a **locked notebook is excluded from the corpus entirely, name included**, mirroring the real query's server-side filter (3 new tests). A locked notebook ships a count but no text — `DemoNotebook.hiddenEntryCount`; its page says what the lock does rather than faking a PIN box. Also added the 6th `DemoIntro` slide. Verified click-through in the demo (list, both dated and undated notebooks, person chip out to a profile, locked page, search hit, locked name unfindable).
98. ~~Suggest a family group when a household is on file~~ — **DONE 2026-08-20.** Feedback-widget note from 2026-08-08 ("Any time a family tree is populated with 3 or more people (i.e. husband, wife, and child), I would like to automatically suggest creating a family group based off of them"). Shipped as a fourth question type in Home's existing "Connections to make" card rather than a new surface — see §3 `suggestFamilyGroups.ts` for the household definition and the naming rules, and §6 for the one-line CHECK migration (applied). Free/deterministic, no AI, same as the rest of that card. **Measured before wiring: 24 households on the real account**, top of the list correct by eye. Accept creates a `group_type: 'Family'` group and adds everyone in one upsert; verified live end-to-end then deleted again, so which households actually become groups stays the founder's call. 15 unit tests.
99. ~~An event's sub-events were relabelled "Associated Events"~~ — **DONE 2026-08-20.** Feedback-widget note from 2026-08-11 ("This should be called 'Sub Events', not 'Associated Events'"), reversing half of item 84 Section 4's blanket rename. `EventDetail.tsx`'s heading only — Group and Person keep "Associated Events", because those lists are a different thing (events they're tied to, not days inside them). Section ORDER is unchanged.

100. ~~Pets couldn't be tagged to events~~ — **DONE 2026-08-20, migration applied and verified live.** Founder report: "app is not letting me tag pets (which have profiles under the people page?) to events". Real gap, not a bug — the 2026-08-01 pets migration says in so many words "Pets stay out of the notes/moments graph in v1", so no such control was ever built. New `moment_pets` join table (§6) + pet chips in "Who was there" + "Was at these events" on the pet's page; see §7 for the shipped behaviour. Deliberately NOT built by widening `notes` — see §6 for why. Verified on the real account by tagging Maple onto a sub-event, confirming the roll-up to the parent (tooltip + no untag badge there), the pet page's new list, and the untag, then removing the row so the account was left exactly as found. **Both follow-ups closed 2026-08-21:** the separate 🐾 row was merged into "Add who was there", and `converse` learned `moment_pets` so Home chat can tag a pet to an event.

101. Maiden / former names — **DONE 2026-08-21, chat half deployed 2026-08-21** (see §7, §12). Founder ask: "need to figure out how to deal with maiden names." Scope decided with the founder: find her by either name + show the old one quietly on her profile; wording is "Former name", not "maiden name" (neutral, also covers divorce/remarriage/adoption — same reasoning that ruled out "diary"/"journal" for Notebooks). **Deliberately deferred, still open:** the family half — the tree showing which family someone was born into, `scan-calendar-sources`' `personIdsByLastName` household fan-out ("dinner with the Andersons") matching former names, and `inferLastNameFromSignals`/`coParentNeedsConfirmation` learning that a wife kept her own name. **Permanently out:** `transcribe`'s `rosterKeywords()` surname tier is already over budget (825 people → 1002 name words against 800, surnames dropped first), so adding former surnames there makes transcription worse.
102. ~~Name the app~~ — **DONE 2026-08-22, settled on Grove.** Item 72 step 3, blocking because the iOS **bundle ID is permanent once a build is uploaded**. Went Boomer → Porch → Grove in one day: Porch shipped, then the founder rejected it and asked to redo the product's purpose first and let the name follow ("rethink entirely what the purpose is… and from THERE we can visit a name"). That repositioning is now §1. Ten names were checked against the App Store; six died on direct category neighbours — **Hearth** (*Hearth — Family App*: mood check-ins + AI suggestions for reaching out to family), **Keepsake** (*Keepsake: Bring Family Closer* — "help families say what they've always meant to say", i.e. the held-letters idea already shipping), **Homestead** (*Digital Homestead* — private invite-only family space), **Harbor** (a private AI journal, a social journal, a second brain), **Trove** (8+, two private-document vaults), **Orchard** (Epic's enterprise "App Orchard"), **Understory** (tree-themed reading tracker). Grove came through with one unrelated collision (an Australian parenting-events app); **Heartwood** was the clean runner-up. Apple requires a unique name *string*, not a unique word. Full story in `PROJECT_HISTORY.md`. **Not renamed on purpose:** lowercase `boomer` storage keys, the `boomer-app-2-eight.vercel.app` hostname, and `PROJECT_HISTORY.md`'s dated entries.

**Items 103–111 came out of the 2026-08-22 repositioning session (see §1 and §9). Founder's agreed build order is 103 → 104 → 105 → 106/107.**

103. **Show what the AI did** — a running log of every automatic action (matched this contact, linked these siblings, tagged this event) plus a periodic digest ("14 contacts matched, 3 events tagged this week"). Founder's own idea and the keystone of the set: it makes automation legible instead of silent, gives somewhere to catch errors, is what makes item 104's auto-accept safe to trust, and answers Home feeling empty. Founder also wants a version of it on the landing page as a selling point. **Nothing like it exists today — every automatic write is currently silent.** Mostly reads data that already exists rather than new machinery. **Next up.**
104. **Triage relief** — founder: mass bulk import "sets a general shell, but it's an overload, very hard to work through," and "too much to triage" is one of three stated reasons for not opening the app. Three parts: auto-accept only what's certain (per §9's act-only-when-certain boundary, logged via 103), stop showing a running count of how far behind you are, and a one-action "archive the whole queue, recoverable" escape hatch. Note this partly revisits the 2026-08-19 decision NOT to build a bulk accept-all — revisited deliberately, after living with the pile. Does **not** reverse the 2026-08-12 "sync everything, let the person decide" directive: nothing here filters.
105. **The calmer mobile shape + App Store** — see §9. Same data, phone-shaped, one thing at a time, glanceable; not a shrunken desktop app. Then Capacitor + a cloud Mac to get a real store listing. Founder: "everyone uses their phone every day, so the app needs to be mobile first," and the Chrome home-screen install "is not user friendly." Absorbs §9's long-standing "general sizing is the redesign, don't patch it piecemeal" note — this *is* that redesign.
106. **Notebook template gallery** — pick from a library to start a notebook (films, books, letters, how work is going) instead of always facing a blank one. Founder: templates are **defaults, never fixed categories** — §1's rule that the app supplies no labels for the internal side still holds. Blank notebooks should also feel like a real word processor, since "people already know how to use one" (TipTap is in place; this is about exposing more of it).
107. **Letters held for later** — written now, addressed to a person already on file, dated forward, sealed until then; the founder's "notes for your daughter to give her on her 18th birthday." Founder chose that these can **actually be sent** (email or link) when the date comes, not just unsealed in-app — so this needs real delivery, and a recipient address. Closest thing to a signature feature the app has. Reuses: notebook entry dates, person links, and the existing per-notebook lock/PIN machinery.
108. **Prompted notebook entries** — the app puts a question in front of you and your answer becomes the entry. The standard fix for the blank page that kills journals.
109. **Home as a composed daily page** — founder: Home "has been less useful than I imagined it'd be." Wants all three of: resurface something from my past unprompted, ask me one question that fills a gap, and tell me who I'm about to see this week with the one thing I'd want to know first. That third one is §9's "private pre-event briefing tool," which the doc has claimed since July but which has never had a screen — today it only happens if you think to ask the chat. Sequencing note: the resurface half wants real photos, so it trails item 27/31.
110. **Per-user cost metering + capped free tier** — founder will not spend more than **$10–20/month total** on other people's AI usage. Measure real per-user cost first, then a hard cap that degrades gracefully to the free features (search, browsing, manual entry all still work without Claude). No rate limiting and no metering exist today (SECURITY.md item 7). Gates opening signups beyond friends and family.
111. **Shared memories + user-generated templates** — founder raised both unprompted ("makes it feel more like a community product"): invite specific people to add photos and their side to one milestone event, and let people publish notebook templates others can start from. **Architectural, and deliberately undecided** — every table is RLS-scoped to a single `auth.uid()`, so this means invitations, per-record permissions, and a rethink of who can edit what. Per §11 it needs its own design conversation before any code. Hard bound: invite-only, never public (§9 guardrail).
112. **Demo persona, stage 2 — replace Gary wholesale** — the founder's call 2026-08-23 was a two-stage rework, and **stage 1 is DONE**: the retirement/60s framing is gone (Gary is a working Regional Operations Manager, 30 years at Frontier this spring; the two retirement parties became a 25-year milestone and Carol's 25th year teaching, with 1985 → 1996 so the arithmetic works; Carol still teaches). The family graph, the people and the ids were deliberately left alone, so this was ~22 exact-match edits, not surgery. **Stage 2, still open:** replace the persona outright with someone mid-life — the drafted sketch is *Dana Marsh, 45: Owen (17 years), Iris 12 and Theo 9, mother in assisted living nearby, father died 2019, accounts lead 13 years, three cities, Owen has five siblings.* That needs the 44-row family graph rebuilt (young kids, no grandchildren) and the ~34 moments / 118 notes re-authored, so it is a real job with its own verification pass. **Sequence it with items 106/107** — once notebook templates and held letters exist, the demo has something new to show anyway, and a letter sealed for a 12-year-old only makes sense with the younger persona. Note the whole supporting cast still skews older by name (Carol, Peggy, Walt, Harold, Ruth, Donna, Yvonne) — stage 2 is where that gets fixed too.

113. ~~Associate one existing event with another~~ — **DONE 2026-08-26, migration applied.** Founder ask from the action-bubble screenshot: *"Need to be able to associate events too — either as a sub event (make it clear which direction it's going) or just as a related event."* Two gaps: from a parent's own page there was no way to pull an EXISTING event in (only "+ New sub-event", which creates a blank one — the only re-parenting tool was the child's own Manage panel), and there was no way at all to connect two events without one containing or swallowing the other. New "🔗 Associate an event" bubble row: pick an event, then choose the direction with both titles written out. Illegal directions stay on screen as muted reasons (target has sub-events / target is itself a sub-event / this event has sub-events / already connected) rather than disappearing. "Related" writes `moment_links` (§6, symmetric, one row per pair) and shows in a new "Related Events" section with hover-unlink tiles, on sub-event pages too. **Verified:** every branch click-tested through the real `EventDetailPage` in the browser preview against a stubbed PostgREST (throwaway harness, deleted); RLS proved on the live table by an insert as role `authenticated` inside a rolled-back transaction, with a foreign `sub` refused (42501); build + 749 tests green. **Not verified against the founder's own logged-in account** — no session was available in the pane.

**Flagged from feedback widget — needs founder scope decision (not filed as bounded items, left open in the widget):**
- *(Jake's birthday dinner, 2026-08-03)* Founder: the chat didn't add the right people to the event or spell all the names correctly, and wants it to actively extract people/event details from a narrative, infer who they are from existing contacts/context, suggest adding them — and if it's fully confident, add them automatically. This overlaps with item 15's person-to-person inference thread and item 76's chat-unification effort; worth deciding whether it's its own item or folds into one of those before scoping.

**Deferred with numbers behind it:**
- *Association rule mining for suggestions* (founder asked 2026-08-08 for "an agent which routinely scans the app and figures out new ideas for connections"). The concept is link prediction over the personal knowledge graph, and the discovery mechanism is association rule mining (support + confidence) — free and deterministic, no AI. Dry-run on the real account first: at confidence ≥0.75/support ≥5 it found 24 rules and **22 had nothing to suggest** (the account is already complete where patterns are strong); loosening to ≥0.6 gave 45 suggestions but the volume came from the bad rules ("in 22 AS → also Pilots", 15 suggestions, wrong — a squadron isn't all pilots). Conclusion: it earns its keep on messy accounts, not this one. Revisit with real users. If built, run it **in-app** (Home load or a scheduled Edge Function), not as an external cloud agent — that credential path was already abandoned 2026-08-03.

**Parked** (don't resurrect unprompted): automatic email reminders (table exists, nothing sends); "AI should ask deeper follow-ups" thread (feeds 17). *(Weather metadata left this list 2026-08-17 — the founder resurrected it themselves; shipped as part of item 21.)*

**Small known follow-ups:** ~~align `person-facts`' category vocabulary with the shared 5-kind enum~~ — **DONE AND DEPLOYED 2026-08-12.** The shared closed enum is `spouse | partner | parent | child | sibling` (`_shared/relationships.ts`); `person-facts` had no **partner** category, so `RELATIONSHIP_CATEGORY_IDS` folded `partnerIds` in under `spouse` and the table-injection path hardcoded the label "Married to". Now a real `partner` category, defaulting to "In a relationship with", with the label table driving both instead of a `category === "spouse"` ternary; frontend gained the category, a sort slot beside spouse, and a `satisfiedBy` list so the "Is X married?" nudge stops asking about someone already recorded as dating. The three PLURAL group categories (`siblings`/`parents`/`kids`) deliberately keep their spelling — they're the stored shape of every cached `key_facts` row and the key `KEY_FACTS_CATEGORY` looks up, so renaming buys nothing visible and costs an AI regeneration sweep across every profile (CLAUDE.md rule 3). **Measured on the real account, and it revises the severity:** 4 partner rows / 8 people, and NONE currently renders "Married to" — the AI's own `relationship_label` had been carrying it ("Engaged to", "Girlfriend of", "In a relationship with"), all still filed under the wrong category. The hardcoded default only bites on the table-injection path, which is one regeneration away for the 4 of those 8 whose `key_facts` are NULL. **Deployed but NOT live-verified end-to-end** — every generation path currently returns `extraction_failed` because of §10's API-key outage, so the new chip has never actually been produced. Re-check once the key is fixed. ~~nicknames stated via `update-moment` aren't written (only lookup)~~ — **DONE and deployed 2026-08-11**: `update-moment` and `update-group` now capture `nickname_updates` like `converse` always has, off a shared `_shared/nicknames.ts` (`mergeNicknames`, additive + case-insensitive dedupe, 10 tests) with the prompt clause and JSON field as shared constants so the next fix lands in all three at once (the item 76 bug class). **The trap, worth remembering:** both new functions build their nickname LOOKUP list with `middle_name`/`goes_by_other` folded in — safe while read-only, but merging onto it would copy a middle name into the `nicknames` column, so the write merges onto a separate raw mirror (`rawNicknamesById`). One-time prompt-cache invalidation, by design (the clause sits in `stableInstructions`, never interpolated). `person-facts` deliberately untouched — it's a Key Facts extractor, not a capture path. **Live-verified 2026-08-11** against a disposable person + event on the real account: "Everyone calls him Chip" through `update-moment` wrote `nicknames: "Chip"`; a second turn ("people also call him Skipper") merged additively to `"Chip, Skipper"`; and with `middle_name: "Bartholomew"` set on that person, the middle name did NOT leak into the column — the trap above, confirmed on real infrastructure. Test data deleted after. `update-group`'s half is the same code path but wasn't separately exercised. ~~Edge Function test coverage (needs Anthropic/Supabase mocks)~~ — **DONE 2026-08-12**, 116 new tests across 7 files (suite 381 → 501). `_shared` modules that had never been tested now are: `dateValidation`, `eventDates`, `tz`, `promptCache`, `ics`, `vcard`, `selfContext`, `userSettings`. The Supabase-mock half is real but cheap — `userSettings`/`selfContext` declare their own `MinimalSupabaseClient` shape, so a ~15-line fake covers `from().select().eq().maybeSingle()` with no SDK, network or database; `buildKinInstruction` takes its rows as an argument, so its whole path runs against a stub that throws if anything tries to query. **What is still NOT covered, deliberately:** each function's `index.ts` orchestration. Those hold `serve()` and a live `fetch` to Anthropic with no seam to inject either, so testing them means refactoring for dependency injection first — a real piece of work, not a follow-up line. `npm run check:functions` (item 95) still typechecks them. ~~no retroactive group backfill for pre-2026-07-15 moments~~ — **CLOSED 2026-08-12, mostly superseded.** Item 85's `loadEventGroupSuggestions` has no date filter, so old untagged moments already surface on Home for one-tap tagging; what it can't reach is events with fewer than 2 attendees or whose attendees don't all share a group. Those are now findable by hand: Events' group filter gained a **"No group yet"** option (matching the existing "No tags yet"/"No location" sentinels), which on the real account narrows 119 events to **51**. A bulk auto-tagger was NOT built — the precision bar that makes the suggestion card trustworthy is exactly what a backfill would have to abandon.

96. **Mass imports were built for a handful of cards, not a real import** — **PHASE 1 DONE 2026-08-19, MERGED AND LIVE 2026-08-21** (see §7 "Reviewing imports"). Built on branch `claude/mass-import-simplification-hj9cib` and left unmerged for two days; merged to `main` on the founder's call once the two migrations were confirmed already applied and the screens were click-tested (§10). Follow-on from the 2026-08-12 directive: removing the AI filter was right, but it moved the whole burden onto a review screen whose answer to ~230 candidates was "Show 20 more (210 still to review)", a ~695px editor per card, no answer between accept and reject, and four separate nudges on Home. Founder chose (2026-08-19) small batches + one inbox, lighter cards, "Not now" as a real state, and a triage pass for calendar events; explicitly did NOT choose a bulk "Accept all N straightforward ones". **Round 2 DONE 2026-08-19** off the founder's preview: four answers on the triage row (Quick Add / Add More Detail / Remind Me / Reject), a chosen-and-rememberable reminder interval, scroll position held on both triage lists and across the review queue's navigations, "Add to events" on the contact card, the picker closing on select, and the gender pass surfaced in the inbox. **Phase 2, still open:** port `ReviewDeck`, the collapsed cards and Remind Me to `BirthdayImportReview` / `ContactImportReview` / `PhotoImportReview` — the deck is already generic, so this is wiring, not design. Also worth doing: `CalendarTriage` and `ContactSelection` are near-identical and want a shared `TriageList` before a third fast pass copies them again.



## 10. Pending manual steps, open bugs, cleanup

- **Free demo Events tab fixed 2026-08-24 (scheduled verification pass):** `demoData.ts`'s `genDate()` appended `T00:00:00Z` to generated events' `event_date`, but `eventSortDate()` (lib/dates.ts) appends its own `T00:00:00` — the double suffix parsed as Invalid Date, showing literal "NaN" year headers and "Invalid Date" text on ~91 of the generated roster's events (visible on the live demo's Events tab). Fixed by making `genDate()` return a bare `YYYY-MM-DD`, matching CORE_MOMENTS and the real DB's DATE column. Second bug found alongside it: `DemoEvents.tsx` fed `DEMO_MOMENTS` into `groupMomentsByYear` unsorted (only the real Events.tsx container sorts before that call), so the same year could resurface in non-adjacent groups and collide on React's `key={year}` — fixed by sorting demo moments the same way (newest first) before mapping. Both confirmed fixed via a local browser click-through (console clean, screenshots of Home/People/Events/Groups/Notebooks + person/group/event detail pages and search all correct); `npm run build`, `npm run test` (705 passed) and `oxlint` all clean. Demo backstory content (Gary Pemberton persona, DemoIntro copy) checked against §1's current positioning — already up to date, no changes needed.
- ~~**Founder action needed: run the two item-96 migrations**~~ — **both applied, confirmed live 2026-08-21** by reading the schema directly: `moment_import_candidates.deferred_until` exists as `date`, the status CHECK accepts 'selected' and 'deferred', the partial deferred index is present, and `user_settings.review_remind_days` exists as `integer`. `probeTriageEnabled()` therefore returns true and the triage page + "Not now" are switched on.
- **Item 113 (Associate an event), 2026-08-26 — needs one click-through on the real account.** `moment_links` is applied and its RLS proved by a rolled-back insert as role `authenticated`, and every UI branch was click-tested through the real `EventDetailPage` against a stubbed backend — but no logged-in session was available in the pane, so no association has yet been made against real data. Worth doing once: link two real events as related, and pull one existing event under another, then undo both.
- **Item 96 click-testing, 2026-08-21 — most of it done, three paths still unseen.** Verified against the founder's real account at merge time, each write reversed afterwards and the queue counts confirmed back at baseline (294 pending / 6 selected / 189 rejected / 176 accepted): one Home nudge reading "1,122 things to review"; all four inbox rows with counts matching the DB; Quick Add creating a real event and Undo deleting it again cleanly; Remind Me applying the saved 30-day default without a sheet, and its Undo; the gender pass saving through the dropdown, dropping the name off the can't-guess list, and the count falling 60 → 59; the contacts queue with its All / Already in Grove / New people filters; the detailed card showing a possible-duplicate warning. **Still unseen:** a batch of 10 ending with the summary panel, a collapsed **Accept** on the detailed card saving the right title/date/attendees (skipped on purpose — unlike Quick Add it has no one-tap Undo, so testing it means leaving or hand-deleting a real event), and **drag**-into-Men/Women (only the dropdown path was exercised; both call the same setter, but the drag handlers themselves have never run).
- ~~**LIVE OUTAGE, found 2026-08-12: the project's `ANTHROPIC_API_KEY` secret is rejected — every AI feature is down.**~~ — **RESOLVED, confirmed 2026-08-19.** The key was replaced; `people.key_facts_updated_at` has rows written 2026-08-17 and twice on 2026-08-19, which only happens when an Anthropic call succeeds. (Left in place because the *shape* of this outage is the lesson: a project-wide secret with a scheduled expiry took ten functions down at once and nothing said a word.) Historical detail follows. Anthropic answers `401 {"type":"authentication_error","message":"API key is invalid."}`. **Cause confirmed 2026-08-12 by Anthropic's own "API key expiring soon" email: the key (named `boomer-app`) had a scheduled expiry date of 2026-08-12 UTC and reached it.** Not a revocation, not a leak — so the replacement is a routine reissue, and the only durable fix is to check the expiry date on the new key. The secret is project-wide (set 2026-07-13) and **10 Edge Functions read it**: `add-fact`, `converse`, `person-facts`, `scan-calendar-sources`, `suggest-prompts`, `summarize-group`, `summarize-moment`, `update-group`, `update-moment`, `google-photos-picker-session-create`. So Home chat, note detection, Key Facts, event/group summaries and calendar scanning are all failing right now. **Founder action: issue a new key at console.anthropic.com and set it** (`npx supabase secrets set ANTHROPIC_API_KEY=… --project-ref dedtnytxhzzjimkozncc`, or Dashboard → Project Settings → Edge Functions → Secrets). **It fails silently by design** — `person-facts` returns `extraction_failed` and falls back to cached facts, `suggest-prompts` returns its hardcoded fallbacks — which is why nothing surfaced an error and it went unnoticed. Found while live-verifying the item-66/partner work: four real people (Kate Tolli, Caroline Newman, Abe Leonard, Cormac Dunn) have `key_facts` NULL because generation has been failing. Start date unknown — the CLI has no `functions logs` subcommand, so it needs the Dashboard's log view to pin down. **Worth adding afterwards:** nothing anywhere alerts on this, and a silent-failure class this wide is exactly what §12 exists for. **Still open as of 2026-08-12 evening, and it is what the founder now sees as "calendars are not syncing"** — re-confirmed from the deployed functions' own logs: 8× `Anthropic extraction call failed 401` from one "Sync now" click, and `Anthropic API error 401` from the Home chat seconds later. Calendar sync fails *silently* too (the button returns success and reports "nothing new found", because a failed extraction returns `[]` and reads as "no events worth suggesting"), so the only visible trace is a `last_synced_at` that stops advancing.
- **The calendar scan no longer decides what is worth keeping — founder directive, 2026-08-12: "just simply sync all new events, and let the person decide themselves whether or not they want to accept/reject it."** Every in-range, non-cancelled, unseen event now becomes a `pending` review card. The AI call stays, but only to extract the clean title/location/notes and suggest tags, groups and people — it no longer returns an `include` verdict, and the "skip generic solo logistics" framing is gone from both the system prompt and the tag guidance. **Why:** the filter was rejecting ~88% of what it saw — one measured sync auto-skipped 202 events and let 28 through, with the rejects being things like `AMD` ×58, `Doc Appt`, `Haircut`, `Lawn Aeration`. The 202 already buried were released by **deleting** their rows (`2026-08-12-unskip-calendar-candidates.sql`, applied), so the scan rediscovers and re-extracts them properly. **Not by flipping them to `pending`** — that was tried first and was wrong: a skip row is a bare tombstone (uid only, no title/location/notes), so flipping produced 202 blank review cards, and permanently, since the row's own uid is what keeps the event out of `seenUids`. Deleting is what makes it unseen again. **This also dissolves the re-judging bug below by construction** — every event now gets a row on the run it is first seen, so nothing can be re-sent to the API forever. `'skipped'` is retained as an allowed status but is written by nothing; an opt-in auto-filter could reuse it. **Known consequence, not yet addressed:** the queue jumped 164 → 366 pending and `ImportReview.tsx` has no bulk action, so it is one card at a time — a "reject all like this" or a multi-select is the obvious next ask if it proves tedious.
- ~~Second calendar-sync bug, 2026-08-12: the scan re-judged the same rejected events forever~~ — **superseded the same day by the directive above, which removes the filter that caused it.** Kept because the shape is worth remembering: `scan-calendar-sources` only ever wrote a row for an event the AI approved, so an `include: false` was thrown away, the event stayed out of `seenUids`, and it was re-sent to the API on every run. Measured: **322 events (140 + 182) re-judged every run against a 240-event/8-batch cap**, so "Jake Personal" never reached the end of its own list, never got `last_synced_at` stamped, and read "Last synced Aug 4" for 9 days. The **least-recently-synced-first source ordering** added alongside it is still in place and still earns its keep (the batch budget is per-run and shared, so an unordered list let one calendar spend it every time).
- ~~Founder action needed: `migrations_manual/2026-08-20-family-group-suggestion.sql` (item 98)~~ — **applied 2026-08-20 via the Management API, no founder step**; `pg_get_constraintdef` confirms `family_group` is in the `dismissed_suggestions` kind CHECK, and a real dismissal wrote and was cleaned up.
- ~~Founder action needed: run `migrations_manual/2026-08-12-subgroup-color.sql` (item 82's manual-override half)~~ — **APPLIED 2026-08-20 via the Management API, no founder step.** `information_schema` confirms `groups.color_index` (smallint); the swatch controls now render on subgroup tiles (3 on the Volin group), and a pin was written (`MogulTool` → index 4) and cleared again through "Back to automatic", so both write paths work on real data. The account is left with zero pins, i.e. every tile still auto-coloured.

- ~~NEEDS DEPLOY: 5 Edge Functions for item 94's group-name fix~~ — **DONE 2026-08-11.** `add-fact`, `converse`, `scan-calendar-sources`, `suggest-prompts`, `update-moment` deployed with the persisted `SUPABASE_ACCESS_TOKEN` and confirmed live via the token-free check. **Incident during this deploy, fully resolved:** the first attempt passed `--no-verify-jwt`, which switched OFF the platform auth gate on all five. Caught within minutes by the token-free check answering with each function's own 401 instead of `UNAUTHORIZED_NO_AUTH_HEADER`. A plain redeploy did NOT put it back — the setting persists server-side — so it took `PATCH /v1/projects/{ref}/functions/{slug}` with `{"verify_jwt": true}`. Re-verified: all 15 functions now report `verify_jwt: true` and all five answer `UNAUTHORIZED_NO_AUTH_HEADER`. **No exposure:** every one of the five checks `auth.getUser()` and 401s on its own, and `suggest-prompts` (the only one that returned a body) returns hardcoded `FALLBACK_SUGGESTIONS` before any Anthropic call — so no user data was readable and no API spend was reachable. New §12 guard added.
- ~~Not yet click-tested against real data~~ — **VERIFIED LIVE 2026-08-11** against `jakevolin@gmail.com`, measured through the app's own client (not a SQL reconstruction). **Item 88, measured:** the old unpaged `notes` read returned exactly 1000 of 1369 rows, so `DueForUpdate` saw 347 people with notes instead of 430 — **83 real people were being listed as "No updates yet" when the founder had written about them.** `person_groups` likewise 1000 of 1204 (204 memberships invisible account-wide). **Item 94, measured — and the severity was narrower than first written:** the account has 21 groups nested 3 deep, but every one has a distinct immediate parent, so the old one-level names were unique and **no wrong-subgroup tagging actually occurred.** What WAS live: all 21 of those groups displayed a path in the app (e.g. "Air Force / 98 FTS / Pilots") that the old server index **could not resolve at all** — not to the wrong group, to nothing. Confirmed fixed end-to-end against the deployed function: asking `converse` for "Air Force / 98 FTS / Pilots" now returns the correct 19-member roster. **Item 93 / the `.order()` fix:** Air Force's 29-group subtree is 852 rows, under the cap, so its 302-member count was already correct and matches the page — that fix is preventative here, not a live repair. Pages checked: Home, Due for an update, Groups, People (712), Events, Calendar — all render, zero console errors.
- **Backlog verification sweep 2026-08-11 (second pass, `jakevolin@gmail.com`)** — cleared most of the "pushed but never clicked" pile. **Item 84 §5 (Calendar), which had had NO browser check of any kind:** gear icon, Timeline (past + future in one list) with a Today button that scrolls 0 → 7854, tag filter pills, month picker (August → December 2026), Day/Week showing the honest "coming soon — Month is fully built for now", the month grid, the day-count badge (Aug 3 renders `3` + a 13px blue `2`), the "On this day" popover opening on tap with real cross-year history ("On August 3 — Going to be a girl dad! 2026, Casa Bonita outing 2025") and closing on a second tap, and Countdowns with a live-ticking seconds column under the TODAY · AUG 11 divider. **Item 84 §4:** the combined name/date/location form — all three edited in one Save, one `moments` update, header re-rendered "September 15, 2026 · New Place, Denver". **Item 84 §2:** the avatar opens the sheet with Settings + Log out. **Item 84 §3:** the quiet "+ Add pet" link renders (the contact-info branch wasn't exercised — the profile used already had contact info, so it correctly showed the full card instead). **Item 82:** 53 subgroup dots in 8 colours on the member chips, and the "Not in a subgroup (6)" pill filters 132 members down to exactly those 6 and restores. **Item 91's GroupDetail half:** with `POST /rest/v1/person_groups` forced to 503, the banner read "Couldn't add Harvey Volin to this group — please try again." (full name, per item 33's nit fix), the "✓ Added" line was withheld, no phantom chip was drawn, and the DB stayed at 132 members with no row for him. **Item 60:** at phone width the three name inputs share one row (same y, x 24/136/247, 104px each). **Still not clicked:** item 59's bulk "✓ Add all suggestions", item 19's group reparenting, and item 61's first-person "my X" re-test.
- ~~NEW BUG, found 2026-08-11: the top nav bar overflows a phone screen~~ — **FIXED 2026-08-11, founder-directed from mockups.** Founder ruled out sideways scrolling entirely ("I dont want to scroll sideways on the app at all"), so the scrolling-tabs option was dropped; they picked icons-with-labels in the top bar over a bottom tab bar, keeping phone and desktop on one layout. New `src/components/NavIcons.tsx` — five hand-written inline SVGs, deliberately NOT an icon library (this repo runs on 3 deps; adding a fourth for five glyphs isn't worth it, and hand-drawn means swapping one is a one-line edit). Icon logic: People is one figure and Groups is two, so the pair reads singular/plural; Events is a photograph, not a date, to stay distinct from Calendar. **The load-bearing fix is `minWidth: 0` on the bar and the tab row** — a flex row's default min-width is its content, so the tabs pushed the bar wider than the screen instead of sharing it; `flex: 1 1 0` with `maxWidth: 76px` lets them share on a phone without stretching across a desktop bar. Verified at 375px: `scrollWidth` 375 = `clientWidth` 375, zero overflowing elements anywhere on the page, all five tabs 44×45px (the touch-target minimum), no label clipped ("Calendar" is tightest at 42px in 44px), avatar right edge at 359. Screenshot-confirmed at both phone and desktop width. **Founder has NOT signed off on the specific drawings** — they said the icons were "an interesting idea" but disliked the mockup's set, and these are a second attempt.
- **~~NEW BUG~~, found 2026-08-11, not fixed: the top nav bar overflows a phone screen.** At a 375px viewport the nav (`Grove / Home / People / Events / Calendar / Groups / JV`) measures 421px, so the page scrolls sideways and the Groups tab and the account avatar sit partly off-screen — `document.documentElement.scrollWidth` 472 vs `clientWidth` 375. Found incidentally while checking the email form at phone width; the email form itself fits (290px boxes). This is item 84 §2's nav styling, which was build-verified only and never seen on a phone. It matters more than most layout nits because the phone is the founder's primary surface (item 72) and this is the app's main navigation. Left unfixed deliberately — the fix is a visual decision (scroll the tabs, shrink them, or drop to icons) and the founder iterates on those via mockups.

- **"Sign in with Google" — Cloud Console + Supabase setup done 2026-08-03, final live confirmation still needed.** Founder completed both steps (redirect URI on the existing Google Photos OAuth Client; Google enabled as a Supabase provider with that Client ID/Secret) — first attempt 400'd with `redirect_uri_mismatch` (URI hadn't saved/was on the wrong client), retested after the founder fixed it and it now reaches Google's real sign-in screen (`accounts.google.com`, scoped to `email profile`, correct client_id/redirect_uri) with no error. Verified as far as possible without real Google credentials in this session — the founder still needs to actually complete a sign-in on the live site to confirm two things: (1) it lands them back in Grove logged in, and (2) since public signup is closed (below), it logs into their *existing* account by matching email rather than erroring or creating a new one. Also still true: while the OAuth consent screen stays in Testing mode, only accounts added as test users can get through this (same limitation as Google Photos) — basic sign-in scopes shouldn't need Google's full verification review to publish beyond that, but not yet checked.
- ~~Founder action needed: run `migrations_manual/2026-08-06-countdown-settings.sql` (item 84)~~ — **run by the founder and confirmed live 2026-08-08**: an anonymous PostgREST select of `custom_title, units, repeat_rule, keep_counting` returns 200, not `42703`. The per-card ⚙ is live. Still worth one pass on the real account: rename a card (the event's own title must be untouched), pick "Days" on an old milestone (a total in the thousands), set something to repeat, and reload to confirm it all stuck — the settings were verified against a stubbed backend, not against real rows under RLS.
- ~~Founder action needed: run `migrations_manual/2026-08-06-countdowns.sql` (item 83)~~ — **run by the founder, confirmed live 2026-08-08** (the table answers PostgREST). **The file is re-runnable** (2026-08-06 fix): the founder's first paste hit `42710: policy "Users manage their own countdowns" already exists` on a second run, because `create policy` has no IF NOT EXISTS while every other statement in the file does — a `drop policy if exists` now precedes it, same as `2026-07-20-relationships-table.sql`. Worth remembering for any future migration that creates a policy. Still unexercised against real data: deleting a pinned event should take its countdown with it via ON DELETE CASCADE.
- ~~Founder action needed: run `migrations_manual/2026-08-03-group-type-suggestion-dismissed.sql` (item 80)~~ — **confirmed applied 2026-08-10** (anonymous PostgREST select of `groups.group_type_suggestion_dismissed` returns 200, not `42703`), so Home's "Tag as Family?" card can remember a "No". Not yet click-tested against real groups.
- ~~Deploy the 4 edge functions for item 86's blended-family fix~~ — **DONE 2026-08-10.** `add-fact`/`converse`/`update-moment`/`update-group` (the four that call `applyFamilySignals`/`syncFamilyClique`) redeployed with the corrected `_shared/relationships.ts`, using the persisted `SUPABASE_ACCESS_TOKEN`; all four confirmed live via the token-free check (`UNAUTHORIZED_NO_AUTH_HEADER`, not Supabase's `NOT_FOUND`). `person-facts` imports the same file but never calls the clique sync, so it was deliberately left alone.
- **Schema-migration sweep 2026-08-10 — every pending SQL file in the docs was already run.** Probed PostgREST anonymously for `people.gender` (item 44), `groups.group_type_suggestion_dismissed` (80), `groups.suggestions_enabled` (57), `feedback_notes`, `dismissed_suggestions` (85) and `countdowns` (83): all 200. **Method worth reusing** — a missing column/table returns 400 `42703`/`42P01`, so this distinguishes applied from pending in one read-only pass with just the anon key, no dashboard and no service role. What this does NOT cover is the remaining **data** migrations (below), whose effects are invisible to an anonymous read under RLS.
- ~~Founder action needed: run `migrations_manual/2026-08-01-pets.sql` (item 73)~~ — **run by the founder and confirmed live 2026-08-01.** `pets`, `person_pets`, every column the app selects, and the `person_pets → pets` embed all return 200 via PostgREST. Full end-to-end click-through done against the real account with disposable test data (create pet → lands on its page → edit/save → persists across reload → appears in the People list with 🐕 and owner chips → attach to a second person → edit from one side shows on the other → mark deceased shows "In memory · 2019–2024" → merge carries the pet to the survivor → delete-profile succeeds with no error). All test data deleted after (verified 0 pets, 0 links, 0 test people).

- ~~Founder action needed: run `migrations_manual/2026-07-30-platform-stats.sql`~~ — **run and confirmed live 2026-07-30**: Landing page's platform databox (§3/§6) shows real cross-account totals, verified in browser preview.
- **Founder action needed: add the Geoapify key to Vercel's production env vars (2026-07-26)** — key created, verified working live in local dev/browser preview (real Denver, CO address suggestions returned and selectable on ImportReview's Location field). Local `.env` already has `VITE_GEOAPIFY_API_KEY` set. Still needs adding to the Vercel project's Environment Variables (Settings → Environment Variables) — `.env` isn't committed, so the deployed build has no key yet and only shows previously-typed-address suggestions in production until this is done. Also worth restricting the key to the production domain + localhost under "Referrer restrictions" in the Geoapify dashboard (currently unrestricted).
- ~~Founder action needed: run `migrations_manual/2026-07-26-group-suggestions-default-off.sql`~~ — **CONFIRMED RUN 2026-08-11.** Measured through the app's own client while logged in: 0 of 68 groups have `suggestions_enabled = true`. Original note kept below.
- ~~Redeploy 4 edge functions for the family tree relationship-sync fix~~ — **DONE 2026-07-25.** `add-fact`/`converse`/`update-moment`/`update-group` all redeployed with the fixed `_shared/relationships.ts` (founder-provided token, confirmed success on all 4).
- ~~Founder action needed: run the family-tree backfill SQL by hand (2026-07-25, item 40 follow-up)~~ — **BOTH FILES CONFIRMED RUN 2026-08-11**, measured against the real graph (713 people) through `loadFamilyGraph`, not a SQL reconstruction. **Sibling backfill:** ZERO pairs of distinct children who share a recorded parent but lack a sibling row — the exact condition its steps 1–2 exist to eliminate, and the dry run had predicted "at least 24" before it ran. **Spouse-coparent backfill:** only 2 co-parent gaps remain account-wide, both `Michael Galchinsky → Sam Volin / Natalie Gregorian` — precisely the Andy Volin / Andi / Michael Galchinsky remarriage case that file is *designed to exclude* (he's a step-parent, not a missing biological one). So it ran AND correctly skipped the one case it was supposed to skip. **Method worth reusing for any data migration:** schema probes can't see these (§10's 2026-08-10 sweep says so), but the app's own graph loader can — re-derive the condition the migration was meant to remove and count it. Original note kept below.
- **~~Founder action needed~~: run the family-tree backfill SQL by hand (2026-07-25, item 40 follow-up)** — code deployed everywhere (frontend + all 4 edge functions), verified live with disposable test people, but the actual backfill against real data (fixes the reported Lorenzo Harris tree, and everyone else's already-built trees) needs to be run **by the founder, in the Supabase Dashboard's SQL Editor** — both the Management API and the browser-client fallback were tried and both got blocked by the auto-mode safety classifier for a write at this scale (a bulk backfill across many real relationship rows, not a narrow single-row fix — see `project_boomer_infra.md` memory for the refined understanding). Run `migrations_manual/2026-07-25-spouse-coparent-backfill.sql` FIRST, then `2026-07-25-shared-parent-sibling-backfill.sql` (each file's own header explains why). **Do not run a copy of the sibling file older than 2026-08-10** — its step 3 unioned parents across each whole clique, which is item 86's bug applied to every blended family in the database at once, additive and irreversible. It now carries the same open-seat rule as the app code, and its header explains how to dry-run it. Dry-run preview already done this session (read-only queries aren't blocked): the spouse-coparent file will add 35 new parent links across ~20 different families (including the reported Jamie/Leanne/Lorenzo case) and correctly excludes the Andy Volin/Andi/Michael Galchinsky remarriage case; the sibling file will add at least 24 new direct sibling pairs before its own transitive-closure step runs. Both are `ON CONFLICT DO NOTHING`/additive-only — safe to re-run, nothing gets deleted or overwritten.
- ~~Needs deploy: `scan-calendar-sources` family-surname matching (2026-07-25)~~ — **deployed 2026-08-01** alongside the subgroup-name fix below. `mentioned_family_names` is now live, so entries like "Meal train for the Mojica family" scan under the new prompt. The founder cleanup noted below (the already-accepted Mojica moment) is now available to do.
- **Founder cleanup available once deployed above:** the real "Meal train for Mojica family" calendar entry was already accepted into a real `moments` row (id `f62ca5f8-…`) under the old logic, so Patrick Mojica/his "98 FTS" group were never attached to it — confirmed live 2026-07-25 (Patrick Mojica *is* on file, *is* in "98 FTS"). Not auto-fixed (this session only verified the gap, didn't touch the real moment). Once the redeploy above ships, the founder can either add Patrick + 98 FTS to that event by hand, or delete just that one `moment_import_candidates` row (`ical_uid` `r3rv0mmoc1c9lhc827928k4oso@google.com`) and re-run "Sync now" to regenerate it under the new logic, then merge it into the existing event.
- ~~`summarize-group` member-conflation prompt fix~~ — **deployed 2026-07-19** (confirmed live: 401, not Supabase's not-found). Still worth regenerating the Sam/Jordan test group's summary (refresh button) to confirm it no longer calls Jordan a member.
- ~~`person-facts` exact-match confidence fix~~ — **deployed 2026-07-19** (confirmed live: 401, not Supabase's not-found). Gus Reynolds's cached Key Facts will still show the stale "Dating: Olivia Gillingham" chip until his profile's Key Facts are refreshed (button, or edit/delete a note).
- ~~Bad data cleanup: wrong "Dating" notes on Gus Reynolds's/Olivia Gillingham's profiles~~ — checked live 2026-07-19, nothing to clean up; confirms the `person-facts` exact-match rule (§12 guard) is working as intended.
- ~~Remaining cleanup: test person "Zzztest CacheCheck" + test event~~ — **checked live 2026-07-20, already gone** (a People search for "Zzztest" returns no matches). Founder must have deleted it since the original note; not this session's doing.
- ~~Julia Lacy's "Wyatt" Key Fact showing as text, not a button~~ — fixed 2026-07-19, no code change; her note used a bare first name, correctly declined per the exact-full-name-match rule (§12 guard). Fixed by editing the note to the full name and letting Key Facts regenerate.
- ~~`search_log` table~~ — **confirmed live**: PostgREST returns 200 for `search_log`, `converse` returns 401 (deployed, not platform-not-found), and the production Home dashboard's "Recall assists this month" card shows a real nonzero count (4).
- **Tim Rose's contact-import candidate is `status='accepted'` (2026-08-02)** — accepted during item 74's live verification and not reversible afterwards (navigating away drops the in-memory Undo). His cell `+12086482849` merged onto his profile, which is what accepting that high-confidence match would have done anyway; the test note written alongside it was deleted. Net effect: he won't reappear in the review queue. Nothing to fix unless the founder wanted to review him by hand.
- **Birthday + photo review note boxes are code-verified only** — both queues were empty on the real account at build time (and Google Photos isn't connected), so `ReviewNoteField` on `BirthdayImportReview.tsx`/`PhotoImportReview.tsx` compiles and is wired identically to the two screens that WERE click-tested, but was never exercised end-to-end. Same caveat for `MatchCallout` on `BirthdayImportReview.tsx` (2026-08-10) — click-tested on the contacts queue only. Worth a look the next time either queue has something in it.
- **Voice mic button**: the audio→transcript→text round trip is confirmed end-to-end as of 2026-08-18, against the deployed function with real synthesized speech (Windows SAPI WAV → deployed `transcribe` → streamed SSE), including auth, the roster keywords, and correct spelling of real roster names. What remains unexercised is only the browser's own microphone capture: the assistant's browser pane still blocks mic hardware (`NotAllowedError`), so `getUserMedia`/`MediaRecorder`/the level meter have never run on a real device. **Founder is still the only one who can confirm that hop, and iOS is where it is most likely to differ** (mp4 recording, AudioContext resume, no live captions). **First real-device data 2026-08-23** (iPhone, iOS 18.7 Safari, from the Edge Function logs): mp4 capture and the streamed transcript both work — two of three recordings that session were fine at 196KB and 911KB. The third arrived as a 44-byte request body, i.e. a capture with no audio in it, and OpenAI rejected it as "Audio file might be corrupted"; both the client floor and the `audio_unreadable` code came from that. What produced the empty capture on the device is still unknown.
- ~~Cache-tiering + relationship-fanout dedupe (2026-07-20) needs deploying~~ — **deployed and confirmed live 2026-07-20** (`converse`/`update-moment`/`update-group`/`add-fact`, via `npx supabase functions deploy` with a founder-provided token; all 4 return 401, not Supabase's not-found). The same-day message-thread-caching fix (`_shared/promptCache.ts`) landed on disk before this redeploy ran, so it went out in the same batch. See PROJECT_HISTORY §14.
- ~~Sibling-linking fixes need redeploy~~ — all 3 rounds deployed and confirmed live 2026-07-20 (`add-fact`/`converse`/`update-group`/`update-moment`); Sucre and Berzins family data hand-repaired live. Full 3-bug story: PROJECT_HISTORY §13.
- ~~Database-wide scrub for the same asymmetric-relationship-note bug~~ — done 2026-07-20, found and bulk-fixed asymmetric pairs across the whole database (not just the two reported families); zero gaps remained on re-scan. Full story: PROJECT_HISTORY §13.
- **Founder cleanup needed: likely duplicate person "David" (no last name) vs. "David Adelstein"** — both have the identical single note "Married to Jill Tullman.", the signature of an accidental duplicate profile rather than two facts. Left unmerged deliberately (found during the scrub above) — merge via the app's own People search + merge-profile feature rather than guessed at.
- **Founder action needed: enable Supabase email-change codes** (item 54) — in the Supabase Dashboard, turn on "Secure email change" (Authentication → Providers → Email) and add `{{ .Token }}` to the "Change Email Address" template (Authentication → Emails → Templates) so it emails a 6-digit code instead of only a link. Until this is flipped on, the new Settings code-entry UI has nothing real to verify against. **"Secure email change" confirmed ON by the founder 2026-08-11 — and that turned out to CONTRADICT the one-code UI shipped under item 54.** With it on, Supabase mails a confirmation to the CURRENT address as well as the new one and only moves the account once both are confirmed; Settings verified the new address alone and then announced "Email updated." while the account still sat on the old address — a silent success of exactly the §12 class. **Fixed 2026-08-11:** two labelled code boxes (one per address), each failure naming the address whose code was wrong, and success claimed only after re-reading `auth.getUser()` and seeing the address actually changed, never off the absence of an error. The founder chose to keep the toggle ON rather than match the old behaviour — it's what stops someone with a hijacked session from changing the email and locking them out. **Note this reverses item 54's original "new address only" decision**, which was made before the toggle's both-addresses semantics were understood. **Still unverified end-to-end** — the `{{ .Token }}` template edit is unconfirmed, and testing for real means putting the founder's only account into a pending email change, which they have twice declined; the pending-state UI itself was verified by temporarily forcing `pendingEmail` in the dev server (two stacked labelled boxes, Confirm disabled until both are filled and on whitespace-only input, "Resend codes", clean at phone width), and the hack reverted.
- **Founder cleanup needed: two separate "Amy Volin" profiles exist** — found 2026-07-20 while verifying the relationships-table build (see PROJECT_HISTORY §15). Not this session's doing and not touched — merge via People search + merge-profile once confirmed which one should survive.
- ~~Founder cleanup needed: two separate "Barbara Bach" profiles exist~~ — **founder confirmed 2026-07-21 only one Barbara Bach profile exists now**; the duplicate noted 2026-07-20 (PROJECT_HISTORY §16) was either already merged or the original finding was wrong. Not the cause of the Bill/Lisa mis-wiring below.
- **Founder cleanup needed: Barbara Bach's relationships are wrong** — found 2026-07-21. On her tree, Bill shows as her father and Lisa as her sister; the real facts are Bill=husband, Lisa=daughter. Item 38's new "Remove a relationship" control (family tree page, centered on Barbara) is the tool to fix this: remove Bill-as-parent and Lisa-as-sibling, then re-add Bill as spouse and Lisa as child via the existing "+" pickers. Not done yet — needs the live app, which this session couldn't reach (see note below).
- **2026-07-21/22 family tree fixes (items 37/38) not verified against live data** — this session had no Supabase credentials (no `.env` in the remote container), so it couldn't load Jake's real tree. All verified instead with `npm run build` and temporary synthetic-data harnesses (deleted before commit) shaped like the reported bugs, rendered through the real code and screenshotted in-browser. Worth a live click-through against the real account to confirm, and to actually fix Barbara/Bill/Lisa per the item above. **Verification lesson (founder-caught 2026-07-22):** checking only the tree centered on the self/root person isn't enough — a fix can look right from one person's view and still be wrong (or just visually ambiguous) from someone else's, since being centered on a different person changes who's a "direct" relation vs. an "extended" one/how tiers stack. Click into a few other people's own tree views too, not just the one that was reported broken.
- **Possible second cause for a "wrong wire" report, not yet ruled out**: on Jake's tree, David/Laura's wire was reported connecting to Jake + his sibling instead of down to Noah/Aaron. The 2026-07-22 bar-extension fix (item 37) plausibly explains this on its own — but if it's still wrong after that deploys, check whether David or Laura is *also* recorded as one of Jake's own parents (same bad-data pattern as Barbara/Bill/Lisa above); fixable with item 38's "Remove a relationship" tool, no code change needed.
- **How bad relationship data can appear without touching the family tree page**: confirmed 2026-07-22 — `add-fact`, `converse`, `update-moment`, and `update-group` all call `_shared/relationships.ts`'s `applyFamilySignals`, which writes directly to the `relationships` table (plus reciprocal notes) with **no confirmation banner**, whenever the AI extracts a spouse/sibling/parent/child/partner signal naming someone whose full name matches *exactly* one person on file (deliberate founder-approved exception to "suggest, don't assert" — siblings named together link with no banner). The one concrete risk: if two different people share an identical full name, this "confident exact match" could resolve to the wrong one of the two — worth keeping in mind if another mis-wired relationship turns up with no clear manual cause.
- ~~Siblings now inherit shared parents (2026-07-20, see PROJECT_HISTORY §16)~~ — fixed the bug where adding a sibling via the family tree "+" picker never copied an existing sibling's parents onto the new person. **Deployed and confirmed live 2026-07-20**: frontend fix (`writeRelationship.ts`) via Vercel, edge-function mirror (`add-fact`/`converse`/`update-group`/`update-moment`) via `npx supabase functions deploy` with a founder-provided token — all 4 returned 401 (not platform-not-found) post-deploy, no Cloudflare retries needed this round.
- ~~Relationships table + `is_self` migration + 5 Edge Function redeploy (item 32, 2026-07-20)~~ — **applied and deployed live 2026-07-20** via the Management API + `npx supabase functions deploy` with a founder-provided token (`add-fact`/`converse`/`update-group`/`update-moment`/`person-facts`, 3 of the 5 needed a retry after a transient Cloudflare 502). Backfill landed 75 relationship rows from existing notes. Click-tested end-to-end (My Page onboarding/circle/`+`, family tree render + re-center + `+`) against the real `jakevolin@gmail.com` account with disposable test data, cleaned up after — see PROJECT_HISTORY §15 for the full verification story, including a self-inflicted name-collision near-miss that was fully cleaned up.
- ~~Self missing from groups created before the 2026-07-20 auto-add-self fix~~ — **backfilled 2026-07-20**: one-off script (authenticated as the real `jakevolin@gmail.com` account, RLS-respecting) added the self person to all 22 pre-existing groups that were missing them (only "Volin Family" already had self as a member). Cached group summaries were deliberately NOT invalidated by this backfill, to avoid a 22-call regeneration cost spike (CLAUDE.md rule 3) — a summary will just read as slightly stale until it's naturally refreshed. **Reverted 2026-07-26** (founder feedback: being auto-added to every group — including ones not really about them — polluted their own Groups search): the 2026-07-20 auto-add-on-create fix and this backfill's effect are both undone; see the new item below.
- ~~Founder needs to run a SQL migration: remove self from all existing groups (2026-07-26)~~ — **CONFIRMED RUN 2026-08-11:** the self person now has 0 rows in `person_groups`. Note the file's own warning still applies going forward — re-add yourself by hand to any group genuinely yours. Original note kept below.
- **~~Founder needs to run a SQL migration~~: remove self from all existing groups (2026-07-26)** — `supabase/migrations_manual/2026-07-26-remove-self-from-existing-groups.sql`, paste into the Supabase SQL Editor (preview SELECT first, then the DELETE). Until this runs, "Your groups" on Circle.tsx and the Groups list still show the founder as a member of nearly every group from the 2026-07-20 backfill above — only NEW groups are unaffected. Re-add yourself afterward to whichever groups are genuinely yours (e.g. your real family group) the same way you'd add anyone else.
- **Auto-add-founder-to-events (2026-07-26) only covers the manual "+ Add Event" shell** — calendar-imported events (`ImportReview.tsx`'s `applyAttendees`) still don't tag the founder as an attendee; deferred because the merge-into-existing-moment path needs a dedup guard (no unique constraint on `notes`) that's only really testable against a live calendar import, not a quick click-test. Separately, whether Home's AI chat (`converse`) already tags the founder when they narrate their own presence in first person ("I went to Kate's wedding") is unconfirmed — that's prompt behavior, not touched by this fix, worth checking empirically before assuming it's covered.
- Email confirmation must be re-enabled (with a proper redirect URL) before real users.
- ~~Founder cleanup needed: disposable test account `onboarding.verify.test@example.com`~~ — **deleted 2026-08-03**, along with 10 other leftover test/QA signups (`claude-test-*`, `boomer.qa.*`, `test@test.com`/`test@testt.com`, etc.), via the Management API directly (no dashboard access needed after all — `people`/`moments`/`groups` deleted first per their FK gotcha, then `auth.users`). Only 3 accounts remain: `jakevolin@gmail.com` (real), `+onboardtest`, `+birthdaytest` (kept per founder's call — not actually a test-cleanup target).
- ~~Founder needs to run a SQL migration: `feedback_notes` table (click-to-comment feedback widget, 2026-07-22)~~ — **confirmed applied 2026-08-10** (PostgREST returns 200). Consistent with the widget having captured every note folded into §8's items 46–61.
- ~~Founder needs to run a SQL migration + redeploy 3 Edge Functions: time zone bug fix (2026-07-24, item — "today" mis-dating evening events)~~ — **migration applied and all 3 functions (`converse`/`update-moment`/`scan-calendar-sources`) deployed live 2026-07-24**, via the Management API + `npx supabase functions deploy` with a founder-provided token. Confirmed live: `user_settings.time_zone` returns 200 via PostgREST (not a 400 undefined-column error), Settings time-zone picker's save round-trip verified end-to-end in a real browser session against `jakevolin@gmail.com`. A second, separate display-only bug found in the same investigation and fixed same day: [EventDetail.tsx:604](../src/pages/EventDetail.tsx) parsed `event_date` with bare `new Date(...)` (UTC-midnight parsing, same bug CLASS as the regression guard below) instead of `formatFullDate()` — this one didn't affect what was SAVED, only what EventDetail showed, and in negative-UTC zones it happened to shift the display back a day, partially masking the real bug rather than causing it. Both fixes verified together live: "Tulas & Jackass The End" (previously mis-dated to 2026-07-25 by the pre-fix `converse` deploy) corrected to 2026-07-24 via its own update-chat, confirmed matching on both EventDetail and the Calendar month grid. **Side finding, not caused by this fix:** that correction cleared the event's cached `summary` (EventDetail's normal behavior on any change) and it couldn't auto-regenerate because the event's `raw_description` was already empty — `update-moment` never writes `raw_description` (only `converse` does, at moment-creation time), so this looks like a pre-existing data gap on this one event, not something introduced here. The individual notes are all intact; only the AI-generated prose blurb needs retyping via "Edit description" if wanted back.
~~67. Tag people to groups/subgroups at entry time~~ — **done 2026-07-30**: `ContactImportReview.tsx`'s "Review contacts" cards now have an "Add to groups" picker (`SearchAddPicker`, browse-all + inline "+ Create group" using the same find-or-create logic as `PersonDetail.tsx`'s `confirmSuggestedGroup`) on every card; selected groups are upserted into `person_groups` on Accept. `+ Add Person` on People.tsx still routes straight to `PersonDetail.tsx` (already has its own group tagger there) — not touched.
~~68. Sort "Review Contacts" list: high-confidence matches first~~ — **done 2026-07-30**, same pass as item 67: query now orders `match_confidence` ascending (`'high'` before `'none'`) then `full_name`.
~~71. "View profile" link after accepting a contact~~ — **done 2026-07-31**: `ContactImportReview.tsx`'s post-Accept confirmation ("Saved contact info for X") now shows a "View profile →" button alongside Undo, pushing the same `person` crumb (`App.tsx`) the rest of the app uses — jumps straight into the just-accepted/merged person's profile without leaving the review queue via People search. Verified live against the real account (`jakevolin@gmail.com`): accepted a real matched duplicate ("Austin Neurighter" → existing "Austin Gula"), clicked through to the profile with correct breadcrumbs, "← Back to Review contacts" returned to the queue. Note: since it was a genuine duplicate whose phone/groups already matched Austin Gula's existing data, the accept itself was a real (harmless, no-op) merge — not a disposable test row, left as-is rather than un-mergeable after leaving the component.
69. **Photo gallery for Person/Group pages** — deferred from item 27's Google Photos build (2026-07-30). `PhotoGallery.tsx` only shows real photos when passed a `momentId` (EventDetail); Person/Group pages still show the original placeholder. Would mean aggregating photos across everything a person/group is tagged to (their moments) rather than one moment's own `photos` rows — not scoped yet.
70. **`ContactImportReview.tsx` paginated + name-editable (2026-07-30)** — founder was facing all 1300+ `selected` candidates rendered on one page at once (unusable) with no way to fix a parsed-vCard name before it became a real profile. Now paginated at 20/card (mirrors `ContactSelection.tsx`'s pattern, smaller page since these cards are heavier); unmatched (new-person) candidates get editable First/Middle/Last inputs prefilled from the parsed name. Accept keeps its existing in-place "Saved contact info for X" confirmation (only refreshes the footer count); Reject refetches the page so the next candidate slides in. Verified live against the founder's real queue (1304 real selected candidates) with a temporary synthetic batch, fully cleaned up after — see PROJECT_HISTORY.md for that story. **Extended same day:** matched cards now show the linked person's current groups ("Already in: X, Y") fetched per-card on `linkedPersonId` change, so a match comes with visible proof it's really them (and those groups are excluded from the "Add to groups" picker to avoid offering a duplicate tag); a 3-way "All / Already in Grove / New people" filter (keyed on `matched_person_id` being set, not `match_confidence`) lets the founder batch through quick confirms separately from the new-person decisions that need real attention. **Match legibility pass (2026-08-10, founder ask):** the suggested person used to appear only inside a small grey "X is already in:" line under a generic "Confirm who this belongs to:", so you couldn't tell the app was proposing a specific person or which name was the incoming one. Now `components/MatchCallout.tsx` (shared with `BirthdayImportReview.tsx`) — "Is X the same person as Y?" at `bodyLg` in a `inkWash`/`border.primary` box, groups as evidence beneath, "Yes — same person" / "No — add as new person" as real buttons (replacing the `cancel` and "Not the same person" underlined links), search demoted to "Or link it to someone else". Confirmed state reads "✓ Goes to Y" instead of a muted "Goes to:". `BirthdayImportReview` gains the "No — add as new person" escape it never had.
- ~~Google Photos import (item 27) is BUILT but NOT LIVE~~ — **backend fully deployed 2026-07-30**: founder completed Google Cloud Console setup (OAuth consent screen + Client ID/Secret), ran the migration, and created the private `photos` Storage bucket directly; `GOOGLE_PHOTOS_CLIENT_ID`/`GOOGLE_PHOTOS_CLIENT_SECRET` set as Supabase Edge Function secrets and all 3 Edge Functions (`google-photos-oauth-callback`/`google-photos-picker-session-create`/`google-photos-picker-session-import`) deployed via founder-provided access token — confirmed live via the token-free check (each returns `UNAUTHORIZED_NO_AUTH_HEADER`, not Supabase's `NOT_FOUND`), and `photo_connections`/`photo_clusters`/`photos` + all RLS policies (including `storage.objects`) confirmed present via a direct Management-API read. Vercel env var + Google Cloud client wiring done by the founder same day. **Bug found and fixed 2026-07-30 during live testing:** `App.tsx`'s mount-time history-state-sync effect called `window.history.replaceState(state, '', window.location.pathname)` — passing only the pathname (no search string) silently stripped any `?query` on every page load, including Google's `?code=...&state=...` on the OAuth callback redirect, so `GooglePhotosOAuthCallback.tsx` always saw an empty URL and failed with a false "That connection link looks invalid or expired" — 100% reproducible, not a flaky/stale-state issue as first suspected. Fixed by omitting the `url` argument entirely (`replaceState(state, '')`), which correctly leaves the current URL untouched — matching what the effect's own comment already said it was supposed to do. Verified locally: a callback URL with real query params now correctly reaches the token-exchange call instead of failing at the pre-check. **Known limitation, not a bug:** while the OAuth consent screen stays in Google's Testing mode, only Google accounts explicitly added as test users can connect — not real end users — until Google's app verification review completes.
- ~~Deploy the 4 AI functions for subgroup-aware group names~~ — **DONE 2026-08-01, all four deployed and verified live.** `converse`/`add-fact`/`update-moment`/`scan-calendar-sources` used to build their group rosters from BARE names and resolve the model's answer by lowercase name match, so two subgroups sharing a name collapsed to whichever row won the index — a wrong-subgroup TAGGING bug, not just display. Now all four use `_shared/groupNames.ts` (server twin of `lib/groupDisplayName.ts`): qualified "Parent / Child" names into the prompt, resolved back to ids by that form, and an ambiguous bare name resolves to NOTHING rather than a guess (drop-the-tag is recoverable; wrong-group is silent). `splitParent` turns a model-written "&lt;existing group&gt; / New Thing" into a real subgroup instead of a group literally named that; the " / " separator has spaces so "98 FTS/Wings of Blue" isn't mistaken for a hierarchy. Verified against the real account: "Who is in the Pilots subgroup?" → "There are two Pilots subgroups on record — one under 22 AS and one under 98 FTS/Wings of Blue. Which one did you mean?", then "The one under 22 AS" → the correct 25-member roster. Same deploy also shipped the previously-pending `add-fact` first-person fix (item 61) and `scan-calendar-sources` family-surname matching.
- Not production-hardened generally: no 2FA/access-control story, minimal tests.
- ~~**RLS unverified on the pre-migration tables**~~ — **VERIFIED LIVE 2026-08-01, all clean.** Founder ran `migrations_manual/2026-08-01-rls-audit.sql`: all 23 tables (incl. `storage.objects`) have RLS on, every read policy scoped to `auth.uid()` or an ownership check through the parent table, nothing evaluating to a bare `true`. **Why the undocumented dashboard-made tables were covered anyway: `rls_auto_enable`**, an event trigger from the original Bolt/StackBlitz scaffold that auto-enables RLS on every `CREATE TABLE` in `public` — correctly written (`SECURITY DEFINER` with a pinned `search_path`). **Leave it in place.** §6's "RLS on everything" is now evidence, not a claim. **Writes verified clean in a second pass the same day** — every WITH CHECK either names `auth.uid()` or inherits the USING expression (Postgres's automatic behavior for `FOR ALL`/`FOR UPDATE`; a blank write condition on those is normal, NOT a hole — the audit script now labels this explicitly so it isn't misread). Two first-pass concerns both closed: `group_associations`' read rule only checks `group_id_a`, but its WITH CHECK requires **both** sides be yours, so the cross-account row that asymmetry appeared to permit can't be created; and the four blank-looking INSERT policies (`home_suggestions`/`notes_group_insert`/`photo_connections`/`relationships_insert_own`) are all correctly scoped. Nothing outstanding. Structural note: `notes` has six overlapping policies (person/moment/group-hung notes) — correct today, most intricate rule set in the DB, re-audit if a fourth note type is ever added.
- ~~**Founder security actions (2026-08-01)**~~ — **ALL DONE 2026-08-01, founder-confirmed:** public signup closed (Supabase Auth → Sign In / Providers → Email), RLS audit run twice and clean, 2FA enabled on Google/GitHub/Supabase/Vercel. **Anthropic, OpenAI and Google Cloud sign in via Google** — no separate password, so they inherit Gmail's 2FA; nothing further needed there, but it makes the Google account the single key to 5 of the 8 services, so its *recovery* path (SIM-swappable phone number? recovery codes stored inside Google?) matters more than adding another factor anywhere else. Only unconfirmed item left from `SECURITY.md`: whether Supabase backups have ever been test-restored (the 4th of the four things that actually prevent a breach). Original instructions kept below for reference / re-running:
- **~~Founder action needed~~ (2026-08-01, security audit — see `SECURITY.md`), in this order:** (1) **close public signup** — Supabase Dashboard → Authentication → Sign In / Providers → Email → disable new sign-ups; highest-value single action while the founder is the sole real user (removes the AI-billing abuse vector and the other tenants at once). (2) **Run `migrations_manual/2026-08-01-rls-audit.sql`** in the SQL Editor (read-only, safe to re-run) — the pre-migration tables (`people`/`moments`/`notes`/`groups`/`person_groups`/`reminders`/`home_suggestions`) were made by hand in the dashboard, so §6's "RLS on everything" is an unverified claim for exactly the tables holding all the real content. Any table with `rls_enabled = false`, or a policy whose expression is literally `true`, is a live cross-account leak and outranks everything else in §8. (3) **2FA on Google/GitHub/Supabase first, then Vercel/Anthropic/OpenAI/Google Cloud/Geoapify** — `SECURITY.md` §2 has the blast-radius table. Note GitHub sits in the top tier *because* pushes to `main` auto-deploy to production with no review step. This session could not verify any of it live: no credentials in the container and the environment's proxy blocks outbound access to both the app and Supabase.
- ~~Founder action needed: deploy `add-fact` (item 61 fix)~~ — **deployed 2026-08-01** alongside the subgroup-name fix below, so the first-person ("my X") misattribution fix is finally live. Item 61's own live re-test still hasn't been run against the deployed version — worth one pass on a real profile next session.
- ~~Founder action needed: run `migrations_manual/2026-07-26-gender.sql`~~ (item 44) — **APPLIED. Re-confirmed live 2026-08-11** (anonymous PostgREST select of `people.gender` returns 200, not `42703`), agreeing with §8 item 44 and the 2026-08-10 migration sweep above. This entry previously read "Confirmed still not run as of 2026-08-05" and contradicted both of them; it was simply never updated, and left as-is it would send a future session chasing a migration that has already run. **If in-laws still read "child-in-law" and no tile shows ♂/♀, the cause is now the DATA, not the column** — nobody's gender is filled in yet. That is what item 44's `GenderFill.tsx` pass (2026-08-11) exists to fix.
- ~~Founder action needed: run `migrations_manual/2026-07-30-moment-sub-events.sql`~~ — **run and confirmed live 2026-07-30** (founder-provided token): `moments.parent_moment_id` column/constraint/index all present. Verified end-to-end in browser preview against the real account — created a sub-event on "Conor & Shelly's wedding" (inherited parent's start date), confirmed the parent/child tiles and "↑ Part of X" link, confirmed the Events.tsx collapse/expand toggle and indented child card, deleted the disposable test sub-event after.
- ~~Founder action needed: run `migrations_manual/2026-07-26-subgroup-member-parent-sync.sql`~~ — **never shipped.** This trigger was added by mistake (not part of the reviewed subgroups plan) and removed same day, before it was ever run — it contradicted the deliberate design that subgroup membership stays independent of the parent's. No founder action needed; adding someone to a subgroup intentionally does NOT also add them to the parent group.
- ~~Founder action needed: run `migrations_manual/2026-07-26-group-subgroups.sql`~~ (item 19, subgroups) — **migration run and fully verified live 2026-07-26.** Full click-through against the real account with disposable test groups: create a subgroup, rename, parent link navigation, parent-roster suggestion chip (add via chip), event tagging via EventDetail's existing "Associate a Group" (zero new code, confirmed), merging a group with 2 subgroups into another root group (subgroups correctly reparent to the survivor), deleting a parent with subgroups (they correctly survive as independent root groups, confirmation copy correctly pluralized). All test groups/events cleaned up after.
- ~~Subgroups showing up as "Associated Groups" of their own parent (and vice versa)~~ — **fixed 2026-07-26.** The Associated Groups suggestion/confirm/manual-picker logic in [GroupDetail.tsx](../src/pages/GroupDetail.tsx) only excluded the current group itself, not its parent or its own subgroups — so a subgroup's roster overlapping the parent's roster made them suggest each other as "associated," duplicating the hierarchy already shown via the Subgroups section. Now excludes parent/subgroup ids from all three (suggestions, confirmed display, and the manual picker). Verified live: 98 FTS/Wings of Blue's "2019" subgroup no longer suggests or lists its parent as an associated group.
- **Before assuming a local diff is unfinished work: check what's actually deployed** — Edge Functions have been deployed from the dashboard without commits before (see §2's token-free checks). Also check `git status` for another concurrent session's work before editing.



---

## 2026-08-28 — Archive: the old §4 Edge Functions section (per-function build narratives)

_Archived verbatim from `PROJECT_CONTEXT.md` §4 when that section was compressed (founder budget
directive). Every function and every live rule survives in `PROJECT_CONTEXT.md`; what moved here is
the dated prompt-engineering history — each rule's founder report, the wrong-then-right iterations,
the measured token counts and deploy confirmations. Search by FUNCTION name or by the symptom._

## 4. Edge Functions (`supabase/functions/`)

| Function | Purpose |
|---|---|
| `converse` | **The main unified brain** (Home). Per turn decides: answer question / capture new moment(s — `moments` array, multiple per turn supported) / update moment / rename placeholder / name+nickname corrections / create+tag groups / create+tag tags / relationship signals / logs recall attempts to `search_log`. AI-suggested tags (item 28, 2026-07-22): each moment entry's `moment_tags: string[]` is resolved via `findOrCreateTagId()` — the same find-by-name-or-create pattern as `moment_groups`/`findOrCreateGroupId`, capped at 1-3 tags per moment with an explicit "prefer reusing an existing tag over coining a near-duplicate" instruction (both live in the fully-static `stableInstructions` tier, so this cost nothing extra to cache; the tags roster itself lives in the 1-hour roster tier alongside the groups roster). `update-moment`'s `add_tags` deliberately NOT added yet (see §8 item 28 — holding the AI surface to one entry point until real usage confirms the vocabulary stays clean). Knows the self person (`is_self`) and their known relationships (`_shared/selfContext.ts`) so "my mom"/"my parents" resolve without a named subject (2026-07-20). Chat-tone preference (2026-07-23, items 22/49): `_shared/userSettings.ts`'s `buildChatToneInstruction` reads `user_settings.chat_tone` and appends one of 4 fixed instruction sentences to the roster tier, right after `selfInstruction` — never the stable tier. "Today's date" in the final uncached tier is now computed in the user's own `user_settings.time_zone` via `_shared/tz.ts` (2026-07-24, bug fix — see §12), not the Edge Function's server UTC clock. Quirk: model occasionally replies in prose instead of the JSON envelope — falls back to showing that prose as the reply. **2026-07-30 (founder feedback: event capture was slow/inaccurate, notes dropped detail):** the 6 initial roster reads now fire via `Promise.all` instead of sequentially; a `notes` entry can now have `"person": null` for a general event-level detail not tied to one attendee (written as `moment_id` + `person_id: null`, same shape `GroupDetail.tsx`'s manual notes already use); `event_date`/`event_end_date` are sanitized (`_shared/dateValidation.ts`) before ever reaching a write; expanded worked examples for ordinal/weekday/compound date phrasing ("the 4th", "next Tuesday", "two weeks from Saturday"); every new moment now requires a concise `occasion`; `summarize-moment` is kicked off in the background (`EdgeRuntime.waitUntil`) right after a new moment is created instead of waiting for the user to open the event page. Deployed and verified live (see PROJECT_HISTORY for the full test transcript). **2026-08-01 (item 73, pets):** loads `pets` + `person_pets` as two more top-level queries in the same `Promise.all` (SEPARATE, never an embed on the people select — an embed of a not-yet-migrated table fails the whole query and takes the roster down with it), renders a pet roster into the 1-hour roster tier (pets change at people-cadence, so this costs no more than a person write and leaves the hot moment-capture path alone), and handles a turn-level `pets` write field. Resolution mirrors the people guards exactly: owner-scoped first (`ownerId|petname`) so two dogs named Bella stay distinct, then a unique bare name, with an `ambiguousPetKeys` set so a shared bare name resolves to nothing rather than the last-indexed one. Updates are ADDITIVE ONLY — fill blank fields, union `attributes` by lowercase label, never overwrite what the profile form set, since chat is the lossier channel. A pet with no resolvable owner is skipped with a loud `console.error` rather than written as an invisible orphan. The prompt's headline rule is "A PET IS NOT A PERSON" (never `new_people`/`notes`/`relevant_people`/`renames`/`family_signals`) — before this, "Sarah got a puppy named Biscuit" created a *person* named Biscuit in the People list and Dunbar count. **2026-08-02 (founder feedback — a date night at Pup Dog created profiles for the couple they met there):** a brand-new name mentioned in a story no longer becomes a profile. `new_people` is now narrowed to names the founder EXPLICITLY asked to add; everyone else brand-new goes in `mentioned_names: [{name, note}]` (per-moment, plus a top-level array for a mention with no event), which writes the note as a general note on the event (`person_id: null`) and returns `mentionedPeopleSuggestions` for the frontend banner — so the detail is saved unconditionally and only the profile is optional. Guards: a name already in the roster gets the note attached to them instead (no banner); duplicates and anyone already covered by `familyResult.newPersonSuggestions` are skipped so one person never gets two banners. Same turn also fixed the moments context the model reads back: a `person_id: null` note no longer renders as `someone: <text>` nor adds a phantom attendee called "someone" to that event's `People:` line. A `console.log("usage", …)` line is kept in deliberately for the CLAUDE.md rule-3 cache check. Verified live: read-only turn = 59,886 `cache_read_input_tokens` / 56 created; a pet-write turn still reads the stable tier (7,093) and only rewrites roster+moments, which is exactly the tiering claim. **2026-08-03 (item 77, founder-reported):** `stableInstructions` now explicitly forbids inventing any detail the user didn't actually state (no such rule existed — a general `person: null` note could read as plausible-but-fabricated, e.g. assuming a pregnancy discovery happened "at an ultrasound" when the user never said that) and clarifies a `notes` entry only attaches to a named attendee when THEY did/said/experienced it, not merely because the sentence is about them (was misattributing "we found out the baby's a girl" to the baby's own profile). Also: the `summarize-moment` background kickoff now fires for ANY moment that gains a note this turn, not just a brand-new one, deduped via a `momentIdsNeedingResummary` set — previously an already-recorded moment gaining detail via Home chat had no invalidation path for its cached summary at all (unlike EventDetail's own chat), and could go stale indefinitely. Deployed and live-verified. **2026-08-10 (subgroup roll-up, plus two pre-existing bugs it uncovered):** the groups roster now applies the same "anyone in a subgroup is a member of the group above it, at any depth" rule the app renders (`_shared/groupRollup.ts`, the Deno twin of `src/lib/groupRollup.ts`, pinned together by `src/lib/groupRollupParity.test.ts`) — before this the model answered "who's in Air Force?" from that group's own rows only and contradicted the screen. Member lists are sorted by person id rather than tree-visit order, so reparenting one subgroup can't reshuffle an unrelated parent's list and bust the 1h roster tier. Roster grew ~2% (18,555 → 18,841 chars). **Bug 1, silent:** the `person_groups` read was unpaged and PostgREST caps a response at 1000 rows without saying so — at 1183 rows the model had been missing ~15% of every group membership in the account. Now paged via `fetchAllPersonGroups`, same `.order()` on every page so the cached prefix stays byte-identical. **Bug 2:** `max_tokens` 4096 → 8192. This model thinks before answering and thinking spends the SAME budget, so a reasoning-heavy question ("how many people are in the Air Force group?", ~300 names) burned all 4096 on thinking and returned NO text block at all — which failed to parse and showed "Sorry, I couldn't process that", after being billed in full. Observed live: `output_tokens` 4096, `thinking_tokens` 4095, zero text. A `stop_reason === "max_tokens"` + no-text-block check now gives that case its own honest message ("ask about a smaller group") rather than the generic apology, since "try again" would just burn another full budget on the identical question. Deployed and live-verified: the previously-failing count question now answers, and a repeat turn reads 72,504 `cache_read_input_tokens` against 54 created. **2026-08-16 (founder: the app "still is asking 'is this his mother?' when her name is clearly a woman's name"):** the model had NO gender data at all — every family fact reached it neutral ("parents: A, B", "A + B — children: …"), so it could not say "his mother" about a Margaret and asked instead, while the family TREE had been saying "mother"/"husband" since 2026-08-05. A `people(id, gender)` read (its own fail-open query, never a column on the people select) is merged with `_shared/nameGender.ts`'s first-name guess via `effectiveGender`, and each name in the PEOPLE roster — the one list naming everyone exactly once, so the cheapest place to carry it — gets a `(m)`/`(f)` suffix. The legend and "use the gendered word, never ask what this already answers" rule live in the fully-static stable tier, so they cost nothing per turn. `idByName` also indexes the marked spelling, so a model that echoes "Linda Whitfield (f)" back finds Linda instead of creating a second one. Live testing caught the model inventing a gender it hadn't been given — Alex Gregorian (nothing recorded, and "Alex" is on the AMBIGUOUS list by design) came back as Sam's "brother-in-law" — so the stable tier now also names the positions with no neutral English word (brother-in-law/sister-in-law, aunt/uncle, niece/nephew, son-in-law/daughter-in-law) and says to describe the link instead of picking one when they're unmarked. Verified live on the real account: "Sam's mother is Andi Romagnoli" (recorded female, and `guessGenderFromName` CAN'T read "Andi" — so that word could only have come from the new column read), "Sam's sister is Natalie Gregorian", "their son Wesley … is Sam's nephew", while Alex is now described as "married to Natalie" rather than assigned a gender. Cache confirmed healthy on a repeat turn: 85,657 `cache_read_input_tokens` against 90 created and 2 at full price. |
| `add-fact` | Classifies fact-bar text: name/nickname update, birthday/anniversary (upserts `reminders`), or plain note. Group inference (`group_signal`, high=auto/medium=ask). Relationship handling via `_shared/relationships.ts`. A fact typed on the self profile's own page already resolves "my X" correctly with no special-casing (the subject is always whichever profile is being viewed). |
| `update-moment` | Called by `NoteWithDetection.tsx` (2026-08-03, replaced the old `UpdateMomentChat`) after each note already saved verbatim — detects attendees/relationships only, never re-inserts a general note; `needsClarification` (was `done`) signals a one-off disambiguating question instead of an open thread. Has full people+events rosters, `moment_field_updates` (when/where/title), `add_groups`, relationship signals, self-person "my X" resolution (2026-07-20). "Today's date" is time-zone-aware, same fix/mechanism as `converse` above (2026-07-24). **2026-07-30:** same roster-read parallelization, date sanitization, and expanded date-phrase examples as `converse` above — deployed live. **2026-08-02:** same `mentioned_names` / narrowed-`new_people` / `mentionedPeopleSuggestions` behavior as `converse` above (flat array — the moment is already fixed here). **2026-08-03 change deployed and verified live** (direct-invoke test: response now returns `needsClarification` not `done`, and a general-detail test message produced no note row, confirming the duplicate-note fix). **Same-day follow-up (item 77):** `additional_notes` guidance now also forbids inventing unstated details and states the same misattribution rule as `converse` (a note only belongs to a named attendee when they themselves did/said/experienced it). Deployed and live-verified. **2026-08-08 (founder report — a manually-created event stayed "Untitled moment" and tagged nobody):** the prompt had no rule that could ever NAME an unnamed event (`occasion` was "only set when the user is giving new or corrected info for that specific field"), which is why events born in the Home chat came out titled and "+ Add Event" ones never did — `converse` has that instruction, this didn't. Now: the volatile moment tier reports an untitled moment as `(not named yet)` (was `unknown`, which read as "not my business") and `stableInstructions` carries a generic auto-naming rule keyed off that exact phrase, explicitly scoped so a name is a LABEL built only from words actually given — it does not license inventing a place/date/occasion type, which would collide with the item-77 anti-invention rule. Rule in the 1h tier, signal in the volatile tier, so the cached prefix stays byte-identical. `location`/`when_text`/`event_date` deliberately NOT given backfill prompting (they're facts, not labels, and a wrong `event_date` moves the event off the calendar). Same turn: `max_tokens` 1500 → 3000 and a `stop_reason === "max_tokens"` guard placed BEFORE the regex salvage — a truncated response used to parse-fail, salvage only `reply`, and silently discard every `additional_notes`/`moment_field_updates` while returning 200 with a cheerful message; the discarded `{error}` on the `moments` update and `moment_groups` upsert are now checked (an RLS rejection previously reported `changed: true` with the title unchanged), `changed` is derived from writes that actually succeeded, and a new `applied` payload itemises them for the frontend checklist. Also fixed: an untitled moment leaked the literal string `"null (last week)"` into the 1h-cached other-events roster. Deployed. |
| `update-group` | Called by `NoteWithDetection.tsx` (2026-08-03, replaced the old `UpdateGroupChat`) the same way as `update-moment` above — `needsClarification` replaces `done`. Rename, members, tag/untag events, member facts (tagged `source_group_id`), relationship signals, self-person "my X" resolution (2026-07-20). Saves per turn. **2026-08-03 change deployed and verified live.** **Same-day follow-up (item 77):** same anti-invention/misattribution rule added to `notes` guidance as `converse`/`update-moment`. Deployed and live-verified. **2026-08-08:** returns the same `applied` payload as `update-moment` (group-shaped: `renamed`/`peopleCreated`/`peopleAdded`/`peopleRemoved`/`eventsTagged`/`eventsUntagged`/`notesAdded`) so the shared `NoteWithDetection` progress checklist works identically on a group. Deployed. |
| `person-facts` | Extracts Key Facts from a person's notes — explicitly stated only, never inferred. Cached in `people.key_facts`; `{refresh: true}` regenerates. Failure paths return cached facts, never wipe. Linked categories (spouse/siblings/parents/kids) resolve to person chips on exact-full-name match OR a `relationships` table row (2026-07-20, additive — never overrides an AI-extracted fact, just fills in a linked person the table already knows about). Has its OWN category vocabulary (not the shared 5-kind enum — known mismatch, read-only so harmless). |
| `summarize-group` | One-sentence group description → cached `groups.summary`. Members = explicit roster only, never event attendees. |
| `summarize-moment` | First-person event summary → cached `moments.summary`. Cleared/regenerated when notes change (Home-chat path fixed 2026-08-03, see `converse` above — was previously only reliable via EventDetail's own chat), or on-demand via EventDetail's manual refresh button. Notes are ordered by `created_at` and numbered in the prompt; system prompt explicitly tells the model note order is recording order, not narrative order, and to infer real chronological order from context clues before writing (2026-07-25, fixes summaries reading in whatever jumbled order notes were recalled in). **2026-07-30:** dropped the fixed "2-4 sentences" cap (founder feedback: summaries were dropping real detail to hit it) — now explicitly prioritizes completeness over brevity, no fixed length; `max_tokens` raised 250→600 to match. Deployed and verified live. **2026-08-03 (item 77):** now looks up the `is_self` person (one extra parallel query) and explicitly anchors the first-person "I" voice to them in both the context and system prompt — previously had zero self-context, so "I" could latch onto whichever named person's note was most detailed instead of reliably being the account owner (founder-reported: a summary reading from a spouse's perspective). Same anti-invention rule as `converse` added. Deployed and live-verified. **2026-08-10:** rolls sub-events up into a parent event's description — reads its children's cached `summary` (falling back to `raw_description`, never their notes) via its own fail-open query, and switches output format when any exist: overview paragraph, blank line, one `Aug 6 · Title — sentence` line per sub-event in date order. Events without sub-events keep the flowing narrative. Also nulls the parent's `summary` whenever a sub-event is summarized (covers every caller in one place; parent rebuilds lazily on next view), `max_tokens` 600→2000 (a 6-sub-event parent hit `stop_reason: max_tokens` at both 600 and 900 and silently lost its last days), and the system prompt now carries a `cache_control` breakpoint — 1,268 tokens, measured cache-hit on the second call. Response also returns `stop_reason`/`usage` for diagnostics. Deployed and live-verified. **2026-08-17 (founder: "I don't need it to tell me a story, I want the FACTS"):** an ordinary event is now summarized as a flat `- ` bullet list, not prose — one fact per bullet, no lead-in, and explicitly forbidden from restating the title/date/location (the page prints those directly above) or listing who was there (the page has its own "Who was there" section). A person is named only when a fact is genuinely about them. Attendee placeholder notes (`content === "Was there."`) are now FILTERED OUT of `notesText` — feeding them in was the actual source of the roll-call summaries (one wedding: 26 notes, 23 of them placeholders, four fifths of the summary reading names back), and dropping them also cuts ~11% of input tokens on every call. A thin event gets one closing non-bullet line naming what wasn't recorded. Sub-event (parent) format is UNCHANGED. Prompt is now ~2,390 tokens, still one `cache_control` breakpoint. Three live iterations were needed: the first draft moved another person's action onto the account owner ("I drove", from Caroline's note), the second duplicated a shared evening once per attendee and narrated with "she said that…", and the fix for the first over-corrected into writing the owner in third person ("Jake believes…"). What finally landed it was concrete wrong/right example pairs in the prompt, not more prose rules. Deployed and live-verified; every existing summary regenerated. |
| `enrich-event` | Game + weather boxes on an event page (item 21, 2026-08-17). **Makes no Anthropic call at all** — team detection is a dictionary lookup in `_shared/sportsDetect.ts` against the 1,652-team `sportsTeams.generated.ts`, then ESPN's scoreboard for the event date says which of those teams actually played, and Open-Meteo supplies the day's weather. Detection is deliberately loose and the DATE is the disambiguator: "Broncos" matches Denver plus nine colleges, but only one of them played that day. Exact date first (one fetch per league), widening ±1 day only on a miss — which also rescues the AI-guessed dates some imported events carry. One hit is stored; more than one becomes `game_candidates` for the picker, never a guess. Weather geocodes ESPN's venue CITY guarded by its STATE, never the venue name (see §12). Results cache permanently (a past score and a past day's weather don't change); only the refresh button, a date/location/title edit, or the `too_soon`/`Scheduled` revisit re-fetch. Game and weather are wrapped independently so one provider failing can't cost the other box, and a thrown failure writes nothing so the next view retries. Deployed and live-verified. |

**2026-08-05 — extended-family vocabulary in `converse` only.** `_shared/selfContext.ts` gained `buildKinInstruction` alongside the untouched `buildSelfInstruction`: grandparents, aunts/uncles, first cousins, nieces/nephews, grandchildren, plus parents-/siblings-/children-in-law. Before this the chat could resolve "my mom" but not "my cousin Steve". Wired into `converse` ONLY — `update-moment`/`update-group` are structured-extraction paths that don't need the vocabulary, which halves the blast radius. Rides the existing 1-hour roster tier, so per-turn cost is a cache read; bounded at two generations out (~10-40 names, ~150-250 tokens) rather than a line per roster person, and every list is sorted with buckets emitted in fixed order so an unchanged roster serializes byte-identically and can't bust the cache. Its one unfiltered `relationships` select REPLACES `buildSelfInstruction`'s 4-6 bounded round-trips. `_shared/kinship.ts` is the math-only mirror of `src/lib/relationshipCalculator.ts` (no gendered nouns, no paths, no step handling — the model needs the category, not the wording) and is the FIRST mirror in this folder with tests: `kinship.test.ts` runs the same fixtures through both copies and asserts they agree, so drift fails `npm test` instead of surfacing as the AI calling a nephew a cousin. Do the same for any future mirror. Deployed; live-verified that "Who are my first cousins?" and "who are my aunts and uncles?" both answer from the roster without asking back.
**2026-08-11 — the whole family tree in `converse` (founder report: "tell me about Manuel Sucre's family" knew only his wife and daughter).** Before this the `relationships` table reached the prompt ONLY for the `is_self` person (via `selfContext.ts`); everyone else was a bare name in the people roster, so any family answer came from whatever prose happened to be in moment notes. `_shared/familyRoster.ts` (mirrored at `src/lib/familyRoster.ts`, pinned by `familyRoster.test.ts`) now serializes the table into the 1-hour roster tier, one line per FAMILY UNIT — `Anamaria Sucre + Manuel Sucre Sr. — children: Ale, Fede, Gisella, Manuel` — plus `A + B — couple` for childless unions and `siblings: A, B` where shared parents aren't on file. Family-unit shape was chosen over one-line-per-person after the founder pushed back on prompt size: per-person writes every relationship twice (once from each end) and measured 18,936 chars; family units say it once at 4,862 chars, 86 lines, on 713 people / 378 rows. `familyRoster.test.ts` carries a round-trip test that re-parses the rendered text back into an edge set and asserts nothing is lost — verified 0 lost links against live data too. `(deceased)` marks a name (from `people.deceased_date`, now on the people select), `(divorced)` marks a couple (`relationships.ended_reason`). An on-demand `lookup_family` tool was considered and rejected on cost: `converse` is a zero-tool full-dump design, so a tool call means re-sending the whole ~30k-token prompt (~0.6¢) versus ~0.03¢/message to carry the compact block in a cached tier. Deployed and live-verified: parents + siblings + wife + daughter all correct, and it chains ACROSS lines unprompted (nephews via siblings' own family lines; all four of Emi's grandparents from three separate lines). Cache confirmed healthy — 77,316 `cache_read_input_tokens` on the follow-up turn. Same change fixed an unpaged `relationships` select in `selfContext.ts` (378 rows today, so not yet truncating) via `fetchAllRelationshipRows`, and now reads the table ONCE per turn shared between the kin instruction and the roster.

| `suggest-prompts` | 3 suggestion cards for Home → cached in `home_suggestions` table; regenerates only when data is newer than cache or on manual refresh. |
| `transcribe` | Streaming speech-to-text (`gpt-transcribe`), SSE out. Auth-gated + roster keywords since 2026-08-18. Returns `audio_unreadable` (422) when OpenAI rejects the file itself, and stops the keyword ladder there rather than re-uploading the same bad file (2026-08-23; `_shared/transcriptGuard.ts` → `isUnreadableAudio`). |
| `validate-calendar-source` | Server-side reachability/format check on a pasted iCal URL (dodges browser CORS) before `calendar_sources` saves it. |
| `scan-calendar-sources` | Fetches connected calendars, parses ICS (`_shared/ics.ts`), AI-extracts/classifies via Claude (`cache_control`-tiered), matches attendees to `people`, writes `moment_import_candidates`. **Reports its own failures (2026-08-19):** `callExtraction` returns `{ items, failed }` and the response carries `extractionFailures`, so a run whose AI calls died is worded as "couldn't read your calendar" instead of "nothing new found" (see §12). **Birthday sources (2026-07-26):** a `calendar_sources.source_type = 'birthdays'` row skips the AI call entirely — `processBirthdaySource` just parses each VEVENT's SUMMARY (stripping a "'s Birthday"/" Birthday" suffix) and DTSTART (month/day/plausible-year, sentinel years like 1604 nulled out), matches the name against the same `idByName` roster used for event attendees, and upserts into `birthday_import_candidates`. Zero added Anthropic cost. Manual JWT path or cron-secret path (scans every account) — see PROJECT_HISTORY.md §21. `icsDateToIsoDate()` now converts a UTC-stamped (`...Z`) DTSTART into the connecting user's own `user_settings.time_zone` before taking the calendar date (2026-07-24, bug fix — see §12); date-only and floating-local DTSTART forms are unaffected (no conversion needed, they never carried a UTC offset to begin with). Extraction prompt (2026-07-25): `suggested_tags` now explicitly checks the event title for a word matching/synonymous with an existing tag before ever coining a new one; `location` now falls back to the model's own world knowledge for a recognizable public event's real-world city (e.g. "SF Fleet Week" → San Francisco) when the calendar entry's own location is blank; new `mentioned_people` output field (names in the title/description, cross-checked server-side against the roster — see ImportReview.tsx entry in §3) and server-side group-affiliation inference (`groupsSharedByMultiple`) feeding `suggested_group_ids`. **Family-surname matching (2026-07-25, NOT YET DEPLOYED — see §10):** new `mentioned_family_names` output field (surnames referenced as a family/household unit, e.g. "Meal train for the Mojica family" → `["Mojica"]`, distinct from `mentioned_people` which explicitly excludes generic "family" references) resolves via a `last_name` lookup to EVERY person on file sharing that surname (a family invite plausibly means the whole household, unlike a single ambiguous first name), tracked separately as `familyMatchedPersonIds`. Their OWN groups are then suggested directly (`groupIdsFromFamilyMembers`, count ≥ 1) rather than requiring a second independently-resolved attendee to also share it, unlike `groupsSharedByMultiple`'s general 2+ bar — a family-name match is already a strong enough per-person signal on its own (e.g. Patrick Mojica alone, matched via "the Mojica family," is enough to suggest his real "98 FTS" group). Same AI call, no added cost. **Gotcha:** the group-affiliation queries (`person_groups`/`notes`) must be scoped via `.in("group_id"/"moment_id", <this user's own small list>)`, NOT `.in("person_id", <every person>)` — with 400+ people the person-based IN-list got long enough to silently misbehave through the Edge Function's outbound fetch (empty data, no thrown error, identical query worked fine from a browser). |

**Shared module** `_shared/relationships.ts`: the 5 relationship kinds (spouse/sibling/parent/child/partner), reciprocal notes written on BOTH sides (`INVERSE_RELATIONSHIP` map — incl. when a suggestion banner is confirmed, not just an immediate confident match, fixed 2026-07-20), dedupe on an EXACT match against the deterministic note text (not a loose name+keyword heuristic — the loose version used to false-positive on the SUBJECT's own original sentence and silently block their own reciprocal note, fixed 2026-07-20, see PROJECT_HISTORY §13), confident-match = name-as-typed exactly equals full name on file (else a suggest-don't-assert banner), siblings named together in one signal also link to EACH OTHER not just to the subject (direct write when confident, exact-full-name lookup at confirm-time otherwise — 2026-07-20), shared-parent inference suggestions, last-name inference for people created from relationship mentions (`inferLastNameFromSignals`, also called by the direct `new_people`/`add_people` creation paths). Every confident/pairwise note write here now ALSO dual-writes the matching row into the `relationships` table (2026-07-20, via `_shared/relationshipsTable.ts`'s `upsertRelationship` — takes a `userId` param now). Used by `converse`/`add-fact`/`update-moment`/`update-group` so relationship behavior is identical at all four entry points. `chat` and `search` functions were deleted 2026-07-19 (superseded by `converse`). `syncFamilyClique`/new `syncSpouseParenthood`/new `invalidateKeyFacts` (2026-07-25) mirror `src/lib/writeRelationship.ts`'s fixes exactly — see that entry (§3) for the full mechanism; **NOT YET REDEPLOYED**, see §10.

**Shared module** `_shared/relationshipsTable.ts` (2026-07-20): the `relationships` table read/write layer — `upsertRelationship` (spouse/sibling/partner symmetric & normalized a<b by id sort; `parent` directional, not normalized) and `getRelationshipsForPerson` (all of one person's links, either side of a row, in one shape), plus `fetchAllRelationshipRows` (2026-08-11, paged — the whole table for this user, shared by `converse`'s kin instruction and family roster so it's read once per turn). Mirrored on the frontend at `src/lib/relationshipsTable.ts` (Deno can't import across the Vite boundary) — keep both in sync if the table shape changes. `_shared/selfContext.ts`: `findSelfPerson`/`buildSelfInstruction` — builds the "my mom/dad" instruction paragraph for `converse`/`update-moment`/`update-group`, appended to each function's own DYNAMIC per-user tier (never the stable tier — the self person's name/relationships are per-user data and would otherwise bust the globally-shared stable-instructions cache).

**Shared module** `_shared/tz.ts` (2026-07-24, bug fix — see §12): `isoDateInTimeZone`/`fullDateInTimeZone` format a `Date` in a given IANA zone (via `Intl`, which ships its own tz database — no external dependency), falling back to UTC formatting if the zone string is invalid. `_shared/userSettings.ts`'s `getUserTimeZone` reads `user_settings.time_zone`, defaulting to `'UTC'` (the old always-server-time behavior) when unset. Used by `converse`/`update-moment` (their "today's date" tier) and `_shared/ics.ts`'s `icsDateToIsoDate` (a UTC-stamped calendar DTSTART).



---

## 2026-08-28 — Archive: the old §7 "What's built" section (per-feature build narratives)

_Archived verbatim from `PROJECT_CONTEXT.md` §7 when that section was compressed (founder budget
directive). Every shipped feature survives in `PROJECT_CONTEXT.md`; what moved here is the dated
chronology — the five numbered contacts-import bug fixes and their root causes, the live-verification
transcripts, and the founder reports behind each change. Search by FEATURE name or by the symptom._

## 7. What's built (all live unless noted in §10)

- **Auth:** sign up / log in. Email confirmation DISABLED for testing — must re-enable before real users.
- **Global search (item 14, 2026-08-12):** a "Search" tab at the end of the nav row (after Groups) on every page, plus `/` and Cmd/Ctrl-K. Searches people, events, groups, notes, pets and tags at once, grouped into sections. **Note text and an event's `raw_description` are searchable here and nowhere else in the app** — that's the point of the feature, not a side effect. Plain word matching, zero AI, zero API cost; when it isn't enough the last row hands the query to Home chat on a deliberate tap (that's how item 30 merges in — the fuzzy half already lives in `converse`, this links to it instead of rebuilding it). The demo has the same panel over static data, minus that row.
- **Home:** continuous chat (answer/capture/update/correct/group-tag per turn, multiple events per message, never dead-ends — suggests close matches or asks); clickable person/event/group chips on replies with canonical spellings; cached suggestion cards (tap = starts a real conversation); dashboard (People/Events/Groups/Notes counts — People/Events/Groups tiles clickable → jump to that tab, 2026-07-20; Notes tile has no page to link to, Dunbar card → DunbarDetail, Recall-assists card, monthly leaderboard → DueForUpdate); "Connections to make" card (2026-07-25, free/no AI — see §3 `suggestConnections.ts`/Home.tsx entries) rotating a few "add this person to this group?" suggestions sourced from event attendance + associated-group membership. Known gap: the chat thread lives in component state — switching tabs loses it.
- **People:** manual "add person" is a no-form blank shell (2026-07-20, matches Events/Groups — was a first+last form before), search (incl. nicknames, middle name, and goes-by "other" name), 5 sort options, count in heading. List cards always show the legal first/last name (never the profile page's "goes by" display name). A "Fill in gender for N people →" link (item 44, 2026-08-11) opens `GenderFill.tsx`, the bulk names→gender pass, and disappears once nobody's left to fill in. **"Import Contacts"** button beside "+ Add Person" (2026-08-17): outlined/secondary, navigates to `ContactsImport.tsx` (the vCard upload) — the People-page twin of Events' "Import Events", same styling and same "shortcut, not a new flow" rule. Hidden in the read-only landing-page demo.
- **Person profile:** Key Facts (cached, ordered Parents→Spouse→Siblings→Children, exact-match chips), missing-category nudges, notes with hover edit/delete + source labels ("Added through: {event}" / "From: {Group}" / "From Home" / "From: Contacts import"), name-edit pencil (first/middle/last name fields + a "Goes by" dropdown picking which of first/middle/last/a typed "other" name displays as the person's name on this page, 2026-07-22 — replaces the name shown in the heading/breadcrumb/nudges outright, e.g. "Maverick Whitfield", not a subtitle; "other" also writes a "Goes by X." note) plus fact bar (AI-classified, still the only path for nickname/birthday/anniversary), Associated Groups hover-untag + search-and-add picker (2026-07-20, matches EventDetail's Affiliated Groups — was read-only before), relationship + new-person + shared-parent + last-name suggestion banners, delete/merge profile (the SEARCHED-FOR record survives; merged-away names fold into nicknames; dependents notes/reminders/person_groups deleted and awaited before the person row, 2026-07-21 fix — matches GroupDetail's delete ordering, prevents an intermittent FK race).
- **Groups:** created conversationally OR via manual "add group" (blank shell, no form, 2026-07-20 — recurring affiliations, school/team/unit/workplace/circle, never one-off events); tiles with summary + capped chips; detail page per §3; membership = explicit only; suggestions from event attendance + associated-group rosters; symmetric confirmed group associations; whole-group delete (2026-07-20, the safety net the manual button needed — groups have no dedupe-by-name check the way `converse` does); **Group Types** (2026-07-20): fixed picker (Family/Friend group/School/Team/Work) on GroupDetail, nullable — sets `group_type` instantly, no save button; Groups page has a type filter dropdown + a badge on typed tiles. Manual "add group" now also adds the self person as a member (2026-07-20 fix — previously a group you created yourself, e.g. your own Family group, wouldn't show on "My page" since you weren't in its roster).
- **Events:** browsable, sorted by real-date guess; detail per §3; AI summary regenerates on new detail (only once there's a description to summarize); delete/merge (searched-for survives; dependents notes/moment_groups deleted and awaited before the moment row, 2026-07-21 fix, same reasoning as PersonDetail above); group tagging + attendee tagging via chat OR direct search-and-add pickers on the event page (2026-07-20); manual "add event" button (2026-07-20) creates a blank shell and drops straight onto its detail page to build up from there — same "step by step" idea as manual "add person," extended to events/groups. **Sub-events** (item 35, 2026-07-30, DONE, migrated and verified live): one level of nesting under a parent event, bundled/collapsible on Events.tsx, "↑ Part of X" / "+ New Sub-event" on EventDetail.tsx. **Associating two existing events** (item 113, 2026-08-26): "Associate an event" in the action bubble — pick one, then say the direction in plain words ("X is part of this event" / "This event is part of X" / "They're related"), with the illegal directions shown as muted reasons rather than hidden. "Related" is a new symmetric `moment_links` row (§6) and its own "Related Events" section, for two events that go together where neither contains the other. **"Import Events"** button beside "+ Add Event" (2026-08-17): outlined/secondary, no import flow of its own — it just navigates to Calendar settings, where iCal sources are added and synced (the existing calendar-import pipeline). Hidden in the read-only landing-page demo like the other write actions.
- **Voice input** on every text box (record → streamed transcript appears progressively in the box, never auto-sends). Live Web Speech captions as a visual draft on desktop/Android only, never on iOS and never the saved text. **Auto-grow textareas** everywhere (160px default, 320px on the two long-note boxes).
- **Cross-navigation:** any person/group/event mention anywhere is a chip → detail page, with breadcrumb trail; refresh restores location (sessionStorage). `pushCrumb` (App.tsx) collapses the trail back to a page's existing position if it's already in the stack (2026-07-23 fix), so repeat clicks / back-and-forth navigation don't grow the breadcrumb unboundedly. Address bar mirrors location via `buildPath`/`parseNavFromPath` (App.tsx): Home is `/home` (2026-07-23 fix, was bare `/`); fixed singleton pages (circle/settings/about/privacy/dunbar/nudges/manageTags) get one URL segment each, e.g. `/circle`, not `/circle/circle` (2026-07-23 fix). On `SIGNED_OUT`, nav state/sessionStorage/URL all reset to `/landing` (2026-07-23 fix, was `/`) — previously the address bar kept showing the last authenticated page after logout. **`vercel.json`** (added 2026-07-23) rewrites all paths to `/index.html` — without it, Vercel had no static route for `/home`, `/circle`, `/person/:id`, etc., so any refresh or direct link to those addressed-bar paths 404'd (only bare `/` ever worked, since it's the real index file). **Logged-out screens now have real paths too** (2026-07-23 fix): `/landing`, `/login`, `/signup`, `/demo`, and `/onboarding` — previously these never pushed a URL at all (guarded by `if (!session) return`), so refreshing on any of them silently dropped back to `/` → Landing. Login's signup/login toggle was lifted from local state into a parent-controlled prop (`isSignUp`/`onToggleMode`) so the in-form "Create an account" link keeps the URL in sync instead of silently drifting from it. The initial-mount effect only attaches `history.state` to whatever path was already loaded rather than rewriting it, since session resolves async and rewriting too early could clobber a legit authenticated deep link before login status is known.
- **Search boxes** on People/Events/Groups (client-side).
- **"My page" + real family tree + relationships table** (item 32, 2026-07-20 — see §3/§4/§6): a real `is_self` flag + `relationships` table replace the note-text-only inference that used to be the sole source of family data. Circle.tsx ("My page") is real (onboarding to flag/create the self person, live circle grid, "+" writes real facts). FamilyTree.tsx works for ANY person, not just the self person, walking the relationships table live. `person-facts` Key Facts linking and `converse`/`update-moment`/`update-group`'s "my mom/dad" resolution both read the same table now — the "all work together" ask is done, not just the tree UI.
- **Relationship calculator** (2026-08-05, item 20's family-tree half — see §3 `relationshipCalculator.ts`/§4): the app can now NAME any relationship, not just draw it. Four surfaces off one engine: a "How is X related to…?" action on the family tree's tap sheet (pick anyone on file, get the label plus the chain — "Steve Volin is Harry Carson's grandchild by marriage", `Harry → their child Barbara → their child Amy → their spouse Steve`); a second line on every tree tile giving that person's relation to whoever the tree is centered on (descendants-mode trees anchor on the self person instead, since their "root" is an arbitrarily-picked founder); a chip on every profile ("Your great-grandparent", tap to expand the chain); and extended-family vocabulary in the Home chat (§4). Costs no extra queries on the tree — `FamilyTree.tsx` keeps the graph it already loaded. Gendered wording depends on `people.gender`; where that's unset, `loadFamilyGraph` fills the gap with a confident first-name guess (`nameGender.ts`, 2026-08-05), so a label only falls back to the neutral form ("aunt/uncle", "grandchild") for names the lookup won't decide. `GenderFill.tsx` (item 44, 2026-08-11) is how the column itself gets filled in bulk. Verified live on the Bach tree.
- **Location cleanup** (item 66, 2026-08-12 — see §3 ManageLocations.tsx / locationGroups.ts): "Manage locations →" on Events lists every place written on an event with its count, rewrites one across all of them at once, and proposes clusters of spellings that look like the same address. Found 4 spellings of one real address on the founder's account, with no false positives across the other 95 locations.
- **Untagged-event sweep** (2026-08-12): Events' group filter has a "No group yet" option, the manual counterpart to Home's event-tagging card (which only offers events where every attendee shares a group). 51 of 119 on the real account.
- **Event tags** (items 28 + 34, 2026-07-22 — see §3/§4/§6): manual tag/untag on EventDetail (create-or-reuse picker, browse-all-on-focus, hover-remove chip) and AI-suggested tagging via `converse` (capture-time only, capped 1-3/moment, reuse-biased), backed by new `tags`/`moment_tags` tables. Events page has a tag filter dropdown (growing from tags actually applied) plus a "Manage tags →" link to `ManageTags.tsx` for a full add/rename/delete view with usage counts. 10 generic starter tags auto-seed once per account. Alphabetical order enforced at render time everywhere tags list (picker, chips, filter, Manage Tags), independent of creation order. Verified live end-to-end against the real account, test data cleaned up after. `update-moment`'s chat-based `add_tags` and `suggest-prompts`'s tag signal deliberately deferred — see §8 item 28.
- **Reviewing imports** (2026-08-19): Home and Calendar show ONE `N things to review →` nudge (was up to four stacked "N found" banners) into `ReviewInbox.tsx`, which breaks the total down per queue and owns the set-aside pile. Calendar events get a two-stage flow like contacts already had: `CalendarTriage.tsx` (fast Keep / Not this one, one line each) then `ImportReview.tsx` for what was kept. That queue now serves batches of 10 (`ReviewDeck.tsx`) with a progress line and an end-of-batch panel instead of an endless "Show 20 more"; its cards open collapsed (Accept / Not now / Reject / Details) and expand on tap, except when the duplicate heuristic fires, where the card opens expanded so the merge question can't be answered by reflex. "Not now" is a real third answer — `status='deferred'`, back in the queue in 30 days. Counts come from one shared module (`lib/reviewQueues.ts`) so Home and Calendar can't disagree. Nothing here filters: the 2026-08-12 "sync everything, let the person decide" directive is untouched, this only changes the size of the bite. No AI call added anywhere. **Round 2 (2026-08-19, after the founder's preview):** the triage row now offers four answers — Quick Add (creates the event on the spot), Add More Detail, Remind Me (pick 1 week / 1 month / 3 months / 6 months, with a "use this as my default" checkbox → `user_settings.review_remind_days`), Reject — so most events never need a second screen. A row the duplicate check flags shows "Looks familiar — review it" instead of Quick Add, so the one-tap path can't create a duplicate. Both triage lists now hold your scroll position (they adjust counters in state instead of refetching, which flipped `loading` and dumped you at the top — Groups.tsx's `silent` idiom); the review queue keeps your place and your batch across "Add more details →" and back. `SearchAddPicker` closes on select. The contact review card gained "Add to events" beside "Add to groups" (attendance is a `notes` row, and undo comes free from the existing snapshot). The inbox gained a quiet "N people missing a gender" row → `GenderFill.tsx`, excluded from Home's total. **Needs both `migrations_manual/2026-08-19-*.sql` files (§10); until they run the app fails open to exactly its old behaviour.** Not yet click-tested in a browser — see §10.
- **Contacts import** (item 65, 2026-07-27): founder-requested, previously-parked "iPhone Contacts import" now built. vCard (.vcf) upload only (`ContactsImport.tsx`, no Storage bucket — base64-in-JSON-body, same pattern as voice upload), parsed by a hand-rolled `_shared/vcard.ts` (handles Apple's item-grouping/X-ABLabel convention for Anniversary + related-names, BDAY-no-year, multi-value TEL/EMAIL/ADR/URL). Deliberately NOT a one-shot bulk-accept: a curation step (`ContactSelection.tsx`, paginated 50/page, immediate per-row DB writes so nothing is lost mid-browse) comes before the usual accept/reject-with-matching review (`ContactImportReview.tsx`, scoped to founder-selected contacts only). Matching: exact/nickname first, then word-overlap fuzzy fallback (`_shared/nameMatch.ts`), corroborated by exact phone/email match. Accept into an existing person fills blank scalar fields and unions array fields (never overwrites/loses existing data); birthday/anniversary go through a new shared `src/lib/reminders.ts` helper into the existing `reminders` table. Business-only vCards (no personal name) are silently skipped in the parser itself. Contact photos and auto-linking Apple's related-names into the real `relationships` table are explicitly out of scope this pass (see §8 item 65). New "Contact Info" collapsible section on `PersonDetail.tsx` (own isolated query, same pattern as `gender`) makes birthday/address/phone/email/etc. manually editable on any profile too, not just importable. Verified live end-to-end against the real account (upload → skip business contact → select/skip/undo with reload-persistence confirmed → new-person accept → merge-into-existing accept with field union confirmed via direct DB read → PersonDetail rendering → re-upload dedupe) — all test data cleaned up after. **Bug fix #1 (2026-07-26):** oversized uploads (e.g. real iCloud exports with a full-res photo embedded per contact, which the parser never reads) were bloating the upload past the Edge Function's ~55MB request-size ceiling (`WORKER_RESOURCE_LIMIT`). `ContactsImport.tsx` now strips `PHOTO`/`LOGO`/`SOUND` fields client-side before base64-encoding. Confirmed fixed against a synthetic 50MB photo-laden file. **Bug fix #2 (2026-07-26, the founder's actual reported file — 2071 contacts, 518KB, no photos):** same `WORKER_RESOURCE_LIMIT` error but from CPU, not payload size — `_shared/nameMatch.ts`'s fuzzy matcher recomputed word-set/regex work from scratch for every (imported contact × existing person) pair, so importing thousands of contacts against an account with hundreds of people already on file ran millions of redundant regex/Set operations and blew the compute budget. Fixed by precomputing each person's candidate-name word-sets and normalized email/phone Sets once (`buildPersonIndex`) before the per-contact loop instead of inside it. **Deployed and confirmed live 2026-07-27** (founder-provided token) — re-tested against the founder's actual 2071-contact/518KB file that originally surfaced this bug: 2008 candidates added, 3 skipped (business-only), no error. That real file's candidates are now sitting in the founder's actual review queue (this was the founder's real data, not test data — nothing to clean up). **Bug fix #3 (2026-07-31):** a high-confidence auto-match (two different real people who happened to share one phone number) had no way in `ContactImportReview.tsx` to say "not them" — the name-edit fields only ever rendered when unmatched, so a wrong match silently discarded any name typed in and merged the new contact's info into the wrong existing person on Accept. Fixed with an explicit "Not the same person — add as new" button that clears the match and reveals the editable name fields, plus an accept-time snapshot (`UndoInfo`) enabling an inline "Undo" link on the post-accept confirmation that exactly reverses either outcome (deletes the newly-created person, or restores an existing person's pre-merge field values/reminders/groups/note) and puts the candidate back to `status='selected'` to be reviewed again. Root-cause data fix applied live (the founder's actual "David Bengford" contact, wrongly merged into "David Adelstein," split back into its own person — confirmed no shared groups/notes/reminders had been added, so the split was clean). New code verified live via a disposable test person + candidate (both the "add as new" path and the "undo a merge" path confirmed via direct DB read, test data cleaned up after). **Bug fix #4 (2026-08-10, founder-reported "it asks if every single Alex is Alex Lesar"):** the fuzzy matcher scored names by word overlap divided by the SHORTER name, so "Alex Lesar" vs. "Alex Smith" scored 0.5 (a match) and vs. a bare "Alex" on file scored 1.0 (high confidence) — 574 of the founder's 576 stored matches were that bug. Replaced with a surname-first rule (`_shared/nameMatch.ts` + its `src/lib/nameMatchStrength.ts` mirror — see §3); exact/nickname `idByName` now claims WHOLE names only, since first-name keys were the other half of the same bug. A shared email/phone no longer overrides a given-name mismatch on its own (households share a landline), phone numbers compare on their last 10 digits, and two equally-plausible people yield a question or nothing rather than a coin flip. `ContactImportReview.tsx` re-checks every stored match on read and sweeps the whole `selected` set once per visit (chunked 100/write), so an existing queue self-heals without a re-import — the founder's dropped from 576 bad matches to 7 real ones on one page load. Deployed + verified live. **Accept/reject landing (2026-08-17):** both actions now collapse the card in place and park it at the top of the screen (`lib/resolvedCardScroll.ts`), matching the other three review queues. Reject shows `Rejected — {name}` with Undo (status back to `selected`, original `matched_person_id` restored) instead of the row vanishing, and both confirmations carry a Done that drops the card from the list. Reject used to refetch the whole page, which is exactly what it can't do now that it has something to confirm — the parent's `refreshTotal` only updates the footer count, and `handleDismissed` removes the card on Done. **Bug fix #5 (2026-08-18, founder report):** the `allPeople` roster is loaded once per visit, so a profile created by accepting one card didn't appear in any other card's "link to someone existing" search until the whole page was reloaded — the worst case being a phone address book that lists the same person two or three times. `onPersonCreated`/`onPersonRemoved` now keep that roster in step with accept and undo (same shape as the existing `onGroupCreated`); see §12. Verified live on the founder's real queue: accepted "Chris Mcgee," found them from the next card's search with no reload, then undid it and confirmed they left the roster and the candidate returned to the queue.
- **Former names** (item 101, 2026-08-21 — see §6, §12): a maiden or otherwise-changed surname on a profile. Set in PersonDetail's name form ("Former name" box) or conversationally; shown as a muted "Formerly Sarah Jenkins." line under the name and nowhere else. Makes the old name resolve everywhere: People + global search, the `claimKey` name→id index in all 6 chat/scan functions, and `nameMatchStrength` (a maiden/married pair scored a surname `conflict` = no match at all, so contact import proposed a duplicate). A merge now files the loser's differing surname here. Roster marker `Sarah Mitchell (formerly Jenkins)`, emitted only when set. Demo: Carol Pemberton, formerly Whitfield.
- **Pets** (item 73, 2026-08-01): profile card, own detail page, and People-list presence — **migration run and verified live end-to-end 2026-08-01 (§10).** Pets are shared records (`pets`/`person_pets`), so the family dog lives on both spouses' profiles and is edited once, on the pet's own page; the picker searches every pet on the account, making "add a new pet" and "attach the spouse's dog" the same gesture, and removing from a profile unlinks rather than deletes. Species is free text and each pet carries an open `{label, value}` Details list, so a fish and a horse both fit without new columns. Pets also appear in the People list with a species emoji (🐕/🐈/🐟/🐾), which is a display merge only — they never enter the People count or Dunbar math. Deceased pets sort last, render as "In memory," and get no follow-up nudges. **Home chat reads AND writes pets** (`converse`, deployed 2026-08-01): "Sarah got a puppy named Biscuit" creates and links it, "what's Sarah's dog called?" answers from the roster, "Biscuit is Tom's dog too" adds a second owner rather than a duplicate pet, two same-named pets make it ask which, and a pet that died is recorded and spoken about in the past tense. Chat writes are additive-only — they fill blanks, never overwrite what the profile form set. Merge carries pets to the survivor; delete-profile cleans up its links. **Pets at events (2026-08-20, founder-reported — "app is not letting me tag pets to events"): migration applied and verified live.** The 2026-08-01 pass deliberately kept pets out of the moments graph; this crosses that line with a `moment_pets` join table (§6), not by widening `notes`. The pet sits in "Who was there" with its species emoji, taps through to its own page, and hover-untags non-destructively; a pet tagged on a sub-event rolls up to the parent exactly like a person does. The pet's own page gained "Was at these events". **One picker for both, 2026-08-21** (founder: "the same way I add a person. Not a whole new separate box.") — the separate 🐾 row is gone and "Add who was there" lists people and pets together, ids namespaced `person:`/`pet:` since the picker returns only an id. The species emoji rides in `SearchAddPicker`'s `prefix` field, never glued to `label`, because `label` is what `rankMatches` scores — an emoji in front demotes a prefix match to a mid-string one and buries "Maple" under every name containing "map". No create-a-pet path in there on purpose: a pet needs an owner, and owners are picked on a profile, so typing a new name still creates a *person*. **Home chat can tag pets to events (`converse`, deployed 2026-08-21):** "we brought Biscuit to the lake house" writes `moment_pets`. Resolution only, never creation — an unknown or ambiguous name is dropped and logged rather than becoming an ownerless pet.
- **Countdowns** (item 83, 2026-08-06 — **needs the migration in §10 before the add/dismiss half works**): a collapsible section at the bottom of the Calendar page, below the month grid. Auto count-ups need nothing added — any past event tagged "Milestone" and any birthday/anniversary with a year on file shows how long it's been (deceased people excluded). Countdowns for what's ahead are opt-in: "+ Add" offers a plain countdown ("Baby due date"), a countdown that's also a real event, or pinning an event already on file. Cards under a week out tick down to the second; a card dated today reads "Today". Dismissing a card only removes it from Countdowns, never the event or birthday behind it. The cards read as one timeline in their own scroll box — past above the Today line, upcoming below, opening centred on it, with a "Today" button to jump back. Each card's ⚙ (needs the settings migration in §10) renames it for the countdown only, picks which units it counts in, sets it to repeat weekly/monthly/yearly, or retires it once its date passes instead of counting up.
- **Notebooks** (2026-08-18 — see §1 for the framing, §3, §6): the app's internal side, a 6th nav tab. You name a notebook ("Movies I loved", "How I'm doing") and add entries one at a time, typed or dictated; each can carry an optional date and links to people. One screen serves both shapes — dates present it reads as a log, absent as a list — so there is no layout toggle. Per-notebook **"Let Grove read this"** switch, on by default: off keeps a notebook out of every chat prompt while leaving it findable in global search. Entries appear in global search under a Notebooks section (both the notebook and each entry; an entry opens its notebook, same as a note opening what it hangs off). **Zero new Edge Functions and zero new AI calls** — people attach via an explicit picker, not AI detection; the only token cost is a capped block (200 most-recent entries) appended to `converse`'s existing tier-3 cached tier, deliberately NOT a 5th `cache_control` breakpoint (the API allows 4 and all 4 were already spoken for). Verified live end-to-end on the real account 2026-08-18: migration → create → undated entry → dated entry (mixed-order sort correct) → person link surviving a hard reload (the silent-RLS check) → search finding and navigating → Grove answering from a notebook → switch off and Grove no longer knowing. In the landing-page demo since 2026-08-19 (item 97). **Nav fix shipped with it:** a 6th tab made the tab row overflow — all six were given an identical 40px, so the "Notebooks" label printed 3.3px on top of "Groups" at 375px. Tabs now flex from their own label width (`flex: 1 1 auto`, was `1 1 0`) and `.nav-tab-label` steps to 0.6rem under 480px. The font-size had to MOVE from App.tsx's inline `navStyles.linkLabel` into index.css — an inline style silently beats a media query (same trap as `.nav-wordmark`). Measured after: no clipping, 9.6px between every label, no sideways scroll; desktop unchanged.
- **Notebook rich text + per-notebook lock** (2026-08-19, founder-requested — see §6): entries are written in a real editor (TipTap/ProseMirror — headings, bold/italic/underline/strike, bullet + numbered lists, quote), not a textarea. **First new runtime dependency since dnd-kit**, accepted because hand-rolled `contentEditable` is unreliable on iOS Safari and the iPhone is the target; it lands entirely in the already-lazy `NotebookDetail` chunk (417kB raw / 131kB gzipped) so the app's entry bundle is untouched and it downloads only when a notebook is opened. Fixed alongside: the edit box rendered ~145px wide because `styles.composerInput`'s `flex: 1` was applied to a textarea that wasn't inside a flex row (founder screenshot). **Lock:** a per-notebook `locked` flag gated on one account-wide PIN (`notebook_pins`, bcrypt via pgcrypto, verified in a SECURITY DEFINER RPC — never compared in the browser). A locked notebook is kept out of global search AND out of `converse` independently of `ai_visible`, because a gate only on the page is theatre — someone at your open tab would just search for it or ask Grove. Unlock state lives in component state only, so leaving the page re-arms the lock with no timer to get wrong. Forgotten PINs reset through Supabase password re-auth. **This is a walk-up-to-your-tab guard, NOT encryption** — entries are stored readable like everything else, so it doesn't defend against a stolen login or DB access; that would mean client-side encryption and losing the AI on those notebooks entirely. Verified live 2026-08-19: editor size/bold/save/reload, legacy plain-text entries still rendering, search matching "diner" but NOT "strong" (the tag-leak check), gate blocking on re-entry with no entry text in the DOM, locked entries gone from search, and Grove answering "you don't have any notebook entries" with `locked = true` and `ai_visible` deliberately left ON. **Not yet verified: the PIN comparison itself** (right PIN opens / wrong PIN refused) — needs a PIN the founder sets, since setting one is entering a credential.
- Demo persona seed data exists ("John & Jane Doe", ~18 people/~22 moments — fake, handwritten UUIDs; don't pattern-match on it) — separate from the item below, and not used by it.
- **"See a live demo" public landing-page demo** (2026-07-23, persona reworked 2026-07-23; scaled up 2026-07-23; de-aged 2026-08-23, item 112): a "Gary Pemberton" persona (216 people, 4 groups, 125 moments, 298 notes, spanning 2011–2026 — wholly original, no real person/IP; working Regional Operations Manager at a fictional industrial distributor — de-aged from "retired, 60s" on 2026-08-23 so the demo stops contradicting §1's age-neutral framing; stage 2 replaces the persona outright, item 112, not ex-military — the original aviation/"Squadron" framing read as generic and was replaced) hardcoded in `src/lib/demoData.ts`, click-through via `authView === 'demo'` → `DemoShell` → a one-time `DemoIntro` welcome walkthrough (see §3, counts there now pulled live from `demoData.ts` instead of hardcoded). Zero Supabase/Edge Function calls anywhere in the demo, by design (CLAUDE.md rule 3 — a public, unauthenticated surface must not be able to run up API cost); the Home chat is scripted (fixed prompts/replies) rather than calling `converse`. Multiple entry points on Landing.tsx now (see §3 Pass 4). Every moment carries 1-2 tags (`DEMO_TAGS`, 8 total: Sports/Milestone/Family/Reunion/Holiday/Work/Golf/Catch-up); the demo's Events tag filter and EventDetail tag chips work like the real app's. `DemoShell` now opens on `DemoIntro.tsx` first (see §3) — founder feedback: dropping a first-timer straight into a populated fake account with no context was "totally useless." 2026-07-23 scale-up: `DemoEventDetail.tsx` was fabricating a generic "Was there." note per attendee instead of surfacing real `DEMO_NOTES` tied via `momentId` (real ones now take priority, placeholder only fills gaps); the original 34 moments got filled out to 2-3 tied notes each; Frank/Steve/Ray/Harold got real spouse/kid relationship edges (Pete deliberately left without, for realism); a generated long-tail roster (~180 people — coworkers/neighbors/school parents/community/extended family, deterministic name-pool generation in `demoData.ts`, most with a single note, ~90 paired with a small one-note "quick capture" event) was added on top of the hand-authored core so the roster reads like a real long-used contact list instead of a curated highlight reel.


---

## 2026-09-04 — Four items the docs carried for six weeks, closed by the founder just looking

A "what's next" pass put five things at the top of the list as cheap wins. The founder checked and **four of them were already fine** — three had probably never been real.

**Google sign-in** and the **Geoapify key on Vercel** were genuine, and the founder had done both (the Geoapify half was already recorded 2026-09-03; the Google redirect fix landed the same day and just needed one more attempt, which the founder has now made — it works on the live site).

The other three were data cleanups §10 had been carrying since **2026-07-20/21**: a duplicate "David" vs. "David Adelstein", two "Amy Volin" profiles, and Barbara Bach's tree showing Bill as her father and Lisa as her sister. The founder looked at all three on the real account and none of them exist any more. Same outcome as the "Barbara Bach duplicate" note back on 2026-07-21 — either already fixed in passing, or the original finding was wrong.

**The lesson, which is about the docs and not the data:** a cleanup item that only the founder can see or verify has no way to close itself. It sits in §10 forever, gets re-read by every session, gets re-presented as "do this first," and costs tokens every time. Three of the five top-of-list items on this pass were ghosts.

**What to do differently:** any §10 entry that depends on the founder's own eyes should be *asked about* the next time they're in the conversation, not carried silently. The Barbara/Bill/Lisa entry in particular had grown two cross-references elsewhere in §10 (the item 37/38 verification note and the "wrong wire" second-cause note), both of which had to be repaired when it was finally deleted — the longer a stale entry sits, the more of the document grows into it.

**Also found on this pass, unrelated:** the founder's local `boomer-app-2` folder was 23 commits behind `origin/main` and had a substantial uncommitted feature in it (auto-tagging existing events, 2026-08-23: a migration, `scan-event-tags`, `suggest-tag-trends`, a ManageTags approval screen, plus an EventDetail chip refactor and a Settings addition). None of it exists anywhere on `origin`. It predates the address-autocomplete and end-date-order work that has since landed on the same files, so it is not a clean rebase. Left untouched pending a founder decision. This is the §10 "working rule" — check `git status` for another session's work before editing — firing for real.

---

## 2026-09-04 — The feature that was already running, and nobody could see it

A "what's next" pass found ~2,100 lines of uncommitted work in the founder's local folder, dated 2026-08-23: auto-tagging events already on file. The folder was also 24 commits behind `origin/main`. The founder chose to finish it.

**The first surprise was that it wasn't unbuilt.** Probing the database before applying its migration returned "195 of 204 events already scanned" — a column the migration was supposed to be *adding*. A later session (2026-08-26) had already deployed both Edge Functions and run the scan against the real account. Live in production, for over a week: 77 tags applied automatically, 45 events with parked tag names, 63 events with a group pick waiting, and 5 trend proposals sitting in `tag_suggestions`.

What had never shipped was the entire **front end** — the Manage tags approval block, the Settings scan/undo section, and Home reading `suggested_group_ids`. So the founder had been looking at 77 AI-applied tags on their own events with no indication which were theirs, no way to see the 5 proposals, and **no undo**. The undo control and the thing needing undoing shipped in opposite halves of the same branch, and only one half went out.

**What was dropped rather than merged, and why that was most of it.** Two thirds of the branch was superseded. Its `recentLocations.ts` helper unified three address-suggestion builders — but main had since shipped `AddressSuggestInput` with three builders that deliberately *diverge* (EventDetail most-used-first, ImportReview most-recent-first, GroupDetail scoped to one group's events), so "unifying" them would have been a regression dressed as a cleanup. Its EventDetail chip refactor (-333 lines into `src/components/event/`) was pure reorganization of a file that had since gained address autocomplete and related events. Neither was the feature; both were re-doable later against current code, and the branch is preserved at `wip/auto-tag-events` if anyone wants them.

Its group-suggestion work was superseded in a more interesting way. The branch added a `reason: 'attendees' | 'ai'` union and a `mergeEventGroupSuggestions` function to fold two signals into one card with precedence. Independently, main's 2026-08-23 group-window work had solved the *same* problem better — `reason` as free text, a `push()` helper enforcing one question per (event, group) with first-wins precedence, and the same removal of the `if (attendance.length === 0) return []` early return. So the merge kept main's shape and added the scan's picks as a **third** pass, ranked last: attendance is a fact about the data, the window is deterministic, and the model's read of a title is an inference, so it explains itself as "Its name and notes point to that group" and yields the reason whenever a stronger signal already claimed the pair.

**One real bug the original never caught:** `npm run check:functions` failed on the `moment_tags → tags` embed. It's a many-to-one FK so PostgREST returns an object, but with no generated database types the client infers an array, and the two shapes don't overlap. Events.tsx and EventDetail.tsx had long since settled on the double cast through `unknown`; the new function hadn't. The branch had clearly never been typechecked — which is also how it got deployed and run against real data.

**Verification found nothing wrong and one thing worth knowing.** Signed into the real account, all five proposals rendered with correct event lists, and expanding "Dinners" showed the design working as intended: 16 events, mostly dinners, plus "Calgary Sim Training May 2025" — visible and unclickable-away only because the per-event checkboxes exist. The AI's imprecision is *supposed* to be correctable before anything is written. Separately, the same pass surfaced four identical "Maple Volin's birthday" events on one date, which is why that question appeared four times on Home.

**The lessons, in order of how much they cost:**

1. **A feature is not shipped when its backend is.** The half that writes went live; the half that explains and reverses did not. If a change writes to real data, the undo is not a follow-up item — it ships in the same breath or the write waits.
2. **Check what is deployed before believing a local diff is unfinished.** §10's own working rule, and this is the second time it has paid: the migration was 80% already applied, and re-running it blind would have been harmless only by luck of it being written re-runnable.
3. **Uncommitted work rots at the speed of the branch it is not on.** Nothing was wrong with the 2026-08-23 code the day it was written. Twelve days and 24 commits later, two thirds of it was worse than what had replaced it.
4. **`.env` credentials expire silently.** The persisted `SUPABASE_ACCESS_TOKEN` returned `Unauthorized` on a plain read. The Supabase MCP connector carried working credentials and did every migration, query and function read this session — worth reaching for first now.
