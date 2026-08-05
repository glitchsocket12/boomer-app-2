-- Editable group types (founder ask, 2026-08-04): group types become a user-owned, growing list
-- like tags, instead of the fixed five from 2026-07-20-group-types.sql.
--
-- groups.group_type stays a plain text column holding the type's NAME (not a foreign key) — every
-- read site in the app already displays that text, and a rename in Manage Group Types rewrites the
-- matching groups in the same step. The CHECK constraint has to go, since it's what pins the
-- column to the original five.
alter table groups drop constraint if exists groups_group_type_check;

create table if not exists group_types (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);

-- Case-insensitive dedup per user, same as tags — "Work" and "work" can't fork into two entries.
create unique index if not exists group_types_unique_per_user on group_types (user_id, lower(name));

alter table group_types enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'group_types' and policyname = 'Users manage their own group types') then
    create policy "Users manage their own group types"
      on group_types
      for all
      using (auth.uid() = user_id)
      with check (auth.uid() = user_id);
  end if;
end $$;

-- Seeds the original five for every existing account, so nobody's pickers change on the day this
-- runs. New accounts get seeded lazily the first time they open Manage Group Types.
insert into group_types (user_id, name)
select u.id, t.name
from auth.users u
cross join (values ('Family'), ('Friend group'), ('School'), ('Team'), ('Work')) as t(name)
on conflict do nothing;
