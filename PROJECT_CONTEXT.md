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
- **Address autocomplete:** Geoapify (geoapify.com — verified free tier, 3,000 req/day, no credit card; Radar was tried first but turned out enterprise/quote-only despite its docs), key in `VITE_GEOAPIFY_API_KEY` (local `.env` + Vercel project settings) — client-side calls only, no Edge Function proxy. Key not yet created — see §10.
- **Dev:** local folder, this repo. `npm run dev` (port 5173; respects `PORT` for the browser-preview tool), `npm run build`, `npm run test` (Vitest — only covers `src/lib/` pure helpers; zero Edge Function coverage).
- **Deploying Edge Functions:** `npx supabase functions deploy <name>` with a founder-provided Personal Access Token, or paste the file into the Supabase dashboard and click Deploy. `supabase/functions/_shared/` is bundled automatically.
- **Schema changes:** SQL handed to the founder to run in the SQL Editor (saved under `supabase/migrations_manual/`), or applied directly via the Management API (`POST /v1/projects/{ref}/database/query` with the same access token).
- **Google Photos import (2026-07-30, item 27):** this app's first OAuth flow and first Supabase Storage usage — see §3 `lib/googlePhotosAuth.ts`/`lib/googlePhotosImport.ts`/`PhotoImportReview.tsx`, §6 `photo_connections`/`photo_clusters`/`photos`, §10 for what's still needed before it's live. New Edge Function secrets `GOOGLE_PHOTOS_CLIENT_ID`/`GOOGLE_PHOTOS_CLIENT_SECRET` (server-side only, from a Google Cloud OAuth Client) and a new Vercel env var `VITE_GOOGLE_PHOTOS_CLIENT_ID` (the client ID itself isn't secret). A private `photos` Storage bucket holds resized (~1600px) copies, RLS-scoped per user by folder prefix — deliberate choice over leaving photos live in Google, since a picker session's access to a picked item expires with the session (no stable long-term pointer available).
- **Token-free live verification (no login needed):** a column exists if PostgREST returns 200 (400 if not, via anon key); a function is deployed if its URL returns its own error/401 rather than Supabase's `NOT_FOUND`.

## 3. Frontend map

```
src/
├── main.tsx / index.css       — entry, global styles (incl. `spin` keyframe)
├── lib/
│   ├── supabase.ts            — shared client (reads VITE_* env)
│   ├── geoapify.ts             — (2026-07-26) fetchAddressSuggestions(): thin client for
│   │                            Geoapify's Address Autocomplete API (key restricted by referrer,
│   │                            safe client-side, no proxy). Reads `VITE_GEOAPIFY_API_KEY`; returns
│   │                            [] (no error) if unset or the call fails — see §2/§10 for the
│   │                            founder's signup step.
│   ├── dates.ts               — eventSortDate/formatMonthYear (tested)
│   ├── summarize.ts           — short title helper (tested)
│   ├── people.ts              — sortByLastName
│   ├── groupTypes.ts          — GROUP_TYPES fixed list (Family/Friend group/School/
│   │                            Team/Work), shared by Groups.tsx + GroupDetail.tsx
│   ├── relationshipsTable.ts  — browser-side upsertRelationship/getRelationshipsForPerson
│   │                            against the `relationships` table (mirrors the Deno copy in
│   │                            supabase/functions/_shared/)
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
│   │                            spouse/child who isn't.
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
│   │                            deploy/run status.
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
│   │                            2026-07-20). `search`/`typeFilter` + scroll position
│   │                            are owned by App.tsx, not this component, so a trip
│   │                            into a group and back via the in-page arrow restores
│   │                            both instead of resetting (item 62, 2026-07-26).
│   │                            Creating a group no longer auto-adds the founder as a
│   │                            member (2026-07-26 — see backlog note in §10; same fix
│   │                            in Onboarding.tsx's Stage 4 group creation), and search
│   │                            excludes the founder's own name from member-name
│   │                            matching so searching your own surname only surfaces
│   │                            groups with someone ELSE by that name, or named for it
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
│   │                            source_group_id attribution over, self-links dropped)
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
│   │                            verified live 2026-07-30.
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
│   ├── EventDetail.tsx        — AI summary (gated: only auto-generates once
│   │                            raw_description has content; manual "Refresh
│   │                            summary" button, 2026-07-25, mirrors GroupDetail's
│   │                            own `RefreshButton` — lets an already-cached
│   │                            summary re-synthesize on demand, e.g. after the
│   │                            2026-07-25 chronological-ordering prompt fix),
│   │                            editable description,
│   │                            who-was-there (hover-untag, non-destructive) +
│   │                            search-and-add picker, suggested attendees from
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
│   │                            Migrated and verified live 2026-07-30.
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
labels from the graph, no new relationship kind needed. `buildFamilyTreeFromGraph` (familyTree.ts,
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
Full story: PROJECT_HISTORY.md.
│   ├── SettingsPage.tsx        — (2026-07-23, items 22/49) reached via "Settings" button next
│   │                            to Log out (App.tsx `settings` crumb). Account + AI settings
│   │                            only, not app-navigation shortcuts (a "My page" link was cut
│   │                            for that reason). Email/password change via
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
│   │                            re-overwrites a later manual choice).
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
│   └── ImportReview.tsx       — (2026-07-24, item 48; overhauled 2026-07-25) accept/reject queue
│                                for AI-extracted calendar-import candidates
│                                (`moment_import_candidates`, status=pending). Accept no longer
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
                                "Save as a note instead" button (both on the auto-suggested match
                                banner and after picking a manual merge target) writes a single
                                moment-scoped `notes` row (no person/group, `source='calendar_import'`)
                                without merging/creating/field-filling — for calendar entries that are
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
│   ├── ErrorBoundary.tsx      — per-tab crash containment; friendly fallback
│   │                            (reload button, raw error tucked behind a
│   │                            "Technical details" toggle)
│   ├── UpdateMomentChat.tsx   — event "add detail" chat → `update-moment`
│   ├── UpdateGroupChat.tsx    — group edit chat → `update-group`
│   ├── VoiceInputButton.tsx   — mic → `transcribe`; renders null w/o MediaRecorder
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
│   │                            later.
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
| `converse` | **The main unified brain** (Home). Per turn decides: answer question / capture new moment(s — `moments` array, multiple per turn supported) / update moment / rename placeholder / name+nickname corrections / create+tag groups / create+tag tags / relationship signals / logs recall attempts to `search_log`. AI-suggested tags (item 28, 2026-07-22): each moment entry's `moment_tags: string[]` is resolved via `findOrCreateTagId()` — the same find-by-name-or-create pattern as `moment_groups`/`findOrCreateGroupId`, capped at 1-3 tags per moment with an explicit "prefer reusing an existing tag over coining a near-duplicate" instruction (both live in the fully-static `stableInstructions` tier, so this cost nothing extra to cache; the tags roster itself lives in the 1-hour roster tier alongside the groups roster). `update-moment`'s `add_tags` deliberately NOT added yet (see §8 item 28 — holding the AI surface to one entry point until real usage confirms the vocabulary stays clean). Knows the self person (`is_self`) and their known relationships (`_shared/selfContext.ts`) so "my mom"/"my parents" resolve without a named subject (2026-07-20). Chat-tone preference (2026-07-23, items 22/49): `_shared/userSettings.ts`'s `buildChatToneInstruction` reads `user_settings.chat_tone` and appends one of 4 fixed instruction sentences to the roster tier, right after `selfInstruction` — never the stable tier. "Today's date" in the final uncached tier is now computed in the user's own `user_settings.time_zone` via `_shared/tz.ts` (2026-07-24, bug fix — see §12), not the Edge Function's server UTC clock. Quirk: model occasionally replies in prose instead of the JSON envelope — falls back to showing that prose as the reply. |
| `add-fact` | Classifies fact-bar text: name/nickname update, birthday/anniversary (upserts `reminders`), or plain note. Group inference (`group_signal`, high=auto/medium=ask). Relationship handling via `_shared/relationships.ts`. A fact typed on the self profile's own page already resolves "my X" correctly with no special-casing (the subject is always whichever profile is being viewed). |
| `update-moment` | Event chat. Saves per turn (not on "done"), has full people+events rosters, `moment_field_updates` (when/where/title), `add_groups`, relationship signals, self-person "my X" resolution (2026-07-20). "Today's date" is time-zone-aware, same fix/mechanism as `converse` above (2026-07-24). |
| `update-group` | Group chat: rename, members, tag/untag events, member facts (tagged `source_group_id`), relationship signals, self-person "my X" resolution (2026-07-20). Saves per turn. |
| `person-facts` | Extracts Key Facts from a person's notes — explicitly stated only, never inferred. Cached in `people.key_facts`; `{refresh: true}` regenerates. Failure paths return cached facts, never wipe. Linked categories (spouse/siblings/parents/kids) resolve to person chips on exact-full-name match OR a `relationships` table row (2026-07-20, additive — never overrides an AI-extracted fact, just fills in a linked person the table already knows about). Has its OWN category vocabulary (not the shared 5-kind enum — known mismatch, read-only so harmless). |
| `summarize-group` | One-sentence group description → cached `groups.summary`. Members = explicit roster only, never event attendees. |
| `summarize-moment` | 2-4 sentence first-person event summary → cached `moments.summary`. Cleared/regenerated when notes change, or on-demand via EventDetail's manual refresh button. Notes are ordered by `created_at` and numbered in the prompt; system prompt explicitly tells the model note order is recording order, not narrative order, and to infer real chronological order from context clues before writing (2026-07-25, fixes summaries reading in whatever jumbled order notes were recalled in). |
| `suggest-prompts` | 3 suggestion cards for Home → cached in `home_suggestions` table; regenerates only when data is newer than cache or on manual refresh. |
| `transcribe` | Whisper speech-to-text. |
| `validate-calendar-source` | Server-side reachability/format check on a pasted iCal URL (dodges browser CORS) before `calendar_sources` saves it. |
| `scan-calendar-sources` | Fetches connected calendars, parses ICS (`_shared/ics.ts`), AI-extracts/classifies via Claude (`cache_control`-tiered), matches attendees to `people`, writes `moment_import_candidates`. **Birthday sources (2026-07-26):** a `calendar_sources.source_type = 'birthdays'` row skips the AI call entirely — `processBirthdaySource` just parses each VEVENT's SUMMARY (stripping a "'s Birthday"/" Birthday" suffix) and DTSTART (month/day/plausible-year, sentinel years like 1604 nulled out), matches the name against the same `idByName` roster used for event attendees, and upserts into `birthday_import_candidates`. Zero added Anthropic cost. Manual JWT path or cron-secret path (scans every account) — see PROJECT_HISTORY.md §21. `icsDateToIsoDate()` now converts a UTC-stamped (`...Z`) DTSTART into the connecting user's own `user_settings.time_zone` before taking the calendar date (2026-07-24, bug fix — see §12); date-only and floating-local DTSTART forms are unaffected (no conversion needed, they never carried a UTC offset to begin with). Extraction prompt (2026-07-25): `suggested_tags` now explicitly checks the event title for a word matching/synonymous with an existing tag before ever coining a new one; `location` now falls back to the model's own world knowledge for a recognizable public event's real-world city (e.g. "SF Fleet Week" → San Francisco) when the calendar entry's own location is blank; new `mentioned_people` output field (names in the title/description, cross-checked server-side against the roster — see ImportReview.tsx entry in §3) and server-side group-affiliation inference (`groupsSharedByMultiple`) feeding `suggested_group_ids`. **Family-surname matching (2026-07-25, NOT YET DEPLOYED — see §10):** new `mentioned_family_names` output field (surnames referenced as a family/household unit, e.g. "Meal train for the Mojica family" → `["Mojica"]`, distinct from `mentioned_people` which explicitly excludes generic "family" references) resolves via a `last_name` lookup to EVERY person on file sharing that surname (a family invite plausibly means the whole household, unlike a single ambiguous first name), tracked separately as `familyMatchedPersonIds`. Their OWN groups are then suggested directly (`groupIdsFromFamilyMembers`, count ≥ 1) rather than requiring a second independently-resolved attendee to also share it, unlike `groupsSharedByMultiple`'s general 2+ bar — a family-name match is already a strong enough per-person signal on its own (e.g. Patrick Mojica alone, matched via "the Mojica family," is enough to suggest his real "98 FTS" group). Same AI call, no added cost. **Gotcha:** the group-affiliation queries (`person_groups`/`notes`) must be scoped via `.in("group_id"/"moment_id", <this user's own small list>)`, NOT `.in("person_id", <every person>)` — with 400+ people the person-based IN-list got long enough to silently misbehave through the Edge Function's outbound fetch (empty data, no thrown error, identical query worked fine from a browser). |

**Shared module** `_shared/relationships.ts`: the 5 relationship kinds (spouse/sibling/parent/child/partner), reciprocal notes written on BOTH sides (`INVERSE_RELATIONSHIP` map — incl. when a suggestion banner is confirmed, not just an immediate confident match, fixed 2026-07-20), dedupe on an EXACT match against the deterministic note text (not a loose name+keyword heuristic — the loose version used to false-positive on the SUBJECT's own original sentence and silently block their own reciprocal note, fixed 2026-07-20, see PROJECT_HISTORY §13), confident-match = name-as-typed exactly equals full name on file (else a suggest-don't-assert banner), siblings named together in one signal also link to EACH OTHER not just to the subject (direct write when confident, exact-full-name lookup at confirm-time otherwise — 2026-07-20), shared-parent inference suggestions, last-name inference for people created from relationship mentions (`inferLastNameFromSignals`, also called by the direct `new_people`/`add_people` creation paths). Every confident/pairwise note write here now ALSO dual-writes the matching row into the `relationships` table (2026-07-20, via `_shared/relationshipsTable.ts`'s `upsertRelationship` — takes a `userId` param now). Used by `converse`/`add-fact`/`update-moment`/`update-group` so relationship behavior is identical at all four entry points. `chat` and `search` functions were deleted 2026-07-19 (superseded by `converse`). `syncFamilyClique`/new `syncSpouseParenthood`/new `invalidateKeyFacts` (2026-07-25) mirror `src/lib/writeRelationship.ts`'s fixes exactly — see that entry (§3) for the full mechanism; **NOT YET REDEPLOYED**, see §10.

**Shared module** `_shared/relationshipsTable.ts` (2026-07-20): the `relationships` table read/write layer — `upsertRelationship` (spouse/sibling/partner symmetric & normalized a<b by id sort; `parent` directional, not normalized) and `getRelationshipsForPerson` (all of one person's links, either side of a row, in one shape). Mirrored on the frontend at `src/lib/relationshipsTable.ts` (Deno can't import across the Vite boundary) — keep both in sync if the table shape changes. `_shared/selfContext.ts`: `findSelfPerson`/`buildSelfInstruction` — builds the "my mom/dad" instruction paragraph for `converse`/`update-moment`/`update-group`, appended to each function's own DYNAMIC per-user tier (never the stable tier — the self person's name/relationships are per-user data and would otherwise bust the globally-shared stable-instructions cache).

**Shared module** `_shared/tz.ts` (2026-07-24, bug fix — see §12): `isoDateInTimeZone`/`fullDateInTimeZone` format a `Date` in a given IANA zone (via `Intl`, which ships its own tz database — no external dependency), falling back to UTC formatting if the zone string is invalid. `_shared/userSettings.ts`'s `getUserTimeZone` reads `user_settings.time_zone`, defaulting to `'UTC'` (the old always-server-time behavior) when unset. Used by `converse`/`update-moment` (their "today's date" tier) and `_shared/ics.ts`'s `icsDateToIsoDate` (a UTC-stamped calendar DTSTART).

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
              design), dismissed_person_ids jsonb [], created_at, parent_moment_id
              uuid? (item 35, 2026-07-30 — self-referencing FK, ON DELETE SET NULL,
              CHECK parent_moment_id != id; sub-events, e.g. a day of a multi-day
              vacation nested under the trip — one level deep only in the UI,
              arbitrary depth in schema, mirrors groups.parent_group_id exactly.
              Migrated live 2026-07-30)
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
reminders     id, person_id, label ("Birthday"/"Anniversary"), month, day,
              year? (2026-07-26, nullable — captured when a birthday-calendar
              import provides one; not shown in the UI yet) — no automatic
              sending exists.
