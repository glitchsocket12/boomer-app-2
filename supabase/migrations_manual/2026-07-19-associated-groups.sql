-- Associated Groups: confirmed group-to-group relationships (one row per pair, ordering
-- normalized client-side so the same two groups can't be linked twice).
create table if not exists group_associations (
  id uuid primary key default gen_random_uuid(),
  group_id_a uuid not null references groups(id) on delete cascade,
  group_id_b uuid not null references groups(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint group_associations_no_self_link check (group_id_a <> group_id_b),
  constraint group_associations_unique_pair unique (group_id_a, group_id_b)
);

alter table group_associations enable row level security;

create policy "Users manage their own group associations"
  on group_associations
  for all
  using (
    exists (select 1 from groups g where g.id = group_id_a and g.user_id = auth.uid())
  )
  with check (
    exists (select 1 from groups g where g.id = group_id_a and g.user_id = auth.uid())
    and exists (select 1 from groups g where g.id = group_id_b and g.user_id = auth.uid())
  );

-- Groups the user has said should NOT be suggested as an associated group of this one — same
-- pattern as the existing groups.dismissed_person_ids.
alter table groups add column if not exists dismissed_group_ids jsonb not null default '[]'::jsonb;
