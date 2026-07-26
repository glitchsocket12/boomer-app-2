-- Birthday-calendar import (extends the existing calendar_sources / scan-calendar-sources
-- pipeline from 2026-07-24-calendar-sources.sql rather than building a parallel system).
-- Founder can mark a connected calendar as a "Birthdays calendar" (e.g. iCloud's auto-generated
-- Birthdays calendar, itself derived from Contacts) — those sources get parsed for name+date only
-- (no AI call, no cost) instead of run through the moment-extraction pipeline.

alter table calendar_sources
  add column if not exists source_type text not null default 'events'
  check (source_type in ('events', 'birthdays'));

-- Mirrors moment_import_candidates' shape/RLS/dedupe pattern exactly (same "AI/parsed suggestions
-- never write directly to real tables" rule as every other suggestion flow in this app).
create table if not exists birthday_import_candidates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  calendar_source_id uuid not null references calendar_sources(id) on delete cascade,
  ical_uid text not null,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'rejected')),
  full_name text,
  birthday_month int,
  birthday_day int,
  birthday_year int,
  matched_person_id uuid references people(id) on delete set null,
  match_confidence text not null default 'none' check (match_confidence in ('high', 'none')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  unique (user_id, ical_uid)
);

alter table birthday_import_candidates enable row level security;

create policy "Users manage their own birthday import candidates"
  on birthday_import_candidates
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index if not exists birthday_import_candidates_pending_idx
  on birthday_import_candidates (user_id)
  where status = 'pending';

-- A Birthdays-calendar entry's DTSTART usually carries the real birth year even though the event
-- recurs yearly — reminders has never captured this (chat-parsed birthdays are month/day only).
-- Nullable/additive: nothing existing reads or requires it yet.
alter table reminders add column if not exists year int;
