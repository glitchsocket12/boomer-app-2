-- Search log: one row per Home chat message the AI classifies as a lookup/recall attempt
-- (not a new memory being captured, a correction, or small talk) — logged by `converse` — with
-- whether it found genuinely relevant existing info. Powers the "Recall assists this month"
-- dashboard stat.
create table if not exists search_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  query_text text not null,
  matched boolean not null default false,
  created_at timestamptz not null default now()
);

alter table search_log enable row level security;

create policy "Users manage their own search log"
  on search_log
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
