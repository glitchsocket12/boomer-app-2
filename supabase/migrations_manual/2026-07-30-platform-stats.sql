-- Platform-wide totals for Home's "living databox" (people/events/groups/datapoints
-- across every account, not just the signed-in user). Every other query against these
-- tables is scoped to auth.uid() by RLS, so a plain client query can't see other users'
-- rows — this function is SECURITY DEFINER (runs as its owner, which owns the tables and
-- therefore bypasses RLS) specifically to add up everyone's counts. Read-only, no args,
-- safe to grant to anon/authenticated.
create or replace function public.platform_stats()
returns table (
  people_count bigint,
  events_count bigint,
  groups_count bigint,
  notes_count bigint
)
language sql
security definer
set search_path = public
stable
as $$
  select
    (select count(*) from people where is_self = false),
    (select count(*) from moments),
    (select count(*) from groups),
    (select count(*) from notes);
$$;

grant execute on function public.platform_stats() to anon, authenticated;
