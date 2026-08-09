-- Home's "Connections to make" card gained two new question types beyond its original
-- "add this person to this group?" (see src/lib/suggestRelationshipGaps.ts and
-- src/lib/suggestEventGroups.ts). The original type remembers a "No" in
-- groups.dismissed_person_ids; the new ones have no equivalent column, and a standing
-- account-wide suggestion MUST remember a "No" or it comes back on every Home visit forever.
--
-- One generic table rather than a column per type, so the next suggestion kind is a new CHECK
-- value instead of another migration. subject_id/object_id deliberately carry no foreign keys:
-- what they point at depends on `kind` (people, moments, groups), and an orphaned dismissal row
-- left behind by a delete is harmless — nothing reads it once the thing it names is gone.
create table if not exists dismissed_suggestions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- family_coparent: subject = the parent to add, object = the child
  -- family_couple:   subject/object = the two people, normalized subject < object
  -- event_group:     subject = the moment, object = the group
  kind text not null check (kind in ('family_coparent', 'family_couple', 'event_group')),
  subject_id uuid not null,
  object_id uuid not null,
  created_at timestamptz not null default now(),
  unique (user_id, kind, subject_id, object_id)
);

alter table dismissed_suggestions enable row level security;

create policy "Users manage their own dismissed suggestions"
  on dismissed_suggestions
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
