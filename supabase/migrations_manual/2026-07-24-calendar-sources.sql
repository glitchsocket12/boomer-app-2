-- Calendar-source connections (gameplan: i-want-to-gameplan-cuddly-wilkinson.md). Deliberately
-- NOT full Google OAuth account access — each row is just a calendar's own secret iCal URL
-- (Settings -> Integrate calendar -> "Secret address in iCal format" in Google Calendar, or the
-- equivalent export URL from any other calendar app), which is inherently read-only and scoped to
-- exactly the one calendar the founder chooses to paste in. No token storage/refresh needed.
create table if not exists calendar_sources (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  ical_url text not null,
  label text not null,
  last_synced_at timestamptz,
  last_sync_error text,
  created_at timestamptz not null default now()
);

alter table calendar_sources enable row level security;

create policy "Users manage their own calendar sources"
  on calendar_sources
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
