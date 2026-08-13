-- Fixes "calendars are not syncing": the sync was re-asking Claude about the same rejected events
-- on every single run, forever, and the wasted work starved the other calendars.
--
-- scan-calendar-sources only ever wrote a row for an event Claude said WAS worth suggesting. When
-- Claude said "skip this" (a dentist appointment, a haircut, a recurring work block), that decision
-- was thrown away — so the event stayed absent from `moment_import_candidates`, stayed out of the
-- function's `seenUids` set, and got sent to Claude again on the next sync. And the next.
--
-- Measured on the founder's account 2026-08-12: 322 events across two calendars were being re-judged
-- every run and producing zero new rows. That is more than the 8-batch-per-run cap (240 events), so
-- "Jake Personal" never reached the end of its own event list, never got its `last_synced_at`
-- stamped, and read as "Last synced Aug 4" indefinitely. The third calendar was never reached at all.
--
-- This adds the missing third status so the skip decision can be recorded once and honoured after.
-- 'skipped' = Claude auto-skipped it, no human involved. 'rejected' stays what it has always meant:
-- the founder looked at a suggestion and said no. Keeping them distinct matters because the review
-- UI, and any future "what did you turn down" view, should not conflate a machine's filter with the
-- founder's own choices. Same status name `contact_import_candidates` already uses for this idea.
--
-- Safe to run more than once. Until it IS run, the app fails open: the function writes its skip rows
-- in a separate statement from the real candidates, so the constraint rejects only the skip-recording
-- and genuine suggestions still save exactly as they do today.

alter table moment_import_candidates
  drop constraint if exists moment_import_candidates_status_check;

alter table moment_import_candidates
  add constraint moment_import_candidates_status_check
  check (status = any (array['pending'::text, 'accepted'::text, 'rejected'::text, 'skipped'::text]));

comment on column moment_import_candidates.status is
  'pending = awaiting founder review; accepted/rejected = founder reviewed it; skipped = the AI scan judged it not worth suggesting (recorded so it is never re-sent to the API).';
