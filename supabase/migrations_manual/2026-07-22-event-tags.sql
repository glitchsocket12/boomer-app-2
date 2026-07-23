-- Event Tags (backlog items 28 + 34): manual + AI-suggested tags on events (moments), plus a
-- growing/learning vocabulary for the Events-page category filter. Deliberately NOT a fixed
-- enum like groups.group_type — tags are multi-valued per event and freely created over time.
create table if not exists tags (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);

-- Case-insensitive dedup per user so "Milestone" and "milestone" can't fork into two separate
-- tags/filter entries.
create unique index if not exists tags_unique_per_user on tags (user_id, lower(name));

alter table tags enable row level security;

create policy "Users manage their own tags"
  on tags
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create table if not exists moment_tags (
  moment_id uuid not null references moments(id) on delete cascade,
  tag_id uuid not null references tags(id) on delete cascade,
  primary key (moment_id, tag_id)
);

alter table moment_tags enable row level security;

create policy "Users manage tags on their own moments"
  on moment_tags
  for all
  using (
    exists (select 1 from moments m where m.id = moment_id and m.user_id = auth.uid())
  )
  with check (
    exists (select 1 from moments m where m.id = moment_id and m.user_id = auth.uid())
    and exists (select 1 from tags t where t.id = tag_id and t.user_id = auth.uid())
  );

-- Reverse lookup ("all moments with this tag") — needed for future search/co-occurrence
-- features; cheap to add now, awkward to retrofit later.
create index if not exists moment_tags_tag_id_idx on moment_tags (tag_id);
