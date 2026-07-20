Read Section 8 ("Backlog — MASTER LIST") of PROJECT_CONTEXT.md and print the remaining (not-yet-done) items as a plain list, grouped exactly like this:

**Bugs** — anything still open under the bugs heading (should normally be empty/none if all fixed).
**Quick wins** — small, low-effort items.
**Bigger features** — larger/multi-step items.
**Parked** — explicitly deferred, not scheduled unless revived.

Rules:
- Locate Section 8 without reading the whole file: Grep PROJECT_CONTEXT.md for the pattern `^## \d+\.` to get every top-level heading's line number, find "## 8. Backlog" and the heading immediately after it, then Read only that line range (offset = Section 8's line, limit = next heading's line minus Section 8's line). Never do a plain, unbounded Read of PROJECT_CONTEXT.md.
- Do not include items already marked done/struck through.
- Keep each item to a bare title only (a few words) — not a restatement of the backlog prose. Drop the "requested [date]" framing, parenthetical asides, and cross-references to other item numbers (e.g. "merges with #14", "pairs with #28").
- Do not read PROJECT_HISTORY.md or any other file.
- Do not edit any files. This is read-only — just output the list.
- Do not run any code or start any dev server.
- If a group has nothing open, write "(nothing open)" under its heading instead of omitting the heading.
