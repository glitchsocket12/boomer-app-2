-- Founder directive, 2026-08-12: "it should just simply sync all new events, and let the person
-- decide themselves whether or not they want to accept/reject it."
--
-- Earlier the same day, scan-calendar-sources started recording the AI's "not worth suggesting"
-- verdict as status='skipped' (see 2026-08-12-calendar-skipped-status.sql). That was built to stop
-- the scan re-sending the same events to the API forever. It worked — but it made the AI's filter
-- permanent instead of merely wasteful, and the filter turned out to be rejecting ~88% of what it
-- saw: 202 events auto-skipped against 28 let through, on one sync of the founder's account.
--
-- The filter is now gone from the function entirely. This releases the events it already buried so
-- the founder can judge them.
--
-- DELETE, not `update ... set status='pending'`. A skip row was only ever a tombstone — it carries
-- user_id, calendar_source_id, ical_uid and nothing else, because recording the "no" was all it was
-- for. Flipping it to 'pending' therefore produces a BLANK review card (no title, no location, no
-- notes, no tag suggestions), and worse, permanently so: the row's uid is what puts that event in
-- the scan's `seenUids` set, so it would never be re-extracted. Tried the update first and it did
-- exactly that to 202 rows — deleting instead makes the events unseen again, so the next sync writes
-- them properly with a real extraction.
--
-- Only ever touches rows the AI skipped. 'rejected' is the founder's own decision and is never
-- reopened by this. Safe to run more than once — a second run matches nothing. Nothing of value is
-- lost: these rows hold no human decision and no AI output, only a uid the scan can rediscover.

delete from moment_import_candidates
 where status = 'skipped';

-- Repairs the 202 rows the first version of this file had already flipped to 'pending' before the
-- problem above was understood. Same tombstones, same reasoning, just already renamed by then —
-- identified by carrying no extraction at all. A genuinely extracted candidate always has an
-- occasion (the prompt requires a 3-6 word title); verified live 2026-08-12 that all 141 accepted
-- and 86 rejected rows, and every AI-written pending row, have one. Drop this statement when
-- re-running against a database that never saw the update version.
delete from moment_import_candidates
 where status = 'pending'
   and occasion is null
   and raw_description is null
   and location is null;
