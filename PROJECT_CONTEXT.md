# PROJECT_CONTEXT.md — Boomer

_A living document. Update it as the project evolves. If something is uncertain, it's marked "unknown" rather than guessed._

---

## 1. Purpose and Vision

Boomer is a mobile-friendly web app designed for adults aged 50–70 who want help staying connected to the people who matter in their lives. The founder (the person you're working with) has no professional coding background and is building this hands-on, learning as they go — explanations should stay in plain language, and major decisions should be checked in on before being built, not just announced.

The core insight driving the product: people don't forget the big things, they forget the *texture* — who was at an event, what was discussed, what's going on with someone's grandkids, what a friend mentioned in passing three months ago. Boomer's job is to be an effortless, conversational memory aid for that texture, so the next time you see someone, you're not starting cold.

**The founder's own words on what makes the app special:** "the output is what is going to make the app special" — meaning the quality, warmth, and usefulness of what the app gives back (not just what it stores) is the actual product. A proactive framing they liked: the app inviting someone back into a memory ("want to take a trip down memory lane about this event?").

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
- **Dev environment:** As of 2026-07-15, moved off StackBlitz to **Claude Code working directly in a local folder** (`C:\Users\jakev\Downloads\boomer-app-2`), specifically to stop the copy-paste workflow between claude.ai chat and StackBlitz that caused repeated friction (see Section 9). Node.js/npm and the Supabase CLI (as a local devDependency, run via `npx supabase`) are now installed on this machine. Edge Functions were pulled out of the Supabase dashboard into `supabase/functions/` in this repo, so both frontend and backend are now edited and deployed from the same local repo — no more pasting code into either StackBlitz or the Supabase dashboard.
- **Hosting/deployment:** **Live on Vercel** as of 2026-07-15 (`https://boomer-app-2-eight.vercel.app/`), connected to the GitHub repo (`github.com/glitchsocket12/boomer-app-2`) for auto-deploy on every push to `main`. `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` are set as environment variables in Vercel's project settings (not from `.env`, which is git-ignored).
- **Model name in use:** `claude-sonnet-5` in all Edge Functions. (Earlier revisions mistakenly used an invalid model string, `claude-sonnet-4-6`, which caused a silent failure mode — see Section 9.)

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
│   ├── PersonDetail.tsx        — one person's profile: all notes about
│   │                             them (chronological), plus a "fact bar"
│   │                             to add a detail (routes through the
│   │                             `add-fact` Edge Function, which decides
│   │                             if it's a last-name correction or a
│   │                             plain note)
│   ├── Groups.tsx               — lists groups (e.g. "Academy Friends")
│   │                             and their members; groups are created
│   │                             CONVERSATIONALLY (via Home), not through
│   │                             a manual "create group" form
│   └── Events.tsx               — browsable list of all moments/events
│                                 (independent of any one person), shows
│                                 attendees (as clickable chips to their
│                                 profile) and any group tags
├── components/
│   ├── ErrorBoundary.tsx        — catches a render-time crash in whatever
│   │                             it wraps and shows an error message
│   │                             instead of taking down the whole app
│   └── UpdateMomentChat.tsx     — small inline conversational widget for
│                                 adding detail to an already-identified
│                                 moment, calls the `update-moment` Edge
│                                 Function. Was mainly used before Home
│                                 became fully conversational; may now be
│                                 partially redundant with Home's general
│                                 capability to update moments in-thread.
```

**As of 2026-07-15, the standalone "Add a Moment" page (`AddAMoment.tsx`) was removed** — Home's unified conversation already covers that capture flow, so the separate page/tab was redundant. Its Edge Function (`chat`) is still deployed but is now unused by the frontend entirely (see the Edge Functions table below). The Events and Groups tabs (described above) were also actually wired into the nav bar for the first time as part of this same change — the architecture doc had described them for a while, but they weren't reachable from the UI until now.

**Supabase Edge Functions (Deno, in the Supabase dashboard, not local CLI):**

| Function | Purpose | Status |
|---|---|---|
| `chat` | Original Add-a-Moment capture conversation | Deployed but no longer called by the app — `AddAMoment.tsx` was removed 2026-07-15 |
| `search` | Original one-shot search (superseded) | Deployed but no longer called by the app |
| `update-moment` | Add detail to one specific moment | Active, used by `UpdateMomentChat.tsx` |
| `add-fact` | Classifies a typed fact as a last-name correction vs. a plain note | Active, used by `PersonDetail.tsx` and `Home.tsx`'s per-person note adding |
| `converse` | **The main unified brain.** One conversation handles: answering questions (about people, groups, or events), capturing brand-new moments, updating existing moments, renaming placeholder people, last-name corrections, and creating/tagging groups — all decided per-turn from conversational context. This is what `Home.tsx` calls. Group creation/tagging logic (see Section 6) was actually implemented here for the first time 2026-07-15 — it was previously described in this doc as if built, but the code had no group handling at all. | Active, actively evolving |

**Important:** `search`, `chat`, and `update-moment` still exist and are deployed, but `converse` has absorbed most of their responsibility for the main Home experience. They are not necessarily kept in sync with each other anymore — treat `converse` as the source of truth for prompt-engineering patterns going forward. `chat` in particular now has zero callers in the frontend and is a candidate for deletion; `update-moment` is still used by `UpdateMomentChat.tsx`, and `add-fact` is still used by `PersonDetail.tsx`'s fact bar.

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
  created_at

moments                          ("events" in the UI/Events page)
  id            uuid PK
  user_id       uuid → auth.users
  raw_description text          (original raw conversation text, kept
                                  for reference)
  occasion      text, nullable
  location      text, nullable
  when_text     text, nullable  (INTENTIONALLY free-text, not a date —
                                  people describe timing loosely, "last
                                  summer" etc. The `converse` function
                                  reasons about actual dates by comparing
                                  when_text's *meaning* against the
                                  moment's created_at timestamp — see
                                  Section 8, date reasoning)
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

notes
  id            uuid PK
  person_id     uuid → people
  moment_id     uuid → moments, NULLABLE (nullable was added later
                                  specifically so a note can be a
                                  standalone manually-added FACT about a
                                  person, not tied to any one moment —
                                  e.g. "married to X, shares a house")
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
  created_at

person_groups                    (join table, many-to-many)
  person_id     uuid → people
  group_id      uuid → groups
  PK (person_id, group_id)

moment_groups                    (join table, many-to-many)
  moment_id     uuid → moments
  group_id      uuid → groups
  PK (moment_id, group_id)
```

## 6. Features Already Built (and confirmed working end-to-end)

- Sign up / log in (Supabase Auth, email confirmation currently **disabled** in the Supabase dashboard for ease of testing — see Section 10, this needs to be re-enabled before real users)
- People list: add a person (first + last name), view list
- Reminders: manually add a birthday/anniversary date per person, visible in their card on the People page. **No automatic email/notification sending exists yet.**
- Person profile page: chronological notes, a "fact bar" to add a detail directly (routes through AI classification to decide if it's a structured correction like a last name, or a plain note)
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
- Groups page: lists groups and members (read-only view; groups are created via conversation, not a manual form). Confirmed working end-to-end 2026-07-15, including actually receiving real group tags from Home conversation (see above).
- Events page: browsable list of all moments, with attendees (clickable, jump to profile) and group tags, independent of any one person. Confirmed working end-to-end (click-tested) 2026-07-15.
- Both Events and Groups are now reachable from the main nav bar (Home / People / Events / Groups) — the standalone "Add a Moment" tab was removed since Home's conversation already covers that capture flow.
- **Nested Groups → Events → Event-detail drill-down, with a clickable breadcrumb trail** (built 2026-07-15). From the Groups tab, each group card has a "View events →" link that opens `GroupDetail.tsx`, listing that group's tagged moments as tiles (short summary + "See more →"). Clicking a tile opens `EventDetail.tsx` — full raw description, the open-ended `details` jsonb (rendered as key/value rows, now surfaced in the UI for the first time), attendee chips (clickable, jump to profile), and per-person notes. A `Breadcrumb.tsx` component renders "Home → Groups → {group name} → {event summary}" above the content; each non-current segment is clickable and jumps straight back to that level. This nested state (`viewingGroup`/`viewingEvent`) lives in `App.tsx`, mirroring the existing `viewingPerson` overlay pattern — so clicking a person chip from inside an event still opens the full-page `PersonDetail` overlay, and its own "← Back to People" button correctly returns to the exact event you came from (group/event state isn't cleared by the person overlay, only the overlay itself is toggled). Click-tested end-to-end.
- Demo/seed data: a fictional persona "John & Jane Doe" (61-year-old retired Air Force veteran in Colorado Springs) with ~18 people, ~22 moments, and 90+ notes, seeded via direct SQL for demo/testing purposes (SQL files were generated and handed off, not run by the assistant directly — the user runs them in the Supabase SQL Editor)

## 7. Features Currently In Progress / Explicitly Deferred

- **Automatic email reminders** — deferred early on ("Not yet — let's move to Add a Moment first and come back to this"). Never revisited since. The `reminders` table exists but nothing sends anything automatically.
- **Voice input** for Add a Moment — the founder said this mattered "a lot" for this audience, using the browser's built-in Web Speech API (free, best support in Chrome/Android, weaker on iPhone Safari). **Not yet built.**
- **Weather/time metadata enrichment** on moments (pulling historical weather for the date/location of an event) — discussed as an interesting idea, explicitly deferred in favor of other priorities. Would require geocoding + a historical weather API (e.g. Open-Meteo, free/no-key).
- **iPhone Contacts integration** — using a person's real saved address/contact info from the user's phone contacts — explicitly deferred as unnecessary complexity for now.
- **Tuning AI conversation quality** — the founder has repeatedly noted the AI could ask better/more thorough follow-up questions before wrapping up a conversation; called "good for MVP, but something to improve" more than once. This is an ongoing, never-fully-resolved thread, not a discrete task.
- ~~Groups tagging for moments~~ — **done and confirmed 2026-07-15** (see Section 6). No longer deferred; moved here to note it's resolved, not tracked as a gap.
- **Existing (pre-2026-07-15) moments and people are NOT retroactively grouped.** Group tagging only happens going forward, on new conversation turns. If the founder wants old moments (like the seeded "Air Force safety school" entry) tagged into a group, that has to be resurfaced/re-mentioned in a Home conversation — there's no batch/backfill tool for this.

## 8. Key UX / Product Decisions (and the reasoning behind them)

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

## 10. Known Limitations / Things NOT Yet Done

- **No automatic email sending** for reminders (table exists, no sending logic).
- **No voice input** yet, despite being an explicitly stated priority.
- **Email confirmation is disabled** in Supabase Auth (was turned off specifically to ease local testing, since Supabase's default confirmation link points to `localhost:3000`, which doesn't resolve in StackBlitz). **This must be reconsidered/re-enabled before any real users sign up**, or a proper redirect URL must be configured.
- **Production deployment now live** on Vercel (`https://boomer-app-2-eight.vercel.app/`), auto-deploying from GitHub `main` — resolved as of 2026-07-15 (see Section 3, Section 9).
- **`search`, `chat`, and `update-moment` Edge Functions may be stale/out of sync** with the improvements made to `converse` (date reasoning, last-name matching, relevant_people-mentions-everyone, graceful "nothing found" handling, etc.) since those fixes were applied to `converse` but not necessarily backported. `chat` is now fully unused by the frontend (`AddAMoment.tsx` was removed) and is a candidate for deletion rather than backporting; `update-moment` is still used by `PersonDetail.tsx`'s fact bar via `UpdateMomentChat.tsx`.
- **No error boundaries existed anywhere until 2026-07-15** — a crash in any one page used to blank the entire app with zero on-screen feedback. A generic `ErrorBoundary` now wraps each tab (see Section 4, Section 9), but it only shows a raw error message/stack trace, which is fine for debugging but not something a non-technical end user should ever actually see — worth designing a friendlier fallback before this goes to real users.
- **AI conversation quality (depth of follow-up questions) is an acknowledged ongoing weakness**, not a solved problem — expect the founder to keep raising this.
- **No automated tests exist.** All verification so far has been manual, click-through testing by the founder in the StackBlitz preview.
- **UUIDs in the demo seed-data SQL were handwritten/generated by the assistant for demo purposes** (e.g. `10000000-0000-0000-0000-000000000001`) — these are NOT how real user data will look; don't assume production IDs follow any particular pattern.
- **`add-fact`, `update-moment`, `chat`, and `search` likely have the same silent-failure pattern that `converse` had** (see Section 9's stale-session bug) — none of them have been audited to confirm they check for a missing/unauthenticated user before writing, or check `.error` on inserts. Only `converse` has been fixed so far. Worth auditing the others before relying on them, especially `update-moment` and `add-fact` since they're still actively used.
- **Home's conversation thread is lost when you switch tabs.** `Home.tsx` keeps its chat history in local component state, and `App.tsx` unmounts `Home` entirely when you navigate to another tab, so an in-progress conversation (including one where the AI just asked a follow-up question before saving) resets to empty if you leave and come back. Noticed 2026-07-15 while testing group tagging; not fixed, just flagging it as a real UX gap.

## 11. Things a Future AI Assistant Must Understand Before Changing This Code

1. **The founder is a genuine coding beginner.** Explanations should stay in plain, jargon-light language. Don't assume familiarity with git, npm, TypeScript, or general dev workflows — but they've now picked up a fair amount through this process (they can read a file tree, run terminal commands when told exactly what to type, and understand the shape of the architecture at a conceptual level).
2. **Check in before major/architectural decisions**, don't just build silently — this has been the working pattern throughout, and deviating from it (building something significant without confirming direction first) would be inconsistent with how this project has been run.
3. **`converse` is the living, central piece of the whole app.** Almost all product intelligence lives in its system prompt and its JSON response-handling logic. Future feature work will very likely mean extending this function's prompt/schema rather than building something parallel to it.
4. **Prefer whole-file replacement over incremental patching once a file is complex**, per the lessons in Section 9 — this codebase has a track record of incremental-edit bugs (duplicate declarations, typos from partial pastes).
5. **The data model favors flexibility (jsonb, free-text dates) over rigid structure**, by deliberate choice, in service of AI-driven conversational search being the primary way data is consumed — don't "clean this up" into strict typed columns without checking whether that trade-off is still wanted.
6. **Nothing here has been production-hardened.** Auth email confirmation is off, there's no deployed hosting, and there are no tests. Treat this as a working prototype/demo, not a production system, unless told otherwise.
7. **The demo data (John & Jane Doe persona) is fake/seed data for demonstration purposes only** — don't confuse it with real user data, and don't assume its patterns (fixed hand-written UUIDs, uniform note counts, etc.) reflect how real usage will look.
8. **See `CLAUDE.md` in the repo root for standing workflow permissions** — as of 2026-07-15, the founder has explicitly asked for verified changes to be committed and pushed to `main` (which auto-deploys to production) without asking each time, and for this document to be kept up to date without being asked. This does not relax the "check in before major/architectural decisions" rule above — it's specifically about not needing manual sign-off on routine follow-through once work is done and verified.

---

_End of document. Update this file as the project progresses — it's meant to be the single source of truth for anyone (human or AI) picking this project up._
