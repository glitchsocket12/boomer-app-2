-- Calendar-import review queue (gameplan: i-want-to-gameplan-cuddly-wilkinson.md, phase 3).
-- AI-extracted candidates from a connected calendar_sources feed land here, NEVER directly in
-- `moments` — matches every other AI-suggestion flow in this app (RelationshipSuggestions, etc.):
-- nothing becomes a real record without an explicit founder accept.
create table if not exists moment_import_candidates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  calendar_source_id uuid not null references calendar_sources(id) on delete cascade,
  ical_uid text not null,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'rejected')),
  occasion text,
  location text,
  when_text text,
  event_date date,
  raw_description text,
  suggested_people jsonb not null default '[]'::jsonb,
  source_recurrence_id text,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  unique (user_id, ical_uid)
);

alter table moment_import_candidates enable row level security;

create policy "Users manage their own import candidates"
  on moment_import_candidates
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index if not exists moment_import_candidates_pending_idx
  on moment_import_candidates (user_id)
  where status = 'pending';
