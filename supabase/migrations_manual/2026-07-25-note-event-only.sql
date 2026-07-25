-- Calendar-import review needs a lightweight "save as a note on this existing event" action
-- (see PROJECT_CONTEXT.md ImportReview entry) that doesn't merge/create a moment and isn't about
-- any one person or group — just a note scoped to the event itself.
--
-- Two things blocked this (confirmed against the live schema via the Management API before
-- writing this migration, not guessed): the CHECK constraint `notes_person_or_group_check`
-- required person_id OR group_id, and every existing RLS policy on `notes` ("Users can manage
-- notes for their own people" plus the four notes_group_* command policies) is scoped to
-- person_id or group_id ownership only — neither covers a moment_id-only row. Live-tested: an
-- insert with only moment_id set failed with "new row violates row-level security policy",
-- i.e. RLS was the actual blocker, not just the CHECK constraint.
--
-- Fix is additive only — widen the CHECK, and ADD one new policy for the moment_id-only case
-- (Postgres OR's multiple permissive policies together), rather than touching any of the 5
-- existing policies that already work for 706+ real person/group notes.

alter table notes drop constraint notes_person_or_group_check;
alter table notes add constraint notes_person_or_group_or_moment_check
  check (person_id is not null or group_id is not null or moment_id is not null);

create policy "Users can manage notes for their own moments" on notes
  for all
  using (
    moment_id is not null
    and exists (select 1 from moments where moments.id = notes.moment_id and moments.user_id = auth.uid())
  )
  with check (
    moment_id is not null
    and exists (select 1 from moments where moments.id = notes.moment_id and moments.user_id = auth.uid())
  );
