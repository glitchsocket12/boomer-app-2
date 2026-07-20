Read Section 8 ("Backlog — MASTER LIST") of PROJECT_CONTEXT.md and print the remaining (not-yet-done) items as a plain list, grouped exactly like this:

**Bugs** — anything still open under the bugs heading (should normally be empty/none if all fixed).
**Quick wins** — small, low-effort items.
**Bigger features** — larger/multi-step items.
**Parked** — explicitly deferred, not scheduled unless revived.

Rules:
- Do not include items already marked done/struck through.
- Keep each item to one line — a short restatement, not the full backlog prose. Drop the "requested [date]" framing.
- Do not read PROJECT_HISTORY.md or any other file.
- Do not edit any files. This is read-only — just output the list.
- Do not run any code or start any dev server.
- If a group has nothing open, write "(nothing open)" under its heading instead of omitting the heading.
