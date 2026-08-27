Run the repo's full verify-and-ship ritual for work that is already written. This is
CLAUDE.md rules 1 and 2 as one command, so the same steps happen the same way every time.

Do not start new work here. If nothing is changed (`git status` is clean), say so and stop.

## 1. Verify

Run `npm run check` (lint → typecheck Edge Functions → build → test). All four must pass.
If any fails, fix it and re-run — never ship red, and never skip a test to get green.

## 2. See it work, if it's visible

If the change has ANY visible UI effect, click it through in the browser preview before
shipping — CLAUDE.md rule 1 means build-passing alone is not "verified". Docs-only or
pure-logic changes skip this; say which case applies and why.

If a path can't be exercised (needs the founder's real account, a real device, real
credentials), do NOT claim it works. Ship it and add one line to §10 saying exactly
what is still unseen.

## 3. Commit and push

Commit with a message written for a non-technical reader: what changed and why, not how.
Push to `main` with `git push -u origin main`. This auto-deploys to production on Vercel —
there is no staging step, so step 1 and 2 are what stand between a change and real users.

## 4. Update the docs, in the same session

- **PROJECT_CONTEXT.md** — update the facts your change affected, in place. Present tense,
  one line per fact. Delete anything your change made obsolete.
- **PROJECT_HISTORY.md** — only if the change has a story worth keeping (a postmortem, a
  trap someone would hit again). Dated narratives live here, never in PROJECT_CONTEXT.
- **§12 regression guards** — if you were bitten by something non-obvious, add the
  one-line general rule. This is the most valuable section in the repo; feed it.
- **§10** — remove anything your change resolved; add anything it left unverified.

## 5. Check the budget before you finish

Run `wc -c PROJECT_CONTEXT.md`. It must be under 200000 (CLAUDE.md rule 2). If your edit
pushed it over, cut or archive something else in the SAME session — never leave it over.

Report the final byte count in your summary so the number stays visible.
