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
- **Deploying Edge Functions:** `npx supabase functions deploy <name>` using `SUPABASE_ACCESS_TOKEN` (persisted in local `.env`, gitignored, since 2026-08-03 — no longer pasted per-session), or paste the file into the Supabase dashboard and click Deploy as fallback. `supabase/functions/_shared/` is bundled automatically.
- **Schema changes:** applied directly via the Management API (`POST /v1/projects/{ref}/database/query`, same persisted token) as the default path now; SQL saved under `supabase/migrations_manual/` and handed to the founder to paste in the SQL Editor only when a write gets blocked or is a large/production-risk bulk change.
- **Google Photos import (2026-07-30, item 27):** this app's first OAuth flow and first Supabase Storage usage — see §3 `lib/googlePhotosAuth.ts`/`lib/googlePhotosImport.ts`/`PhotoImportReview.tsx`, §6 `photo_connections`/`photo_clusters`/`photos`, §10 for what's still needed before it's live. New Edge Function secrets `GOOGLE_PHOTOS_CLIENT_ID`/`GOOGLE_PHOTOS_CLIENT_SECRET` (server-side only, from a Google Cloud OAuth Client) and a new Vercel env var `VITE_GOOGLE_PHOTOS_CLIENT_ID` (the client ID itself isn't secret). A private `photos` Storage bucket holds resized (~1600px) copies, RLS-scoped per user by folder prefix — deliberate choice over leaving photos live in Google, since a picker session's access to a picked item expires with the session (no stable long-term pointer available).
- **Sign in with Google (2026-08-03):** `Login.tsx` has a "Continue with Google" button using Supabase Auth's built-in OAuth (`supabase.auth.signInWithOAuth`) — unlike the Google Photos flow above, this is fully handled by Supabase (no custom Edge Function/callback route). Not usable yet — see §10 for the two founder steps left.
- **The 1000-row cap (2026-08-10, swept):** PostgREST caps ANY response at 1000 rows and reports nothing — no error, no flag, just a shorter array, so an unpaged account-wide read looks successful while quietly omitting data. Every Edge Function read was audited; the fix is `_shared/pagedSelect.ts`'s `fetchAllRows()`, which pages and REQUIRES an `.order()` (paging without a stable sort duplicates and skips rows, which is worse than the truncation). Tables already over the cap on the founder's account: `contact_import_candidates` 2008, `notes` 1456, `person_groups` 1183. `people` sits at 700 and is the next to cross. **Embedded selects are NOT capped** — verified empirically (all 796 event-attached notes come back through `moments.select("notes(...)")`), so single-parent embeds like update-group's roster are fine. Writes are unaffected. Narrowed reads (`.eq()` on one id, `.limit(n)`) are fine. When adding any new account-wide read, page it. **The first sweep covered Edge Functions only; the browser reads the same tables directly and was swept 2026-08-10 (second pass) via `src/lib/pagedSelect.ts`** (browser twin of the Deno helper — keep the two in sync). That pass fixed a live bug: Home's "Connections to make" card read `person_groups` unpaged, so 183 of 1183 memberships were invisible and read as "not a member yet" — 21 of its 29 questions were about people already in the group, which is why an accepted suggestion came back on the next visit. Paged now: `suggestConnections.ts`, `suggestEventGroups.ts`, `dismissedSuggestions.ts`, `familyTree.ts` (loadFamilyGraph), `relationshipsTable.ts` (whole-table branch). **Still unpaged: the page-level reads in `People.tsx`, `Groups.tsx`, `Circle.tsx`, `Events.tsx`, `FamilyTree.tsx` etc. — see backlog item 88.**
- **Token-free live verification (no login needed):** a column exists if PostgREST returns 200 (400 if not, via anon key); a function is deployed if its URL returns its own error/401 rather than Supabase's `NOT_FOUND`.

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
│   │                            serif). `CountdownsSection.tsx` was deliberately skipped in the
│   │                            sweep (concurrent uncommitted work elsewhere at the time) — still
│   │                            on the old green `ink`-as-accent pattern, needs a follow-up pass.
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
│   ├── groupTypes.ts          — GROUP_TYPES fixed list (Family/Friend group/School/
│   │                            Team/Work), shared by Groups.tsx + GroupDetail.tsx
│   ├── groupDisplayName.ts    — groupDisplayName(group, nameById) → "Parent / Child" for a
│   │                            subgroup, bare name otherwise. Always qualifies (no
│   │                            collision check). Single source of the format.
│   ├── searchRanking.ts       — (2026-08-10, tested) rankMatches()/matchScore() for
│   │                            SearchAddPicker: orders substring matches exact-first,
│   │                            then prefix ("98 FTS / …" descendants), then own-name
│   │                            (text past the last "/"), ties shallowest-then-shortest.
│   │                            Exists because full-chain labels made a parent group
│   │                            match-collide with all its subgroups and lose.
│   ├── subgroupColors.ts      — (2026-08-04, tested) subgroupColorMap() assigns a
│   │                            `subgroupPalette` colour per subgroup BY POSITION (cycles past
│   │                            8; position not a hash of the id, because a hash collides and
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
│   ├── suggestEventGroups.ts  — (2026-08-08, item 85) untagged events whose EVERY attendee (2+)
│   │                            belongs to one group → "Tag this event as that group?".
│   │                            All-attendees, not most: at 2+ the real account gave 55 noisy
│   │                            pairs, all-attendees gave ~10 good ones. Deliberately NOT gated
│   │                            on groups.suggestions_enabled (that flag means "suggest PEOPLE
│   │                            for this group" and is off for 63 of 68 groups). Accept copies
│   │                            EventDetail.tsx's handleTagGroup.
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
│   │                            lists plus an AMBIGUOUS blocklist (Jordan, Casey, Sam…) checked
│   │                            first, so the clarify prompt stops asking about the obvious ones.
│   │                            The founder's "only ask under 75% sure" is expressed as list
│   │                            membership, NOT invented per-name probabilities. Hyphenated names
│   │                            need both halves to agree (else Jean-Pierre reads female). Guesses
│   │                            NEVER reach the database — they fill gaps in `Graph.genderById`
│   │                            only, and a recorded gender (including non-binary/other) always wins
│   ├── nameMatchStrength.ts   — (2026-08-10) `nameMatchStrength(contactFullName, personNameKeys)`
│   │                            → strong/weak/none. Surnames decide: both sides have one and they
│   │                            differ = not the same person. weak = first name matches but one
│   │                            side has no surname on file, an initial against a matching
│   │                            surname, or a 1-char typo in a 5+ char surname (Baerman/Baermann).
│   │                            Aliases (nicknames/middle/goes-by) count as given names only,
│   │                            never surnames. MIRRORED verbatim in `_shared/nameMatch.ts` for
│   │                            the import; `nameMatch.test.ts` runs both and fails on drift.
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
│   ├── PetDetail.tsx          — (2026-08-01) a pet's own page, crumb type `pet`, URL `/pet/:id`.
│   │                            Founder chose this over "tapping a pet opens its owner's
│   │                            profile," so a pet is a record you navigate TO, like a group or
│   │                            event. Species emoji + name heading, breed/species line, dates,
│   │                            Details rows, notes, owner PersonChips ("Belongs to"), and the
│   │                            ONLY pet edit form in the app. Delete here is a real delete
│   │                            (removes it from every profile) and says so — distinct from
│   │                            PetsSection's × , which only unlinks.
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
│   │                            who-was-there (hover-untag, non-destructive) +
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
│   │                            Summary regeneration (2026-08-08): the gate is
│   │                            `hasSomethingToSummarize()` (lib/moments.ts), not
│   │                            `raw_description.trim()` — a manually-created event has a
│   │                            permanently-empty raw_description, so it could gain any
│   │                            number of notes and stay stuck on "Nothing written yet"
│   │                            forever even though summarize-moment reads notes fine.
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
│   ├── DunbarDetail.tsx       — Dunbar's-number explainer + tier progress bars
│   ├── DueForUpdate.tsx       — people sorted oldest/no note first
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
                                Third disposition alongside merge/save-as-note (2026-08-03): "+ Add as
                                a sub-event" files the candidate as its OWN new event nested under an
                                existing one (`parent_moment_id`, item 35) — offered on the likely-match
                                banner, as a swap from a chosen merge target, and via its own
                                search-an-event picker. Accept button reads "Add as sub-event"; the
                                confirmation reads `Added as a sub-event of "{parent}" — {event}`.
                                Parent picker excludes events that are already sub-events (one level
                                deep, same rule as EventDetail.tsx), from an isolated fail-open
                                `parent_moment_id` query so an unrun migration degrades instead of
                                breaking the page.
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
│   │                            expands into a note box (mic included, the primary use) plus a
│   │                            row of secondary actions, each opening its own panel. Owns its
│   │                            open/closed state, so pages no longer keep their own
│   │                            `showXPicker` flags. REPLACED FloatingNoteButton.tsx, now
│   │                            deleted. On EventDetail (attendees / associate a group / new
│   │                            sub-event / Manage) and GroupDetail (add people / associate a
│   │                            group / new subgroup / Manage). Hidden when `readOnly`, so the
│   │                            demo never renders it.
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
│   ├── VoiceInputButton.tsx   — mic → `transcribe`; renders null w/o MediaRecorder.
│   │                            Optional `onBusyChange(busy)` (2026-08-02) reports
│   │                            recording/transcribing so a caller can disable its save
│   │                            button — accepting mid-transcription otherwise drops the audio.
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

Every page listed above under `pages/` (Home/People/PersonDetail/Groups/GroupDetail/Events/EventDetail/FamilyTree) is split into a data-fetching container plus a pure, exported `*View` component (2026-07-23) — `src/pages/demo/` (`DemoShell.tsx` + a one-time `DemoIntro.tsx` welcome walkthrough + 8 thin containers) and `src/lib/demoData.ts` (a fictional "Gary Pemberton" persona, zero real data, zero API calls) feed that same static data into each real `*View` for the public landing-page demo (see §7's "See a live demo"), so a future UX edit to any of those `*View`s updates the demo automatically.

`src/pages/demo/DemoIntro.tsx` (2026-07-23, founder feedback — a first-time visitor dropped straight into a populated fake account had zero context): full-screen 5-step reading sequence (own `Stage`/dot pattern mirroring Onboarding.tsx's, DemoShell's own color palette) shown once per `DemoShell` mount, before the tab nav — Welcome, then one pain-point-framed paragraph each for Home/People/Events/Groups, referencing real Gary Pemberton specifics. Skip on every step. Plain `useState` in `DemoShell` (`introSeen`), no persistence — `DemoShell` fully unmounts on "Exit demo," so re-entering shows the intro again by design.

`App.tsx` is the traffic controller: auth state, first-run onboarding gate (`onboardingPending`/`checkOnboarding()` — see Onboarding.tsx above), tab nav (Home/People/Events/Groups), a generic `navStack: Crumb[]` breadcrumb stack any page can push person/group/event crumbs onto, persisted to sessionStorage (`boomer-nav`) so refresh stays put. Voice input + AutoGrowTextarea are on every conversational text box (Home, event chat, group chat, fact bar). `authView` (`'landing' | 'login' | 'signup' | 'demo'`) also gates `DemoShell` in when `!session`. **Address bar now mirrors `{view, navStack}`** (2026-07-23, founder-requested — the URL used to never change while clicking through the app): `buildPath()`/`parseNavFromPath()` turn it into `/:tab` or chained `/:crumbType/:crumbId` segments. Deliberately the LIGHTWEIGHT of two options offered (the other being a full router-library rebuild) — no new dependency, sessionStorage stays the full-fidelity same-tab-refresh mechanism (real labels/memberIds); `history.state` carries the same full-fidelity payload for Back/Forward (`popstate` reads it directly, no lossy re-parsing needed in-session); `parseNavFromPath()` is only a fallback for a fresh tab/pasted link with neither sessionStorage nor `history.state` available — it reconstructs the right page (every detail page re-fetches by id anyway) but breadcrumb/back-button TEXT falls back to showing the raw id instead of a real name in that one lossy case. Not real client-side routing — no route-level code splitting, no deep architecture change, verified live (forward nav, browser Back, browser Forward, hard reload, and the no-sessionStorage fallback all confirmed working against the real account).

## 4. Edge Functions (`supabase/functions/`)

| Function | Purpose |
|---|---|
| `converse` | **The main unified brain** (Home). Per turn decides: answer question / capture new moment(s — `moments` array, multiple per turn supported) / update moment / rename placeholder / name+nickname corrections / create+tag groups / create+tag tags / relationship signals / logs recall attempts to `search_log`. AI-suggested tags (item 28, 2026-07-22): each moment entry's `moment_tags: string[]` is resolved via `findOrCreateTagId()` — the same find-by-name-or-create pattern as `moment_groups`/`findOrCreateGroupId`, capped at 1-3 tags per moment with an explicit "prefer reusing an existing tag over coining a near-duplicate" instruction (both live in the fully-static `stableInstructions` tier, so this cost nothing extra to cache; the tags roster itself lives in the 1-hour roster tier alongside the groups roster). `update-moment`'s `add_tags` deliberately NOT added yet (see §8 item 28 — holding the AI surface to one entry point until real usage confirms the vocabulary stays clean). Knows the self person (`is_self`) and their known relationships (`_shared/selfContext.ts`) so "my mom"/"my parents" resolve without a named subject (2026-07-20). Chat-tone preference (2026-07-23, items 22/49): `_shared/userSettings.ts`'s `buildChatToneInstruction` reads `user_settings.chat_tone` and appends one of 4 fixed instruction sentences to the roster tier, right after `selfInstruction` — never the stable tier. "Today's date" in the final uncached tier is now computed in the user's own `user_settings.time_zone` via `_shared/tz.ts` (2026-07-24, bug fix — see §12), not the Edge Function's server UTC clock. Quirk: model occasionally replies in prose instead of the JSON envelope — falls back to showing that prose as the reply. **2026-07-30 (founder feedback: event capture was slow/inaccurate, notes dropped detail):** the 6 initial roster reads now fire via `Promise.all` instead of sequentially; a `notes` entry can now have `"person": null` for a general event-level detail not tied to one attendee (written as `moment_id` + `person_id: null`, same shape `GroupDetail.tsx`'s manual notes already use); `event_date`/`event_end_date` are sanitized (`_shared/dateValidation.ts`) before ever reaching a write; expanded worked examples for ordinal/weekday/compound date phrasing ("the 4th", "next Tuesday", "two weeks from Saturday"); every new moment now requires a concise `occasion`; `summarize-moment` is kicked off in the background (`EdgeRuntime.waitUntil`) right after a new moment is created instead of waiting for the user to open the event page. Deployed and verified live (see PROJECT_HISTORY for the full test transcript). **2026-08-01 (item 73, pets):** loads `pets` + `person_pets` as two more top-level queries in the same `Promise.all` (SEPARATE, never an embed on the people select — an embed of a not-yet-migrated table fails the whole query and takes the roster down with it), renders a pet roster into the 1-hour roster tier (pets change at people-cadence, so this costs no more than a person write and leaves the hot moment-capture path alone), and handles a turn-level `pets` write field. Resolution mirrors the people guards exactly: owner-scoped first (`ownerId|petname`) so two dogs named Bella stay distinct, then a unique bare name, with an `ambiguousPetKeys` set so a shared bare name resolves to nothing rather than the last-indexed one. Updates are ADDITIVE ONLY — fill blank fields, union `attributes` by lowercase label, never overwrite what the profile form set, since chat is the lossier channel. A pet with no resolvable owner is skipped with a loud `console.error` rather than written as an invisible orphan. The prompt's headline rule is "A PET IS NOT A PERSON" (never `new_people`/`notes`/`relevant_people`/`renames`/`family_signals`) — before this, "Sarah got a puppy named Biscuit" created a *person* named Biscuit in the People list and Dunbar count. **2026-08-02 (founder feedback — a date night at Pup Dog created profiles for the couple they met there):** a brand-new name mentioned in a story no longer becomes a profile. `new_people` is now narrowed to names the founder EXPLICITLY asked to add; everyone else brand-new goes in `mentioned_names: [{name, note}]` (per-moment, plus a top-level array for a mention with no event), which writes the note as a general note on the event (`person_id: null`) and returns `mentionedPeopleSuggestions` for the frontend banner — so the detail is saved unconditionally and only the profile is optional. Guards: a name already in the roster gets the note attached to them instead (no banner); duplicates and anyone already covered by `familyResult.newPersonSuggestions` are skipped so one person never gets two banners. Same turn also fixed the moments context the model reads back: a `person_id: null` note no longer renders as `someone: <text>` nor adds a phantom attendee called "someone" to that event's `People:` line. A `console.log("usage", …)` line is kept in deliberately for the CLAUDE.md rule-3 cache check. Verified live: read-only turn = 59,886 `cache_read_input_tokens` / 56 created; a pet-write turn still reads the stable tier (7,093) and only rewrites roster+moments, which is exactly the tiering claim. **2026-08-03 (item 77, founder-reported):** `stableInstructions` now explicitly forbids inventing any detail the user didn't actually state (no such rule existed — a general `person: null` note could read as plausible-but-fabricated, e.g. assuming a pregnancy discovery happened "at an ultrasound" when the user never said that) and clarifies a `notes` entry only attaches to a named attendee when THEY did/said/experienced it, not merely because the sentence is about them (was misattributing "we found out the baby's a girl" to the baby's own profile). Also: the `summarize-moment` background kickoff now fires for ANY moment that gains a note this turn, not just a brand-new one, deduped via a `momentIdsNeedingResummary` set — previously an already-recorded moment gaining detail via Home chat had no invalidation path for its cached summary at all (unlike EventDetail's own chat), and could go stale indefinitely. Deployed and live-verified. **2026-08-10 (subgroup roll-up, plus two pre-existing bugs it uncovered):** the groups roster now applies the same "anyone in a subgroup is a member of the group above it, at any depth" rule the app renders (`_shared/groupRollup.ts`, the Deno twin of `src/lib/groupRollup.ts`, pinned together by `src/lib/groupRollupParity.test.ts`) — before this the model answered "who's in Air Force?" from that group's own rows only and contradicted the screen. Member lists are sorted by person id rather than tree-visit order, so reparenting one subgroup can't reshuffle an unrelated parent's list and bust the 1h roster tier. Roster grew ~2% (18,555 → 18,841 chars). **Bug 1, silent:** the `person_groups` read was unpaged and PostgREST caps a response at 1000 rows without saying so — at 1183 rows the model had been missing ~15% of every group membership in the account. Now paged via `fetchAllPersonGroups`, same `.order()` on every page so the cached prefix stays byte-identical. **Bug 2:** `max_tokens` 4096 → 8192. This model thinks before answering and thinking spends the SAME budget, so a reasoning-heavy question ("how many people are in the Air Force group?", ~300 names) burned all 4096 on thinking and returned NO text block at all — which failed to parse and showed "Sorry, I couldn't process that", after being billed in full. Observed live: `output_tokens` 4096, `thinking_tokens` 4095, zero text. A `stop_reason === "max_tokens"` + no-text-block check now gives that case its own honest message ("ask about a smaller group") rather than the generic apology, since "try again" would just burn another full budget on the identical question. Deployed and live-verified: the previously-failing count question now answers, and a repeat turn reads 72,504 `cache_read_input_tokens` against 54 created. |
| `add-fact` | Classifies fact-bar text: name/nickname update, birthday/anniversary (upserts `reminders`), or plain note. Group inference (`group_signal`, high=auto/medium=ask). Relationship handling via `_shared/relationships.ts`. A fact typed on the self profile's own page already resolves "my X" correctly with no special-casing (the subject is always whichever profile is being viewed). |
| `update-moment` | Called by `NoteWithDetection.tsx` (2026-08-03, replaced the old `UpdateMomentChat`) after each note already saved verbatim — detects attendees/relationships only, never re-inserts a general note; `needsClarification` (was `done`) signals a one-off disambiguating question instead of an open thread. Has full people+events rosters, `moment_field_updates` (when/where/title), `add_groups`, relationship signals, self-person "my X" resolution (2026-07-20). "Today's date" is time-zone-aware, same fix/mechanism as `converse` above (2026-07-24). **2026-07-30:** same roster-read parallelization, date sanitization, and expanded date-phrase examples as `converse` above — deployed live. **2026-08-02:** same `mentioned_names` / narrowed-`new_people` / `mentionedPeopleSuggestions` behavior as `converse` above (flat array — the moment is already fixed here). **2026-08-03 change deployed and verified live** (direct-invoke test: response now returns `needsClarification` not `done`, and a general-detail test message produced no note row, confirming the duplicate-note fix). **Same-day follow-up (item 77):** `additional_notes` guidance now also forbids inventing unstated details and states the same misattribution rule as `converse` (a note only belongs to a named attendee when they themselves did/said/experienced it). Deployed and live-verified. **2026-08-08 (founder report — a manually-created event stayed "Untitled moment" and tagged nobody):** the prompt had no rule that could ever NAME an unnamed event (`occasion` was "only set when the user is giving new or corrected info for that specific field"), which is why events born in the Home chat came out titled and "+ Add Event" ones never did — `converse` has that instruction, this didn't. Now: the volatile moment tier reports an untitled moment as `(not named yet)` (was `unknown`, which read as "not my business") and `stableInstructions` carries a generic auto-naming rule keyed off that exact phrase, explicitly scoped so a name is a LABEL built only from words actually given — it does not license inventing a place/date/occasion type, which would collide with the item-77 anti-invention rule. Rule in the 1h tier, signal in the volatile tier, so the cached prefix stays byte-identical. `location`/`when_text`/`event_date` deliberately NOT given backfill prompting (they're facts, not labels, and a wrong `event_date` moves the event off the calendar). Same turn: `max_tokens` 1500 → 3000 and a `stop_reason === "max_tokens"` guard placed BEFORE the regex salvage — a truncated response used to parse-fail, salvage only `reply`, and silently discard every `additional_notes`/`moment_field_updates` while returning 200 with a cheerful message; the discarded `{error}` on the `moments` update and `moment_groups` upsert are now checked (an RLS rejection previously reported `changed: true` with the title unchanged), `changed` is derived from writes that actually succeeded, and a new `applied` payload itemises them for the frontend checklist. Also fixed: an untitled moment leaked the literal string `"null (last week)"` into the 1h-cached other-events roster. Deployed. |
| `update-group` | Called by `NoteWithDetection.tsx` (2026-08-03, replaced the old `UpdateGroupChat`) the same way as `update-moment` above — `needsClarification` replaces `done`. Rename, members, tag/untag events, member facts (tagged `source_group_id`), relationship signals, self-person "my X" resolution (2026-07-20). Saves per turn. **2026-08-03 change deployed and verified live.** **Same-day follow-up (item 77):** same anti-invention/misattribution rule added to `notes` guidance as `converse`/`update-moment`. Deployed and live-verified. **2026-08-08:** returns the same `applied` payload as `update-moment` (group-shaped: `renamed`/`peopleCreated`/`peopleAdded`/`peopleRemoved`/`eventsTagged`/`eventsUntagged`/`notesAdded`) so the shared `NoteWithDetection` progress checklist works identically on a group. Deployed. |
| `person-facts` | Extracts Key Facts from a person's notes — explicitly stated only, never inferred. Cached in `people.key_facts`; `{refresh: true}` regenerates. Failure paths return cached facts, never wipe. Linked categories (spouse/siblings/parents/kids) resolve to person chips on exact-full-name match OR a `relationships` table row (2026-07-20, additive — never overrides an AI-extracted fact, just fills in a linked person the table already knows about). Has its OWN category vocabulary (not the shared 5-kind enum — known mismatch, read-only so harmless). |
| `summarize-group` | One-sentence group description → cached `groups.summary`. Members = explicit roster only, never event attendees. |
| `summarize-moment` | First-person event summary → cached `moments.summary`. Cleared/regenerated when notes change (Home-chat path fixed 2026-08-03, see `converse` above — was previously only reliable via EventDetail's own chat), or on-demand via EventDetail's manual refresh button. Notes are ordered by `created_at` and numbered in the prompt; system prompt explicitly tells the model note order is recording order, not narrative order, and to infer real chronological order from context clues before writing (2026-07-25, fixes summaries reading in whatever jumbled order notes were recalled in). **2026-07-30:** dropped the fixed "2-4 sentences" cap (founder feedback: summaries were dropping real detail to hit it) — now explicitly prioritizes completeness over brevity, no fixed length; `max_tokens` raised 250→600 to match. Deployed and verified live. **2026-08-03 (item 77):** now looks up the `is_self` person (one extra parallel query) and explicitly anchors the first-person "I" voice to them in both the context and system prompt — previously had zero self-context, so "I" could latch onto whichever named person's note was most detailed instead of reliably being the account owner (founder-reported: a summary reading from a spouse's perspective). Same anti-invention rule as `converse` added. Deployed and live-verified. |

**2026-08-05 — extended-family vocabulary in `converse` only.** `_shared/selfContext.ts` gained `buildKinInstruction` alongside the untouched `buildSelfInstruction`: grandparents, aunts/uncles, first cousins, nieces/nephews, grandchildren, plus parents-/siblings-/children-in-law. Before this the chat could resolve "my mom" but not "my cousin Steve". Wired into `converse` ONLY — `update-moment`/`update-group` are structured-extraction paths that don't need the vocabulary, which halves the blast radius. Rides the existing 1-hour roster tier, so per-turn cost is a cache read; bounded at two generations out (~10-40 names, ~150-250 tokens) rather than a line per roster person, and every list is sorted with buckets emitted in fixed order so an unchanged roster serializes byte-identically and can't bust the cache. Its one unfiltered `relationships` select REPLACES `buildSelfInstruction`'s 4-6 bounded round-trips. `_shared/kinship.ts` is the math-only mirror of `src/lib/relationshipCalculator.ts` (no gendered nouns, no paths, no step handling — the model needs the category, not the wording) and is the FIRST mirror in this folder with tests: `kinship.test.ts` runs the same fixtures through both copies and asserts they agree, so drift fails `npm test` instead of surfacing as the AI calling a nephew a cousin. Do the same for any future mirror. Deployed; live-verified that "Who are my first cousins?" and "who are my aunts and uncles?" both answer from the roster without asking back.
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
dismissed_suggestions
              id, user_id, kind ('family_coparent'/'family_couple'/'event_group',
              CHECK-constrained), subject_id, object_id, created_at; UNIQUE
              (user_id, kind, subject_id, object_id). Item 85, 2026-08-08 — the "No"
              store for Home's newer suggestion types (lib/dismissedSuggestions.ts).
              NO foreign keys on subject_id/object_id: what they point at depends on
              kind (people/moments/groups), and an orphan row after a delete is
              harmless. family_couple normalizes subject < object so the pair matches
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
- **Relationship calculator** (2026-08-05, item 20's family-tree half — see §3 `relationshipCalculator.ts`/§4): the app can now NAME any relationship, not just draw it. Four surfaces off one engine: a "How is X related to…?" action on the family tree's tap sheet (pick anyone on file, get the label plus the chain — "Steve Volin is Harry Carson's grandchild by marriage", `Harry → their child Barbara → their child Amy → their spouse Steve`); a second line on every tree tile giving that person's relation to whoever the tree is centered on (descendants-mode trees anchor on the self person instead, since their "root" is an arbitrarily-picked founder); a chip on every profile ("Your great-grandparent", tap to expand the chain); and extended-family vocabulary in the Home chat (§4). Costs no extra queries on the tree — `FamilyTree.tsx` keeps the graph it already loaded. Gendered wording depends on `people.gender`, which is mostly unset until item 44's migration runs, so most labels currently read in the neutral form ("aunt/uncle", "grandchild") rather than "aunt"/"grandson". Verified live on the Bach tree.
- **Event tags** (items 28 + 34, 2026-07-22 — see §3/§4/§6): manual tag/untag on EventDetail (create-or-reuse picker, browse-all-on-focus, hover-remove chip) and AI-suggested tagging via `converse` (capture-time only, capped 1-3/moment, reuse-biased), backed by new `tags`/`moment_tags` tables. Events page has a tag filter dropdown (growing from tags actually applied) plus a "Manage tags →" link to `ManageTags.tsx` for a full add/rename/delete view with usage counts. 10 generic starter tags auto-seed once per account. Alphabetical order enforced at render time everywhere tags list (picker, chips, filter, Manage Tags), independent of creation order. Verified live end-to-end against the real account, test data cleaned up after. `update-moment`'s chat-based `add_tags` and `suggest-prompts`'s tag signal deliberately deferred — see §8 item 28.
- **Contacts import** (item 65, 2026-07-27): founder-requested, previously-parked "iPhone Contacts import" now built. vCard (.vcf) upload only (`ContactsImport.tsx`, no Storage bucket — base64-in-JSON-body, same pattern as voice upload), parsed by a hand-rolled `_shared/vcard.ts` (handles Apple's item-grouping/X-ABLabel convention for Anniversary + related-names, BDAY-no-year, multi-value TEL/EMAIL/ADR/URL). Deliberately NOT a one-shot bulk-accept: a curation step (`ContactSelection.tsx`, paginated 50/page, immediate per-row DB writes so nothing is lost mid-browse) comes before the usual accept/reject-with-matching review (`ContactImportReview.tsx`, scoped to founder-selected contacts only). Matching: exact/nickname first, then word-overlap fuzzy fallback (`_shared/nameMatch.ts`), corroborated by exact phone/email match. Accept into an existing person fills blank scalar fields and unions array fields (never overwrites/loses existing data); birthday/anniversary go through a new shared `src/lib/reminders.ts` helper into the existing `reminders` table. Business-only vCards (no personal name) are silently skipped in the parser itself. Contact photos and auto-linking Apple's related-names into the real `relationships` table are explicitly out of scope this pass (see §8 item 65). New "Contact Info" collapsible section on `PersonDetail.tsx` (own isolated query, same pattern as `gender`) makes birthday/address/phone/email/etc. manually editable on any profile too, not just importable. Verified live end-to-end against the real account (upload → skip business contact → select/skip/undo with reload-persistence confirmed → new-person accept → merge-into-existing accept with field union confirmed via direct DB read → PersonDetail rendering → re-upload dedupe) — all test data cleaned up after. **Bug fix #1 (2026-07-26):** oversized uploads (e.g. real iCloud exports with a full-res photo embedded per contact, which the parser never reads) were bloating the upload past the Edge Function's ~55MB request-size ceiling (`WORKER_RESOURCE_LIMIT`). `ContactsImport.tsx` now strips `PHOTO`/`LOGO`/`SOUND` fields client-side before base64-encoding. Confirmed fixed against a synthetic 50MB photo-laden file. **Bug fix #2 (2026-07-26, the founder's actual reported file — 2071 contacts, 518KB, no photos):** same `WORKER_RESOURCE_LIMIT` error but from CPU, not payload size — `_shared/nameMatch.ts`'s fuzzy matcher recomputed word-set/regex work from scratch for every (imported contact × existing person) pair, so importing thousands of contacts against an account with hundreds of people already on file ran millions of redundant regex/Set operations and blew the compute budget. Fixed by precomputing each person's candidate-name word-sets and normalized email/phone Sets once (`buildPersonIndex`) before the per-contact loop instead of inside it. **Deployed and confirmed live 2026-07-27** (founder-provided token) — re-tested against the founder's actual 2071-contact/518KB file that originally surfaced this bug: 2008 candidates added, 3 skipped (business-only), no error. That real file's candidates are now sitting in the founder's actual review queue (this was the founder's real data, not test data — nothing to clean up). **Bug fix #3 (2026-07-31):** a high-confidence auto-match (two different real people who happened to share one phone number) had no way in `ContactImportReview.tsx` to say "not them" — the name-edit fields only ever rendered when unmatched, so a wrong match silently discarded any name typed in and merged the new contact's info into the wrong existing person on Accept. Fixed with an explicit "Not the same person — add as new" button that clears the match and reveals the editable name fields, plus an accept-time snapshot (`UndoInfo`) enabling an inline "Undo" link on the post-accept confirmation that exactly reverses either outcome (deletes the newly-created person, or restores an existing person's pre-merge field values/reminders/groups/note) and puts the candidate back to `status='selected'` to be reviewed again. Root-cause data fix applied live (the founder's actual "David Bengford" contact, wrongly merged into "David Adelstein," split back into its own person — confirmed no shared groups/notes/reminders had been added, so the split was clean). New code verified live via a disposable test person + candidate (both the "add as new" path and the "undo a merge" path confirmed via direct DB read, test data cleaned up after). **Bug fix #4 (2026-08-10, founder-reported "it asks if every single Alex is Alex Lesar"):** the fuzzy matcher scored names by word overlap divided by the SHORTER name, so "Alex Lesar" vs. "Alex Smith" scored 0.5 (a match) and vs. a bare "Alex" on file scored 1.0 (high confidence) — 574 of the founder's 576 stored matches were that bug. Replaced with a surname-first rule (`_shared/nameMatch.ts` + its `src/lib/nameMatchStrength.ts` mirror — see §3); exact/nickname `idByName` now claims WHOLE names only, since first-name keys were the other half of the same bug. A shared email/phone no longer overrides a given-name mismatch on its own (households share a landline), phone numbers compare on their last 10 digits, and two equally-plausible people yield a question or nothing rather than a coin flip. `ContactImportReview.tsx` re-checks every stored match on read and sweeps the whole `selected` set once per visit (chunked 100/write), so an existing queue self-heals without a re-import — the founder's dropped from 576 bad matches to 7 real ones on one page load. Deployed + verified live.
- **Pets** (item 73, 2026-08-01): profile card, own detail page, and People-list presence — **migration run and verified live end-to-end 2026-08-01 (§10).** Pets are shared records (`pets`/`person_pets`), so the family dog lives on both spouses' profiles and is edited once, on the pet's own page; the picker searches every pet on the account, making "add a new pet" and "attach the spouse's dog" the same gesture, and removing from a profile unlinks rather than deletes. Species is free text and each pet carries an open `{label, value}` Details list, so a fish and a horse both fit without new columns. Pets also appear in the People list with a species emoji (🐕/🐈/🐟/🐾), which is a display merge only — they never enter the People count or Dunbar math. Deceased pets sort last, render as "In memory," and get no follow-up nudges. **Home chat reads AND writes pets** (`converse`, deployed 2026-08-01): "Sarah got a puppy named Biscuit" creates and links it, "what's Sarah's dog called?" answers from the roster, "Biscuit is Tom's dog too" adds a second owner rather than a duplicate pet, two same-named pets make it ask which, and a pet that died is recorded and spoken about in the past tense. Chat writes are additive-only — they fill blanks, never overwrite what the profile form set. Merge carries pets to the survivor; delete-profile cleans up its links.
- **Countdowns** (item 83, 2026-08-06 — **needs the migration in §10 before the add/dismiss half works**): a collapsible section at the bottom of the Calendar page, below the month grid. Auto count-ups need nothing added — any past event tagged "Milestone" and any birthday/anniversary with a year on file shows how long it's been (deceased people excluded). Countdowns for what's ahead are opt-in: "+ Add" offers a plain countdown ("Baby due date"), a countdown that's also a real event, or pinning an event already on file. Cards under a week out tick down to the second; a card dated today reads "Today". Dismissing a card only removes it from Countdowns, never the event or birthday behind it. The cards read as one timeline in their own scroll box — past above the Today line, upcoming below, opening centred on it, with a "Today" button to jump back. Each card's ⚙ (needs the settings migration in §10) renames it for the countdown only, picks which units it counts in, sets it to repeat weekly/monthly/yearly, or retires it once its date passes instead of counting up.
- Demo persona seed data exists ("John & Jane Doe", ~18 people/~22 moments — fake, handwritten UUIDs; don't pattern-match on it) — separate from the item below, and not used by it.
- **"See a live demo" public landing-page demo** (2026-07-23, persona reworked 2026-07-23; scaled up 2026-07-23): a "Gary Pemberton" persona (216 people, 4 groups, 125 moments, 298 notes, spanning 2011–2026 — wholly original, no real person/IP; retired Regional Operations Manager at a fictional industrial distributor, not ex-military — the original aviation/"Squadron" framing read as generic and was replaced) hardcoded in `src/lib/demoData.ts`, click-through via `authView === 'demo'` → `DemoShell` → a one-time `DemoIntro` welcome walkthrough (see §3, counts there now pulled live from `demoData.ts` instead of hardcoded). Zero Supabase/Edge Function calls anywhere in the demo, by design (CLAUDE.md rule 3 — a public, unauthenticated surface must not be able to run up API cost); the Home chat is scripted (fixed prompts/replies) rather than calling `converse`. Multiple entry points on Landing.tsx now (see §3 Pass 4). Every moment carries 1-2 tags (`DEMO_TAGS`, 8 total: Sports/Milestone/Family/Reunion/Holiday/Work/Golf/Catch-up); the demo's Events tag filter and EventDetail tag chips work like the real app's. `DemoShell` now opens on `DemoIntro.tsx` first (see §3) — founder feedback: dropping a first-timer straight into a populated fake account with no context was "totally useless." 2026-07-23 scale-up: `DemoEventDetail.tsx` was fabricating a generic "Was there." note per attendee instead of surfacing real `DEMO_NOTES` tied via `momentId` (real ones now take priority, placeholder only fills gaps); the original 34 moments got filled out to 2-3 tied notes each; Frank/Steve/Ray/Harold got real spouse/kid relationship edges (Pete deliberately left without, for realism); a generated long-tail roster (~180 people — coworkers/neighbors/school parents/community/extended family, deterministic name-pool generation in `demoData.ts`, most with a single note, ~90 paired with a small one-note "quick capture" event) was added on top of the hand-authored core so the roster reads like a real long-used contact list instead of a curated highlight reel.

## 8. Backlog — MASTER LIST (founder's priority list; work order: bugs → quick wins → bigger features)

Items 1–13 (bugs + quick wins) all done 2026-07-18. Also done 2026-07-19: event delete/merge, associated groups, chat layout fix, last-name sort, note source labels, group notes. Also done: 25 (2026-07-20: sibling-group transitive linking + reciprocal-write-on-confirm fix, deployed and confirmed live — see §10); 36 (2026-07-20: manual "add an event" / "add a group" buttons, plus group delete — see §7); 35/Group Types (2026-07-20: `group_type` column + fixed picker on GroupDetail + filter/badge on Groups — see §7); **32 (2026-07-20: real `is_self` flag + `relationships` table, real "My page"/family tree, "my mom/dad" resolution — see §7, DEPLOYED and DB-migrated live, see §10)**.

**Open — bigger features:**
14. Global search bar on every page (decide: text match first vs. semantic — merges with 30).
15. **Relationship-aware smarts** umbrella — partially unblocked by item 32's `relationships` table: "resolve 'my parents'" is DONE (`converse`/`update-moment`/`update-group` all do it now). **Background GROUP-connection scanning + approval log on Home — DONE 2026-07-25** (see item 50/§3 Home.tsx "Connections to make" card, `lib/suggestConnections.ts`) — deliberately scoped to group membership only (deterministic, free), not person-to-person relationship inference, to avoid a recurring AI cost on every Home visit (CLAUDE.md rule 3); a richer AI-based version remains a possible future upgrade, not built. Still open: answer via family links ("Braden's dog" → spouse's note) — **the pets half of this is now unblocked by item 73's `pets`/`person_pets` tables (2026-08-01): a household pet is LINKED to both spouses, so "Braden's dog" resolves off the roster without walking the relationships graph at all — but `converse` doesn't load that roster yet (step C, still to do)**; auto-suggest links from note content beyond what already exists (person-to-person relationship scanning specifically, as opposed to the group-connection scanning now done).
16. Auto-notes from chat for every person mentioned (events do this; extend everywhere).
17. Long story/voice-note handling (1–2 min recording parsed into all its facts) — chat currently chokes on long stories.
18. Real-time voice transcription (words appear as you speak; Whisper is batch-only — partial option: Web Speech captions on non-iPhone only).
19. ~~Group hierarchy~~ — **subgroups DONE 2026-07-26, migrated and verified live.** Founder's real ask, clarified 2026-07-26: nested subgroups under an existing group (e.g. a specific mission under "22 AS", or class year/staff/role under "Wings of Blue"), each with independent membership, so events can be tagged to the specific subgroup. Shipped as a self-referencing `groups.parent_group_id` — see §3 GroupDetail.tsx/Groups.tsx entries and §6. **Extended 2026-08-03 (founder ask):** the UI's one-level cap is gone (arbitrary depth, subgroups of subgroups), and an EXISTING group can now be reparented two ways — drag its card onto another group's card on Groups.tsx, or "Move this under another group…" / "Make it a subgroup instead" in GroupDetail's danger zone. Both replace the founder's workaround of creating a blank subgroup in the target and merging the real group away into it. NOT browser-verified before pushing (founder said push; build + 79 tests green, click-through never ran — no logged-in session available that session). Because a subgroup is just a normal `groups` row, every existing group-picker (EventDetail's "Associate a Group", ImportReview, PersonDetail's "Associated Groups") already worked on it with zero extra code, confirmed live. Still open, deliberately deferred (founder feedback 2026-07-26, given the 2026-07-26 auto-add-to-groups revert): a "rules engine" auto-deriving group C from group A + group B membership — if revisited, should suggest-and-confirm rather than silently auto-write, same as item 15's connection scanning.
20. Data viz: family tree, connection map. — **family-tree half substantially DONE 2026-08-05** (relationship calculator: compare any two people, per-tile relation labels, profile chip, AI vocabulary — see §7). Connection map still open. Adjacent family-tree ideas surveyed with the founder the same day and NOT built, roughly in value order: tree health check (flag impossible/suspicious data — someone their own ancestor, three biological parents, a child older than a parent; the Barbara Bach class of bug in §10 is the live example); birth years/lifespans on tiles (the tree never joins `reminders`, so no dates appear anywhere on it); search-and-jump within the tree; export the tree as an image (it's already SVG); zoom/fit-to-screen (the canvas is fixed-width with horizontal scroll, painful on a phone); duplicate detection + merge; GEDCOM import/export; photos on tiles (blocked — people have no photos at all, `photos` is moment-scoped); tree statistics.
21. Internet lookup for added context.
22. ~~Settings page~~ — **DONE 2026-07-23** (v1, see item 49 for what shipped). Of the six candidates speculated here, only chat tone/About shipped in v1; tile colors, suggestion sensitivity, and terminology library remain open (each needs new infrastructure built first — a theme layer, a suggestion-frequency concept, a centralized vocabulary module, respectively). "User's own profile/library" was considered and cut from Settings entirely — that's app navigation (already reachable via the main nav), not a setting.
23. **Security hardening** + honest About-page writeup ("I don't want it to be bullshit") — start from §10's reality, audit first. **Audit half DONE 2026-08-01 → `SECURITY.md`** (repo root): full static read of functions/migrations/frontend, plus `migrations_manual/2026-08-01-rls-audit.sql` (read-only) for the founder to verify RLS on the pre-migration tables. Foundation confirmed sound (RLS pattern, JWT gate on all 12 functions, service-role queries scoped by verified `user.id` not request body, secrets server-side only, 3 deps/0 vulns). Hardening half still open, in `SECURITY.md`'s own priority order: close public signup → security headers → AI rate limiting → email confirmation back on → account delete/export → app-layer column encryption → CORS lock-down.
24. Family-dynamic variety (half-/step-/adoptive) — **needs founder decision first**: (a) new relationship types vs. (b) qualifier field on the existing 5; qualifier also changes shared-parent inference (ask which parent, not both). Real example on file: Andy Volin (deceased) was married to Andi Volin, who's since remarried to Michael Galchinsky. **Partially superseded 2026-07-25** (see item 40 follow-up): spouse-as-co-parent auto-linking now ships, gated by a heuristic guard (skip + suggest instead when either side already has another spouse/partner on file) rather than waiting on this full qualifier-field decision — that heuristic catches the Andy/Andi/Michael shape specifically but is not the real half/step/adoptive data model this item is still tracking (e.g. it can't represent "step-parent to one sibling, blood parent to another" once the two are linked as full siblings — syncFamilyClique's existing all-parents-shared-across-the-clique behavior, unchanged, still flattens that). **Further superseded 2026-08-03:** step-parents and step-siblings are now first-class in the family tree (add, view, remove, tagged in the diagram), derived from ordinary spouse/parent rows with the blood-inferences suppressed per-write via `LinkOptions` — no qualifier field needed for those two. Adoptive, and half- vs. full-sibling within a rendered sibling group, are what's left of this item. Still open.
26. Ratings/thumbs feedback loop (tunes suggestions; does not retrain the model).
27. ~~Photo gallery for real~~ — **BUILT 2026-07-30, not yet deployed/live (see §10)**: real import via Google Photos OAuth + Picker API (not upload — founder chose this over a raw-upload/Supabase-Storage-only approach after confirming Google's API no longer allows third-party library scanning; see PROJECT_HISTORY for the full tradeoff discussion). `EventDetail.tsx` real gallery + quick-add; `PhotoImportReview.tsx` general import with date-clustered event-matching review. Person/Group photo rollups NOT included — see item 69. True camera-roll sync still needs the native iPhone app.
28. ~~Manual + AI-suggested tags on events~~ — **DONE 2026-07-22** (schema: new `tags`/`moment_tags` tables, see §6). Manual create-or-reuse picker + hover-remove chip on EventDetail; AI-suggested via `converse` only for v1 (capped 1-3 tags/moment, reuse-biased instruction) — `update-moment`'s chat-based `add_tags` and `suggest-prompts`'s tag signal deliberately deferred until real usage confirms the vocabulary stays clean, not scope-cut for any other reason. Verified live end-to-end against the real account (manual create/reuse/persist/untag, AI auto-tag via Home chat correctly created and applied a new "vacation" tag with no manual step), test data cleaned up after. Pairs with item 34's filter, same schema change powers both. **Same-day follow-up (founder-requested):** the tag picker now browses the full alphabetical list on focus instead of requiring you to already know a tag's exact spelling (`SearchAddPicker`'s new `browseAll` prop); 10 generic starter tags auto-seed once per account (`ensureStarterTags.ts`, guarded so it can't resurrect a deliberately-emptied list); new `ManageTags.tsx` page (linked from Events) lists every tag with usage counts and lets you add/rename/delete outside the context of any one event. Verified live: starter seed fired correctly on the real account's next sign-in (10/10 inserted, left a pre-existing AI-created "Phone Calls" tag alone rather than duplicating), rename/add/delete all confirmed against real + disposable test tags, alphabetical order holds everywhere (picker, chips, filter, Manage Tags list) regardless of creation order.
29. ~~Search within GroupDetail~~ — **DONE 2026-07-26.** `GroupDetail.tsx`'s member list gets a `SearchBox` (same component/pattern as `People.tsx`) once a group has more than 12 members; filters by name, doesn't affect the "show all" expansion. People page's own filter already existed (`People.tsx` `filterPeople`) — no separate work needed there.
30. AI/"fuzzy" semantic search (likely merges into 14).
31. **"Memory lane" curated media feed** — requested 2026-07-19. A scrollable, media-driven feed surfacing curated memories (vs. today's specific-lookup mode only); best outcome likely needs real event photos, so probably sequences after item 27 (photo gallery). Already named as a target query mode in §9's product philosophy, just not built yet.
32. ~~User's own profile~~ — **DONE 2026-07-20.** Real `is_self` flag + `relationships` table (shared source of truth for family links), real "My page" (`Circle.tsx`) + real family tree (`FamilyTree.tsx`, works for any person), `person-facts` linking and "my mom/dad" resolution both read the same table — see §3/§4/§6/§7. Full build story in PROJECT_HISTORY §15. Still-open UX questions, not yet resolved: (a) empty relationship categories on "Your circle" shown as invite-to-add vs. hidden until populated. ~~(b) a family tree for a group you're NOT a member of~~ — **RESOLVED 2026-07-21**, see item 41. ~~(c) "+" always targets a tier's first branch when a tier has more than one~~ — **FIXED 2026-07-20**, see item 37.
33. **Refer to the user as "You" instead of "User"** — requested 2026-07-19. `converse` reply text: DONE (item 53). **Extended 2026-07-26** to member/attendee chips: `EventDetail.tsx`'s `AttendeeChip` and `GroupDetail.tsx`'s `MemberChip` now show "You" instead of the founder's own name, keyed off each page's `selfId` (`is_self` lookup). **Extended 2026-08-10:** `PersonDetail.tsx`'s Key Facts chips now say "You" too (the case that reads worst — "Married to &lt;founder's name&gt;" on their spouse's profile), off an isolated `is_self` query mirroring EventDetail's. The chip still navigates to the founder's own profile; only the wording changed, and the demo (no `selfId` passed) is unaffected. **NOT browser-verified** — no login available that session. Still not audited: any other list of people that might render the self person by name.
34. ~~Filterable "View" by event category on the Events page~~ — **DONE 2026-07-22.** Shipped together with item 28: a tag filter dropdown on Events.tsx, growing from distinct tags actually applied (`useMemo`, not a fixed hardcoded set, per the founder's original ask), membership-based (a moment can carry more than one tag) rather than the single-value equality Groups.tsx's type filter uses, plus a "No tags yet" option. Verified live: option list matches tags in use, filtering narrows correctly.
35. ~~Sub-events for multi-day events~~ — **DONE 2026-07-30, migrated and verified live.** Requested 2026-07-19, founder flagged as important. Self-referencing `moments.parent_moment_id` (mirrors item 19's subgroups pattern), one level deep in the UI: "Sub-events" section + "+ New Sub-event" on `EventDetail.tsx`, sub-events bundled/collapsible under their parent on `Events.tsx` (founder-approved mockup) rather than shown flat — see §3 entries for both files. Calendar-import's earlier "Save as a note instead" workaround (2026-07-25, ImportReview.tsx) is untouched and not migrated onto real sub-events — noted as a possible future follow-up, not done here.
37. ~~Family tree bug scan~~ — **DONE 2026-07-20**, three wire-connection follow-ups **2026-07-21/22**, layout engine rewrite **2026-07-22** (item 39), same-day live-bug fix **2026-07-22**: Kids tier now also positions relative to its own parents' tier above (`layoutRelativeToParent`) instead of independently centering on the canvas — root-gen is now the only independently-laid-out tier — fixing left-clipping on wide trees and grandchildren rendering off-anchor. One reported "missing grandparent marriage line" turned out to be a real data gap (no `spouse` relationship on file), not a bug — flagged to founder, not auto-fixed. **2026-07-21 fix, confirmed live:** the root's own siblings were the one place in `familyTree.ts` still built as a bare name list with no spouse lookup — every other role (root's own spouse, aunts/uncles, cousins, kids) already attached in-law spouses. A married sibling's spouse now shows up with a marriage line too; verified against Jake's real tree (Josh Volin + Faith Volin).

38. ~~Undo a mis-added family tree relationship~~ — **DONE 2026-07-21.** Added `removeRelationship`/`unlinkRelationship` + a "Remove a relationship" control on the family tree page, scoped to the centered person's direct relations. Verified via `npm run build` + synthetic-data harness only — not yet confirmed against live data (see §10). Full story: PROJECT_HISTORY §18. **Relabeled "View Relationships" 2026-07-26**: each chip's name is now clickable and opens that person's own profile page (`onSelectPerson`, threaded through `FamilyTree`/`FamilyTreeView`/App.tsx); the hover-reveal trash icon still removes the relationship, unchanged. Verified live against Jake's real tree. **Partner-pair fix 2026-08-01 (founder report — Gus Reynolds / Sarah, "the trash icon doesn't remove him, from either profile"):** remove AND mark-ended both hardcoded `kind='spouse'`, but the tree renders a `partner` (dating) pair in the same spouse position — on a partner pair the DELETE/UPDATE matched zero rows, returned no error, and the tree re-rendered unchanged. The real kind now flows `Graph.spouseKindByPair` → `TreePerson.spouseKind` → the remove/divorce slots, so writes hit the row that exists and the chip/confirm copy says "partner" instead of calling a dating pair spouses; `unlinkRelationship` also clears both kinds and both note phrasings ("Married to X." / "In a relationship with X."). Verified live: Gus/Sarah row deleted, tree updated.

39. ~~Family tree layout engine rewrite~~ — **DONE 2026-07-22**, same day as founder-proposed. Implemented in the fresh session the founder asked for; see item 37's "Root-cause rewrite" entry for what shipped.

40. ~~Full sibling/parent clique sync~~ — **DONE 2026-07-21, deployed and DB-backfilled.** Founder-requested: adding any relationship should reciprocate across everyone it touches, not just the pair directly linked (e.g. adding a 3rd sibling to a 2-sibling group should connect all 3, and share all parents across all 3 — not just sync the new pair). Replaced the old 2-person-only `syncSiblingParents` with `syncFamilyClique` (see §6), which walks the full transitive sibling closure on every sibling or parent add — wired into both the frontend "+" picker/suggestion-banner paths AND all 4 relationship-capturing edge functions (`add-fact`, `converse`, `update-moment`, `update-group`, all redeployed same day). Verified live against Jake's real sibling group (Josh/Jake/Jess/Danny Volin): a test sibling added only to Josh correctly picked up Amy/Steve as parents AND direct sibling links to Jake/Jess/Danny; a test parent added only to that new sibling correctly propagated to all four. Spouse→parent propagation (step-parent case) explicitly excluded — see item 24. One-time SQL backfill for pre-existing data run same day (165 → 177 relationship rows). **Follow-up 2026-07-25 (founder report — Lorenzo Harris tree, "relationships don't sync regardless of whose profile was centered"):** the clique closure above only ever walked EXISTING sibling rows — it never discovered "these two share a recorded parent" on its own, so kids added one at a time (the normal way of building a tree) never became siblings. Fixed: closure now also seeds from the anchor's own parents' other children. Spouse→parent propagation (item 24) also now ships — auto-links except when either side already has another spouse/partner on file (remarriage guard), which surfaces as a new suggestion banner instead (`suggestCoParentLinks`, FamilyTree.tsx). New `invalidateKeyFacts` closes a third, related gap: nothing previously invalidated a profile's cached Key Facts chips after a relationship changed elsewhere. Verified live with disposable test people (shared-parent siblings, spouse auto-coparent, remarriage-guard banner accept/decline, Key Facts regeneration) against `jakevolin@gmail.com`, cleaned up after — see §3 writeRelationship.ts entry for the full mechanism. **Not yet deployed/backfilled against production — see §10.**

41. ~~Family tree entry points beyond My Page~~ — **DONE 2026-07-21.** Founder-requested: see any person's tree from their own profile, and generate a Family-typed group's tree without needing to be a member yourself. `PersonDetail.tsx` now has a "View family tree →" link (any profile, not just self). `GroupDetail.tsx` now has a "Generate this family's tree →" button on `group_type === 'Family'` groups. Shipped in two passes same day: first via `pickFamilyTreeRoot()` picking a best-covering center person, then superseded within the day by a dedicated `buildDescendantTree()` (familyTree.ts, `mode: 'descendants'`) scoped to the whole group's lineage instead of one member's ego graph — `pickFamilyTreeRoot()` removed. Verified live: The Volins (21 members) → tree centers on the family's eldest known generation, correctly fanning down through all members; a non-self profile (Steve Volin) opens its own ego tree correctly.

42. ~~Family tree generation cap~~ — **DONE 2026-07-21.** Founder-reported: Harvey/Roberta's great-grandchild (Wesley Gregorian) had no section — both tree modes were hardcoded to a fixed generation window (ego mode: 2 up/1 down; descendants mode: 5 labels). Both now walk however far the relationships data actually goes in each direction (capped at 25 generations only as a cycle guard) — see §7 FamilyTree.tsx entry for the mechanism. Matters for the founder's stated use case: people using this to keep track of real family lineage, potentially recording many generations back. Verified live: Harvey Volin's tree now shows a "Great-Grandchildren" section containing Wesley Gregorian; The Volins group tree unaffected in shape, still renders correctly.
43. ~~Family tree color coding~~ — **DONE 2026-07-21.** Founder-requested: make relationships easier to read at a glance — who's centered on whom, and which side grandparents/aunts-uncles/cousins are on. See §7 FamilyTree.tsx entry for the mechanism. Deferred (founder's own call, flagged to revisit — see item 44): a gender icon per person, not bundled into this pass. Verified live against Jake Volin's tree (purple moves correctly when re-centered on a non-self person like Amy Volin; blue/rose sides span from Great-Grandparents down through cousins' kids) and The Berzins' group meta-tree (single green color, no purple, clicking any member correctly opens their own purple-centered ego tree).
44. **Gender icon on family tree tiles** — **Manual-field half DONE 2026-07-26** (auto-fill half still open, see below). New nullable `people.gender` column (`male`/`female`/`non-binary`/`other`, migration: `supabase/migrations_manual/2026-07-26-gender.sql`, **not yet run — founder action needed, see §10**), editable dropdown on `PersonDetail.tsx` (inside the name-edit form, next to Deceased). `FamilyTree.tsx` renders a ♂/♀ glyph before the name for male/female (non-binary/other deliberately left unmarked — no symbol chosen without founder sign-off). Fetched via its own query in `familyTree.ts`'s `loadGraph()`, separate from the main people select, so a not-yet-migrated database degrades to "no icons," not a broken tree. **Still open:** the one-time hybrid auto-fill (static first-name→gender lookup, ≥90% confidence) from the original spec — deferred, not built this pass. **Raised in value 2026-08-05:** the relationship calculator (item 20/§7) words every label off this same column, so with gender unset the whole tree reads "aunt/uncle", "niece/nephew", "grandchild", "parent" instead of the natural word. Running the migration and the auto-fill would upgrade every kinship label in the app at once, not just the tile glyphs.
45. ~~Standalone first-run onboarding experience~~ — **DONE 2026-07-22.** Full gameplan discussed and iterated with the founder before building (plan file: `gameplan-the-onboarding-experience-lexical-parrot.md`, not checked into the repo). Built on top of the founder's own same-day signup expansion (items above: name/birthday at signup, auto-created self profile). See §3 Onboarding.tsx entry for the full mechanism — full-screen, no app chrome, sequenced by connective leverage (family tree first, then a closed-ended group picker, notes/events deliberately excluded). Verified live end-to-end with a disposable test account (`onboarding.verify.test@example.com`, deleted 2026-08-03 along with 10 other leftover test signups — see §10).

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
58. ~~Auto-load more Home suggestions without a refresh~~ — **DONE 2026-08-10.** `loadHomeSuggestions` now returns the ENTIRE pool in round-robin order instead of just the first 6; `Home.tsx` holds all of it in state and slices `SAMPLE_SIZE` for display, so answering a card filters it out and the next slides up on the same render. No refetch, no reload, and **zero extra queries** — every candidate was already computed in memory and then discarded. 2 new unit tests on the unbounded-limit path. **NOT browser-verified** (Home is behind a login; no session available) — the refill is unit-tested, the on-screen behaviour isn't.
59. ~~EventDetail attendee suggestions missing "Add all"~~ — **DONE 2026-08-10.** "✓ Add all suggestions" now sits beside the existing remove-all on all three of `EventDetail.tsx`'s suggestion boxes (sibling sub-event, associated group, family), matching `GroupDetail.tsx`. New `handleApproveAllSuggestions` does ONE bulk `notes` insert + ONE `handleNoteSaved()` — never a loop over `handleAddAttendee`, which would spend a `summarize-moment` regeneration per person for a single click (CLAUDE.md rule 3). **NOT browser-verified before pushing** (founder said push; build + 319 tests green, but the Browser pane was hidden that session so no click-through and no login was possible) — specifically unverified: that the ✓ button renders in each of the three boxes, and the bulk-insert write path itself.
60. ~~New-person name inputs don't stay side by side~~ — **DONE 2026-08-10.** `PersonDetail.tsx`'s `renameInput` was already `flex: '1 1 150px'` by the time this was picked up, but three 150px bases can't fit a phone's content width, so it still wrapped — now `flex: '1 1 0'` + `minWidth: 0` so the three boxes always share one row. Middle placeholder shortened to "Middle/nickname" to stay legible at a third of phone width. Known tradeoff: these inputs render at `fontSize.h2`, so long placeholder text clips on a narrow phone. **NOT browser-verified before pushing** — same hidden-pane/no-login gap as item 59; the one-row layout is CSS-reasoned, not seen.
61. **First-person "my" misattributed to the wrong person** — **Code fix DONE 2026-07-26, NOT YET DEPLOYED (see §10).** Root-caused to `add-fact` (the profile-scoped quick-fact bar — matches the Ken Miller repro exactly: text typed directly on Ken's profile). Its prompt framed all captured text as "about" the profile person with no signal that a first-person pronoun means the app's signed-in user instead; added an explicit instruction (using the existing `is_self` lookup) telling it first-person text refers to the self person, never to rewrite "my X" as "&lt;profile name&gt;'s X," and to leave the pronoun as typed if unsure. `converse`/`update-moment` weren't touched — their existing `buildSelfInstruction` already resolves unqualified "my"/"our" for relationship capture; only `add-fact`'s plain-note path had the gap. A live test on Ken Miller's profile ("my scout troop leader") saved unchanged, not misattributed — but no deploy token was available this session, so that test actually ran against the OLD (undeployed) function and isn't real confirmation of the fix; re-verify after deploying.
62. ~~Groups page lost its filter + scroll position when returning via the back arrow~~ — **DONE 2026-07-26.** Founder-reported: pick a group-type filter, click into a group, then use the in-page "← Back to Groups" arrow — landed back at an unfiltered, top-of-page list instead of where you left off. Root cause: `Groups.tsx` unmounts every time a crumb is pushed (App.tsx swaps it out for `GroupDetail`), so its local `search`/`typeFilter` state and scroll position were lost on every return trip. Fixed by lifting both into `App.tsx` (which never unmounts) and adding a scroll-position ref that's restored once the list reloads, cleared on a direct top-nav tab click so only the actual back-arrow round trip restores scroll. Verified live against the real account: "Friend group" filter + scrolled-to "Colorado Springs Friends" → back arrow correctly restored both; direct "Groups" tab click still lands at the top.
63. ~~Spouse/family chaining should apply everywhere a person is suggested, not just events~~ — **DONE 2026-07-26.** Founder feedback: self's spouse should always be suggested for events (household events are a given, shouldn't need self manually added first), and the existing event "person added → spouse suggested → kids suggested once spouse also added" chain should apply to every suggestion surface in the app, not just EventDetail.tsx. Shipped: (1) EventDetail.tsx/ImportReview.tsx now always seed self into the attendee set fed to `suggestFamilyMembers`, so self's spouse is suggested even before self is tagged; (2) GroupDetail.tsx gained a second suggestion box, "Family of a current member?", using the same `suggestFamilyMembers` chaining seeded from the group's explicit members; (3) `suggestConnections.ts` (Home's "Connections to make" card) gained the same family signal, generalized across every group. Verified live against the real account: a blank new event immediately suggested Caroline Volin (self's spouse) with zero attendees added; a throwaway test group seeded with Jake+Steve Volin correctly suggested Amy Volin (Steve's spouse), and once added, correctly suggested Jess/Danny/Josh Volin (their kids per the `relationships` table) — test group deleted after verifying, no changes to real data.
65. ~~iPhone Contacts import~~ — **DONE 2026-07-27.** Previously parked; founder asked to build it out, specifically calling out birthdays and addresses, then added mid-plan that nothing should auto-import wholesale (a real contact list can be 1000+ entries) and that browsing needs to be chunked with progress saved. See §3/§6/§7 for the mechanism (`ContactsImport.tsx` → `ContactSelection.tsx` curation → `ContactImportReview.tsx` accept/reject, `contact_import_candidates` table, `_shared/vcard.ts`/`_shared/nameMatch.ts`). Contact photos and auto-linking Apple's "related names" into the real `relationships` table were deliberately scoped out — flagged as separate decisions (photo storage needs a Storage bucket, same infra as the still-unbuilt item 27; relationship auto-linking risks silently writing wrong family links from free-text labels). Verified live end-to-end against the real account (`jakevolin@gmail.com`), all test data cleaned up after.
66. **Clean up messy duplicate location strings** — requested 2026-07-27. Founder typed the same real address ("12208 Bandon Dr…") three slightly different ways across past events before `AddressSuggestInput` (§3 ImportReview.tsx entry) existed to catch it. Wants a way to consolidate the old bad variants into one correct value (ideally the Geoapify-verified formatting) — either a merge tool for past `moments.location` strings, or a lighter "×" on a local suggestion in `AddressSuggestInput`'s dropdown to stop it from ever being offered again. Not scoped or built yet.

72. **Mobile redesign — NEXT UP, agreed with the founder 2026-08-01.** Triggered by opening the PWA on a real iPhone: everything is sized for a mouse (body text mostly 0.85–0.9rem, 46 of 86 files styling via inline `React.CSSProperties`). The founder's own framing is that they don't want to redo work, and the thing making a redesign expensive is structural, not visual: **every colour and size is typed directly into each screen — `#2E4034` appears 226 times across 46 files, `fontSize: '0.85rem'` 127 times.** Agreed four-step order:
    1. **Extract design tokens into one shared file** (colours, text sizes, spacing, radii) that every screen reads from, so a palette change is ~8 lines instead of 46 files. **Founder asked for this to be done in a FRESH SESSION (2026-08-01) — start here.** Purely structural, zero intended visual change, which is also what makes it easy to verify: *any* visible difference means something was done wrong. Do NOT bundle visual changes into this step.
    2. Founder uses the app on their phone for a week or two and notes what actually annoys them.
    3. Settle the app rename (see `PWA.md` for the four places the name lives).
    4. Redesign only the 3–4 screens really lived in (likely Home/Events/PersonDetail), **mobile-first** — the phone is now the primary surface, and designing desktop-first is exactly how the hover-only controls happened. The remaining screens can stay as-is indefinitely; the founder is the only user.

    **Practical constraint to plan around:** remote sessions have no Supabase credentials and the proxy blocks the live site, so an assistant cannot see the app. The founder is the eyes for anything visual (this is why *they* caught the touch bugs, not the audit). Expect to work from their screenshots.

73. **Pets on a profile** — requested 2026-08-01, **UI + schema DONE, chat wiring NOT done.** Founder decisions taken up front: a pet is its OWN record attachable to one or more people (household dog edited once, shows on both spouses' profiles), and the Home chat should eventually both read AND write pets. "Somewhat customizable to accommodate the variety of pets" → species is free text, plus an open `{label, value}` Details list per pet (Barn/Tank/Vet), not a fixed field set. Shipped: `pets`/`person_pets` tables (§6), `lib/pets.ts`, `components/PetsSection.tsx`, `pages/PetDetail.tsx` (§3). **Follow-up shipped same day, founder's ask:** pets appear in the **People list** with a species emoji, and tapping one opens its **own page** rather than an owner's profile (both founder decisions — the alternatives offered were "just a list on one person" and "tap goes to the owner's profile"). Pets are a display merge into that list only: separate tables, and the People count/Dunbar math still counts people alone. Editing moved off the profile card onto the pet page so there's one form, not two. ~~(B) founder runs the migration~~ **DONE 2026-08-01, verified live (see §10).** ~~(D) `PersonDetail.tsx` merge/delete `person_pets` handling~~ **DONE 2026-08-01**: merge unions the duplicate's pets onto the survivor then detaches (a plain re-point would collide, since a pet can be on several profiles) and the merge confirm copy now says "pets"; delete-profile deletes `person_pets` in the same `Promise.all` as the other dependents — safe only post-migration, since that `Promise.all` aborts the whole delete on any error. Both verified live with disposable test people. ~~(C) `converse` pet roster + write path~~ and ~~(E) the "a pet is not a person" guard~~ **BOTH DONE, deployed and verified live 2026-08-01** (founder-provided token). `converse` loads pets + person_pets as two SEPARATE top-level queries (never an embed — that would take the whole people roster down pre-migration), renders them into the roster tier, and writes a turn-level `pets` field: owner-scoped resolution first, then unique bare name, additive-only updates (never overwrites the profile form), links upserted per owner, and a loud `console.error` + skip for any pet with no resolvable owner. Guards added to `add-fact`/`update-moment`/`update-group` too — all four redeployed. **Item 73 is complete.** **Deliberately deferred:** a "Pets" Key Facts category in `person-facts` (would force an AI regeneration sweep across every profile for info the Pets card already shows), pet birthdays on the Calendar (needs `reminders.pet_id` + CHECK/RLS changes), demo pet content, a `PetChip`, a global Pets page (the People list now covers it), pets on events/photos.

74. ~~A place to write/dictate notes while reviewing imports~~ — **DONE 2026-08-02.** Founder ask: the review cards showed facts (name, phone, birthday, date) with nowhere to record what you actually know about the person, and that review pass is the only realistic moment anyone adds it. Shipped `components/ReviewNoteField.tsx` (see §3) on all four import review queues; ImportReview's pre-existing "Your notes (optional)" box just gained the mic and kept its `source: 'calendar_import'` tag unchanged. Two founder decisions: scope = all four queues (not just contacts), and **no AI note-splitter** — priced at ~half a cent per contact written about (Sonnet 5, no cache benefit since the prompt is per-person), ruled out as too expensive for a 1000-contact pass; Key Facts already does the splitting where it's visible. `ContactImportReview`'s `UndoInfo.noteId` became `noteIds: string[]` so Undo takes back both the vCard-derived note and the typed one; the typed text is deliberately NOT cleared on Undo (everything else on the card is candidate-derived, that isn't). Verified live against the real account: typed note → accept → appears verbatim on the profile with no import badge; empty box → accept → no note row created; accept → Undo → note gone and candidate back in the queue; per-card Accept-disable while recording. Test data cleaned up, **except** one real candidate (Tim Rose) left in `status='accepted'` — see §10.

75. ~~Ask before creating a profile for someone mentioned in a journal entry~~ — **DONE 2026-08-02** (see §4 `converse`/`update-moment`, §3 `MentionedPeopleSuggestions.tsx`, §12 guard). Founder ask, from a real entry: a date night at Pup Dog with Caroline, where the couple they met (Rachel and Matt) got full profiles they didn't want — but the fact they met them there still had to be recallable. Founder decision: ask for **every** brand-new name (predictable) rather than letting the AI judge which mentions are peripheral, and apply it to the event-page chat too, not just Home.

76. **Unify the two chat Edge Functions** (`converse` + `update-moment`, and arguably `update-group`/`add-fact`) — founder, 2026-08-02: *"I really wish it was one singular app — not sure why we even have two chat functions."* They're split for **cost, not design**: `converse` loads the whole roster + every moment each turn; `update-moment` loads one moment. A naive merge makes the event chat pay for the full archive on every message. A real unification means one function with one prompt and *scoped* context selection (pass the moment id → load only what that conversation needs), which also stops the current bug class where a rule fixed in one prompt silently stays broken in the other (item 75 had to be written twice; so did the pets guard, the date-phrase examples, and the general-note handling). Not scoped or estimated yet.
77. ~~**Chat-generated notes shouldn't invent sentiment that wasn't actually said**~~ — reported via feedback widget 2026-08-03, on "Jake's birthday dinner." Founder flagged a specific line as fabricated feeling/emotion that wasn't in what she actually typed. Partially addressed by item 81 (2026-08-03): general/event-level notes on Event/Group pages are now stored 100% verbatim, no longer AI-paraphrased at all, so this bug class is structurally gone there. **Remaining scope DONE 2026-08-03** (separate same-day founder report, on "Going to be a girl dad!" — an invented ultrasound/health-markers detail never said, plus a note misattributed to the unborn baby's own profile instead of being a general note): `converse`'s stableInstructions and `update-moment`'s `additional_notes` guidance (mirrored into `update-group` too) now both explicitly forbid inventing any detail the user didn't actually state, and clarify a note only attaches to a named person when THEY did/said/experienced it — not merely because they're the sentence's topic. Related bug caught in the same pass: `summarize-moment` had no self-person anchor at all, so its cached first-person "I" voice could latch onto whichever named person's note was most detailed instead of reliably being the account owner — now explicitly grounded via the `is_self` person (see §4). Deployed and live-verified (re-summarizing the reported event produced no new invented content). **Known gap:** the two already-bad notes on that specific event (the ultrasound detail, the baby misattribution) predate the fix and are stored data, not something a prompt change retroactively cleans up — fixing them needs the founder's actual wording, not a guess.
78/79. ~~Landing page should call out the calendar- and contacts-import features~~ — **DONE 2026-08-10.** Shipped as ONE new bullet (not two) at the top of `Landing.tsx`'s "how-it-works" list — both asks are the same promise, and the list was three bullets, so five read as a feature dump: "You don't start from scratch. Connect your calendar and Boomer builds out the events you've already been to; pull in your phone contacts and it starts filling in the people — then nudges you over time to add what it doesn't know." Copy is the founder's to redline.
80. ~~"Connections to make" Yes button not saving~~ + ~~auto-suggest Family tag on Home~~ — **DONE 2026-08-03.** Founder report: clicking "Yes" on Home's "Connections to make" card (e.g. adding Abram Woody to Air Force) repeatedly didn't stick. Root cause: `acceptConnectionSuggestion`/`dismissConnectionSuggestion` (`lib/suggestConnections.ts`) never checked `{ error }` on their Supabase calls, and `Home.tsx`'s click handler removed the suggestion from local state before the write even resolved — a failed write was invisible, and since suggestions recompute fresh from the DB every visit, the same suggestion just kept reappearing. Both now return `{ error }`, the handlers await and only clear local state on confirmed success, and a shared error banner surfaces a failure instead of silently dropping it. Verified live against `jakevolin@gmail.com`: clicked Yes on Abram Woody → Air Force, confirmed the `person_groups` row actually exists via direct query, reloaded and confirmed he no longer resurfaces as a suggestion. Second half: new `lib/suggestFamilyTag.ts` scans untagged groups (`group_type is null`) for a family-shaped name (`\bfamily\b`, or "The Xs"/"The X's"/"The Xs'") and surfaces a Yes/No "Tag as Family?" card on Home, same pattern as Connections to make. New `groups.group_type_suggestion_dismissed` column (migration `2026-08-03-group-type-suggestion-dismissed.sql`, **not yet run — founder action needed, see §10**) tracks a "No"; until the migration runs the feature fails open to showing nothing (its own query, not folded into any shared groups select, per the isolation pattern in the infra notes). Regex validated against the real account's ~60 groups: matched every untagged family-shaped name, zero false positives on non-family groups (years, "Pilots", "NCOs", "Civilians", etc).
81. ~~Two separate ways to add a note on Event/Group pages~~ — **DONE 2026-08-03.** Founder confusion (this conversation): a plain "Add a note" box sat beside a separate AI chat ("Remember something else?"/"Edit this group") on both pages — overlapping jobs, unclear which to use, and Home's chat made a third pattern. `UpdateMomentChat.tsx`/`UpdateGroupChat.tsx` replaced with one `NoteWithDetection.tsx` (see §3), matching the single-input pattern `PersonDetail`'s fact bar already used. Founder decision: attendee/relationship detection runs **automatically** on every note (not on-demand) — small added AI cost/latency accepted. `update-moment`/`update-group` prompts updated to stop re-inserting a paraphrased copy of the general note (frontend already saves it verbatim) and to stop angling for an open "anything else?" follow-up, since each call is now one discrete note rather than a multi-turn thread; `needsClarification` replaces `done` for the rare genuine disambiguation case. Home's `converse` chat is untouched — deliberately different, whole-account scope. Both edge functions deployed (persisted `SUPABASE_ACCESS_TOKEN`, see §2) and verified live: direct-invoke test confirmed `needsClarification` in the response and zero note rows written for a general-detail test message. Click-tested end-to-end on a real event and a real group (verbatim save, summary regeneration, no duplicate notes); test notes cleaned up afterward.
82. ~~See at a glance who in a group is in a subgroup~~ — **auto-colour half DONE 2026-08-04.** Founder ask: with a 20-person group and several subgroups, working out who's already sorted meant opening each subgroup in turn. Shipped both halves of the ask together — subgroup tiles carry a colour that repeats as a dot on the parent-level member chips (so the tile grid is the legend), plus a "Not in a subgroup (N)" filter pill. See §3 GroupDetail.tsx / `lib/subgroupColors.ts`. **NOT browser-verified before pushing** (founder said push; build + 102 tests green, click-through never ran — same call as item 19). Unverified specifically: the dot/rule rendering, the pill's filter behaviour, and phone width. **Still open: tap-to-recolour swatches.** Founder chose auto-assigned colours specifically to avoid a `groups.color` column and a hand-run migration; the manual-override half is only worth building if the automatic colours actually annoy in use. Note the tradeoff that would go away: with position-assigned colours, adding a subgroup can shift the colours of the ones sorting after it.

83. ~~Countdowns on the Calendar page~~ — **DONE 2026-08-06, code pushed; `migrations_manual/2026-08-06-countdowns.sql` still needs running (§10).** Founder ask (with a screenshot of the iOS "Countdown" app): auto-add milestones so you can see how long it's been, and let them add future things they're looking forward to. Four founder decisions taken up front: (a) auto count-ups = past events tagged "Milestone" + birthdays/anniversaries with a `year` on file, NOT every past event — a curated short list beats "whatever happened lately"; (b) a section on the Calendar page, not its own page/tab; (c) adding a countdown gives a CHOICE (plain countdown / countdown + real event / pin an event already on file) rather than the app deciding which one a countdown is; (d) implied by (b): future countdowns are opt-in only, since Upcoming sits right below and already lists everything ahead. Shipped: `countdowns` table (§6), `lib/countdowns.ts` + `lib/moments.ts` + `components/CountdownsSection.tsx` (§3), 25 new unit tests on the date math. **Verified:** build/lint/181 tests green, and the real component driven in a headless Chromium at phone width against a stub REST server (derived milestones render with the right unit columns; untagged past events, year-less reminders and a deceased person's birthday all correctly absent; add-standalone, pin-existing, tap-through to Event/Person, dismiss, reload-persistence, re-add-after-dismiss, and un-pin-stays-hidden all confirmed; a 3-day-out card ticked its Seconds column). **NOT verified against the real database** — no Supabase credentials in that session, so RLS, the CHECK/partial unique indexes, and the ON DELETE CASCADE (delete a pinned event → its countdown goes with it) are unexercised until the migration runs. Deliberately deferred: drag-reordering cards, countdowns on Home, demo-account countdown content, pet birthdays as milestones (needs `reminders.pet_id`, already deferred under item 73).
84. **Airtable-inspired visual/structural redesign** — founder-directed 2026-08-07, mockup-approved before any code touched. **Section 1 DONE 2026-08-07** (palette/type/shape in `theme.ts`, `ink`/`primary` split — see §3 theme.ts entry). **Section 2 DONE 2026-08-07**: `App.tsx`'s plain "Settings"/"Log out" buttons replaced with an avatar circle (initials from the `is_self` person's name, falls back to email initials pre-onboarding) that opens the existing `ChoiceSheet` component (reused as-is, not a new dropdown pattern) with Settings/Log out as its two choices; nav bar itself styled for the first time (was raw unstyled buttons) with an active-tab indicator. Self-name fetch is isolated in its own effect/query (same "don't take the whole shell down over one field" pattern as PersonDetail's gender/contact-info queries) so a slow or missing self person only affects the avatar, never blocks the app shell. **Build-verified only — NOT click-tested against a real login** (no test-account credentials in this session; the demo account doesn't render this nav at all, it has its own separate `DemoShell` topbar). Founder should click through Settings + Log out on the real account before trusting this fully. **Section 3 DONE 2026-08-07**: `PetsSection.tsx`/`ContactInfoSection.tsx` now render a single quiet "+ Add pet"/"+ Add contact info" text link (no border/card) instead of a permanent bordered empty card in live mode — clicking either opens the same full card/form as before (Pets: the picker; Contact Info: goes straight into editing, since that's the only way it ever gets its first field). `PhotoGallery.tsx` gained a `personId` prop that rolls up photos from every event that person is tagged to attending (same notes.person_id/moment_id signal EventDetail already uses for attendance), with its own empty-state caption instead of the old always-shown "upcoming feature" placeholder text; wired up in `PersonDetail.tsx` (`readOnly` — i.e. the demo — deliberately still gets no `personId`, since `PhotoGallery` has no static-data override like `PetsSection`'s `pets` prop and would otherwise fire a real query from the logged-out demo). **Build-verified + demo-verified the guard holds** (demo's Gallery still shows the old placeholder caption, confirming no query fired); **the new quiet-link empty states themselves were NOT click-tested** — same no-credentials gap as Section 2, and the demo account can't exercise the live-only branch either. **Section 4 DONE 2026-08-07** — the big one, `EventDetail.tsx`/`GroupDetail.tsx` restructured to the consistent order (Title → Date/Location [Event only] → Summary → Gallery → Who was there → Associated Events → Associated Groups [Group also gets Subgroups here] → Tags [Event only] → Notes → Manage). Specifics: Event's separate rename-pencil and "Edit date & location" pencil merged into one `editingBasics` flow/form (was two states, two handlers, two forms — now one of each, one combined `moments` update). Group's inline Type `<select>` moved into Manage; a static badge near the title still shows the type in both modes. Event's "Sub-events" and Group's unlabeled moments list both relabeled "Associated Events" (same underlying data/logic, just repositioned and headed). New shared `components/ManagePanel.tsx` (modeled on the existing `FilterPanel.tsx` overlay, no baked-in footer) replaces both pages' always-visible "danger zone" — a "⋯ Manage" button at the bottom now opens it, and it holds exactly the same merge/delete (Group also: type, nest-under-another-group, move-to-top-level) logic and state as before, just relocated. New shared `components/FloatingNoteButton.tsx` (modeled on the existing `FeedbackWidget.tsx` fixed-position pattern, opposite corner so they never overlap) replaces the inline note box in both pages' Notes sections with a bottom-right bubble that expands into the same `NoteWithDetection` instance on click. `CountdownsSection.tsx` was NOT touched by this restructure (unrelated file, still on old styling per Section 1's note) — Calendar enhancements (Day One-style "On this day" hover popover, click-to-open month/year picker, Day/Week/Month toggle — only Month exists today) remain the last open piece of this item. **Build-verified + demo-verified the read-only rendering path on both a real event and a real group** (fresh browser tab, zero console errors, section order confirmed exactly as above); **the write-path UI — the combined edit form, the Manage popup, the floating chat bubble — was NOT click-tested**, same no-credentials gap as Sections 2/3, and demo mode (readOnly) hides all three by design so it can't exercise them either. **Section 5 DONE 2026-08-07 — the last one, `Calendar.tsx`.** The gear icon (decided in Section 2's conversation but never actually wired up in code until now) replaces the "Calendar settings →" text link. "Upcoming" is now "Timeline": past events feed into the same scrollable list as upcoming ones, with a "Today" divider between them and a "Today" button that scrolls back to it (lands there automatically on load, too) — reminders stay upcoming-only since `nextOccurrenceDate` only ever resolves forward and there's no reminder-history modeled anywhere else in the app. The month label is now a click-to-open picker (year nav + a 12-month grid) instead of plain text. A new Day/Week/Month segmented control sits above the grid — Month is fully wired to the existing grid, Day/Week show an honest "coming soon" message rather than faking a view that doesn't exist. Hovering (or tapping) a day with history opens an "On this day" popover listing every year a moment has ever landed on that exact month/day — deliberately independent of the currently-viewed year, so a date with real cross-year history is still hoverable even if nothing's tagged to it in the year on screen; a small count badge on the day number hints when there's more than one. **Build-verified only.** Calendar has no demo route at all (`DemoShell.tsx` doesn't reference it — Home/People/Events/Groups are the only demo tabs), so unlike every other section this one couldn't even be read-only-verified this session — no browser check of any kind, just `npm run build` passing and a careful manual re-read of the diff. Founder should click through this page for real before trusting it. **Item 84 (the whole redesign) is now complete** — all 5 sections shipped, though every section's write-path/interactive behavior still needs a real click-through the founder hasn't been able to give it yet (see each section's own note above for exactly what's unverified).

Also worth noting: a separate concurrent session was actively editing `EventDetail.tsx` (an inline "create a new attendee who isn't on file yet" feature on the attendee picker) while Section 5 was being built — untouched and left exactly as found, per the file-scoped staging discipline used throughout this whole item.

84. ~~Countdowns follow-up: no page jump on delete, a Today line, per-card settings~~ — **DONE 2026-08-06, same day as item 83; `migrations_manual/2026-08-06-countdown-settings.sql` needs running before the ⚙ appears (§10).** Three founder asks off using the shipped section: (a) the × made the whole page jump to the top and back — it was the refetch (`load()` set `loading`, the section returned `null`, the page got shorter, the browser dropped the scroll position); now the card leaves optimistically by `cardIdentity` and only the one changed row is folded into state, and the list is its own scroll box so the page height never moves at all. (b) A "Today" button like the one planned for the new app: cards now sort into ONE chronological line (oldest first) with a Today line between past and upcoming, centred on open, and the button sets the box's `scrollTop` directly. (c) Per-card settings behind a ⚙ next to the ×, rather than on card tap — tap still opens the event/person, which is worth keeping. Four settings: rename (display-only via `custom_title`, so the event keeps its own title and stays synced), count in chosen units (`breakdownIn` gives the TOTAL in the largest chosen unit — Days alone reads 1,523, not 1), repeat weekly/monthly/yearly (displays at the next occurrence), and keep-counting-vs-retire once the date passes (offered only for a one-off still ahead, so nothing ever vanishes from under the founder). 13 new unit tests. **Verified:** build/lint/234 tests green, plus the real component driven in the browser against a stubbed PostgREST (throwaway harness, deleted after — no login needed): timeline order with the Today line between past and upcoming; × leaves `window.scrollY` identical before, during and after the write (1052 → 1052 → 1052, mid-page) with the right dismissal row written; Today button lands the list centred on the line without moving the page; ⚙ → "Days" on a 2022 milestone reads **Days 1,525** (creating the derived card's row first, then patching units); rename writes `custom_title` and the card re-titles while the event keeps its own name; "Every year" flips the card to ↓ 300 days and moves it below the Today line; "Take it off the list" saves without the still-future card vanishing; a 3-day-out card ticks its Seconds column; and the pre-migration path (settings select → 42703 → retry on the base columns) renders all cards with the ⚙ hidden, × and "+ Add" still working, no console errors. **One bug found and fixed in that pass:** the auto-centre marked itself done on the first render, when the section was still `loading` and both refs were null — derived cards come from props, so `cards` is already full before the query returns. Gated on `loading` and on the refs actually existing.

85. ~~"Connections to make" only ever asked one kind of question~~ — **DONE 2026-08-08.** Feedback-widget note from 2026-07-27 ("this is also a great feature - we probably need to beef it up"), scoped with the founder 2026-08-08. The card only asked "add this person to this group?"; it now pools four question types (see §3 `suggestConnections.ts`, `suggestRelationshipGaps.ts`, `suggestEventGroups.ts`, `dismissedSuggestions.ts`, and §6 `dismissed_suggestions`), shows 6 instead of 4, and round-robins so no one type crowds the others out. Founder decisions: family gaps + event tagging (NOT "suggest a group for the 196 people in no group" — too close to the per-group signal switched off in item 57), and **deterministic, no AI call**, keeping the card free to recompute per visit. Measured on the real account: 7 co-parent gaps, 1 couple gap, 9 event-tag pairs, 25 person→group. Verified live end-to-end (both accept paths written and confirmed in the DB, dismissals persisted across a reload, pre-migration fail-closed path confirmed by probe before the table existed). Deliberately out of scope: item 58's auto-refill, a per-row "why" line, revisiting `suggestions_enabled` for the other 63 groups.
86. **`syncFamilyClique` unions parents across a whole sibling clique — wrong for blended families.** Found 2026-08-08 while verifying item 85, on real data. Accepting "Is Lisa Dunn also a parent of Liam/Cormac?" (a step-parent link, correct per the founder) made all three Dunn children one sibling clique, and the clique sync then gave every child the union of every parent — writing **Tara Dunn (Brian's ex-wife) as Elizabeth's mother**, a person she has no relationship to. Deleted manually; the two step-sibling links and Brian→Elizabeth were correct and kept. This is pre-existing behaviour shared with FamilyTree.tsx's accept buttons, NOT introduced by item 85 — but item 85 raises the odds by surfacing step-parent suggestions account-wide, and the sync can silently re-add the bad row the next time anything in that family is edited. Founder decision 2026-08-08: ship item 85 as-is and file this. Likely fix: don't union parents across a clique whose members have differing parent sets (a blended family), or ask instead of asserting — the option costed at the time was a warning on the card ("this will also link Elizabeth as a sibling and give her Tara as a parent"). Not scoped yet.
87. ~~A new sub-event should suggest the people who were at the other sub-events~~ — **DONE 2026-08-10.** Founder ask: everyone at Day 1 of the Defenders of Freedom demo was probably at Days 2 and 3, so a fresh sub-event shouldn't start from an empty "Who was there". New "Were they at this one too?" box on sub-event pages (§3 EventDetail.tsx, `src/lib/siblingAttendees.ts`, 7 unit tests). Candidate pool = the parent event's directly-tagged attendees + every sibling sub-event's; ranked by how many of those a person appears in, ties alphabetical. Reuses the existing SuggestedAttendeeChip / `onAddAttendee` / `dismissed_person_ids` machinery unchanged, so tap-to-add and dismiss behave exactly like the group and family boxes. Verified live on the real account against Day 3 of the demo event (19 correct suggestions, Patrick Mojica ranked first on 3 sub-events; parent page correctly shows no box). **Not re-tested: the tap-to-add and dismiss writes** — shared, already-shipped handlers, and exercising them would have written wrong attendance into real data.
88. **Sweep the remaining browser-side reads for the 1000-row cap.** Founder reported 2026-08-10 that "Yes" in Home's "Connections to make" never stuck; root cause was the browser reading `person_groups` (1183 rows) unpaged, so 183 memberships were invisible and 21 of the card's 29 questions were about people already in the group. Fixed for the whole suggestion path (§2's 1000-row-cap entry, `src/lib/pagedSelect.ts`). **Not yet swept: the page-level account-wide reads** — `People.tsx`, `Groups.tsx`, `Circle.tsx`, `Events.tsx`, `DunbarDetail.tsx`, `DueForUpdate.tsx`, `FamilyTree.tsx`, `lib/groupRoster.ts`, `lib/countdowns.ts`, `lib/tags.ts`, `lib/moments.ts`. Same failure mode, and `people` is at 700 of 1000 — a roster page silently missing its last N rows is the next one to bite. Mechanical: wrap each in `fetchAllRows` with an explicit `.order()`.

**Flagged from feedback widget — needs founder scope decision (not filed as bounded items, left open in the widget):**
- *(Jake's birthday dinner, 2026-08-03)* Founder: the chat didn't add the right people to the event or spell all the names correctly, and wants it to actively extract people/event details from a narrative, infer who they are from existing contacts/context, suggest adding them — and if it's fully confident, add them automatically. This overlaps with item 15's person-to-person inference thread and item 76's chat-unification effort; worth deciding whether it's its own item or folds into one of those before scoping.

**Deferred with numbers behind it:**
- *Association rule mining for suggestions* (founder asked 2026-08-08 for "an agent which routinely scans the app and figures out new ideas for connections"). The concept is link prediction over the personal knowledge graph, and the discovery mechanism is association rule mining (support + confidence) — free and deterministic, no AI. Dry-run on the real account first: at confidence ≥0.75/support ≥5 it found 24 rules and **22 had nothing to suggest** (the account is already complete where patterns are strong); loosening to ≥0.6 gave 45 suggestions but the volume came from the bad rules ("in 22 AS → also Pilots", 15 suggestions, wrong — a squadron isn't all pilots). Conclusion: it earns its keep on messy accounts, not this one. Revisit with real users. If built, run it **in-app** (Home load or a scheduled Edge Function), not as an external cloud agent — that credential path was already abandoned 2026-08-03.

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
- Security honesty tiers (item 23): encryption at rest/in transit = claimable now; E2E = roadmap only (conflicts with AI reading content today). Reasoning written up for the founder in `SECURITY.md` §4 — three options (app-layer column encryption / on-device AI in a native app / full E2EE), none committed to; app-layer is the recommended first step, but only after closed signups + 2FA + verified isolation + tested backups.
- **Touch fixes 2026-08-01 (found opening the PWA on a real iPhone):** `src/lib/touch.ts`'s `IS_TOUCH` (`matchMedia('(hover: none)')`, computed once at module load — a touchscreen laptop CAN hover and keeps the hover-only behavior). **13 hover-gated controls across `GroupDetail`/`EventDetail`/`PersonDetail`/`FamilyTree`/`ImportReview` were completely unreachable on touch** (member/attendee/tag/group remove ×, family-tree relationship remove, note edit/delete) — all now render on `hovered || IS_TOUCH`. `index.css` gained a `@media (hover: none)` block: inputs floored at 16px (iOS force-zooms anything smaller on focus and never zooms back — 7 inputs were 0.85–0.95rem), and `.touch-action` gives the now-always-visible 18px/10px-icon buttons a 32px minimum target. Note delete now `confirm()`s on both platforms — it's permanent, and the reveal fix put it one stray thumb-tap away. **Deliberately NOT fixed: general sizing** (body text mostly 0.85–0.9rem, mouse-era layout) — that's the redesign, and patching it piecemeal means doing it twice.
- **PWA shipped 2026-08-01 → `PWA.md`** (install steps, name-change checklist, decisions). `public/manifest.webmanifest` (standalone, theme `#2E4034`, bg `#F7F5F2`), iOS meta tags + `apple-touch-icon` in `index.html`, four PNG icons in `public/` generated by `scripts/generate-icons.py` (regenerable — edit `LETTER`/`BG`/`FG` and re-run, so the pending rename is a 5-minute job). **No service worker, deliberately:** the app is useless offline anyway (every screen hits the DB/AI), so its only real effect would be serving a stale build after a deploy to the one user who can't debug it. **`index.html`'s viewport deliberately omits `viewport-fit=cover`** — without it iOS auto-insets the web view away from the home indicator, keeping Home's fixed-bottom chat bar clear with zero CSS changes; adding it would require safe-area padding on every fixed element.
- **Native iPhone: PWA first, NOT Capacitor (founder decision 2026-08-01).** Founder works on a PC and only has borrowed Mac access — every Capacitor/Xcode build and update would need someone else's machine, so it isn't a workflow. A PWA ("Add to Home Screen") needs no Mac, no $99/yr, no App Review, and solves the actual stated problem (logging a memory without opening a laptop). Whisper-over-Web-Speech (§2) already makes iPhone Safari a first-class target, so this works today. Revisit Capacitor only if camera-roll access becomes necessary — measured cost if so: backend (all 5,306 lines of Edge Functions + DB + auth) is 100% reusable on every path; only the ~20,100 lines of web-DOM screens are in question.

## 10. Pending manual steps, open bugs, cleanup

- **"Sign in with Google" — Cloud Console + Supabase setup done 2026-08-03, final live confirmation still needed.** Founder completed both steps (redirect URI on the existing Google Photos OAuth Client; Google enabled as a Supabase provider with that Client ID/Secret) — first attempt 400'd with `redirect_uri_mismatch` (URI hadn't saved/was on the wrong client), retested after the founder fixed it and it now reaches Google's real sign-in screen (`accounts.google.com`, scoped to `email profile`, correct client_id/redirect_uri) with no error. Verified as far as possible without real Google credentials in this session — the founder still needs to actually complete a sign-in on the live site to confirm two things: (1) it lands them back in Boomer logged in, and (2) since public signup is closed (below), it logs into their *existing* account by matching email rather than erroring or creating a new one. Also still true: while the OAuth consent screen stays in Testing mode, only accounts added as test users can get through this (same limitation as Google Photos) — basic sign-in scopes shouldn't need Google's full verification review to publish beyond that, but not yet checked.
- ~~Founder action needed: run `migrations_manual/2026-08-06-countdown-settings.sql` (item 84)~~ — **run by the founder and confirmed live 2026-08-08**: an anonymous PostgREST select of `custom_title, units, repeat_rule, keep_counting` returns 200, not `42703`. The per-card ⚙ is live. Still worth one pass on the real account: rename a card (the event's own title must be untouched), pick "Days" on an old milestone (a total in the thousands), set something to repeat, and reload to confirm it all stuck — the settings were verified against a stubbed backend, not against real rows under RLS.
- ~~Founder action needed: run `migrations_manual/2026-08-06-countdowns.sql` (item 83)~~ — **run by the founder, confirmed live 2026-08-08** (the table answers PostgREST). **The file is re-runnable** (2026-08-06 fix): the founder's first paste hit `42710: policy "Users manage their own countdowns" already exists` on a second run, because `create policy` has no IF NOT EXISTS while every other statement in the file does — a `drop policy if exists` now precedes it, same as `2026-07-20-relationships-table.sql`. Worth remembering for any future migration that creates a policy. Still unexercised against real data: deleting a pinned event should take its countdown with it via ON DELETE CASCADE.
- **Founder action needed: run `migrations_manual/2026-08-03-group-type-suggestion-dismissed.sql` (item 80)** — adds `groups.group_type_suggestion_dismissed`, needed for Home's new "Tag as Family?" card to remember a "No". No token available this session to run it directly (see `project_boomer_infra.md`); paste this file into the Supabase SQL Editor. Until it runs, that card just never appears (fails open, verified — no error, no crash) — the "Connections to make" fix (same item) doesn't depend on this migration and is already live.
- ~~Founder action needed: run `migrations_manual/2026-08-01-pets.sql` (item 73)~~ — **run by the founder and confirmed live 2026-08-01.** `pets`, `person_pets`, every column the app selects, and the `person_pets → pets` embed all return 200 via PostgREST. Full end-to-end click-through done against the real account with disposable test data (create pet → lands on its page → edit/save → persists across reload → appears in the People list with 🐕 and owner chips → attach to a second person → edit from one side shows on the other → mark deceased shows "In memory · 2019–2024" → merge carries the pet to the survivor → delete-profile succeeds with no error). All test data deleted after (verified 0 pets, 0 links, 0 test people).

- ~~Founder action needed: run `migrations_manual/2026-07-30-platform-stats.sql`~~ — **run and confirmed live 2026-07-30**: Landing page's platform databox (§3/§6) shows real cross-account totals, verified in browser preview.
- **Founder action needed: add the Geoapify key to Vercel's production env vars (2026-07-26)** — key created, verified working live in local dev/browser preview (real Denver, CO address suggestions returned and selectable on ImportReview's Location field). Local `.env` already has `VITE_GEOAPIFY_API_KEY` set. Still needs adding to the Vercel project's Environment Variables (Settings → Environment Variables) — `.env` isn't committed, so the deployed build has no key yet and only shows previously-typed-address suggestions in production until this is done. Also worth restricting the key to the production domain + localhost under "Referrer restrictions" in the Geoapify dashboard (currently unrestricted).
- **Founder action needed: run `migrations_manual/2026-07-26-group-suggestions-default-off.sql`** — flips the `groups.suggestions_enabled` (item 57) default from true to false, and sets every existing group's value to false, per founder feedback 2026-07-26 ("not using it for anyone"). Code-side defaults (GroupDetail.tsx, suggestConnections.ts) already updated and verified in browser preview; no token available this session to run it directly (see `project_boomer_infra.md`), so paste this file into the Supabase SQL Editor. Until it runs, existing groups keep whatever value they already have (mixed true/false — some groups were already manually toggled off).
- ~~Redeploy 4 edge functions for the family tree relationship-sync fix~~ — **DONE 2026-07-25.** `add-fact`/`converse`/`update-moment`/`update-group` all redeployed with the fixed `_shared/relationships.ts` (founder-provided token, confirmed success on all 4).
- **Founder action needed: run the family-tree backfill SQL by hand (2026-07-25, item 40 follow-up)** — code deployed everywhere (frontend + all 4 edge functions), verified live with disposable test people, but the actual backfill against real data (fixes the reported Lorenzo Harris tree, and everyone else's already-built trees) needs to be run **by the founder, in the Supabase Dashboard's SQL Editor** — both the Management API and the browser-client fallback were tried and both got blocked by the auto-mode safety classifier for a write at this scale (a bulk backfill across many real relationship rows, not a narrow single-row fix — see `project_boomer_infra.md` memory for the refined understanding). Run `migrations_manual/2026-07-25-spouse-coparent-backfill.sql` FIRST, then `2026-07-25-shared-parent-sibling-backfill.sql` (each file's own header explains why). Dry-run preview already done this session (read-only queries aren't blocked): the spouse-coparent file will add 35 new parent links across ~20 different families (including the reported Jamie/Leanne/Lorenzo case) and correctly excludes the Andy Volin/Andi/Michael Galchinsky remarriage case; the sibling file will add at least 24 new direct sibling pairs before its own transitive-closure step runs. Both are `ON CONFLICT DO NOTHING`/additive-only — safe to re-run, nothing gets deleted or overwritten.
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
- **Voice mic button**: backend confirmed working. UI click-tested 2026-08-02 in the review queues — the button mounts, the state machine drives the "Listening…" bubble, and `onBusyChange` correctly disables only its own card's Accept. The actual audio→Whisper→text round trip is STILL unconfirmed in-app: the assistant's browser pane blocks microphone hardware (`NotAllowedError`), so that hop was simulated, not exercised. Founder is the only one who can confirm it on a real device.
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
- ~~Founder cleanup needed: disposable test account `onboarding.verify.test@example.com`~~ — **deleted 2026-08-03**, along with 10 other leftover test/QA signups (`claude-test-*`, `boomer.qa.*`, `test@test.com`/`test@testt.com`, etc.), via the Management API directly (no dashboard access needed after all — `people`/`moments`/`groups` deleted first per their FK gotcha, then `auth.users`). Only 3 accounts remain: `jakevolin@gmail.com` (real), `+onboardtest`, `+birthdaytest` (kept per founder's call — not actually a test-cleanup target).
- **Founder needs to run a SQL migration: `feedback_notes` table (item — click-to-comment feedback widget, 2026-07-22)** — `supabase/migrations_manual/2026-07-22-feedback-notes.sql`, paste into the Supabase SQL Editor. Until this runs, the widget's save silently no-ops (insert fails, swallowed) — UI flow itself is verified working (toggle/highlight/click-intercept/composer, see FeedbackWidget.tsx).
- ~~Founder needs to run a SQL migration + redeploy 3 Edge Functions: time zone bug fix (2026-07-24, item — "today" mis-dating evening events)~~ — **migration applied and all 3 functions (`converse`/`update-moment`/`scan-calendar-sources`) deployed live 2026-07-24**, via the Management API + `npx supabase functions deploy` with a founder-provided token. Confirmed live: `user_settings.time_zone` returns 200 via PostgREST (not a 400 undefined-column error), Settings time-zone picker's save round-trip verified end-to-end in a real browser session against `jakevolin@gmail.com`. A second, separate display-only bug found in the same investigation and fixed same day: [EventDetail.tsx:604](../src/pages/EventDetail.tsx) parsed `event_date` with bare `new Date(...)` (UTC-midnight parsing, same bug CLASS as the regression guard below) instead of `formatFullDate()` — this one didn't affect what was SAVED, only what EventDetail showed, and in negative-UTC zones it happened to shift the display back a day, partially masking the real bug rather than causing it. Both fixes verified together live: "Tulas & Jackass The End" (previously mis-dated to 2026-07-25 by the pre-fix `converse` deploy) corrected to 2026-07-24 via its own update-chat, confirmed matching on both EventDetail and the Calendar month grid. **Side finding, not caused by this fix:** that correction cleared the event's cached `summary` (EventDetail's normal behavior on any change) and it couldn't auto-regenerate because the event's `raw_description` was already empty — `update-moment` never writes `raw_description` (only `converse` does, at moment-creation time), so this looks like a pre-existing data gap on this one event, not something introduced here. The individual notes are all intact; only the AI-generated prose blurb needs retyping via "Edit description" if wanted back.
~~67. Tag people to groups/subgroups at entry time~~ — **done 2026-07-30**: `ContactImportReview.tsx`'s "Review contacts" cards now have an "Add to groups" picker (`SearchAddPicker`, browse-all + inline "+ Create group" using the same find-or-create logic as `PersonDetail.tsx`'s `confirmSuggestedGroup`) on every card; selected groups are upserted into `person_groups` on Accept. `+ Add Person` on People.tsx still routes straight to `PersonDetail.tsx` (already has its own group tagger there) — not touched.
~~68. Sort "Review Contacts" list: high-confidence matches first~~ — **done 2026-07-30**, same pass as item 67: query now orders `match_confidence` ascending (`'high'` before `'none'`) then `full_name`.
~~71. "View profile" link after accepting a contact~~ — **done 2026-07-31**: `ContactImportReview.tsx`'s post-Accept confirmation ("Saved contact info for X") now shows a "View profile →" button alongside Undo, pushing the same `person` crumb (`App.tsx`) the rest of the app uses — jumps straight into the just-accepted/merged person's profile without leaving the review queue via People search. Verified live against the real account (`jakevolin@gmail.com`): accepted a real matched duplicate ("Austin Neurighter" → existing "Austin Gula"), clicked through to the profile with correct breadcrumbs, "← Back to Review contacts" returned to the queue. Note: since it was a genuine duplicate whose phone/groups already matched Austin Gula's existing data, the accept itself was a real (harmless, no-op) merge — not a disposable test row, left as-is rather than un-mergeable after leaving the component.
69. **Photo gallery for Person/Group pages** — deferred from item 27's Google Photos build (2026-07-30). `PhotoGallery.tsx` only shows real photos when passed a `momentId` (EventDetail); Person/Group pages still show the original placeholder. Would mean aggregating photos across everything a person/group is tagged to (their moments) rather than one moment's own `photos` rows — not scoped yet.
70. **`ContactImportReview.tsx` paginated + name-editable (2026-07-30)** — founder was facing all 1300+ `selected` candidates rendered on one page at once (unusable) with no way to fix a parsed-vCard name before it became a real profile. Now paginated at 20/card (mirrors `ContactSelection.tsx`'s pattern, smaller page since these cards are heavier); unmatched (new-person) candidates get editable First/Middle/Last inputs prefilled from the parsed name. Accept keeps its existing in-place "Saved contact info for X" confirmation (only refreshes the footer count); Reject refetches the page so the next candidate slides in. Verified live against the founder's real queue (1304 real selected candidates) with a temporary synthetic batch, fully cleaned up after — see PROJECT_HISTORY.md for that story. **Extended same day:** matched cards now show the linked person's current groups ("Already in: X, Y") fetched per-card on `linkedPersonId` change, so a match comes with visible proof it's really them (and those groups are excluded from the "Add to groups" picker to avoid offering a duplicate tag); a 3-way "All / Already in Boomer / New people" filter (keyed on `matched_person_id` being set, not `match_confidence`) lets the founder batch through quick confirms separately from the new-person decisions that need real attention. **Match legibility pass (2026-08-10, founder ask):** the suggested person used to appear only inside a small grey "X is already in:" line under a generic "Confirm who this belongs to:", so you couldn't tell the app was proposing a specific person or which name was the incoming one. Now `components/MatchCallout.tsx` (shared with `BirthdayImportReview.tsx`) — "Is X the same person as Y?" at `bodyLg` in a `inkWash`/`border.primary` box, groups as evidence beneath, "Yes — same person" / "No — add as new person" as real buttons (replacing the `cancel` and "Not the same person" underlined links), search demoted to "Or link it to someone else". Confirmed state reads "✓ Goes to Y" instead of a muted "Goes to:". `BirthdayImportReview` gains the "No — add as new person" escape it never had.
- ~~Google Photos import (item 27) is BUILT but NOT LIVE~~ — **backend fully deployed 2026-07-30**: founder completed Google Cloud Console setup (OAuth consent screen + Client ID/Secret), ran the migration, and created the private `photos` Storage bucket directly; `GOOGLE_PHOTOS_CLIENT_ID`/`GOOGLE_PHOTOS_CLIENT_SECRET` set as Supabase Edge Function secrets and all 3 Edge Functions (`google-photos-oauth-callback`/`google-photos-picker-session-create`/`google-photos-picker-session-import`) deployed via founder-provided access token — confirmed live via the token-free check (each returns `UNAUTHORIZED_NO_AUTH_HEADER`, not Supabase's `NOT_FOUND`), and `photo_connections`/`photo_clusters`/`photos` + all RLS policies (including `storage.objects`) confirmed present via a direct Management-API read. Vercel env var + Google Cloud client wiring done by the founder same day. **Bug found and fixed 2026-07-30 during live testing:** `App.tsx`'s mount-time history-state-sync effect called `window.history.replaceState(state, '', window.location.pathname)` — passing only the pathname (no search string) silently stripped any `?query` on every page load, including Google's `?code=...&state=...` on the OAuth callback redirect, so `GooglePhotosOAuthCallback.tsx` always saw an empty URL and failed with a false "That connection link looks invalid or expired" — 100% reproducible, not a flaky/stale-state issue as first suspected. Fixed by omitting the `url` argument entirely (`replaceState(state, '')`), which correctly leaves the current URL untouched — matching what the effect's own comment already said it was supposed to do. Verified locally: a callback URL with real query params now correctly reaches the token-exchange call instead of failing at the pre-check. **Known limitation, not a bug:** while the OAuth consent screen stays in Google's Testing mode, only Google accounts explicitly added as test users can connect — not real end users — until Google's app verification review completes.
- ~~Deploy the 4 AI functions for subgroup-aware group names~~ — **DONE 2026-08-01, all four deployed and verified live.** `converse`/`add-fact`/`update-moment`/`scan-calendar-sources` used to build their group rosters from BARE names and resolve the model's answer by lowercase name match, so two subgroups sharing a name collapsed to whichever row won the index — a wrong-subgroup TAGGING bug, not just display. Now all four use `_shared/groupNames.ts` (server twin of `lib/groupDisplayName.ts`): qualified "Parent / Child" names into the prompt, resolved back to ids by that form, and an ambiguous bare name resolves to NOTHING rather than a guess (drop-the-tag is recoverable; wrong-group is silent). `splitParent` turns a model-written "&lt;existing group&gt; / New Thing" into a real subgroup instead of a group literally named that; the " / " separator has spaces so "98 FTS/Wings of Blue" isn't mistaken for a hierarchy. Verified against the real account: "Who is in the Pilots subgroup?" → "There are two Pilots subgroups on record — one under 22 AS and one under 98 FTS/Wings of Blue. Which one did you mean?", then "The one under 22 AS" → the correct 25-member roster. Same deploy also shipped the previously-pending `add-fact` first-person fix (item 61) and `scan-calendar-sources` family-surname matching.
- Not production-hardened generally: no 2FA/access-control story, minimal tests.
- ~~**RLS unverified on the pre-migration tables**~~ — **VERIFIED LIVE 2026-08-01, all clean.** Founder ran `migrations_manual/2026-08-01-rls-audit.sql`: all 23 tables (incl. `storage.objects`) have RLS on, every read policy scoped to `auth.uid()` or an ownership check through the parent table, nothing evaluating to a bare `true`. **Why the undocumented dashboard-made tables were covered anyway: `rls_auto_enable`**, an event trigger from the original Bolt/StackBlitz scaffold that auto-enables RLS on every `CREATE TABLE` in `public` — correctly written (`SECURITY DEFINER` with a pinned `search_path`). **Leave it in place.** §6's "RLS on everything" is now evidence, not a claim. **Writes verified clean in a second pass the same day** — every WITH CHECK either names `auth.uid()` or inherits the USING expression (Postgres's automatic behavior for `FOR ALL`/`FOR UPDATE`; a blank write condition on those is normal, NOT a hole — the audit script now labels this explicitly so it isn't misread). Two first-pass concerns both closed: `group_associations`' read rule only checks `group_id_a`, but its WITH CHECK requires **both** sides be yours, so the cross-account row that asymmetry appeared to permit can't be created; and the four blank-looking INSERT policies (`home_suggestions`/`notes_group_insert`/`photo_connections`/`relationships_insert_own`) are all correctly scoped. Nothing outstanding. Structural note: `notes` has six overlapping policies (person/moment/group-hung notes) — correct today, most intricate rule set in the DB, re-audit if a fourth note type is ever added.
- ~~**Founder security actions (2026-08-01)**~~ — **ALL DONE 2026-08-01, founder-confirmed:** public signup closed (Supabase Auth → Sign In / Providers → Email), RLS audit run twice and clean, 2FA enabled on Google/GitHub/Supabase/Vercel. **Anthropic, OpenAI and Google Cloud sign in via Google** — no separate password, so they inherit Gmail's 2FA; nothing further needed there, but it makes the Google account the single key to 5 of the 8 services, so its *recovery* path (SIM-swappable phone number? recovery codes stored inside Google?) matters more than adding another factor anywhere else. Only unconfirmed item left from `SECURITY.md`: whether Supabase backups have ever been test-restored (the 4th of the four things that actually prevent a breach). Original instructions kept below for reference / re-running:
- **~~Founder action needed~~ (2026-08-01, security audit — see `SECURITY.md`), in this order:** (1) **close public signup** — Supabase Dashboard → Authentication → Sign In / Providers → Email → disable new sign-ups; highest-value single action while the founder is the sole real user (removes the AI-billing abuse vector and the other tenants at once). (2) **Run `migrations_manual/2026-08-01-rls-audit.sql`** in the SQL Editor (read-only, safe to re-run) — the pre-migration tables (`people`/`moments`/`notes`/`groups`/`person_groups`/`reminders`/`home_suggestions`) were made by hand in the dashboard, so §6's "RLS on everything" is an unverified claim for exactly the tables holding all the real content. Any table with `rls_enabled = false`, or a policy whose expression is literally `true`, is a live cross-account leak and outranks everything else in §8. (3) **2FA on Google/GitHub/Supabase first, then Vercel/Anthropic/OpenAI/Google Cloud/Geoapify** — `SECURITY.md` §2 has the blast-radius table. Note GitHub sits in the top tier *because* pushes to `main` auto-deploy to production with no review step. This session could not verify any of it live: no credentials in the container and the environment's proxy blocks outbound access to both the app and Supabase.
- ~~Founder action needed: deploy `add-fact` (item 61 fix)~~ — **deployed 2026-08-01** alongside the subgroup-name fix below, so the first-person ("my X") misattribution fix is finally live. Item 61's own live re-test still hasn't been run against the deployed version — worth one pass on a real profile next session.
- **Founder action needed: run `migrations_manual/2026-07-26-gender.sql`** (item 44) — adds the nullable `people.gender` column. Code (PersonDetail's gender dropdown, FamilyTree's ♂/♀ glyph, ClarifyGenderPrompt) already deployed and verified in browser preview — it fails open (no crash, no icons/saves) until this runs, so nothing breaks in the gap, but nothing persists either. **Confirmed still not run as of 2026-08-05** — a direct PostgREST read of `people.gender` returns `42703 column people.gender does not exist`. This is why EVERY in-law reads "child-in-law"/"sibling-in-law"/"parent-in-law" and every aunt/uncle reads "aunt/uncle" (founder-reported: Mark Berzins → Jake Volin), why no tile shows ♂/♀, and why the profile Gender dropdown silently doesn't stick. `loadFamilyGraph` now reports this as `graph.genderSupported`, which is what keeps the clarify prompt hidden rather than offering a save that would fail.
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
10. **Hand over SQL as the actual `.sql` file, not pasted into chat** (founder directive, 2026-08-08). Any migration the founder has to run goes out as the file itself, so it can be opened, select-all'd and pasted straight into the Supabase SQL Editor without re-copying out of a chat bubble. Say in one line what it does, that it's safe to run twice, and how they'll know it worked. Same for anything else destined for another tool.

## 12. Regression guards (hard-won one-liners — full stories in PROJECT_HISTORY.md §9)

- **`platform_stats()` is the ONLY intentional RLS bypass** (`SECURITY DEFINER`, granted to `anon` for the Landing page's databox). It is safe solely because it returns four counts. Never extend it to return rows, names, or anything per-record — that turns it into a public data leak. Query 4 of `migrations_manual/2026-08-01-rls-audit.sql` exists to confirm it's still the only such function.
- **Silent RLS failure is the house bug:** any Supabase write that only checks `if (data)` fails silently — always check `.error`, and gate every function on a valid `user` up front (401 "log out and back in" on stale sessions). The AI will cheerfully claim it saved when nothing did.
- **Bare first names/nicknames only resolve when unique account-wide** ("two Bobs"); relationship auto-linking additionally requires name-as-typed == full name on file. Any new AI shorthand (group names too) must handle non-unique.
- **Model JSON is never clean:** slice first `{` to last `}`, retry once on parse failure, regex-extract `"reply"` as last resort. Assistant-prefill (`{role:"assistant","{"}`) is NOT supported — hard API error. Give `max_tokens` headroom for the richest turn (converse: 4096) — truncation = silent JSON failure. Remove unused fields from prompt schemas (dead output budget truncated Key Facts).
- **Save per turn, never gate on "done"** — users don't reply to closing questions.
- **A name merely MENTIONED in a story is never auto-created as a profile** (2026-08-02) — it's written as a general note on the event (`person_id: null`) and offered as a one-tap banner. The note must be written server-side at capture time, never deferred to the banner: an unanswered banner has to leave the detail intact, because the note is the only record of that person. Applies to `converse` and `update-moment`; any new capture surface needs the same split.
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
