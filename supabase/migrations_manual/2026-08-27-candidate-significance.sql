-- "Recommended" — one column so the AI can say what KIND of thing a calendar entry was.
--
-- WHY. The founder's calendar sync produced 1,300 genuinely different one-off events. Everything
-- built for item 96 makes each decision cheaper (small batches, one-line rows, four answers) but
-- none of it reduces the NUMBER of decisions — the queue still asks 1,300 questions. Founder ask,
-- 2026-08-22: "there should be a 'Recommended' to add feature, based off the names inside of the
-- calendar/context for important events/vacations/travel/events. AI could probably easily scan it
-- right?"
--
-- THIS RANKS. IT NEVER HIDES. The 2026-08-12 directive ("just simply sync all new events, and let
-- the person decide themselves") removed an AI filter that was HIDING 202 of 230 events — that
-- ruling stands. Every candidate stays in the list and is reachable in one tap; a recommended one
-- is merely shown first. A wrong guess costs a missed boost, nothing more.
--
-- A KIND, NOT A FLAG. "Recommended · looks like a trip" costs about two extra output tokens and
-- makes a wrong guess visibly wrong instead of mysteriously wrong. Recommended = anything that
-- isn't 'routine'. The list is deliberately short and concrete; widening it is a frontend edit
-- plus one line here.
--
-- NULL MEANS "NOT SCORED YET" — which is what all 1,300 existing rows are until the score-candidates
-- backfill runs, and what every row is on a database that hasn't run this file. The app works fully
-- in that state: it probes for the column (an unknown COLUMN errors; an unknown value would not),
-- and with no column it behaves exactly as it does today.
--
-- Safe to run more than once.

alter table moment_import_candidates
  add column if not exists significance text;

alter table moment_import_candidates
  drop constraint if exists moment_import_candidates_significance_check;

alter table moment_import_candidates
  add constraint moment_import_candidates_significance_check
  check (
    significance is null
    or significance = any (array['trip'::text, 'celebration'::text, 'milestone'::text, 'holiday'::text, 'gathering'::text, 'routine'::text])
  );

-- Partial index: every query that reads this column also filters status = 'pending' (the triage
-- list, the recommended count, the not-yet-scored count, and the "set aside everything routine"
-- write). Decided rows never need it.
create index if not exists moment_import_candidates_significance_idx
  on moment_import_candidates (user_id, significance)
  where status = 'pending';

comment on column moment_import_candidates.significance is
  'What KIND of thing this calendar entry looks like, from the AI extraction (scan-calendar-sources) or the score-candidates backfill. Anything other than ''routine'' is shown in the triage page''s Recommended list. NEVER used to hide or reject anything — every candidate stays in the full list regardless (2026-08-12 directive). Null = not scored yet.';
