---
name: next-actions
description: Read PROJECT_CONTEXT.md's Master List and other backlog sections to see what's left to build, then propose a prioritized punch list of next actions for a new session. Use when the founder asks "what's next", "what should we work on", or wants a prioritized to-do list for the app.
---

# Next Actions

Figure out what remains to be built on Boomer and hand the founder a short, prioritized list they can hand to a new session.

## Steps

1. Read `PROJECT_CONTEXT.md`, focusing on:
   - Section 7 ("Features Currently In Progress / Explicitly Deferred"), especially the **MASTER LIST** subsection (bugs / quick wins / bigger features / carried-over / parked).
   - Section 10 ("Known Limitations / Things NOT Yet Done") for anything code-complete but not yet live (pending manual SQL/redeploy steps) — these are cheap wins since the code is already written.
2. Build a mental model of what's actually open:
   - Skip anything struck through (`~~like this~~`) or marked "done"/"fixed"/"deployed and confirmed" — it's finished.
   - Treat "code-complete but NOT yet live" items as highest priority, cheapest wins — no new code needed, just a manual deploy/SQL step the founder has to run (or `npx supabase functions deploy ...` if a token is available this session).
   - Respect the founder's stated work order: **bugs first, then quick wins, then bigger features** (per the Master List's own framing).
   - Anything under "Parked" stays parked unless the founder has said otherwise recently — don't resurrect it unprompted.
   - Anything flagged as needing a founder decision first (e.g. family-dynamic-variety relationship types) should be surfaced as a *question to ask*, not started blind.
3. Cross-check against recent git log (`git log --oneline -15`) in case something's been built since PROJECT_CONTEXT.md was last updated but the doc wasn't refreshed yet.
4. Present a short, plain-language, non-technical punch list (the founder is non-technical — see CLAUDE.md):
   - **Do these first (deploy-only, no coding needed):** any pending manual steps from Section 10.
   - **Next 1-3 items worth building**, in priority order, each with a one-line "why this one" and a rough size (quick / medium / big).
   - **One open question**, if there's a decision the founder needs to make before the next big item can start.
   - Keep it to what fits on one screen — this is a menu to pick from, not a full audit.
5. End by asking which item(s) to start in a new session — don't start building anything in this chat.
