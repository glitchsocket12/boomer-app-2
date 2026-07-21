-- Backlog item 32/15: a real `relationships` table as the shared source of truth for family
-- links — the family tree, person-facts' Key Facts linking, reciprocal notes
-- (_shared/relationships.ts), and "my mom/dad" resolution should all read/write through this ONE
-- table instead of staying siloed (notes text + people.key_facts JSON, no queryable graph).
-- Founder-confirmed architecture decision 2026-07-20 — see PROJECT_CONTEXT.md backlog item 32.

-- Self-profile flag: the one `people` row that represents the app's own user, so "my mom"/"my
-- parents" have a profile to attach to, and so this row can be excluded from the People list,
-- search, Dunbar tiers, and "due for an update" (it's not someone to follow up with).
alter table people add column if not exists is_self boolean not null default false;

-- Only one "this is me" profile per user.
create unique index if not exists people_one_self_per_user
  on people (user_id) where (is_self);

create table if not exists relationships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  person_a_id uuid not null references people(id) on delete cascade,
  person_b_id uuid not null references people(id) on delete cascade,
  -- spouse/sibling/partner are symmetric and stored ONCE per pair (person_a_id < person_b_id by
  -- uuid sort — same normalization group_associations already uses for its symmetric pairs).
  -- "parent" is directional: person_a_id is the PARENT of person_b_id. There's no separate
  -- "child" kind stored — it's just the reverse lookup of a "parent" row (person_b_id = the
  -- person, kind = 'parent' -> their parents; person_a_id = the person -> their children).
  kind text not null check (kind in ('spouse', 'sibling', 'partner', 'parent')),
  created_at timestamptz not null default now(),
  constraint relationships_no_self_pair check (person_a_id <> person_b_id),
  constraint relationships_unique unique (person_a_id, person_b_id, kind)
);

create index if not exists relationships_person_a_idx on relationships (person_a_id);
create index if not exists relationships_person_b_idx on relationships (person_b_id);

alter table relationships enable row level security;

drop policy if exists "relationships_select_own" on relationships;
drop policy if exists "relationships_insert_own" on relationships;
drop policy if exists "relationships_update_own" on relationships;
drop policy if exists "relationships_delete_own" on relationships;

create policy "relationships_select_own" on relationships for select using (auth.uid() = user_id);
create policy "relationships_insert_own" on relationships for insert with check (auth.uid() = user_id);
create policy "relationships_update_own" on relationships for update using (auth.uid() = user_id);
create policy "relationships_delete_own" on relationships for delete using (auth.uid() = user_id);

-- Best-effort backfill from the 5 deterministic reciprocal-note phrasings RECIPROCAL_NOTE already
-- writes (supabase/functions/_shared/relationships.ts) — doesn't attempt fuzzy/partial-name
-- matching, only an exact "name [+ last_name]" match against another of the same user's people.
-- New writes going forward (via the wired-up edge functions) matter more than perfect historical
-- coverage, so a note that doesn't resolve here is simply left out, not guessed at.
do $$
declare
  r record;
  target_id uuid;
  a uuid;
  b uuid;
  raw_name text;
begin
  for r in
    select n.id as note_id, n.person_id, n.content, p.user_id
    from notes n
    join people p on p.id = n.person_id
    where n.person_id is not null
  loop
    -- spouse
    if r.content ~* '^Married to (.+)\.$' then
      raw_name := regexp_replace(r.content, '^Married to (.+)\.$', '\1', 'i');
      select id into target_id from people
        where user_id = r.user_id and id <> r.person_id
          and lower(name || coalesce(' ' || last_name, '')) = lower(raw_name)
        limit 1;
      if target_id is not null then
        a := least(r.person_id, target_id); b := greatest(r.person_id, target_id);
        insert into relationships (user_id, person_a_id, person_b_id, kind)
        values (r.user_id, a, b, 'spouse') on conflict do nothing;
      end if;
    end if;

    -- sibling
    if r.content ~* '^Their sibling is (.+)\.$' then
      raw_name := regexp_replace(r.content, '^Their sibling is (.+)\.$', '\1', 'i');
      select id into target_id from people
        where user_id = r.user_id and id <> r.person_id
          and lower(name || coalesce(' ' || last_name, '')) = lower(raw_name)
        limit 1;
      if target_id is not null then
        a := least(r.person_id, target_id); b := greatest(r.person_id, target_id);
        insert into relationships (user_id, person_a_id, person_b_id, kind)
        values (r.user_id, a, b, 'sibling') on conflict do nothing;
      end if;
    end if;

    -- partner
    if r.content ~* '^In a relationship with (.+)\.$' then
      raw_name := regexp_replace(r.content, '^In a relationship with (.+)\.$', '\1', 'i');
      select id into target_id from people
        where user_id = r.user_id and id <> r.person_id
          and lower(name || coalesce(' ' || last_name, '')) = lower(raw_name)
        limit 1;
      if target_id is not null then
        a := least(r.person_id, target_id); b := greatest(r.person_id, target_id);
        insert into relationships (user_id, person_a_id, person_b_id, kind)
        values (r.user_id, a, b, 'partner') on conflict do nothing;
      end if;
    end if;

    -- "Their child is X." -> this note's person is X's PARENT
    if r.content ~* '^Their child is (.+)\.$' then
      raw_name := regexp_replace(r.content, '^Their child is (.+)\.$', '\1', 'i');
      select id into target_id from people
        where user_id = r.user_id and id <> r.person_id
          and lower(name || coalesce(' ' || last_name, '')) = lower(raw_name)
        limit 1;
      if target_id is not null then
        insert into relationships (user_id, person_a_id, person_b_id, kind)
        values (r.user_id, r.person_id, target_id, 'parent') on conflict do nothing;
      end if;
    end if;

    -- "Their parent is X." -> X is this note's person's PARENT
    if r.content ~* '^Their parent is (.+)\.$' then
      raw_name := regexp_replace(r.content, '^Their parent is (.+)\.$', '\1', 'i');
      select id into target_id from people
        where user_id = r.user_id and id <> r.person_id
          and lower(name || coalesce(' ' || last_name, '')) = lower(raw_name)
        limit 1;
      if target_id is not null then
        insert into relationships (user_id, person_a_id, person_b_id, kind)
        values (r.user_id, target_id, r.person_id, 'parent') on conflict do nothing;
      end if;
    end if;
  end loop;
end $$;
