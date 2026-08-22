-- Two-stage review + "not now" for calendar-import candidates.
--
-- WHY. The 2026-08-12 directive ("it should just simply sync all new events, and let the person
-- decide themselves whether or not they want to accept/reject it") removed the AI's filter, which
-- was right — it was rejecting 88% of what it saw. But it moved the whole burden onto the review
-- screen, and that screen was built for a handful of cards: the founder's own 3-year calendar
-- produces ~230 pending candidates, each rendered as a ~695px full editor, with no finish line and
-- no answer between "accept" and "reject".
--
-- This adds the two statuses that make the queue chewable WITHOUT hiding anything (nothing here
-- filters — that ruling stands):
--
--   'selected'  the founder kept it in a fast one-line triage pass (CalendarTriage.tsx) and it is
--               now waiting for the detailed card. Exactly the meaning, and exactly the name,
--               `contact_import_candidates` already uses for the same two-stage idea.
--   'deferred'  "not now". A real third answer beside accept/reject: the card leaves your plate and
--               comes back on `deferred_until` instead of sitting in the queue forever or taking a
--               permanent no it didn't earn.
--
-- 'skipped' is deliberately left alone. It means "the MACHINE said no" (see
-- 2026-08-12-calendar-skipped-status.sql) and nothing writes it today. Keeping it distinct from a
-- human's decision is the whole reason it was given its own value in the first place; reusing it
-- for a founder's "not this one" would conflate exactly what that migration separated. A triage
-- "Not this one" writes 'rejected', because that is what it is.
--
-- NOTHING IS MIGRATED. Existing 'pending' rows stay 'pending' and simply show up in the new triage
-- list, which is where an untriaged candidate belongs. No row changes meaning retroactively.
--
-- Safe to run more than once. Until it IS run the app fails open: the frontend probes for
-- `deferred_until` (an unknown COLUMN errors; an unknown status VALUE would not), and when the
-- probe fails it keeps reading 'pending' into the detailed queue exactly as it does today, hides
-- the triage page, and hides the "Not now" button. Running this file switches all of it on with no
-- redeploy.

alter table moment_import_candidates
  drop constraint if exists moment_import_candidates_status_check;

alter table moment_import_candidates
  add constraint moment_import_candidates_status_check
  check (status = any (array['pending'::text, 'accepted'::text, 'rejected'::text, 'skipped'::text, 'selected'::text, 'deferred'::text]));

-- Date, not timestamptz: "bring this back in a month" is a calendar-day promise, and comparing it
-- against the user's own today is what the wake-up sweep does. An hour either way is meaningless
-- here, and a date keeps the comparison free of timezone reasoning.
alter table moment_import_candidates
  add column if not exists deferred_until date;

-- Partial index: the wake-up sweep runs on every visit to the inbox and the review queue, and only
-- ever asks for deferred rows that have come due. Most accounts have none.
create index if not exists moment_import_candidates_deferred_until_idx
  on moment_import_candidates (user_id, deferred_until)
  where status = 'deferred';

comment on column moment_import_candidates.status is
  'pending = not yet triaged (shows in the fast CalendarTriage list); selected = kept in triage, awaiting the detailed review card; deferred = founder pressed "Not now", returns on deferred_until; accepted/rejected = founder reviewed it; skipped = the AI scan judged it not worth suggesting (recorded so it is never re-sent to the API — unused since the filter was removed 2026-08-12).';

comment on column moment_import_candidates.deferred_until is
  'Set with status = ''deferred''. The date this candidate rejoins the review queue; a cheap idempotent sweep flips it back to ''selected'' once today >= this. Null for every other status.';
