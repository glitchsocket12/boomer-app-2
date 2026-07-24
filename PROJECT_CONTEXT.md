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
│   ├── people.ts              — sortByLastName
│   ├── groupTypes.ts          — GROUP_TYPES fixed list (Family/Friend group/School/
│   │                            Team/Work), shared by Groups.tsx + GroupDetail.tsx
│   ├── relationshipsTable.ts  — browser-side upsertRelationship/getRelationshipsForPerson
│   │                            against the `relationships` table (mirrors the Deno copy in
│   │                            supabase/functions/_shared/)
│   ├── writeRelationship.ts   — linkRelationship/createAndLinkRelationship: the shared "+"
│   │                            write path (relationships table row + both-sides reciprocal
│   │                            note) used by Circle.tsx and FamilyTree.tsx
│   ├── familyTree.ts          — buildFamilyTree(personId): walks the relationships table
│   │                            (one full-table fetch, then in-memory graph walk) into the
│   │                            tiers/branches FamilyTree.tsx renders
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
│   └── ensureSelfFromSignup.ts — (2026-07-22) turns sign-up's auth user_metadata
│                                (first_name/last_name/birthday) into a real self `people`
│                                row + Birthday `reminders` row, so a new signup skips
│                                Circle.tsx's "which profile is you?" onboarding. Called
│                                from App.tsx's `onAuthStateChange` on the `SIGNED_IN`
│                                event only (not the initial session restore, so it isn't
│                                re-run on every page load). No-ops safely: does nothing
│                                if `first_name` is absent (pre-2026-07-22 accounts, or
│                                login rather than signup) or if a self person already
│                                exists (checked before inserting — verified live against
│                                the real `jakevolin@gmail.com` account that this correctly
│                                skips rather than creating a duplicate). Errors are
│                                logged, never thrown — worst case a new user just falls
│                                through to the existing manual onboarding screen.
├── pages/
│   ├── Landing.tsx            — public marketing page (2026-07-22), now what `!session`
│   │                            renders in App.tsx instead of bare Login.tsx: single
│   │                            scrolling page (What is Boomer? / Not another social
│   │                            network incl. a Boomer-vs-social-media/journaling-apps/
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
│   │                            Nav "Boomer" wordmark is now a button that smooth-scrolls
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
│   ├── Login.tsx              — combined sign up / log in. Takes `initialSignUp` (which
│   │                            tile/button was clicked sets the starting mode) and
│   │                            `onBack` (returns to Landing) props, both
│   │                            optional/undefined-safe so existing callers don't break.
│   │                            `onBack` is now wired to a sticky top nav bar with a
│   │                            clickable "Boomer" wordmark (2026-07-22, matches
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
│   │                            group membership); final handoff regenerates
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
│   │                            fact bar, 2026-07-20).
│   ├── People.tsx             — list + search, sort dropdown, count; manual "add
│   │                            person" (blank shell, no form, 2026-07-20 — matches
│   │                            the Events/Groups add pattern) → lands on its profile
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
│   ├── Groups.tsx             — group tiles (summary, ≤5 member chips, event chips,
│   │                            type badge); manual "add group" (blank shell, no
│   │                            form, 2026-07-20) → lands on its detail page to
│   │                            rename via the pencil; type filter dropdown
│   │                            (All/No type/Family/Friend group/School/Team/Work,
│   │                            2026-07-20)
│   ├── GroupDetail.tsx        — "Generate this family's tree →" button on Family-typed
│   │                            groups (item 41), passes explicit member ids straight through
│   │                            to FamilyTree.tsx (`memberIds` prop) which calls
│   │                            `buildDescendantTree()` (familyTree.ts) — scoped to that
│   │                            group's own lineage, not any one member's ego graph.
│   │                            `pickFamilyTreeRoot()` removed 2026-07-21 (superseded by this).
│   │                            group type picker (fixed 5-option dropdown, nullable,
│   │                            writes on change, 2026-07-20), summary + refresh (rename now invalidates the cached
│   │                            summary too, not just membership changes — a manually-
│   │                            created group's summary can otherwise stay generated
│   │                            against the "New group" placeholder forever), members
│   │                            (explicit only, sorted, collapsible >12, hover-remove),
│   │                            suggestions (from events + associated groups, capped
│   │                            20, add/deny all), Associated Groups (confirmed +
│   │                            suggested + manual picker), notes section, edit chat,
│   │                            delete group
│   ├── Events.tsx             — all moments, sorted by event_date (fallback
│   │                            created_at), "Month Year" format, grouped under
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
│   │                            yet) → `ManageTags.tsx`
│   ├── EventDetail.tsx        — AI summary (gated: only auto-generates once
│   │                            raw_description has content), editable description,
│   │                            who-was-there (hover-untag, non-destructive) +
│   │                            search-and-add picker, suggested attendees from
│   │                            group rosters, Affiliated Groups (hover-untag,
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
│   │                            tag was created
│   ├── DunbarDetail.tsx       — Dunbar's-number explainer + tier progress bars
│   ├── DueForUpdate.tsx       — people sorted oldest/no note first
│   ├── ManageTags.tsx         — (item 28 follow-up, 2026-07-22) reached via "Manage
│   │                            tags →" link on Events.tsx (App.tsx `manageTags`
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
│   │                             one (lands on its PersonDetail to name it). Reached
│   │                             via "My page" in the top bar
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
│                                 people (deleted after). Grandparents tier also pulls in
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
│                                 then climbs one hop up wherever 2+ picked founders turn out to
│                                 share a parent who wasn't tagged into the group themselves,
│                                 unifying siblings under that shared parent instead of showing
│                                 them as disconnected branches. Verified live: The Berzins' group
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
the container.
│   ├── SettingsPage.tsx        — (2026-07-23, items 22/49) reached via "Settings" button next
│   │                            to Log out (App.tsx `settings` crumb). Account + AI settings
│   │                            only, not app-navigation shortcuts (a "My page" link was cut
│   │                            for that reason). Email/password change via
│   │                            `supabase.auth.updateUser()`; chat-tone picker (4 presets,
│   │                            `user_settings` table) upserts on click, same shape as
│   │                            `home_suggestions`; links to About/Privacy
│   ├── About.tsx               — (2026-07-23) placeholder page reached from Settings — real
│   │                            copy (item 23's "I don't want it to be bullshit" honesty ask)
│   │                            still to be drafted with the founder
│   └── Privacy.tsx             — (2026-07-23) placeholder page reached from Settings — real
│                                privacy/data policy still to be drafted with the founder, not
│                                invented unilaterally
├── components/
│   ├── RelationshipAddPicker.tsx — real "add a relative" affordance shared by Circle.tsx/
│   │                              FamilyTree.tsx (replaced MockAddPicker.tsx 2026-07-20):
│   │                              search everyone on file, or type a name that matches no
│   │                              one to create a brand-new person, both wired through
│   │                              writeRelationship.ts. Enter-to-submit (2026-07-22, founder
│   │                              ask — clicking felt too hands-on): wrapped in a `<form>`,
│   │                              Enter commits the typed name (exact match selects the
│   │                              existing person, otherwise creates new), same outcome as
│   │                              clicking either option.
│   ├── ErrorBoundary.tsx      — per-tab crash containment; friendly fallback
│   │                            (reload button, raw error tucked behind a
│   │                            "Technical details" toggle)
│   ├── UpdateMomentChat.tsx   — event "add detail" chat → `update-moment`
│   ├── UpdateGroupChat.tsx    — group edit chat → `update-group`
│   ├── VoiceInputButton.tsx   — mic → `transcribe`; renders null w/o MediaRecorder
│   ├── AutoGrowTextarea.tsx   — grows to 160px then scrolls; Enter sends
│   ├── PhotoGallery.tsx       — DISPLAY-ONLY placeholder tiles (no real photos)
│   ├── RefreshButton.tsx      — spinning refresh icon
│   ├── SearchBox.tsx          — client-side list filter. Optional `onFocus`/`onBlur`
│   │                            props (item 28 follow-up, 2026-07-22, additive)
│   │                            passed straight through to the input, so a picker
│   │                            built on top can react to focus state
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
│   ├── Chips.tsx              — PersonChip (green) / GroupChip (gold) / EventChip
│   │                            (blue) — shared visual language everywhere
│   ├── EditButton.tsx         — pencil rename control (Event/Group headings)
│   ├── Breadcrumb.tsx         — trail for App.tsx's navStack
│   ├── RelationshipSuggestions.tsx — shared suggestion-banner UI (all 4 surfaces)
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

Every page listed above under `pages/` (Home/People/PersonDetail/Groups/GroupDetail/Events/EventDetail/FamilyTree) is split into a data-fetching container plus a pure, exported `*View` component (2026-07-23) — `src/pages/demo/` (`DemoShell.tsx` + a one-time `DemoIntro.tsx` welcome walkthrough + 8 thin containers) and `src/lib/demoData.ts` (a fictional "Gary Pemberton" persona, zero real data, zero API calls) feed that same static data into each real `*View` for the public landing-page demo (see §7's "See a live demo"), so a future UX edit to any of those `*View`s updates the demo automatically.

`src/pages/demo/DemoIntro.tsx` (2026-07-23, founder feedback — a first-time visitor dropped straight into a populated fake account had zero context): full-screen 5-step reading sequence (own `Stage`/dot pattern mirroring Onboarding.tsx's, DemoShell's own color palette) shown once per `DemoShell` mount, before the tab nav — Welcome, then one pain-point-framed paragraph each for Home/People/Events/Groups, referencing real Gary Pemberton specifics. Skip on every step. Plain `useState` in `DemoShell` (`introSeen`), no persistence — `DemoShell` fully unmounts on "Exit demo," so re-entering shows the intro again by design.

`App.tsx` is the traffic controller: auth state, first-run onboarding gate (`onboardingPending`/`checkOnboarding()` — see Onboarding.tsx above), tab nav (Home/People/Events/Groups), a generic `navStack: Crumb[]` breadcrumb stack any page can push person/group/event crumbs onto, persisted to sessionStorage (`boomer-nav`) so refresh stays put. Voice input + AutoGrowTextarea are on every conversational text box (Home, event chat, group chat, fact bar). `authView` (`'landing' | 'login' | 'signup' | 'demo'`) also gates `DemoShell` in when `!session`. **Address bar now mirrors `{view, navStack}`** (2026-07-23, founder-requested — the URL used to never change while clicking through the app): `buildPath()`/`parseNavFromPath()` turn it into `/:tab` or chained `/:crumbType/:crumbId` segments. Deliberately the LIGHTWEIGHT of two options offered (the other being a full router-library rebuild) — no new dependency, sessionStorage stays the full-fidelity same-tab-refresh mechanism (real labels/memberIds); `history.state` carries the same full-fidelity payload for Back/Forward (`popstate` reads it directly, no lossy re-parsing needed in-session); `parseNavFromPath()` is only a fallback for a fresh tab/pasted link with neither sessionStorage nor `history.state` available — it reconstructs the right page (every detail page re-fetches by id anyway) but breadcrumb/back-button TEXT falls back to showing the raw id instead of a real name in that one lossy case. Not real client-side routing — no route-level code splitting, no deep architecture change, verified live (forward nav, browser Back, browser Forward, hard reload, and the no-sessionStorage fallback all confirmed working against the real account).

## 4. Edge Functions (`supabase/functions/`)

| Function | Purpose |
|---|---|
| `converse` | **The main unified brain** (Home). Per turn decides: answer question / capture new moment(s — `moments` array, multiple per turn supported) / update moment / rename placeholder / name+nickname corrections / create+tag groups / create+tag tags / relationship signals / logs recall attempts to `search_log`. AI-suggested tags (item 28, 2026-07-22): each moment entry's `moment_tags: string[]` is resolved via `findOrCreateTagId()` — the same find-by-name-or-create pattern as `moment_groups`/`findOrCreateGroupId`, capped at 1-3 tags per moment with an explicit "prefer reusing an existing tag over coining a near-duplicate" instruction (both live in the fully-static `stableInstructions` tier, so this cost nothing extra to cache; the tags roster itself lives in the 1-hour roster tier alongside the groups roster). `update-moment`'s `add_tags` deliberately NOT added yet (see §8 item 28 — holding the AI surface to one entry point until real usage confirms the vocabulary stays clean). Knows the self person (`is_self`) and their known relationships (`_shared/selfContext.ts`) so "my mom"/"my parents" resolve without a named subject (2026-07-20). Chat-tone preference (2026-07-23, items 22/49): `_shared/userSettings.ts`'s `buildChatToneInstruction` reads `user_settings.chat_tone` and appends one of 4 fixed instruction sentences to the roster tier, right after `selfInstruction` — never the stable tier. Quirk: model occasionally replies in prose instead of the JSON envelope — falls back to showing that prose as the reply. |
| `add-fact` | Classifies fact-bar text: name/nickname update, birthday/anniversary (upserts `reminders`), or plain note. Group inference (`group_signal`, high=auto/medium=ask). Relationship handling via `_shared/relationships.ts`. A fact typed on the self profile's own page already resolves "my X" correctly with no special-casing (the subject is always whichever profile is being viewed). |
| `update-moment` | Event chat. Saves per turn (not on "done"), has full people+events rosters, `moment_field_updates` (when/where/title), `add_groups`, relationship signals, self-person "my X" resolution (2026-07-20). |
| `update-group` | Group chat: rename, members, tag/untag events, member facts (tagged `source_group_id`), relationship signals, self-person "my X" resolution (2026-07-20). Saves per turn. |
| `person-facts` | Extracts Key Facts from a person's notes — explicitly stated only, never inferred. Cached in `people.key_facts`; `{refresh: true}` regenerates. Failure paths return cached facts, never wipe. Linked categories (spouse/siblings/parents/kids) resolve to person chips on exact-full-name match OR a `relationships` table row (2026-07-20, additive — never overrides an AI-extracted fact, just fills in a linked person the table already knows about). Has its OWN category vocabulary (not the shared 5-kind enum — known mismatch, read-only so harmless). |
| `summarize-group` | One-sentence group description → cached `groups.summary`. Members = explicit roster only, never event attendees. |
| `summarize-moment` | 2-4 sentence first-person event summary → cached `moments.summary`. Cleared/regenerated when notes change. |
| `suggest-prompts` | 3 suggestion cards for Home → cached in `home_suggestions` table; regenerates only when data is newer than cache or on manual refresh. |
| `transcribe` | Whisper speech-to-text. |

**Shared module** `_shared/relationships.ts`: the 5 relationship kinds (spouse/sibling/parent/child/partner), reciprocal notes written on BOTH sides (`INVERSE_RELATIONSHIP` map — incl. when a suggestion banner is confirmed, not just an immediate confident match, fixed 2026-07-20), dedupe on an EXACT match against the deterministic note text (not a loose name+keyword heuristic — the loose version used to false-positive on the SUBJECT's own original sentence and silently block their own reciprocal note, fixed 2026-07-20, see PROJECT_HISTORY §13), confident-match = name-as-typed exactly equals full name on file (else a suggest-don't-assert banner), siblings named together in one signal also link to EACH OTHER not just to the subject (direct write when confident, exact-full-name lookup at confirm-time otherwise — 2026-07-20), shared-parent inference suggestions, last-name inference for people created from relationship mentions (`inferLastNameFromSignals`, also called by the direct `new_people`/`add_people` creation paths). Every confident/pairwise note write here now ALSO dual-writes the matching row into the `relationships` table (2026-07-20, via `_shared/relationshipsTable.ts`'s `upsertRelationship` — takes a `userId` param now). Used by `converse`/`add-fact`/`update-moment`/`update-group` so relationship behavior is identical at all four entry points. `chat` and `search` functions were deleted 2026-07-19 (superseded by `converse`).

**Shared module** `_shared/relationshipsTable.ts` (2026-07-20): the `relationships` table read/write layer — `upsertRelationship` (spouse/sibling/partner symmetric & normalized a<b by id sort; `parent` directional, not normalized) and `getRelationshipsForPerson` (all of one person's links, either side of a row, in one shape). Mirrored on the frontend at `src/lib/relationshipsTable.ts` (Deno can't import across the Vite boundary) — keep both in sync if the table shape changes. `_shared/selfContext.ts`: `findSelfPerson`/`buildSelfInstruction` — builds the "my mom/dad" instruction paragraph for `converse`/`update-moment`/`update-group`, appended to each function's own DYNAMIC per-user tier (never the stable tier — the self person's name/relationships are per-user data and would otherwise bust the globally-shared stable-instructions cache).

## 5. AI cost & caching architecture (see CLAUDE.md rule 3 — non-negotiable)

- **DB-cached outputs** (generate once, serve from a column, refresh on data change or manual button): `people.key_facts`, `groups.summary`, `moments.summary`, `home_suggestions`. Never re-call the API for unchanged content.
- **Prompt caching, tiered by volatility (restructured 2026-07-20):** `converse`/`update-moment`/`update-group` each split their system prompt into ordered tiers, stable-to-volatile, each its own `cache_control` breakpoint: fully-static instructions (zero interpolated data) → a roster tier (people/groups/other-items — changes rarely, 1-hour TTL) → a hot-write tier (moments for `converse`; this-item's-own-state for `update-moment`/`update-group` — default 5-minute TTL) → today's date last, uncached (previously sat at the FRONT of one combined block and busted the whole thing daily). `add-fact`/`person-facts` also cache-marked. `summarize-group`/`summarize-moment` deliberately have NO markers (under the ~1024-token minimum — nothing to gain).
- **Every roster/moment query in these functions has an explicit `.order()`** — Postgres row order is otherwise nondeterministic and silently busts the cache-prefix match. Removing one kills caching with no error.
- Verify with `usage.cache_read_input_tokens` in responses when touching this code (confirmed nonzero live 2026-07-19; the 2026-07-20 redeploy is confirmed live via §10's 401 check — re-verify the usage field itself next time real chat traffic hits it).
- **Conversation thread also cached (2026-07-20):** `_shared/promptCache.ts`'s `withMessageCacheBreakpoint` adds a `cache_control` marker to the last message in `messages` — the 4th and final breakpoint in each function (max 4/request) — so the growing back-and-forth itself gets cached too, not just the archive/roster tiers above. Previously the system-prompt tiers could hit cache while the whole message thread still re-paid full price every turn.
- **Relationship-extraction fanout, reduced 2026-07-20 (not eliminated):** `_shared/relationships.ts`'s `getRelationNames` now memoizes each person's parent/sibling extraction within one request (previously re-derived the SUBJECT's own list from scratch on every sibling compared against it) and checks `people.key_facts` before ever making a fresh Claude call, falling back to a live call only when Key Facts are empty/missing for that person. Cuts the ~12-call worst case when many siblings/parents are named at once; doesn't remove the ceiling. See PROJECT_HISTORY §14.

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
              "other" additionally writes a "Goes by X." note. key_facts jsonb?,
              key_facts_updated_at?, is_self bool (default false, partial unique
              index per user_id — at most one "this is me" profile; excluded from
              People list/search/Dunbar/due-for-update, 2026-07-20), created_at
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
groups        id, user_id, name, summary? (AI cache), group_type? (Family/Friend
              group/School/Team/Work, nullable, fixed picker, CHECK-constrained),
              dismissed_person_ids jsonb [], dismissed_group_ids jsonb [], created_at
person_groups person_id + group_id (PK) — THE definition of membership (explicit
              only; event attendees are never members, only suggestions)
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
```

`dismissed_*` columns only filter suggestion lists; conversational writes never consult them, so a denied person can still be added by name in chat.

## 7. What's built (all live unless noted in §10)

- **Auth:** sign up / log in. Email confirmation DISABLED for testing — must re-enable before real users.
- **Home:** continuous chat (answer/capture/update/correct/group-tag per turn, multiple events per message, never dead-ends — suggests close matches or asks); clickable person/event/group chips on replies with canonical spellings; cached suggestion cards (tap = starts a real conversation); dashboard (People/Events/Groups/Notes counts — People/Events/Groups tiles clickable → jump to that tab, 2026-07-20; Notes tile has no page to link to, Dunbar card → DunbarDetail, Recall-assists card, monthly leaderboard → DueForUpdate). Known gap: the chat thread lives in component state — switching tabs loses it.
- **People:** manual "add person" is a no-form blank shell (2026-07-20, matches Events/Groups — was a first+last form before), search (incl. nicknames, middle name, and goes-by "other" name), 5 sort options, count in heading. List cards always show the legal first/last name (never the profile page's "goes by" display name).
- **Person profile:** Key Facts (cached, ordered Parents→Spouse→Siblings→Children, exact-match chips), missing-category nudges, notes with hover edit/delete + source labels ("Added through: {event}" / "From: {Group}" / "From Home"), name-edit pencil (first/middle/last name fields + a "Goes by" dropdown picking which of first/middle/last/a typed "other" name displays as the person's name on this page, 2026-07-22 — replaces the name shown in the heading/breadcrumb/nudges outright, e.g. "Maverick Whitfield", not a subtitle; "other" also writes a "Goes by X." note) plus fact bar (AI-classified, still the only path for nickname/birthday/anniversary), Associated Groups hover-untag + search-and-add picker (2026-07-20, matches EventDetail's Affiliated Groups — was read-only before), relationship + new-person + shared-parent + last-name suggestion banners, delete/merge profile (the SEARCHED-FOR record survives; merged-away names fold into nicknames; dependents notes/reminders/person_groups deleted and awaited before the person row, 2026-07-21 fix — matches GroupDetail's delete ordering, prevents an intermittent FK race).
- **Groups:** created conversationally OR via manual "add group" (blank shell, no form, 2026-07-20 — recurring affiliations, school/team/unit/workplace/circle, never one-off events); tiles with summary + capped chips; detail page per §3; membership = explicit only; suggestions from event attendance + associated-group rosters; symmetric confirmed group associations; whole-group delete (2026-07-20, the safety net the manual button needed — groups have no dedupe-by-name check the way `converse` does); **Group Types** (2026-07-20): fixed picker (Family/Friend group/School/Team/Work) on GroupDetail, nullable — sets `group_type` instantly, no save button; Groups page has a type filter dropdown + a badge on typed tiles. Manual "add group" now also adds the self person as a member (2026-07-20 fix — previously a group you created yourself, e.g. your own Family group, wouldn't show on "My page" since you weren't in its roster).
- **Events:** browsable, sorted by real-date guess; detail per §3; AI summary regenerates on new detail (only once there's a description to summarize); delete/merge (searched-for survives; dependents notes/moment_groups deleted and awaited before the moment row, 2026-07-21 fix, same reasoning as PersonDetail above); group tagging + attendee tagging via chat OR direct search-and-add pickers on the event page (2026-07-20); manual "add event" button (2026-07-20) creates a blank shell and drops straight onto its detail page to build up from there — same "step by step" idea as manual "add person," extended to events/groups.
- **Voice input** on every text box (record → Whisper → text dropped in for review, never auto-sends; no live captions — batch only). **Auto-grow textareas** everywhere.
- **Cross-navigation:** any person/group/event mention anywhere is a chip → detail page, with breadcrumb trail; refresh restores location (sessionStorage). `pushCrumb` (App.tsx) collapses the trail back to a page's existing position if it's already in the stack (2026-07-23 fix), so repeat clicks / back-and-forth navigation don't grow the breadcrumb unboundedly. Address bar mirrors location via `buildPath`/`parseNavFromPath` (App.tsx): Home is `/home` (2026-07-23 fix, was bare `/`); fixed singleton pages (circle/settings/about/privacy/dunbar/nudges/manageTags) get one URL segment each, e.g. `/circle`, not `/circle/circle` (2026-07-23 fix). On `SIGNED_OUT`, nav state/sessionStorage/URL all reset to `/` (2026-07-23 fix) — previously the address bar kept showing the last authenticated page after logout. **`vercel.json`** (added 2026-07-23) rewrites all paths to `/index.html` — without it, Vercel had no static route for `/home`, `/circle`, `/person/:id`, etc., so any refresh or direct link to those addressed-bar paths 404'd (only bare `/` ever worked, since it's the real index file). Login/Signup/Demo/Onboarding never push a URL at all (guarded by `if (!session) return`), so they don't 404 — refreshing on them just silently drops back to `/` → Landing, a separate pre-existing quirk, not fixed here.
- **Search boxes** on People/Events/Groups (client-side).
- **"My page" + real family tree + relationships table** (item 32, 2026-07-20 — see §3/§4/§6): a real `is_self` flag + `relationships` table replace the note-text-only inference that used to be the sole source of family data. Circle.tsx ("My page") is real (onboarding to flag/create the self person, live circle grid, "+" writes real facts). FamilyTree.tsx works for ANY person, not just the self person, walking the relationships table live. `person-facts` Key Facts linking and `converse`/`update-moment`/`update-group`'s "my mom/dad" resolution both read the same table now — the "all work together" ask is done, not just the tree UI.
- **Event tags** (items 28 + 34, 2026-07-22 — see §3/§4/§6): manual tag/untag on EventDetail (create-or-reuse picker, browse-all-on-focus, hover-remove chip) and AI-suggested tagging via `converse` (capture-time only, capped 1-3/moment, reuse-biased), backed by new `tags`/`moment_tags` tables. Events page has a tag filter dropdown (growing from tags actually applied) plus a "Manage tags →" link to `ManageTags.tsx` for a full add/rename/delete view with usage counts. 10 generic starter tags auto-seed once per account. Alphabetical order enforced at render time everywhere tags list (picker, chips, filter, Manage Tags), independent of creation order. Verified live end-to-end against the real account, test data cleaned up after. `update-moment`'s chat-based `add_tags` and `suggest-prompts`'s tag signal deliberately deferred — see §8 item 28.
- Demo persona seed data exists ("John & Jane Doe", ~18 people/~22 moments — fake, handwritten UUIDs; don't pattern-match on it) — separate from the item below, and not used by it.
- **"See a live demo" public landing-page demo** (2026-07-23, persona reworked 2026-07-23): a "Gary Pemberton" persona (21 people, 4 groups, 34 moments spanning 2011–2026 — wholly original, no real person/IP; retired Regional Operations Manager at a fictional industrial distributor, not ex-military — the original aviation/"Squadron" framing read as generic and was replaced) hardcoded in `src/lib/demoData.ts`, click-through via `authView === 'demo'` → `DemoShell` → a one-time `DemoIntro` welcome walkthrough (see §3). Zero Supabase/Edge Function calls anywhere in the demo, by design (CLAUDE.md rule 3 — a public, unauthenticated surface must not be able to run up API cost); the Home chat is scripted (fixed prompts/replies) rather than calling `converse`. Multiple entry points on Landing.tsx now (see §3 Pass 4). Every moment carries 1-2 tags (`DEMO_TAGS`, 7 total: Sports/Milestone/Family/Reunion/Holiday/Work/Golf); the demo's Events tag filter and EventDetail tag chips work like the real app's. `DemoShell` now opens on `DemoIntro.tsx` first (see §3) — founder feedback: dropping a first-timer straight into a populated fake account with no context was "totally useless."

## 8. Backlog — MASTER LIST (founder's priority list; work order: bugs → quick wins → bigger features)

Items 1–13 (bugs + quick wins) all done 2026-07-18. Also done 2026-07-19: event delete/merge, associated groups, chat layout fix, last-name sort, note source labels, group notes. Also done: 25 (2026-07-20: sibling-group transitive linking + reciprocal-write-on-confirm fix, deployed and confirmed live — see §10); 36 (2026-07-20: manual "add an event" / "add a group" buttons, plus group delete — see §7); 35/Group Types (2026-07-20: `group_type` column + fixed picker on GroupDetail + filter/badge on Groups — see §7); **32 (2026-07-20: real `is_self` flag + `relationships` table, real "My page"/family tree, "my mom/dad" resolution — see §7, DEPLOYED and DB-migrated live, see §10)**.

**Open — bigger features:**
14. Global search bar on every page (decide: text match first vs. semantic — merges with 30).
15. **Relationship-aware smarts** umbrella — partially unblocked by item 32's `relationships` table: "resolve 'my parents'" is DONE (`converse`/`update-moment`/`update-group` all do it now). Still open: answer via family links ("Braden's dog" → spouse's note) — the table can now support this but nothing queries it for that yet; auto-suggest links from note content beyond what already exists; background relationship scanning; approval log on Home.
16. Auto-notes from chat for every person mentioned (events do this; extend everywhere).
17. Long story/voice-note handling (1–2 min recording parsed into all its facts) — chat currently chokes on long stories.
18. Real-time voice transcription (words appear as you speak; Whisper is batch-only — partial option: Web Speech captions on non-iPhone only).
19. Rules engine ("group A + group B ⇒ group C") + group hierarchy visualization.
20. Data viz: family tree, connection map.
21. Internet lookup for added context.
22. ~~Settings page~~ — **DONE 2026-07-23** (v1, see item 49 for what shipped). Of the six candidates speculated here, only chat tone/About shipped in v1; tile colors, suggestion sensitivity, and terminology library remain open (each needs new infrastructure built first — a theme layer, a suggestion-frequency concept, a centralized vocabulary module, respectively). "User's own profile/library" was considered and cut from Settings entirely — that's app navigation (already reachable via the main nav), not a setting.
23. **Security hardening** + honest About-page writeup ("I don't want it to be bullshit") — start from §10's reality, audit first.
24. Family-dynamic variety (half-/step-/adoptive) — **needs founder decision first**: (a) new relationship types vs. (b) qualifier field on the existing 5; qualifier also changes shared-parent inference (ask which parent, not both). Concretely blocks auto-linking a new spouse as a parent of the other spouse's existing kids (step-parent case) — deliberately left manual-only in item 40 pending this. Real example on file: Andy Volin (deceased) was married to Andi Volin, who's since remarried to Michael Galchinsky.
26. Ratings/thumbs feedback loop (tunes suggestions; does not retrain the model).
27. Photo gallery for real (upload/Supabase Storage/tagging; placeholder shipped). True camera-roll sync needs the native iPhone app.
28. ~~Manual + AI-suggested tags on events~~ — **DONE 2026-07-22** (schema: new `tags`/`moment_tags` tables, see §6). Manual create-or-reuse picker + hover-remove chip on EventDetail; AI-suggested via `converse` only for v1 (capped 1-3 tags/moment, reuse-biased instruction) — `update-moment`'s chat-based `add_tags` and `suggest-prompts`'s tag signal deliberately deferred until real usage confirms the vocabulary stays clean, not scope-cut for any other reason. Verified live end-to-end against the real account (manual create/reuse/persist/untag, AI auto-tag via Home chat correctly created and applied a new "vacation" tag with no manual step), test data cleaned up after. Pairs with item 34's filter, same schema change powers both. **Same-day follow-up (founder-requested):** the tag picker now browses the full alphabetical list on focus instead of requiring you to already know a tag's exact spelling (`SearchAddPicker`'s new `browseAll` prop); 10 generic starter tags auto-seed once per account (`ensureStarterTags.ts`, guarded so it can't resurrect a deliberately-emptied list); new `ManageTags.tsx` page (linked from Events) lists every tag with usage counts and lets you add/rename/delete outside the context of any one event. Verified live: starter seed fired correctly on the real account's next sign-in (10/10 inserted, left a pre-existing AI-created "Phone Calls" tag alone rather than duplicating), rename/add/delete all confirmed against real + disposable test tags, alphabetical order holds everywhere (picker, chips, filter, Manage Tags list) regardless of creation order.
29. Search within GroupDetail; People filter (criteria undecided).
30. AI/"fuzzy" semantic search (likely merges into 14).
31. **"Memory lane" curated media feed** — requested 2026-07-19. A scrollable, media-driven feed surfacing curated memories (vs. today's specific-lookup mode only); best outcome likely needs real event photos, so probably sequences after item 27 (photo gallery). Already named as a target query mode in §9's product philosophy, just not built yet.
32. ~~User's own profile~~ — **DONE 2026-07-20.** Real `is_self` flag + `relationships` table (shared source of truth for family links), real "My page" (`Circle.tsx`) + real family tree (`FamilyTree.tsx`, works for any person), `person-facts` linking and "my mom/dad" resolution both read the same table — see §3/§4/§6/§7. Full build story in PROJECT_HISTORY §15. Still-open UX questions, not yet resolved: (a) empty relationship categories on "Your circle" shown as invite-to-add vs. hidden until populated. ~~(b) a family tree for a group you're NOT a member of~~ — **RESOLVED 2026-07-21**, see item 41. ~~(c) "+" always targets a tier's first branch when a tier has more than one~~ — **FIXED 2026-07-20**, see item 37.
33. **Refer to the user as "You" instead of "User"** — requested 2026-07-19. E.g. "Your brother is Josh," "Your Mom is Amy" — more conversational/personal than the current third-person "User" phrasing. Likely pairs with item 32 once a user profile exists.
34. ~~Filterable "View" by event category on the Events page~~ — **DONE 2026-07-22.** Shipped together with item 28: a tag filter dropdown on Events.tsx, growing from distinct tags actually applied (`useMemo`, not a fixed hardcoded set, per the founder's original ask), membership-based (a moment can carry more than one tag) rather than the single-value equality Groups.tsx's type filter uses, plus a "No tags yet" option. Verified live: option list matches tags in use, filtering narrows correctly.
35. **Sub-events for multi-day events** — requested 2026-07-19, founder flagged as important. Certain events (e.g. a vacation) span multiple days and generate lots of small sub-memories; needs a way to nest those under a parent event rather than flattening everything into one event or scattering into unrelated standalone events. Adjacent to item 36's now-shipped "add event" flow — a parent-event picker would be a natural addition to that button/page later.
37. ~~Family tree bug scan~~ — **DONE 2026-07-20**, three wire-connection follow-ups **2026-07-21/22**, layout engine rewrite **2026-07-22** (item 39), same-day live-bug fix **2026-07-22**: Kids tier now also positions relative to its own parents' tier above (`layoutRelativeToParent`) instead of independently centering on the canvas — root-gen is now the only independently-laid-out tier — fixing left-clipping on wide trees and grandchildren rendering off-anchor. One reported "missing grandparent marriage line" turned out to be a real data gap (no `spouse` relationship on file), not a bug — flagged to founder, not auto-fixed. **2026-07-21 fix, confirmed live:** the root's own siblings were the one place in `familyTree.ts` still built as a bare name list with no spouse lookup — every other role (root's own spouse, aunts/uncles, cousins, kids) already attached in-law spouses. A married sibling's spouse now shows up with a marriage line too; verified against Jake's real tree (Josh Volin + Faith Volin).

38. ~~Undo a mis-added family tree relationship~~ — **DONE 2026-07-21.** Added `removeRelationship`/`unlinkRelationship` + a "Remove a relationship" control on the family tree page, scoped to the centered person's direct relations. Verified via `npm run build` + synthetic-data harness only — not yet confirmed against live data (see §10). Full story: PROJECT_HISTORY §18.

39. ~~Family tree layout engine rewrite~~ — **DONE 2026-07-22**, same day as founder-proposed. Implemented in the fresh session the founder asked for; see item 37's "Root-cause rewrite" entry for what shipped.

40. ~~Full sibling/parent clique sync~~ — **DONE 2026-07-21, deployed and DB-backfilled.** Founder-requested: adding any relationship should reciprocate across everyone it touches, not just the pair directly linked (e.g. adding a 3rd sibling to a 2-sibling group should connect all 3, and share all parents across all 3 — not just sync the new pair). Replaced the old 2-person-only `syncSiblingParents` with `syncFamilyClique` (see §6), which walks the full transitive sibling closure on every sibling or parent add — wired into both the frontend "+" picker/suggestion-banner paths AND all 4 relationship-capturing edge functions (`add-fact`, `converse`, `update-moment`, `update-group`, all redeployed same day). Verified live against Jake's real sibling group (Josh/Jake/Jess/Danny Volin): a test sibling added only to Josh correctly picked up Amy/Steve as parents AND direct sibling links to Jake/Jess/Danny; a test parent added only to that new sibling correctly propagated to all four. Spouse→parent propagation (step-parent case) explicitly excluded — see item 24. One-time SQL backfill for pre-existing data run same day (165 → 177 relationship rows).

41. ~~Family tree entry points beyond My Page~~ — **DONE 2026-07-21.** Founder-requested: see any person's tree from their own profile, and generate a Family-typed group's tree without needing to be a member yourself. `PersonDetail.tsx` now has a "View family tree →" link (any profile, not just self). `GroupDetail.tsx` now has a "Generate this family's tree →" button on `group_type === 'Family'` groups. Shipped in two passes same day: first via `pickFamilyTreeRoot()` picking a best-covering center person, then superseded within the day by a dedicated `buildDescendantTree()` (familyTree.ts, `mode: 'descendants'`) scoped to the whole group's lineage instead of one member's ego graph — `pickFamilyTreeRoot()` removed. Verified live: The Volins (21 members) → tree centers on the family's eldest known generation, correctly fanning down through all members; a non-self profile (Steve Volin) opens its own ego tree correctly.

42. ~~Family tree generation cap~~ — **DONE 2026-07-21.** Founder-reported: Harvey/Roberta's great-grandchild (Wesley Gregorian) had no section — both tree modes were hardcoded to a fixed generation window (ego mode: 2 up/1 down; descendants mode: 5 labels). Both now walk however far the relationships data actually goes in each direction (capped at 25 generations only as a cycle guard) — see §7 FamilyTree.tsx entry for the mechanism. Matters for the founder's stated use case: people using this to keep track of real family lineage, potentially recording many generations back. Verified live: Harvey Volin's tree now shows a "Great-Grandchildren" section containing Wesley Gregorian; The Volins group tree unaffected in shape, still renders correctly.
43. ~~Family tree color coding~~ — **DONE 2026-07-21.** Founder-requested: make relationships easier to read at a glance — who's centered on whom, and which side grandparents/aunts-uncles/cousins are on. See §7 FamilyTree.tsx entry for the mechanism. Deferred (founder's own call, flagged to revisit — see item 44): a gender icon per person, not bundled into this pass. Verified live against Jake Volin's tree (purple moves correctly when re-centered on a non-self person like Amy Volin; blue/rose sides span from Great-Grandparents down through cousins' kids) and The Berzins' group meta-tree (single green color, no purple, clicking any member correctly opens their own purple-centered ego tree).
44. **Gender icon on family tree tiles** — raised by founder 2026-07-21 alongside item 43, deliberately deferred (founder's call, revisit with them whether this was the right sequencing). Needs a new nullable `gender` column on `people` (Male/Female/Non-Binary/Other, always manually editable on a profile) plus a one-time hybrid auto-fill: a static first-name→gender lookup (not a live AI call — no per-view cost) sets it automatically only when confidence is ≥90%, otherwise leaves it unset for the founder to confirm. Independent of the `side`/`TreePerson` machinery item 43 shipped — the icon would render per-person on every tile (ego or group meta-tree alike), unrelated to root/purple/side logic.
45. ~~Standalone first-run onboarding experience~~ — **DONE 2026-07-22.** Full gameplan discussed and iterated with the founder before building (plan file: `gameplan-the-onboarding-experience-lexical-parrot.md`, not checked into the repo). Built on top of the founder's own same-day signup expansion (items above: name/birthday at signup, auto-created self profile). See §3 Onboarding.tsx entry for the full mechanism — full-screen, no app chrome, sequenced by connective leverage (family tree first, then a closed-ended group picker, notes/events deliberately excluded). Verified live end-to-end with a disposable test account; that test account (`onboarding.verify.test@example.com`) still needs founder cleanup via the Supabase dashboard.

**Items 46–53 came in via the click-to-comment feedback widget (§3 FeedbackWidget.tsx), founder session 2026-07-23, folded in here instead of living only in the `feedback_notes` table — marked done in the widget once captured below:**

46. Rename the Home "Notes" stat tile to "Datapoints" — founder's framing: not just a note count, but a summary across notes/contacts/events/groups meant to show how much the app is assisting memory beyond the ~150 Dunbar cap. Quick copy/label change first pass; broader "datapoints" reframing (what else counts, how it's computed) is the bigger open question.
47. Dunbar's-tiers widget on Home — show the actual names of who's in each tier ("Intimate circle 5 of 5: ...") instead of just a count, to make it feel more dynamic/personal.
48. New Calendar feature — nav button placed next to Groups; ships first as a mockup placeholder page. Auto-populates from dates already on people's profiles/events. Must be filterable by tag — founder specifically doesn't want a calendar cluttered with reminders from a two-year-old phone call.
49. ~~Add a "Settings" button next to Log out~~ — **DONE 2026-07-23.** Scoped down with the founder to account + AI settings only (email/password change, chat-tone preference) plus About and Privacy/data-policy links — explicitly not a place for app-interface shortcuts. `SettingsPage.tsx`/`About.tsx`/`Privacy.tsx` (see §3), `user_settings` table (see §6), `converse` roster-tier read (see §4/§5). About/Privacy are placeholder pages — real copy for both still needs to be drafted together with the founder, not invented unilaterally. Verified live against the founder's real account: email/tone sections render correctly, chat tone persists and visibly changes `converse` reply style (tested "direct"), password change round-tripped (changed, logged in with the new one, reverted to original) — email-change form intentionally not tested live against the real account (low-risk code path, same `supabase.auth.updateUser()` already proven for password, but founder chose not to risk it on the real login for this pass).
50. Home page engagement — founder wants the "Most reinforced this month" area (and Home generally) to prompt the user to confirm/add value back into the model: "is this person in group X?", "confirm this relationship", "suggested tags for this event." Explicitly a brainstorm ask, not a spec — related to item 15's relationship-aware smarts and item 26's ratings loop.
51. EventDetail "Affiliated Groups" section — formatting should match how Groups.tsx handles adding additional groups; currently wastes space when a moment has none. Same treatment for tags: click-to-reveal rather than always-visible. Also pick one term, "Affiliated" or "Associated" groups, and use it consistently.
52. Event dates — use an exact date when one is known instead of vague guidance text; vague text (e.g. "late February 2018") is fine specifically when no exact date exists. Flagged live on the VCIC Competition event.
53. `converse` chat voice bug — the AI writes in first person but refers to the founder in third person in the same reply, flagged live on the VCIC Competition event note. Needs an explicit voice instruction in the prompt (pairs with item 33's "You" vs "User" phrasing fix).

**Parked** (don't resurrect unprompted): automatic email reminders (table exists, nothing sends); weather metadata; iPhone Contacts import; "AI should ask deeper follow-ups" thread (feeds 17).

**Small known follow-ups:** align `person-facts`' category vocabulary with the shared 5-kind enum; nicknames stated via `update-moment`/`person-facts` paths aren't written (only lookup); Edge Function test coverage (needs Anthropic/Supabase mocks); no retroactive group backfill for pre-2026-07-15 moments.

## 9. Product & UX decisions (the standing "why")

- **iPhone app is the real end goal** — weigh iPhone Safari support in every web-API choice (this decided Whisper over Web Speech).
- Web/PWA now, not native; email over push (scope); one shared People concept under everything.
- **Talk, don't fill out forms (mostly):** most corrections/dates/nicknames are set conversationally via AI classification (the fact bar), not form fields. Exceptions, kept consistent across Person/Event/Group: rename pencils (name/title fields) and manual group/attendee tagging (search-and-add pickers), plus note edit/delete, merge/delete — these are direct-manipulation controls, not AI-classified.
- **Flexible data over rigid structure** (jsonb `details`, free-text `when_text`): great for AI-driven recall, deliberately bad for structured reporting — don't "clean up" without asking. `event_date` was an explicit founder-approved exception (AI resolves "last week" to a real date for sorting only).
- **Never silently assert an inference.** Relationship links, new people from mentions, shared parents, last names — all "suggest, don't assert" banners unless the match is exact-full-name confident. Key Facts never infer or pad. Exception (founder decision 2026-07-20): siblings named together in the same statement link directly to each other, no suggestion banner — same certainty as the stated pair, not a separate guess.
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
- ~~Bad data cleanup: wrong "Dating" notes on Gus Reynolds's/Olivia Gillingham's profiles~~ — checked live 2026-07-19, nothing to clean up; confirms the `person-facts` exact-match rule (§12 guard) is working as intended.
- ~~Remaining cleanup: test person "Zzztest CacheCheck" + test event~~ — **checked live 2026-07-20, already gone** (a People search for "Zzztest" returns no matches). Founder must have deleted it since the original note; not this session's doing.
- ~~Julia Lacy's "Wyatt" Key Fact showing as text, not a button~~ — fixed 2026-07-19, no code change; her note used a bare first name, correctly declined per the exact-full-name-match rule (§12 guard). Fixed by editing the note to the full name and letting Key Facts regenerate.
- ~~`search_log` table~~ — **confirmed live**: PostgREST returns 200 for `search_log`, `converse` returns 401 (deployed, not platform-not-found), and the production Home dashboard's "Recall assists this month" card shows a real nonzero count (4).
- **Voice mic button**: backend confirmed working; still never click-tested inside the app UI post-fix.
- ~~Cache-tiering + relationship-fanout dedupe (2026-07-20) needs deploying~~ — **deployed and confirmed live 2026-07-20** (`converse`/`update-moment`/`update-group`/`add-fact`, via `npx supabase functions deploy` with a founder-provided token; all 4 return 401, not Supabase's not-found). The same-day message-thread-caching fix (`_shared/promptCache.ts`) landed on disk before this redeploy ran, so it went out in the same batch. See PROJECT_HISTORY §14.
- ~~Sibling-linking fixes need redeploy~~ — all 3 rounds deployed and confirmed live 2026-07-20 (`add-fact`/`converse`/`update-group`/`update-moment`); Sucre and Berzins family data hand-repaired live. Full 3-bug story: PROJECT_HISTORY §13.
- ~~Database-wide scrub for the same asymmetric-relationship-note bug~~ — done 2026-07-20, found and bulk-fixed asymmetric pairs across the whole database (not just the two reported families); zero gaps remained on re-scan. Full story: PROJECT_HISTORY §13.
- **Founder cleanup needed: likely duplicate person "David" (no last name) vs. "David Adelstein"** — both have the identical single note "Married to Jill Tullman.", the signature of an accidental duplicate profile rather than two facts. Left unmerged deliberately (found during the scrub above) — merge via the app's own People search + merge-profile feature rather than guessed at.
- **Founder cleanup needed: two separate "Amy Volin" profiles exist** — found 2026-07-20 while verifying the relationships-table build (see PROJECT_HISTORY §15). Not this session's doing and not touched — merge via People search + merge-profile once confirmed which one should survive.
- ~~Founder cleanup needed: two separate "Barbara Bach" profiles exist~~ — **founder confirmed 2026-07-21 only one Barbara Bach profile exists now**; the duplicate noted 2026-07-20 (PROJECT_HISTORY §16) was either already merged or the original finding was wrong. Not the cause of the Bill/Lisa mis-wiring below.
- **Founder cleanup needed: Barbara Bach's relationships are wrong** — found 2026-07-21. On her tree, Bill shows as her father and Lisa as her sister; the real facts are Bill=husband, Lisa=daughter. Item 38's new "Remove a relationship" control (family tree page, centered on Barbara) is the tool to fix this: remove Bill-as-parent and Lisa-as-sibling, then re-add Bill as spouse and Lisa as child via the existing "+" pickers. Not done yet — needs the live app, which this session couldn't reach (see note below).
- **2026-07-21/22 family tree fixes (items 37/38) not verified against live data** — this session had no Supabase credentials (no `.env` in the remote container), so it couldn't load Jake's real tree. All verified instead with `npm run build` and temporary synthetic-data harnesses (deleted before commit) shaped like the reported bugs, rendered through the real code and screenshotted in-browser. Worth a live click-through against the real account to confirm, and to actually fix Barbara/Bill/Lisa per the item above. **Verification lesson (founder-caught 2026-07-22):** checking only the tree centered on the self/root person isn't enough — a fix can look right from one person's view and still be wrong (or just visually ambiguous) from someone else's, since being centered on a different person changes who's a "direct" relation vs. an "extended" one/how tiers stack. Click into a few other people's own tree views too, not just the one that was reported broken.
- **Possible second cause for a "wrong wire" report, not yet ruled out**: on Jake's tree, David/Laura's wire was reported connecting to Jake + his sibling instead of down to Noah/Aaron. The 2026-07-22 bar-extension fix (item 37) plausibly explains this on its own — but if it's still wrong after that deploys, check whether David or Laura is *also* recorded as one of Jake's own parents (same bad-data pattern as Barbara/Bill/Lisa above); fixable with item 38's "Remove a relationship" tool, no code change needed.
- **How bad relationship data can appear without touching the family tree page**: confirmed 2026-07-22 — `add-fact`, `converse`, `update-moment`, and `update-group` all call `_shared/relationships.ts`'s `applyFamilySignals`, which writes directly to the `relationships` table (plus reciprocal notes) with **no confirmation banner**, whenever the AI extracts a spouse/sibling/parent/child/partner signal naming someone whose full name matches *exactly* one person on file (deliberate founder-approved exception to "suggest, don't assert" — siblings named together link with no banner). The one concrete risk: if two different people share an identical full name, this "confident exact match" could resolve to the wrong one of the two — worth keeping in mind if another mis-wired relationship turns up with no clear manual cause.
- ~~Siblings now inherit shared parents (2026-07-20, see PROJECT_HISTORY §16)~~ — fixed the bug where adding a sibling via the family tree "+" picker never copied an existing sibling's parents onto the new person. **Deployed and confirmed live 2026-07-20**: frontend fix (`writeRelationship.ts`) via Vercel, edge-function mirror (`add-fact`/`converse`/`update-group`/`update-moment`) via `npx supabase functions deploy` with a founder-provided token — all 4 returned 401 (not platform-not-found) post-deploy, no Cloudflare retries needed this round.
- ~~Relationships table + `is_self` migration + 5 Edge Function redeploy (item 32, 2026-07-20)~~ — **applied and deployed live 2026-07-20** via the Management API + `npx supabase functions deploy` with a founder-provided token (`add-fact`/`converse`/`update-group`/`update-moment`/`person-facts`, 3 of the 5 needed a retry after a transient Cloudflare 502). Backfill landed 75 relationship rows from existing notes. Click-tested end-to-end (My Page onboarding/circle/`+`, family tree render + re-center + `+`) against the real `jakevolin@gmail.com` account with disposable test data, cleaned up after — see PROJECT_HISTORY §15 for the full verification story, including a self-inflicted name-collision near-miss that was fully cleaned up.
- ~~Self missing from groups created before the 2026-07-20 auto-add-self fix~~ — **backfilled 2026-07-20**: one-off script (authenticated as the real `jakevolin@gmail.com` account, RLS-respecting) added the self person to all 22 pre-existing groups that were missing them (only "Volin Family" already had self as a member). Cached group summaries were deliberately NOT invalidated by this backfill, to avoid a 22-call regeneration cost spike (CLAUDE.md rule 3) — a summary will just read as slightly stale until it's naturally refreshed.
- Email confirmation must be re-enabled (with a proper redirect URL) before real users.
- **Founder cleanup needed: disposable test account `onboarding.verify.test@example.com`** — created 2026-07-22 to verify the new onboarding experience end-to-end (signup → tree → groups → Home). Fully isolated by RLS from real data, but this session has no Supabase auth-admin access to delete it — needs removing via the dashboard.
- **Founder needs to run a SQL migration: `feedback_notes` table (item — click-to-comment feedback widget, 2026-07-22)** — `supabase/migrations_manual/2026-07-22-feedback-notes.sql`, paste into the Supabase SQL Editor. Until this runs, the widget's save silently no-ops (insert fails, swallowed) — UI flow itself is verified working (toggle/highlight/click-intercept/composer, see FeedbackWidget.tsx).
- Not production-hardened generally: no 2FA/access-control story, minimal tests.
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
- Before loosening any name-matching/confidence check, grep PROJECT_HISTORY for why it was added first — `person-facts`'s exact-full-name-match rule looks overly strict in isolation but exists specifically to stop a real false-positive (Gus/Olivia, 2026-07-19); "unambiguous in the roster" ≠ "confirmed identity," since the named person may not be in the system at all.
- Fix classes of bugs, not instances: `converse`'s siblings (`update-moment`/`update-group`) have repeatedly harbored the same bug (JSON fences, max_tokens, silent errors, missing rosters) — when one function gets a reliability fix, check them all. Same for the two independent name-resolution paths (`relationships.ts` and `person-facts`).
- **A confident match and a confirmed suggestion must write the exact same both-sides notes** — `relationships.ts`'s direct-write path did, but `RelationshipSuggestions.tsx`'s confirm handlers only ever wrote onto the newly linked/created person, never back onto the subject, until fixed 2026-07-20 (found via the Sucre-brothers inconsistent-siblings report: whichever profile the fact was typed on could end up with nothing). Any new relationship-suggestion type needs the same both-sides write, not just the "obvious" direction.
- **A "does this note already exist" dedupe check must match the EXACT deterministic text, never a loose "mentions this name + a family-shaped keyword" heuristic** — the loose version (`relationships.ts`, fixed 2026-07-20) false-positived on the SUBJECT's own original sentence (e.g. "Her siblings are Clare, Bridget, and Patrick" already contains "Clare" + the word "siblings"), silently blocking the subject from ever getting their OWN reciprocal note while everyone else correctly got theirs pointing back at them — found via the Berzins-family report, where Caroline (the one person who'd actually typed the fact) was the one left incomplete, not her siblings.
- **A `.select()` embedding a table that doesn't exist yet fails the WHOLE query, not just that one field** — adding `moment_tags(tags(...))` to Events.tsx/EventDetail.tsx's existing moments query, before the item-28 migration had been run, turned "no tags yet" into "Events page shows zero events" (PostgREST returns `data: null` for the entire row set, and the existing `?? []` fallback silently swallows that into an empty list, same silent-failure shape as the RLS guard above). Caught before push by testing directly against the live schema (`supabase.from(...).select(...)` via the browser console) rather than trusting `npm run build`, which can't see this. Any new embed on an existing, page-critical query needs the migration confirmed live FIRST — don't push code that adds a new embed until the table it joins actually exists in production.
- **Display text derived from a navigation-time prop (breadcrumb label) goes stale the moment the underlying record is renamed mid-visit** — `PersonDetail.tsx` had every nudge/fact-bar/banner string keyed off the `personName` prop instead of the freshly-loaded `person` state, invisible until the manual "add person" flow (2026-07-20) made same-visit renames the common case instead of the rare one. Any page with an in-place rename control needs its own display text to track live state, not what it was called when you navigated in.
- **A blank-shell record's cached AI summary can be generated against its placeholder name/content before it's ever filled in** — `GroupDetail.tsx`'s rename didn't invalidate the cached summary (only membership changes did), so a manually-created group (2026-07-20) could get summarized as "New group" and stay that way forever. Any manual-create-then-fill-in flow needs its rename/edit paths to invalidate the same caches the AI-driven paths already do.