groups        id, user_id, name, summary? (AI cache), group_type? (Family/Friend
              group/School/Team/Work, nullable, fixed picker, CHECK-constrained),
              dismissed_person_ids jsonb [], dismissed_group_ids jsonb [], created_at,
              suggestions_enabled bool (item 57, 2026-07-25 — per-group opt-out for the
              member-suggestion signal, read by GroupDetail.tsx and
              lib/suggestConnections.ts; migrated live 2026-07-26; default flipped
              true→false 2026-07-26 per founder feedback — not used in practice — pending
              founder SQL run, see §10), parent_group_id uuid? (item 19, 2026-07-26 —
              self-referencing FK, ON DELETE SET NULL, CHECK parent_group_id != id;
              nested subgroups, e.g. a mission under a squadron or a class year under a
              school group — one level deep only in the UI, arbitrary depth in schema;
              migrated live 2026-07-26). Subgroup membership is deliberately independent of
              the parent's — no sync trigger. One was added by mistake 2026-07-26 and removed
              same day before ever being run (contradicted this design decision). Group-picker
              labels everywhere a group gets tagged to something (EventDetail.tsx,
              ImportReview.tsx, ContactImportReview.tsx, PersonDetail.tsx) render as
              "Parent / Subgroup" via lib/groupDisplayName.ts so same-named subgroups under
              different parents (e.g. two units each with a "Pilots" subgroup) stay
              distinguishable — added 2026-07-30.
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
              across re-scans), status ('pending'/'accepted'/'rejected'), occasion?,
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

`dismissed_*` columns only filter suggestion lists; conversational writes never consult them, so a denied person can still be added by name in chat.

`platform_stats()` — one deliberate exception to "RLS on everything": a `SECURITY DEFINER` SQL function (`migrations_manual/2026-07-30-platform-stats.sql`) returning cross-account totals (people/moments/groups/notes) for the Landing page's platform databox (§3). Granted to anon/authenticated (public page, no session) — **confirmed live 2026-07-30**, real cross-account totals rendering on Landing.

## 7. What's built (all live unless noted in §10)

