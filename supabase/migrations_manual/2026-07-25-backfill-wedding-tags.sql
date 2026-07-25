-- One-time backfill, not a schema change: 21 pending calendar-import candidates with "wedding" in
-- the title were generated at 05:49 UTC today, before the same-day prompt fix (2026-07-25,
-- ImportReview entry) that makes new candidates match title words against the existing tag
-- roster. This backfills just those already-existing rows so they don't sit un-tagged forever —
-- purely additive (only touches suggested_tags, nothing else), and still just a *suggestion* the
-- founder reviews/can un-check on each tile like any other, same as if the AI had proposed it.
update moment_import_candidates
set suggested_tags = '["Weddings"]'::jsonb
where occasion ilike '%wedding%'
  and status = 'pending'
  and jsonb_array_length(suggested_tags) = 0;