- **Auth:** sign up / log in. Email confirmation DISABLED for testing — must re-enable before real users.
- **Home:** continuous chat (answer/capture/update/correct/group-tag per turn, multiple events per message, never dead-ends — suggests close matches or asks); clickable person/event/group chips on replies with canonical spellings; cached suggestion cards (tap = starts a real conversation); dashboard (People/Events/Groups/Notes counts — People/Events/Groups tiles clickable → jump to that tab, 2026-07-20; Notes tile has no page to link to, Dunbar card → DunbarDetail, Recall-assists card, monthly leaderboard → DueForUpdate); "Connections to make" card (2026-07-25, free/no AI — see §3 `suggestConnections.ts`/Home.tsx entries) rotating a few "add this person to this group?" suggestions sourced from event attendance + associated-group membership. Known gap: the chat thread lives in component state — switching tabs loses it.
- **People:** manual "add person" is a no-form blank shell (2026-07-20, matches Events/Groups — was a first+last form before), search (incl. nicknames, middle name, and goes-by "other" name), 5 sort options, count in heading. List cards always show the legal first/last name (never the profile page's "goes by" display name).
- **Person profile:** Key Facts (cached, ordered Parents→Spouse→Siblings→Children, exact-match chips), missing-category nudges, notes with hover edit/delete + source labels ("Added through: {event}" / "From: {Group}" / "From Home" / "From: Contacts import"), name-edit pencil (first/middle/last name fields + a "Goes by" dropdown picking which of first/middle/last/a typed "other" name displays as the person's name on this page, 2026-07-22 — replaces the name shown in the heading/breadcrumb/nudges outright, e.g. "Maverick Whitfield", not a subtitle; "other" also writes a "Goes by X." note) plus fact bar (AI-classified, still the only path for nickname/birthday/anniversary), Associated Groups hover-untag + search-and-add picker (2026-07-20, matches EventDetail's Affiliated Groups — was read-only before), relationship + new-person + shared-parent + last-name suggestion banners, delete/merge profile (the SEARCHED-FOR record survives; merged-away names fold into nicknames; dependents notes/reminders/person_groups deleted and awaited before the person row, 2026-07-21 fix — matches GroupDetail's delete ordering, prevents an intermittent FK race).
- **Groups:** created conversationally OR via manual "add group" (blank shell, no form, 2026-07-20 — recurring affiliations, school/team/unit/workplace/circle, never one-off events); tiles with summary + capped chips; detail page per §3; membership = explicit only; suggestions from event attendance + associated-group rosters; symmetric confirmed group associations; whole-group delete (2026-07-20, the safety net the manual button needed — groups have no dedupe-by-name check the way `converse` does); **Group Types** (2026-07-20): fixed picker (Family/Friend group/School/Team/Work) on GroupDetail, nullable — sets `group_type` instantly, no save button; Groups page has a type filter dropdown + a badge on typed tiles. Manual "add group" now also adds the self person as a member (2026-07-20 fix — previously a group you created yourself, e.g. your own Family group, wouldn't show on "My page" since you weren't in its roster).
- **Events:** browsable, sorted by real-date guess; detail per §3; AI summary regenerates on new detail (only once there's a description to summarize); delete/merge (searched-for survives; dependents notes/moment_groups deleted and awaited before the moment row, 2026-07-21 fix, same reasoning as PersonDetail above); group tagging + attendee tagging via chat OR direct search-and-add pickers on the event page (2026-07-20); manual "add event" button (2026-07-20) creates a blank shell and drops straight onto its detail page to build up from there — same "step by step" idea as manual "add person," extended to events/groups. **Sub-events** (item 35, 2026-07-30, DONE, migrated and verified live): one level of nesting under a parent event, bundled/collapsible on Events.tsx, "↑ Part of X" / "+ New Sub-event" on EventDetail.tsx.
- **Voice input** on every text box (record → Whisper → text dropped in for review, never auto-sends; no live captions — batch only). **Auto-grow textareas** everywhere.
- **Cross-navigation:** any person/group/event mention anywhere is a chip → detail page, with breadcrumb trail; refresh restores location (sessionStorage). `pushCrumb` (App.tsx) collapses the trail back to a page's existing position if it's already in the stack (2026-07-23 fix), so repeat clicks / back-and-forth navigation don't grow the breadcrumb unboundedly. Address bar mirrors location via `buildPath`/`parseNavFromPath` (App.tsx): Home is `/home` (2026-07-23 fix, was bare `/`); fixed singleton pages (circle/settings/about/privacy/dunbar/nudges/manageTags) get one URL segment each, e.g. `/circle`, not `/circle/circle` (2026-07-23 fix). On `SIGNED_OUT`, nav state/sessionStorage/URL all reset to `/landing` (2026-07-23 fix, was `/`) — previously the address bar kept showing the last authenticated page after logout. **`vercel.json`** (added 2026-07-23) rewrites all paths to `/index.html` — without it, Vercel had no static route for `/home`, `/circle`, `/person/:id`, etc., so any refresh or direct link to those addressed-bar paths 404'd (only bare `/` ever worked, since it's the real index file). **Logged-out screens now have real paths too** (2026-07-23 fix): `/landing`, `/login`, `/signup`, `/demo`, and `/onboarding` — previously these never pushed a URL at all (guarded by `if (!session) return`), so refreshing on any of them silently dropped back to `/` → Landing. Login's signup/login toggle was lifted from local state into a parent-controlled prop (`isSignUp`/`onToggleMode`) so the in-form "Create an account" link keeps the URL in sync instead of silently drifting from it. The initial-mount effect only attaches `history.state` to whatever path was already loaded rather than rewriting it, since session resolves async and rewriting too early could clobber a legit authenticated deep link before login status is known.
- **Search boxes** on People/Events/Groups (client-side).
- **"My page" + real family tree + relationships table** (item 32, 2026-07-20 — see §3/§4/§6): a real `is_self` flag + `relationships` table replace the note-text-only inference that used to be the sole source of family data. Circle.tsx ("My page") is real (onboarding to flag/create the self person, live circle grid, "+" writes real facts). FamilyTree.tsx works for ANY person, not just the self person, walking the relationships table live. `person-facts` Key Facts linking and `converse`/`update-moment`/`update-group`'s "my mom/dad" resolution both read the same table now — the "all work together" ask is done, not just the tree UI.
- **Event tags** (items 28 + 34, 2026-07-22 — see §3/§4/§6): manual tag/untag on EventDetail (create-or-reuse picker, browse-all-on-focus, hover-remove chip) and AI-suggested tagging via `converse` (capture-time only, capped 1-3/moment, reuse-biased), backed by new `tags`/`moment_tags` tables. Events page has a tag filter dropdown (growing from tags actually applied) plus a "Manage tags →" link to `ManageTags.tsx` for a full add/rename/delete view with usage counts. 10 generic starter tags auto-seed once per account. Alphabetical order enforced at render time everywhere tags list (picker, chips, filter, Manage Tags), independent of creation order. Verified live end-to-end against the real account, test data cleaned up after. `update-moment`'s chat-based `add_tags` and `suggest-prompts`'s tag signal deliberately deferred — see §8 item 28.
- **Contacts import** (item 65, 2026-07-27): founder-requested, previously-parked "iPhone Contacts import" now built. vCard (.vcf) upload only (`ContactsImport.tsx`, no Storage bucket — base64-in-JSON-body, same pattern as voice upload), parsed by a hand-rolled `_shared/vcard.ts` (handles Apple's item-grouping/X-ABLabel convention for Anniversary + related-names, BDAY-no-year, multi-value TEL/EMAIL/ADR/URL). Deliberately NOT a one-shot bulk-accept: a curation step (`ContactSelection.tsx`, paginated 50/page, immediate per-row DB writes so nothing is lost mid-browse) comes before the usual accept/reject-with-matching review (`ContactImportReview.tsx`, scoped to founder-selected contacts only). Matching: exact/nickname first, then word-overlap fuzzy fallback (`_shared/nameMatch.ts`), corroborated by exact phone/email match. Accept into an existing person fills blank scalar fields and unions array fields (never overwrites/loses existing data); birthday/anniversary go through a new shared `src/lib/reminders.ts` helper into the existing `reminders` table. Business-only vCards (no personal name) are silently skipped in the parser itself. Contact photos and auto-linking Apple's related-names into the real `relationships` table are explicitly out of scope this pass (see §8 item 65). New "Contact Info" collapsible section on `PersonDetail.tsx` (own isolated query, same pattern as `gender`) makes birthday/address/phone/email/etc. manually editable on any profile too, not just importable. Verified live end-to-end against the real account (upload → skip business contact → select/skip/undo with reload-persistence confirmed → new-person accept → merge-into-existing accept with field union confirmed via direct DB read → PersonDetail rendering → re-upload dedupe) — all test data cleaned up after. **Bug fix #1 (2026-07-26):** oversized uploads (e.g. real iCloud exports with a full-res photo embedded per contact, which the parser never reads) were bloating the upload past the Edge Function's ~55MB request-size ceiling (`WORKER_RESOURCE_LIMIT`). `ContactsImport.tsx` now strips `PHOTO`/`LOGO`/`SOUND` fields client-side before base64-encoding. Confirmed fixed against a synthetic 50MB photo-laden file. **Bug fix #2 (2026-07-26, the founder's actual reported file — 2071 contacts, 518KB, no photos):** same `WORKER_RESOURCE_LIMIT` error but from CPU, not payload size — `_shared/nameMatch.ts`'s fuzzy matcher recomputed word-set/regex work from scratch for every (imported contact × existing person) pair, so importing thousands of contacts against an account with hundreds of people already on file ran millions of redundant regex/Set operations and blew the compute budget. Fixed by precomputing each person's candidate-name word-sets and normalized email/phone Sets once (`buildPersonIndex`) before the per-contact loop instead of inside it. **Deployed and confirmed live 2026-07-27** (founder-provided token) — re-tested against the founder's actual 2071-contact/518KB file that originally surfaced this bug: 2008 candidates added, 3 skipped (business-only), no error. That real file's candidates are now sitting in the founder's actual review queue (this was the founder's real data, not test data — nothing to clean up).
- Demo persona seed data exists ("John & Jane Doe", ~18 people/~22 moments — fake, handwritten UUIDs; don't pattern-match on it) — separate from the item below, and not used by it.
- **"See a live demo" public landing-page demo** (2026-07-23, persona reworked 2026-07-23; scaled up 2026-07-23): a "Gary Pemberton" persona (216 people, 4 groups, 125 moments, 298 notes, spanning 2011–2026 — wholly original, no real person/IP; retired Regional Operations Manager at a fictional industrial distributor, not ex-military — the original aviation/"Squadron" framing read as generic and was replaced) hardcoded in `src/lib/demoData.ts`, click-through via `authView === 'demo'` → `DemoShell` → a one-time `DemoIntro` welcome walkthrough (see §3, counts there now pulled live from `demoData.ts` instead of hardcoded). Zero Supabase/Edge Function calls anywhere in the demo, by design (CLAUDE.md rule 3 — a public, unauthenticated surface must not be able to run up API cost); the Home chat is scripted (fixed prompts/replies) rather than calling `converse`. Multiple entry points on Landing.tsx now (see §3 Pass 4). Every moment carries 1-2 tags (`DEMO_TAGS`, 8 total: Sports/Milestone/Family/Reunion/Holiday/Work/Golf/Catch-up); the demo's Events tag filter and EventDetail tag chips work like the real app's. `DemoShell` now opens on `DemoIntro.tsx` first (see §3) — founder feedback: dropping a first-timer straight into a populated fake account with no context was "totally useless." 2026-07-23 scale-up: `DemoEventDetail.tsx` was fabricating a generic "Was there." note per attendee instead of surfacing real `DEMO_NOTES` tied via `momentId` (real ones now take priority, placeholder only fills gaps); the original 34 moments got filled out to 2-3 tied notes each; Frank/Steve/Ray/Harold got real spouse/kid relationship edges (Pete deliberately left without, for realism); a generated long-tail roster (~180 people — coworkers/neighbors/school parents/community/extended family, deterministic name-pool generation in `demoData.ts`, most with a single note, ~90 paired with a small one-note "quick capture" event) was added on top of the hand-authored core so the roster reads like a real long-used contact list instead of a curated highlight reel.

## 8. Backlog — MASTER LIST (founder's priority list; work order: bugs → quick wins → bigger features)

Items 1–13 (bugs + quick wins) all done 2026-07-18. Also done 2026-07-19: event delete/merge, associated groups, chat layout fix, last-name sort, note source labels, group notes. Also done: 25 (2026-07-20: sibling-group transitive linking + reciprocal-write-on-confirm fix, deployed and confirmed live — see §10); 36 (2026-07-20: manual "add an event" / "add a group" buttons, plus group delete — see §7); 35/Group Types (2026-07-20: `group_type` column + fixed picker on GroupDetail + filter/badge on Groups — see §7); **32 (2026-07-20: real `is_self` flag + `relationships` table, real "My page"/family tree, "my mom/dad" resolution — see §7, DEPLOYED and DB-migrated live, see §10)**.

**Open — bigger features:**
14. Global search bar on every page (decide: text match first vs. semantic — merges with 30).
15. **Relationship-aware smarts** umbrella — partially unblocked by item 32's `relationships` table: "resolve 'my parents'" is DONE (`converse`/`update-moment`/`update-group` all do it now). **Background GROUP-connection scanning + approval log on Home — DONE 2026-07-25** (see item 50/§3 Home.tsx "Connections to make" card, `lib/suggestConnections.ts`) — deliberately scoped to group membership only (deterministic, free), not person-to-person relationship inference, to avoid a recurring AI cost on every Home visit (CLAUDE.md rule 3); a richer AI-based version remains a possible future upgrade, not built. Still open: answer via family links ("Braden's dog" → spouse's note) — the table can now support this but nothing queries it for that yet; auto-suggest links from note content beyond what already exists (person-to-person relationship scanning specifically, as opposed to the group-connection scanning now done).
16. Auto-notes from chat for every person mentioned (events do this; extend everywhere).
17. Long story/voice-note handling (1–2 min recording parsed into all its facts) — chat currently chokes on long stories.
18. Real-time voice transcription (words appear as you speak; Whisper is batch-only — partial option: Web Speech captions on non-iPhone only).
19. ~~Group hierarchy~~ — **subgroups DONE 2026-07-26, migrated and verified live.** Founder's real ask, clarified 2026-07-26: nested subgroups under an existing group (e.g. a specific mission under "22 AS", or class year/staff/role under "Wings of Blue"), each with independent membership, so events can be tagged to the specific subgroup. Shipped as a self-referencing `groups.parent_group_id` (one level deep in the UI) — see §3 GroupDetail.tsx/Groups.tsx entries and §6. Because a subgroup is just a normal `groups` row, every existing group-picker (EventDetail's "Associate a Group", ImportReview, PersonDetail's "Associated Groups") already worked on it with zero extra code, confirmed live. Still open, deliberately deferred (founder feedback 2026-07-26, given the 2026-07-26 auto-add-to-groups revert): a "rules engine" auto-deriving group C from group A + group B membership — if revisited, should suggest-and-confirm rather than silently auto-write, same as item 15's connection scanning.
20. Data viz: family tree, connection map.
21. Internet lookup for added context.
22. ~~Settings page~~ — **DONE 2026-07-23** (v1, see item 49 for what shipped). Of the six candidates speculated here, only chat tone/About shipped in v1; tile colors, suggestion sensitivity, and terminology library remain open (each needs new infrastructure built first — a theme layer, a suggestion-frequency concept, a centralized vocabulary module, respectively). "User's own profile/library" was considered and cut from Settings entirely — that's app navigation (already reachable via the main nav), not a setting.
23. **Security hardening** + honest About-page writeup ("I don't want it to be bullshit") — start from §10's reality, audit first.
24. Family-dynamic variety (half-/step-/adoptive) — **needs founder decision first**: (a) new relationship types vs. (b) qualifier field on the existing 5; qualifier also changes shared-parent inference (ask which parent, not both). Real example on file: Andy Volin (deceased) was married to Andi Volin, who's since remarried to Michael Galchinsky. **Partially superseded 2026-07-25** (see item 40 follow-up): spouse-as-co-parent auto-linking now ships, gated by a heuristic guard (skip + suggest instead when either side already has another spouse/partner on file) rather than waiting on this full qualifier-field decision — that heuristic catches the Andy/Andi/Michael shape specifically but is not the real half/step/adoptive data model this item is still tracking (e.g. it can't represent "step-parent to one sibling, blood parent to another" once the two are linked as full siblings — syncFamilyClique's existing all-parents-shared-across-the-clique behavior, unchanged, still flattens that). Still open.
26. Ratings/thumbs feedback loop (tunes suggestions; does not retrain the model).
27. ~~Photo gallery for real~~ — **BUILT 2026-07-30, not yet deployed/live (see §10)**: real import via Google Photos OAuth + Picker API (not upload — founder chose this over a raw-upload/Supabase-Storage-only approach after confirming Google's API no longer allows third-party library scanning; see PROJECT_HISTORY for the full tradeoff discussion). `EventDetail.tsx` real gallery + quick-add; `PhotoImportReview.tsx` general import with date-clustered event-matching review. Person/Group photo rollups NOT included — see item 69. True camera-roll sync still needs the native iPhone app.
28. ~~Manual + AI-suggested tags on events~~ — **DONE 2026-07-22** (schema: new `tags`/`moment_tags` tables, see §6). Manual create-or-reuse picker + hover-remove chip on EventDetail; AI-suggested via `converse` only for v1 (capped 1-3 tags/moment, reuse-biased instruction) — `update-moment`'s chat-based `add_tags` and `suggest-prompts`'s tag signal deliberately deferred until real usage confirms the vocabulary stays clean, not scope-cut for any other reason. Verified live end-to-end against the real account (manual create/reuse/persist/untag, AI auto-tag via Home chat correctly created and applied a new "vacation" tag with no manual step), test data cleaned up after. Pairs with item 34's filter, same schema change powers both. **Same-day follow-up (founder-requested):** the tag picker now browses the full alphabetical list on focus instead of requiring you to already know a tag's exact spelling (`SearchAddPicker`'s new `browseAll` prop); 10 generic starter tags auto-seed once per account (`ensureStarterTags.ts`, guarded so it can't resurrect a deliberately-emptied list); new `ManageTags.tsx` page (linked from Events) lists every tag with usage counts and lets you add/rename/delete outside the context of any one event. Verified live: starter seed fired correctly on the real account's next sign-in (10/10 inserted, left a pre-existing AI-created "Phone Calls" tag alone rather than duplicating), rename/add/delete all confirmed against real + disposable test tags, alphabetical order holds everywhere (picker, chips, filter, Manage Tags list) regardless of creation order.
29. ~~Search within GroupDetail~~ — **DONE 2026-07-26.** `GroupDetail.tsx`'s member list gets a `SearchBox` (same component/pattern as `People.tsx`) once a group has more than 12 members; filters by name, doesn't affect the "show all" expansion. People page's own filter already existed (`People.tsx` `filterPeople`) — no separate work needed there.
30. AI/"fuzzy" semantic search (likely merges into 14).
31. **"Memory lane" curated media feed** — requested 2026-07-19. A scrollable, media-driven feed surfacing curated memories (vs. today's specific-lookup mode only); best outcome likely needs real event photos, so probably sequences after item 27 (photo gallery). Already named as a target query mode in §9's product philosophy, just not built yet.
32. ~~User's own profile~~ — **DONE 2026-07-20.** Real `is_self` flag + `relationships` table (shared source of truth for family links), real "My page" (`Circle.tsx`) + real family tree (`FamilyTree.tsx`, works for any person), `person-facts` linking and "my mom/dad" resolution both read the same table — see §3/§4/§6/§7. Full build story in PROJECT_HISTORY §15. Still-open UX questions, not yet resolved: (a) empty relationship categories on "Your circle" shown as invite-to-add vs. hidden until populated. ~~(b) a family tree for a group you're NOT a member of~~ — **RESOLVED 2026-07-21**, see item 41. ~~(c) "+" always targets a tier's first branch when a tier has more than one~~ — **FIXED 2026-07-20**, see item 37.
33. **Refer to the user as "You" instead of "User"** — requested 2026-07-19. `converse` reply text: DONE (item 53). **Extended 2026-07-26** to member/attendee chips: `EventDetail.tsx`'s `AttendeeChip` and `GroupDetail.tsx`'s `MemberChip` now show "You" instead of the founder's own name, keyed off each page's `selfId` (`is_self` lookup). Not yet audited: PersonDetail's relationship/Key-Facts chips, and any other list of people that might render the self person by name.
34. ~~Filterable "View" by event category on the Events page~~ — **DONE 2026-07-22.** Shipped together with item 28: a tag filter dropdown on Events.tsx, growing from distinct tags actually applied (`useMemo`, not a fixed hardcoded set, per the founder's original ask), membership-based (a moment can carry more than one tag) rather than the single-value equality Groups.tsx's type filter uses, plus a "No tags yet" option. Verified live: option list matches tags in use, filtering narrows correctly.
35. ~~Sub-events for multi-day events~~ — **DONE 2026-07-30, migrated and verified live.** Requested 2026-07-19, founder flagged as important. Self-referencing `moments.parent_moment_id` (mirrors item 19's subgroups pattern), one level deep in the UI: "Sub-events" section + "+ New Sub-event" on `EventDetail.tsx`, sub-events bundled/collapsible under their parent on `Events.tsx` (founder-approved mockup) rather than shown flat — see §3 entries for both files. Calendar-import's earlier "Save as a note instead" workaround (2026-07-25, ImportReview.tsx) is untouched and not migrated onto real sub-events — noted as a possible future follow-up, not done here.
37. ~~Family tree bug scan~~ — **DONE 2026-07-20**, three wire-connection follow-ups **2026-07-21/22**, layout engine rewrite **2026-07-22** (item 39), same-day live-bug fix **2026-07-22**: Kids tier now also positions relative to its own parents' tier above (`layoutRelativeToParent`) instead of independently centering on the canvas — root-gen is now the only independently-laid-out tier — fixing left-clipping on wide trees and grandchildren rendering off-anchor. One reported "missing grandparent marriage line" turned out to be a real data gap (no `spouse` relationship on file), not a bug — flagged to founder, not auto-fixed. **2026-07-21 fix, confirmed live:** the root's own siblings were the one place in `familyTree.ts` still built as a bare name list with no spouse lookup — every other role (root's own spouse, aunts/uncles, cousins, kids) already attached in-law spouses. A married sibling's spouse now shows up with a marriage line too; verified against Jake's real tree (Josh Volin + Faith Volin).

38. ~~Undo a mis-added family tree relationship~~ — **DONE 2026-07-21.** Added `removeRelationship`/`unlinkRelationship` + a "Remove a relationship" control on the family tree page, scoped to the centered person's direct relations. Verified via `npm run build` + synthetic-data harness only — not yet confirmed against live data (see §10). Full story: PROJECT_HISTORY §18. **Relabeled "View Relationships" 2026-07-26**: each chip's name is now clickable and opens that person's own profile page (`onSelectPerson`, threaded through `FamilyTree`/`FamilyTreeView`/App.tsx); the hover-reveal trash icon still removes the relationship, unchanged. Verified live against Jake's real tree.

39. ~~Family tree layout engine rewrite~~ — **DONE 2026-07-22**, same day as founder-proposed. Implemented in the fresh session the founder asked for; see item 37's "Root-cause rewrite" entry for what shipped.

40. ~~Full sibling/parent clique sync~~ — **DONE 2026-07-21, deployed and DB-backfilled.** Founder-requested: adding any relationship should reciprocate across everyone it touches, not just the pair directly linked (e.g. adding a 3rd sibling to a 2-sibling group should connect all 3, and share all parents across all 3 — not just sync the new pair). Replaced the old 2-person-only `syncSiblingParents` with `syncFamilyClique` (see §6), which walks the full transitive sibling closure on every sibling or parent add — wired into both the frontend "+" picker/suggestion-banner paths AND all 4 relationship-capturing edge functions (`add-fact`, `converse`, `update-moment`, `update-group`, all redeployed same day). Verified live against Jake's real sibling group (Josh/Jake/Jess/Danny Volin): a test sibling added only to Josh correctly picked up Amy/Steve as parents AND direct sibling links to Jake/Jess/Danny; a test parent added only to that new sibling correctly propagated to all four. Spouse→parent propagation (step-parent case) explicitly excluded — see item 24. One-time SQL backfill for pre-existing data run same day (165 → 177 relationship rows). **Follow-up 2026-07-25 (founder report — Lorenzo Harris tree, "relationships don't sync regardless of whose profile was centered"):** the clique closure above only ever walked EXISTING sibling rows — it never discovered "these two share a recorded parent" on its own, so kids added one at a time (the normal way of building a tree) never became siblings. Fixed: closure now also seeds from the anchor's own parents' other children. Spouse→parent propagation (item 24) also now ships — auto-links except when either side already has another spouse/partner on file (remarriage guard), which surfaces as a new suggestion banner instead (`suggestCoParentLinks`, FamilyTree.tsx). New `invalidateKeyFacts` closes a third, related gap: nothing previously invalidated a profile's cached Key Facts chips after a relationship changed elsewhere. Verified live with disposable test people (shared-parent siblings, spouse auto-coparent, remarriage-guard banner accept/decline, Key Facts regeneration) against `jakevolin@gmail.com`, cleaned up after — see §3 writeRelationship.ts entry for the full mechanism. **Not yet deployed/backfilled against production — see §10.**

41. ~~Family tree entry points beyond My Page~~ — **DONE 2026-07-21.** Founder-requested: see any person's tree from their own profile, and generate a Family-typed group's tree without needing to be a member yourself. `PersonDetail.tsx` now has a "View family tree →" link (any profile, not just self). `GroupDetail.tsx` now has a "Generate this family's tree →" button on `group_type === 'Family'` groups. Shipped in two passes same day: first via `pickFamilyTreeRoot()` picking a best-covering center person, then superseded within the day by a dedicated `buildDescendantTree()` (familyTree.ts, `mode: 'descendants'`) scoped to the whole group's lineage instead of one member's ego graph — `pickFamilyTreeRoot()` removed. Verified live: The Volins (21 members) → tree centers on the family's eldest known generation, correctly fanning down through all members; a non-self profile (Steve Volin) opens its own ego tree correctly.

42. ~~Family tree generation cap~~ — **DONE 2026-07-21.** Founder-reported: Harvey/Roberta's great-grandchild (Wesley Gregorian) had no section — both tree modes were hardcoded to a fixed generation window (ego mode: 2 up/1 down; descendants mode: 5 labels). Both now walk however far the relationships data actually goes in each direction (capped at 25 generations only as a cycle guard) — see §7 FamilyTree.tsx entry for the mechanism. Matters for the founder's stated use case: people using this to keep track of real family lineage, potentially recording many generations back. Verified live: Harvey Volin's tree now shows a "Great-Grandchildren" section containing Wesley Gregorian; The Volins group tree unaffected in shape, still renders correctly.
43. ~~Family tree color coding~~ — **DONE 2026-07-21.** Founder-requested: make relationships easier to read at a glance — who's centered on whom, and which side grandparents/aunts-uncles/cousins are on. See §7 FamilyTree.tsx entry for the mechanism. Deferred (founder's own call, flagged to revisit — see item 44): a gender icon per person, not bundled into this pass. Verified live against Jake Volin's tree (purple moves correctly when re-centered on a non-self person like Amy Volin; blue/rose sides span from Great-Grandparents down through cousins' kids) and The Berzins' group meta-tree (single green color, no purple, clicking any member correctly opens their own purple-centered ego tree).
44. **Gender icon on family tree tiles** — **Manual-field half DONE 2026-07-26** (auto-fill half still open, see below). New nullable `people.gender` column (`male`/`female`/`non-binary`/`other`, migration: `supabase/migrations_manual/2026-07-26-gender.sql`, **not yet run — founder action needed, see §10**), editable dropdown on `PersonDetail.tsx` (inside the name-edit form, next to Deceased). `FamilyTree.tsx` renders a ♂/♀ glyph before the name for male/female (non-binary/other deliberately left unmarked — no symbol chosen without founder sign-off). Fetched via its own query in `familyTree.ts`'s `loadGraph()`, separate from the main people select, so a not-yet-migrated database degrades to "no icons," not a broken tree. **Still open:** the one-time hybrid auto-fill (static first-name→gender lookup, ≥90% confidence) from the original spec — deferred, not built this pass.
45. ~~Standalone first-run onboarding experience~~ — **DONE 2026-07-22.** Full gameplan discussed and iterated with the founder before building (plan file: `gameplan-the-onboarding-experience-lexical-parrot.md`, not checked into the repo). Built on top of the founder's own same-day signup expansion (items above: name/birthday at signup, auto-created self profile). See §3 Onboarding.tsx entry for the full mechanism — full-screen, no app chrome, sequenced by connective leverage (family tree first, then a closed-ended group picker, notes/events deliberately excluded). Verified live end-to-end with a disposable test account; that test account (`onboarding.verify.test@example.com`) still needs founder cleanup via the Supabase dashboard.

**Items 46–53 came in via the click-to-comment feedback widget (§3 FeedbackWidget.tsx), founder session 2026-07-23, folded in here instead of living only in the `feedback_notes` table — marked done in the widget once captured below:**

46. ~~Rename the Home "Notes" stat tile to "Datapoints"~~ — **DONE 2026-07-24.** Copy-only change (`Home.tsx`); underlying count query untouched. Broader "datapoints" reframing (what else counts, how it's computed) stays open. Verified live.
47. ~~Dunbar's-tiers widget on Home~~ — **DONE 2026-07-24.** `DunbarDetail.tsx` now shows real names (most-recently-added first) within each cumulative tier slice, not just a count — still the existing cumulative-bucket model, not real per-person tier assignment (founder-confirmed scope). Verified live against the real account.
48. ~~New Calendar feature~~ — **DONE 2026-07-24.** Full build story in PROJECT_HISTORY.md §21. `Calendar.tsx` (nav tab: upcoming list + fixed-height month grid over `moments`/`reminders`), `CalendarSettings.tsx` (connect calendars via secret iCal URL — not Google OAuth), `scan-calendar-sources` Edge Function (fetches/parses connected feeds, AI-extracts via Claude, matches attendees, writes to `moment_import_candidates`) on both a manual "Sync now" button and a daily `pg_cron` job, and `ImportReview.tsx` (accept/reject queue — accept writes real `moments`+`notes`, reject writes nothing). Nudges on Home/Calendar surface the pending count. New tables: `calendar_sources`, `moment_import_candidates`. Verified live end-to-end against the founder's real connected calendar. **Follow-up fix 2026-07-25:** founder reported no real events surfacing (only birthdays). Root cause: the pre-AI filter required 2+ formal Google "guest" attendees or a recurrence rule before an event ever reached Claude — most personal calendars don't use formal guest invites, so real gatherings (trips, visits, reunions) were silently dropped before classification. Removed that filter; every non-cancelled, in-range event now goes to the AI, which does the actual worth-suggesting judgment call. Also found and fixed live: batches were running sequentially and blowing past the Edge Function execution timeout on a real backlog (1,060 raw events on the founder's actual calendar) — switched to `Promise.all` concurrent batch calls plus a per-invocation batch cap, so a large backlog catches up over a few clicks instead of timing out. Verified live: full backlog processed cleanly, 232 real candidates now pending (trips, reunions, family gatherings — not just birthdays). **Overhaul 2026-07-25** (founder ask: accept-flow feedback, merge-with-existing, tag/group suggestions, real date ranges): see §3 ImportReview.tsx and §6 `moments`/`moment_import_candidates` entries for the mechanism. Verified live against the founder's real account: merge-accept ("Adrienne and Jacob Fisher's Wedding") and range-accept ("Conor & Shelly's wedding", June 17–19 2027) both round-tripped correctly through EventDetail/Events.tsx.
49. ~~Add a "Settings" button next to Log out~~ — **DONE 2026-07-23.** Scoped down with the founder to account + AI settings only (email/password change, chat-tone preference) plus About and Privacy/data-policy links — explicitly not a place for app-interface shortcuts. `SettingsPage.tsx`/`About.tsx`/`Privacy.tsx` (see §3), `user_settings` table (see §6), `converse` roster-tier read (see §4/§5). About/Privacy are placeholder pages — real copy for both still needs to be drafted together with the founder, not invented unilaterally. Verified live against the founder's real account: email/tone sections render correctly, chat tone persists and visibly changes `converse` reply style (tested "direct"), password change round-tripped (changed, logged in with the new one, reverted to original) — email-change form intentionally not tested live against the real account (low-risk code path, same `supabase.auth.updateUser()` already proven for password, but founder chose not to risk it on the real login for this pass).
54. ~~Email-change verification code~~ — **DONE 2026-07-23** (code side; Supabase Dashboard step still pending, see §10). `SettingsPage.tsx`: after "Update email," the page now asks for a 6-digit code (`supabase.auth.verifyOtp({ type: 'email_change' })`) sent to the **new** address only (founder decided against also codeing the old address — logging into Settings already proves identity; the new-email code just confirms it's real/reachable) before the change takes effect, with resend/cancel. UI verified live (pending state, wrong-code error, cancel) against the founder's real account using a fake address — never completed against a real inbox, so the actual code-delivery email hasn't been seen yet.
50. ~~Home page engagement~~ — **"is this person in group X?" DONE 2026-07-25** (item 15's "Connections to make" card). Founder's other two examples ("confirm this relationship," "suggested tags for this event") still open — this was explicitly a brainstorm ask, not a spec; related to item 26's ratings loop.
51. ~~EventDetail "Affiliated Groups" section~~ — **DONE 2026-07-24.** `EventDetail.tsx`'s groups and tags pickers are now collapsed behind toggle buttons ("+ Associate a New Group" / "+ Add a Tag"), mirroring `GroupDetail.tsx`'s pattern, instead of always-visible; empty states now show "No groups/tags at this time" rather than wasting space. Standardized on "Associated Groups" terminology (matches `GroupDetail.tsx`/`PersonDetail.tsx`; `update-moment`'s prompt text updated too) — `AffiliatedGroupChip` renamed to `AssociatedGroupChip`. PersonDetail's own heading left untouched this pass to avoid colliding with a concurrent session's in-progress deceased/divorce work on that file. Verified live (VCIC Competition event): toggle opens/closes the picker correctly.
52. ~~Event dates~~ — **DONE 2026-07-24.** `EventDetail.tsx` and `Events.tsx` now prefer the exact `event_date` over vague `when_text` when both exist (new shared helpers in `lib/dates.ts`: `formatFullDate`, `formatEventWhen`); `when_text` still shows when no exact date is on file. Verified live: VCIC Competition now shows "February 24, 2018" instead of "late February 2018."
53. ~~`converse` chat voice bug~~ — **DONE 2026-07-24.** Added an explicit VOICE instruction to `converse`'s stable system prompt (`stableInstructions`, static/deterministic — doesn't affect the prompt cache prefix) telling the model to always address the founder as "you" in reply text, never by their own name or as "User." Deployed via `npx supabase functions deploy converse`. Verified live: re-asked about the VCIC Competition note, reply now reads "...Daniel Book allegedly shoved you and you slipped down a muddy hill" instead of naming the founder in third person.
55. ~~`converse` MOMENT_ID tag leak~~ — **DONE 2026-07-24.** Added an instruction to `stableInstructions` telling the model the `[MOMENT_ID: ...]` tag is bookkeeping-only and must never appear in reply text. Deployed via `npx supabase functions deploy converse`. Verified live: re-asked about the VCIC Competition, reply no longer starts with the tag.
56. ~~Calendar month-grid tile truncation + app column too narrow on desktop~~ — **DONE 2026-07-24.** Founder-reported: day tiles with long titles were stretching their whole grid column instead of truncating. Root cause: `gridTemplateColumns: repeat(7, 1fr)` has no `min-width: 0` clamp, so a child's min-content width pushes the column wider — fixed via `minmax(0, 1fr)` plus `minWidth: 0`/`overflow: hidden` on the day cells and tile buttons (Calendar.tsx). Also addressed the founder's follow-up "why is the whole app so thin on desktop": the app's page column (`maxWidth`) was hardcoded to 600px identically across every page — confirmed harmless to widen since any phone viewport is already narrower than 600px, so this only affects desktop viewing, not the eventual native-iPhone build. Bumped to 840px across all logged-in app pages + Breadcrumb.tsx (Landing.tsx's own unrelated `maxWidth` left alone — that's a marketing-page callout box, not the app shell). Verified live: tiles clip with ellipsis inside a uniform-width cell, page column measurably wider (888px including padding vs. previous ~648px) with no layout breakage.

**Items 57–61 came in via the click-to-comment feedback widget (§3 FeedbackWidget.tsx), founder session 2026-07-25, folded in here instead of living only in the `feedback_notes` table — marked done in the widget once captured below:**

57. ~~Per-group toggle for "connections to make" suggestions~~ — **DONE 2026-07-25** (scope confirmed with founder: Groups only, not Events — EventDetail's own attendee-suggestion boxes are a separate, not-yet-built ask). New `groups.suggestions_enabled` column (default true); checkbox on `GroupDetail.tsx` right above where the suggestion chips would render (always visible, not gated on there currently being any, so it stays reachable to re-enable); off also drops that group from Home's "Connections to make" card since both read the same column (`lib/suggestConnections.ts`). Isolated fetch/write, fails open to "on" if the column isn't there yet — doesn't risk breaking the member list or Home's card while the migration is pending. **Founder's stretch idea (proactively offer to turn suggestions off after repeated dismissals) NOT built** — out of scope for this pass. **Migration run and fully verified live 2026-07-26** against the real `jakevolin@gmail.com` account, "Air Force Academy" (113 pending suggestions at the time): unchecking the toggle immediately hid all suggestion chips + the add/remove-all buttons and showed the "Off" hint; the `false` value survived a full reload (confirmed directly against the DB, not just the UI); Home's "Connections to make" card reads the identical column so it stops surfacing that group's people too. Test toggle reverted back to on afterward (real data, not disposable).
58. **Auto-load more Home suggestions without a refresh** — requested 2026-07-25. `suggestConnections.ts` already returns a random sample (currently 4) of the full candidate pool per call (§3); founder wants the "Connections to make" card to silently fetch/show another batch once the visible ones are cleared, instead of requiring a full page reload to see more.
59. **EventDetail affiliated-group attendee suggestions missing "Add all"** — requested 2026-07-25 (USAFA Graduation event). `GroupDetail.tsx` already has "✓ Add all suggestions" paired with "× Remove all suggestions" (`GroupDetail.tsx:826`); `EventDetail.tsx`'s matching "Also from the affiliated group?" attendee-suggestion section only has the remove-all half (`EventDetail.tsx:833`, `:860`) — add the accept-all counterpart to match.
60. **New-person name inputs don't stay side by side** — requested 2026-07-25. `PersonDetail.tsx`'s first/middle/last rename inputs (`nameInputRow`/`renameInput`, ~line 1472) are flex with no explicit width or `flex-basis` per box, so they can wrap to separate lines instead of showing as three equal-sized boxes in one row — founder found this confusing. Styling-only fix (give each input a shared `flex: 1`/basis).
61. **First-person "my" misattributed to the wrong person** — **Code fix DONE 2026-07-26, NOT YET DEPLOYED (see §10).** Root-caused to `add-fact` (the profile-scoped quick-fact bar — matches the Ken Miller repro exactly: text typed directly on Ken's profile). Its prompt framed all captured text as "about" the profile person with no signal that a first-person pronoun means the app's signed-in user instead; added an explicit instruction (using the existing `is_self` lookup) telling it first-person text refers to the self person, never to rewrite "my X" as "&lt;profile name&gt;'s X," and to leave the pronoun as typed if unsure. `converse`/`update-moment` weren't touched — their existing `buildSelfInstruction` already resolves unqualified "my"/"our" for relationship capture; only `add-fact`'s plain-note path had the gap. A live test on Ken Miller's profile ("my scout troop leader") saved unchanged, not misattributed — but no deploy token was available this session, so that test actually ran against the OLD (undeployed) function and isn't real confirmation of the fix; re-verify after deploying.
62. ~~Groups page lost its filter + scroll position when returning via the back arrow~~ — **DONE 2026-07-26.** Founder-reported: pick a group-type filter, click into a group, then use the in-page "← Back to Groups" arrow — landed back at an unfiltered, top-of-page list instead of where you left off. Root cause: `Groups.tsx` unmounts every time a crumb is pushed (App.tsx swaps it out for `GroupDetail`), so its local `search`/`typeFilter` state and scroll position were lost on every return trip. Fixed by lifting both into `App.tsx` (which never unmounts) and adding a scroll-position ref that's restored once the list reloads, cleared on a direct top-nav tab click so only the actual back-arrow round trip restores scroll. Verified live against the real account: "Friend group" filter + scrolled-to "Colorado Springs Friends" → back arrow correctly restored both; direct "Groups" tab click still lands at the top.
63. ~~Spouse/family chaining should apply everywhere a person is suggested, not just events~~ — **DONE 2026-07-26.** Founder feedback: self's spouse should always be suggested for events (household events are a given, shouldn't need self manually added first), and the existing event "person added → spouse suggested → kids suggested once spouse also added" chain should apply to every suggestion surface in the app, not just EventDetail.tsx. Shipped: (1) EventDetail.tsx/ImportReview.tsx now always seed self into the attendee set fed to `suggestFamilyMembers`, so self's spouse is suggested even before self is tagged; (2) GroupDetail.tsx gained a second suggestion box, "Family of a current member?", using the same `suggestFamilyMembers` chaining seeded from the group's explicit members; (3) `suggestConnections.ts` (Home's "Connections to make" card) gained the same family signal, generalized across every group. Verified live against the real account: a blank new event immediately suggested Caroline Volin (self's spouse) with zero attendees added; a throwaway test group seeded with Jake+Steve Volin correctly suggested Amy Volin (Steve's spouse), and once added, correctly suggested Jess/Danny/Josh Volin (their kids per the `relationships` table) — test group deleted after verifying, no changes to real data.
65. ~~iPhone Contacts import~~ — **DONE 2026-07-27.** Previously parked; founder asked to build it out, specifically calling out birthdays and addresses, then added mid-plan that nothing should auto-import wholesale (a real contact list can be 1000+ entries) and that browsing needs to be chunked with progress saved. See §3/§6/§7 for the mechanism (`ContactsImport.tsx` → `ContactSelection.tsx` curation → `ContactImportReview.tsx` accept/reject, `contact_import_candidates` table, `_shared/vcard.ts`/`_shared/nameMatch.ts`). Contact photos and auto-linking Apple's "related names" into the real `relationships` table were deliberately scoped out — flagged as separate decisions (photo storage needs a Storage bucket, same infra as the still-unbuilt item 27; relationship auto-linking risks silently writing wrong family links from free-text labels). Verified live end-to-end against the real account (`jakevolin@gmail.com`), all test data cleaned up after.
66. **Clean up messy duplicate location strings** — requested 2026-07-27. Founder typed the same real address ("12208 Bandon Dr…") three slightly different ways across past events before `AddressSuggestInput` (§3 ImportReview.tsx entry) existed to catch it. Wants a way to consolidate the old bad variants into one correct value (ideally the Geoapify-verified formatting) — either a merge tool for past `moments.location` strings, or a lighter "×" on a local suggestion in `AddressSuggestInput`'s dropdown to stop it from ever being offered again. Not scoped or built yet.

**Parked** (don't resurrect unprompted): automatic email reminders (table exists, nothing sends); weather metadata; "AI should ask deeper follow-ups" thread (feeds 17).

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

- ~~Founder action needed: run `migrations_manual/2026-07-30-platform-stats.sql`~~ — **run and confirmed live 2026-07-30**: Landing page's platform databox (§3/§6) shows real cross-account totals, verified in browser preview.
- **Founder action needed: add the Geoapify key to Vercel's production env vars (2026-07-26)** — key created, verified working live in local dev/browser preview (real Denver, CO address suggestions returned and selectable on ImportReview's Location field). Local `.env` already has `VITE_GEOAPIFY_API_KEY` set. Still needs adding to the Vercel project's Environment Variables (Settings → Environment Variables) — `.env` isn't committed, so the deployed build has no key yet and only shows previously-typed-address suggestions in production until this is done. Also worth restricting the key to the production domain + localhost under "Referrer restrictions" in the Geoapify dashboard (currently unrestricted).
- **Founder action needed: run `migrations_manual/2026-07-26-group-suggestions-default-off.sql`** — flips the `groups.suggestions_enabled` (item 57) default from true to false, and sets every existing group's value to false, per founder feedback 2026-07-26 ("not using it for anyone"). Code-side defaults (GroupDetail.tsx, suggestConnections.ts) already updated and verified in browser preview; no token available this session to run it directly (see `project_boomer_infra.md`), so paste this file into the Supabase SQL Editor. Until it runs, existing groups keep whatever value they already have (mixed true/false — some groups were already manually toggled off).
- ~~Redeploy 4 edge functions for the family tree relationship-sync fix~~ — **DONE 2026-07-25.** `add-fact`/`converse`/`update-moment`/`update-group` all redeployed with the fixed `_shared/relationships.ts` (founder-provided token, confirmed success on all 4).
- **Founder action needed: run the family-tree backfill SQL by hand (2026-07-25, item 40 follow-up)** — code deployed everywhere (frontend + all 4 edge functions), verified live with disposable test people, but the actual backfill against real data (fixes the reported Lorenzo Harris tree, and everyone else's already-built trees) needs to be run **by the founder, in the Supabase Dashboard's SQL Editor** — both the Management API and the browser-client fallback were tried and both got blocked by the auto-mode safety classifier for a write at this scale (a bulk backfill across many real relationship rows, not a narrow single-row fix — see `project_boomer_infra.md` memory for the refined understanding). Run `migrations_manual/2026-07-25-spouse-coparent-backfill.sql` FIRST, then `2026-07-25-shared-parent-sibling-backfill.sql` (each file's own header explains why). Dry-run preview already done this session (read-only queries aren't blocked): the spouse-coparent file will add 35 new parent links across ~20 different families (including the reported Jamie/Leanne/Lorenzo case) and correctly excludes the Andy Volin/Andi/Michael Galchinsky remarriage case; the sibling file will add at least 24 new direct sibling pairs before its own transitive-closure step runs. Both are `ON CONFLICT DO NOTHING`/additive-only — safe to re-run, nothing gets deleted or overwritten.
- **Needs deploy: `scan-calendar-sources` family-surname matching (2026-07-25)** — code committed (`mentioned_family_names`, see §4 entry), not yet run through `npx supabase functions deploy scan-calendar-sources`. Until deployed, calendar entries like "Meal train for the Mojica family" keep matching/scanning under the OLD prompt (no surname resolution). Needs a founder-provided Supabase access token (see §2 workflow) — none available this session.
- **Founder cleanup available once deployed above:** the real "Meal train for Mojica family" calendar entry was already accepted into a real `moments` row (id `f62ca5f8-…`) under the old logic, so Patrick Mojica/his "98 FTS" group were never attached to it — confirmed live 2026-07-25 (Patrick Mojica *is* on file, *is* in "98 FTS"). Not auto-fixed (this session only verified the gap, didn't touch the real moment). Once the redeploy above ships, the founder can either add Patrick + 98 FTS to that event by hand, or delete just that one `moment_import_candidates` row (`ical_uid` `r3rv0mmoc1c9lhc827928k4oso@google.com`) and re-run "Sync now" to regenerate it under the new logic, then merge it into the existing event.
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
- **Founder action needed: enable Supabase email-change codes** (item 54) — in the Supabase Dashboard, turn on "Secure email change" (Authentication → Providers → Email) and add `{{ .Token }}` to the "Change Email Address" template (Authentication → Emails → Templates) so it emails a 6-digit code instead of only a link. Until this is flipped on, the new Settings code-entry UI has nothing real to verify against.
- **Founder cleanup needed: two separate "Amy Volin" profiles exist** — found 2026-07-20 while verifying the relationships-table build (see PROJECT_HISTORY §15). Not this session's doing and not touched — merge via People search + merge-profile once confirmed which one should survive.
- ~~Founder cleanup needed: two separate "Barbara Bach" profiles exist~~ — **founder confirmed 2026-07-21 only one Barbara Bach profile exists now**; the duplicate noted 2026-07-20 (PROJECT_HISTORY §16) was either already merged or the original finding was wrong. Not the cause of the Bill/Lisa mis-wiring below.
- **Founder cleanup needed: Barbara Bach's relationships are wrong** — found 2026-07-21. On her tree, Bill shows as her father and Lisa as her sister; the real facts are Bill=husband, Lisa=daughter. Item 38's new "Remove a relationship" control (family tree page, centered on Barbara) is the tool to fix this: remove Bill-as-parent and Lisa-as-sibling, then re-add Bill as spouse and Lisa as child via the existing "+" pickers. Not done yet — needs the live app, which this session couldn't reach (see note below).
- **2026-07-21/22 family tree fixes (items 37/38) not verified against live data** — this session had no Supabase credentials (no `.env` in the remote container), so it couldn't load Jake's real tree. All verified instead with `npm run build` and temporary synthetic-data harnesses (deleted before commit) shaped like the reported bugs, rendered through the real code and screenshotted in-browser. Worth a live click-through against the real account to confirm, and to actually fix Barbara/Bill/Lisa per the item above. **Verification lesson (founder-caught 2026-07-22):** checking only the tree centered on the self/root person isn't enough — a fix can look right from one person's view and still be wrong (or just visually ambiguous) from someone else's, since being centered on a different person changes who's a "direct" relation vs. an "extended" one/how tiers stack. Click into a few other people's own tree views too, not just the one that was reported broken.
- **Possible second cause for a "wrong wire" report, not yet ruled out**: on Jake's tree, David/Laura's wire was reported connecting to Jake + his sibling instead of down to Noah/Aaron. The 2026-07-22 bar-extension fix (item 37) plausibly explains this on its own — but if it's still wrong after that deploys, check whether David or Laura is *also* recorded as one of Jake's own parents (same bad-data pattern as Barbara/Bill/Lisa above); fixable with item 38's "Remove a relationship" tool, no code change needed.
- **How bad relationship data can appear without touching the family tree page**: confirmed 2026-07-22 — `add-fact`, `converse`, `update-moment`, and `update-group` all call `_shared/relationships.ts`'s `applyFamilySignals`, which writes directly to the `relationships` table (plus reciprocal notes) with **no confirmation banner**, whenever the AI extracts a spouse/sibling/parent/child/partner signal naming someone whose full name matches *exactly* one person on file (deliberate founder-approved exception to "suggest, don't assert" — siblings named together link with no banner). The one concrete risk: if two different people share an identical full name, this "confident exact match" could resolve to the wrong one of the two — worth keeping in mind if another mis-wired relationship turns up with no clear manual cause.
- ~~Siblings now inherit shared parents (2026-07-20, see PROJECT_HISTORY §16)~~ — fixed the bug where adding a sibling via the family tree "+" picker never copied an existing sibling's parents onto the new person. **Deployed and confirmed live 2026-07-20**: frontend fix (`writeRelationship.ts`) via Vercel, edge-function mirror (`add-fact`/`converse`/`update-group`/`update-moment`) via `npx supabase functions deploy` with a founder-provided token — all 4 returned 401 (not platform-not-found) post-deploy, no Cloudflare retries needed this round.
- ~~Relationships table + `is_self` migration + 5 Edge Function redeploy (item 32, 2026-07-20)~~ — **applied and deployed live 2026-07-20** via the Management API + `npx supabase functions deploy` with a founder-provided token (`add-fact`/`converse`/`update-group`/`update-moment`/`person-facts`, 3 of the 5 needed a retry after a transient Cloudflare 502). Backfill landed 75 relationship rows from existing notes. Click-tested end-to-end (My Page onboarding/circle/`+`, family tree render + re-center + `+`) against the real `jakevolin@gmail.com` account with disposable test data, cleaned up after — see PROJECT_HISTORY §15 for the full verification story, including a self-inflicted name-collision near-miss that was fully cleaned up.
- ~~Self missing from groups created before the 2026-07-20 auto-add-self fix~~ — **backfilled 2026-07-20**: one-off script (authenticated as the real `jakevolin@gmail.com` account, RLS-respecting) added the self person to all 22 pre-existing groups that were missing them (only "Volin Family" already had self as a member). Cached group summaries were deliberately NOT invalidated by this backfill, to avoid a 22-call regeneration cost spike (CLAUDE.md rule 3) — a summary will just read as slightly stale until it's naturally refreshed. **Reverted 2026-07-26** (founder feedback: being auto-added to every group — including ones not really about them — polluted their own Groups search): the 2026-07-20 auto-add-on-create fix and this backfill's effect are both undone; see the new item below.
- **Founder needs to run a SQL migration: remove self from all existing groups (2026-07-26)** — `supabase/migrations_manual/2026-07-26-remove-self-from-existing-groups.sql`, paste into the Supabase SQL Editor (preview SELECT first, then the DELETE). Until this runs, "Your groups" on Circle.tsx and the Groups list still show the founder as a member of nearly every group from the 2026-07-20 backfill above — only NEW groups are unaffected. Re-add yourself afterward to whichever groups are genuinely yours (e.g. your real family group) the same way you'd add anyone else.
- **Auto-add-founder-to-events (2026-07-26) only covers the manual "+ Add Event" shell** — calendar-imported events (`ImportReview.tsx`'s `applyAttendees`) still don't tag the founder as an attendee; deferred because the merge-into-existing-moment path needs a dedup guard (no unique constraint on `notes`) that's only really testable against a live calendar import, not a quick click-test. Separately, whether Home's AI chat (`converse`) already tags the founder when they narrate their own presence in first person ("I went to Kate's wedding") is unconfirmed — that's prompt behavior, not touched by this fix, worth checking empirically before assuming it's covered.
- Email confirmation must be re-enabled (with a proper redirect URL) before real users.
- **Founder cleanup needed: disposable test account `onboarding.verify.test@example.com`** — created 2026-07-22 to verify the new onboarding experience end-to-end (signup → tree → groups → Home). Fully isolated by RLS from real data, but this session has no Supabase auth-admin access to delete it — needs removing via the dashboard.
- **Founder needs to run a SQL migration: `feedback_notes` table (item — click-to-comment feedback widget, 2026-07-22)** — `supabase/migrations_manual/2026-07-22-feedback-notes.sql`, paste into the Supabase SQL Editor. Until this runs, the widget's save silently no-ops (insert fails, swallowed) — UI flow itself is verified working (toggle/highlight/click-intercept/composer, see FeedbackWidget.tsx).
- ~~Founder needs to run a SQL migration + redeploy 3 Edge Functions: time zone bug fix (2026-07-24, item — "today" mis-dating evening events)~~ — **migration applied and all 3 functions (`converse`/`update-moment`/`scan-calendar-sources`) deployed live 2026-07-24**, via the Management API + `npx supabase functions deploy` with a founder-provided token. Confirmed live: `user_settings.time_zone` returns 200 via PostgREST (not a 400 undefined-column error), Settings time-zone picker's save round-trip verified end-to-end in a real browser session against `jakevolin@gmail.com`. A second, separate display-only bug found in the same investigation and fixed same day: [EventDetail.tsx:604](../src/pages/EventDetail.tsx) parsed `event_date` with bare `new Date(...)` (UTC-midnight parsing, same bug CLASS as the regression guard below) instead of `formatFullDate()` — this one didn't affect what was SAVED, only what EventDetail showed, and in negative-UTC zones it happened to shift the display back a day, partially masking the real bug rather than causing it. Both fixes verified together live: "Tulas & Jackass The End" (previously mis-dated to 2026-07-25 by the pre-fix `converse` deploy) corrected to 2026-07-24 via its own update-chat, confirmed matching on both EventDetail and the Calendar month grid. **Side finding, not caused by this fix:** that correction cleared the event's cached `summary` (EventDetail's normal behavior on any change) and it couldn't auto-regenerate because the event's `raw_description` was already empty — `update-moment` never writes `raw_description` (only `converse` does, at moment-creation time), so this looks like a pre-existing data gap on this one event, not something introduced here. The individual notes are all intact; only the AI-generated prose blurb needs retyping via "Edit description" if wanted back.
~~67. Tag people to groups/subgroups at entry time~~ — **done 2026-07-30**: `ContactImportReview.tsx`'s "Review contacts" cards now have an "Add to groups" picker (`SearchAddPicker`, browse-all + inline "+ Create group" using the same find-or-create logic as `PersonDetail.tsx`'s `confirmSuggestedGroup`) on every card; selected groups are upserted into `person_groups` on Accept. `+ Add Person` on People.tsx still routes straight to `PersonDetail.tsx` (already has its own group tagger there) — not touched.
~~68. Sort "Review Contacts" list: high-confidence matches first~~ — **done 2026-07-30**, same pass as item 67: query now orders `match_confidence` ascending (`'high'` before `'none'`) then `full_name`.
69. **Photo gallery for Person/Group pages** — deferred from item 27's Google Photos build (2026-07-30). `PhotoGallery.tsx` only shows real photos when passed a `momentId` (EventDetail); Person/Group pages still show the original placeholder. Would mean aggregating photos across everything a person/group is tagged to (their moments) rather than one moment's own `photos` rows — not scoped yet.
70. **`ContactImportReview.tsx` paginated + name-editable (2026-07-30)** — founder was facing all 1300+ `selected` candidates rendered on one page at once (unusable) with no way to fix a parsed-vCard name before it became a real profile. Now paginated at 20/card (mirrors `ContactSelection.tsx`'s pattern, smaller page since these cards are heavier); unmatched (new-person) candidates get editable First/Middle/Last inputs prefilled from the parsed name. Accept keeps its existing in-place "Saved contact info for X" confirmation (only refreshes the footer count); Reject refetches the page so the next candidate slides in. Verified live against the founder's real queue (1304 real selected candidates) with a temporary synthetic batch, fully cleaned up after — see PROJECT_HISTORY.md for that story. **Extended same day:** matched cards now show the linked person's current groups ("Already in: X, Y") fetched per-card on `linkedPersonId` change, so a match comes with visible proof it's really them (and those groups are excluded from the "Add to groups" picker to avoid offering a duplicate tag); a 3-way "All / Already in Boomer / New people" filter (keyed on `matched_person_id` being set, not `match_confidence`) lets the founder batch through quick confirms separately from the new-person decisions that need real attention.
- ~~Google Photos import (item 27) is BUILT but NOT LIVE~~ — **backend fully deployed 2026-07-30**: founder completed Google Cloud Console setup (OAuth consent screen + Client ID/Secret), ran the migration, and created the private `photos` Storage bucket directly; `GOOGLE_PHOTOS_CLIENT_ID`/`GOOGLE_PHOTOS_CLIENT_SECRET` set as Supabase Edge Function secrets and all 3 Edge Functions (`google-photos-oauth-callback`/`google-photos-picker-session-create`/`google-photos-picker-session-import`) deployed via founder-provided access token — confirmed live via the token-free check (each returns `UNAUTHORIZED_NO_AUTH_HEADER`, not Supabase's `NOT_FOUND`), and `photo_connections`/`photo_clusters`/`photos` + all RLS policies (including `storage.objects`) confirmed present via a direct Management-API read. Vercel env var + Google Cloud client wiring done by the founder same day. **Bug found and fixed 2026-07-30 during live testing:** `App.tsx`'s mount-time history-state-sync effect called `window.history.replaceState(state, '', window.location.pathname)` — passing only the pathname (no search string) silently stripped any `?query` on every page load, including Google's `?code=...&state=...` on the OAuth callback redirect, so `GooglePhotosOAuthCallback.tsx` always saw an empty URL and failed with a false "That connection link looks invalid or expired" — 100% reproducible, not a flaky/stale-state issue as first suspected. Fixed by omitting the `url` argument entirely (`replaceState(state, '')`), which correctly leaves the current URL untouched — matching what the effect's own comment already said it was supposed to do. Verified locally: a callback URL with real query params now correctly reaches the token-exchange call instead of failing at the pre-check. **Known limitation, not a bug:** while the OAuth consent screen stays in Google's Testing mode, only Google accounts explicitly added as test users can connect — not real end users — until Google's app verification review completes.
- Not production-hardened generally: no 2FA/access-control story, minimal tests.
- **Founder action needed: deploy `add-fact` (item 61 fix)** — `npx supabase functions deploy add-fact --project-ref dedtnytxhzzjimkozncc` with a founder-provided access token (no token available this session). Until deployed, the live function still has the first-person misattribution bug.
- **Founder action needed: run `migrations_manual/2026-07-26-gender.sql`** (item 44) — adds the nullable `people.gender` column. Code (PersonDetail's gender dropdown, FamilyTree's ♂/♀ glyph) already deployed and verified in browser preview — it fails open (no crash, no icons/saves) until this runs, so nothing breaks in the gap, but nothing persists either.
- ~~Founder action needed: run `migrations_manual/2026-07-30-moment-sub-events.sql`~~ — **run and confirmed live 2026-07-30** (founder-provided token): `moments.parent_moment_id` column/constraint/index all present. Verified end-to-end in browser preview against the real account — created a sub-event on "Conor & Shelly's wedding" (inherited parent's start date), confirmed the parent/child tiles and "↑ Part of X" link, confirmed the Events.tsx collapse/expand toggle and indented child card, deleted the disposable test sub-event after.
- ~~Founder action needed: run `migrations_manual/2026-07-26-subgroup-member-parent-sync.sql`~~ — **never shipped.** This trigger was added by mistake (not part of the reviewed subgroups plan) and removed same day, before it was ever run — it contradicted the deliberate design that subgroup membership stays independent of the parent's. No founder action needed; adding someone to a subgroup intentionally does NOT also add them to the parent group.
- ~~Founder action needed: run `migrations_manual/2026-07-26-group-subgroups.sql`~~ (item 19, subgroups) — **migration run and fully verified live 2026-07-26.** Full click-through against the real account with disposable test groups: create a subgroup, rename, parent link navigation, parent-roster suggestion chip (add via chip), event tagging via EventDetail's existing "Associate a Group" (zero new code, confirmed), merging a group with 2 subgroups into another root group (subgroups correctly reparent to the survivor), deleting a parent with subgroups (they correctly survive as independent root groups, confirmation copy correctly pluralized). All test groups/events cleaned up after.
- ~~Subgroups showing up as "Associated Groups" of their own parent (and vice versa)~~ — **fixed 2026-07-26.** The Associated Groups suggestion/confirm/manual-picker logic in [GroupDetail.tsx](../src/pages/GroupDetail.tsx) only excluded the current group itself, not its parent or its own subgroups — so a subgroup's roster overlapping the parent's roster made them suggest each other as "associated," duplicating the hierarchy already shown via the Subgroups section. Now excludes parent/subgroup ids from all three (suggestions, confirmed display, and the manual picker). Verified live: 98 FTS/Wings of Blue's "2019" subgroup no longer suggests or lists its parent as an associated group.
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
- **Server-side "today" must never be `new Date()` on its own** — Edge Functions run in UTC, so an evening event in any US time zone (UTC has already rolled to the next calendar day) got resolved/dated tomorrow instead of today. Fixed 2026-07-24: `converse`/`update-moment`'s "today" and `scan-calendar-sources`' UTC-stamped DTSTART parsing now go through `_shared/tz.ts`, formatted in the user's own `user_settings.time_zone` (defaults to `'UTC'` — the old behavior — until set). Any future code computing "today"/"now" server-side for date resolution needs the same treatment, not a bare `new Date()`.
- **A bare `YYYY-MM-DD` string handed to `new Date(...)` parses as UTC midnight, not local midnight** — same underlying gotcha as the guard above, but client-side: `EventDetail.tsx` displayed `event_date` via `new Date(moment.event_date).toLocaleDateString(...)`, which in a negative-UTC zone rolls the displayed date back a day. `dates.ts`'s `eventSortDate`/`formatFullDate` already parse this correctly (append `T00:00:00`, tested in `dates.test.ts`) — `EventDetail.tsx` just wasn't using them for this one line, fixed 2026-07-24. Any new code displaying a bare date column must go through `dates.ts`, never construct `new Date()` from it directly.
- **Display text derived from a navigation-time prop (breadcrumb label) goes stale the moment the underlying record is renamed mid-visit** — `PersonDetail.tsx` had every nudge/fact-bar/banner string keyed off the `personName` prop instead of the freshly-loaded `person` state, invisible until the manual "add person" flow (2026-07-20) made same-visit renames the common case instead of the rare one. Any page with an in-place rename control needs its own display text to track live state, not what it was called when you navigated in.
- **A blank-shell record's cached AI summary can be generated against its placeholder name/content before it's ever filled in** — `GroupDetail.tsx`'s rename didn't invalidate the cached summary (only membership changes did), so a manually-created group (2026-07-20) could get summarized as "New group" and stay that way forever. Any manual-create-then-fill-in flow needs its rename/edit paths to invalidate the same caches the AI-driven paths already do.
