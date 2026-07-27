-- Contacts import (vCard). Founder-requested: build out People profiles from an iPhone Contacts
-- export (iCloud.com/Contacts.app "Export vCard" -> one .vcf file, many contacts). Mirrors the
-- existing calendar-import pipeline's "suggest, never auto-write" pattern (moment_import_candidates/
-- birthday_import_candidates) rather than creating people directly from a parsed file.
--
-- Founder follow-up: a real contact list can be 1000+ entries, most of which aren't people this
-- app should track. Nothing gets created just because it was in the file -- the founder actively
-- curates via a paginated selection step (status 'pending' -> 'selected'/'skipped') BEFORE the
-- usual accept/reject-with-matching review (status 'selected' -> 'accepted'/'rejected'). See
-- ContactSelection.tsx / ContactImportReview.tsx.

-- New optional contact-detail columns on people (all nullable/additive, gender/deceased_date
-- precedent -- see 2026-07-26-gender.sql). Multi-value fields are jsonb arrays of {label, value}
-- rather than rigid single columns, matching the app's existing "customizable over hardcoded" bias
-- (nicknames, key_facts) -- a real contact card routinely carries 2-3 phones/emails/addresses.
alter table people add column if not exists organization text;
alter table people add column if not exists job_title text;
alter table people add column if not exists phones jsonb not null default '[]'::jsonb;
alter table people add column if not exists emails jsonb not null default '[]'::jsonb;
alter table people add column if not exists addresses jsonb not null default '[]'::jsonb;
alter table people add column if not exists urls jsonb not null default '[]'::jsonb;
alter table people add column if not exists social_profiles jsonb not null default '[]'::jsonb;
-- addresses entries are the one structured multi-field shape ({label, street, city, state, zip,
-- country}); phones/emails/urls/social_profiles are flat {label, value} pairs.

-- Birthdays/anniversaries do NOT get a new people column -- they already belong in the existing
-- reminders table (person_id, label, month, day, year?), same as the birthday-calendar-import path.

-- contact_import_candidates: a contact is a single match-or-create decision (like a birthday
-- candidate), not a multi-entity composite (like a moment with attendees/tags/groups) -- mirrors
-- birthday_import_candidates' shape/RLS/dedupe. No calendar_source_id: this is a one-time file
-- upload, not a recurring synced feed.
create table if not exists contact_import_candidates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  row_key text not null, -- vCard UID when present, else hash of normalized-name+first-email
  status text not null default 'pending'
    check (status in ('pending', 'selected', 'skipped', 'accepted', 'rejected')),
  full_name text not null,
  first_name text,
  last_name text,
  middle_name text,
  nickname text,
  organization text,
  job_title text,
  phones jsonb not null default '[]'::jsonb,
  emails jsonb not null default '[]'::jsonb,
  addresses jsonb not null default '[]'::jsonb,
  urls jsonb not null default '[]'::jsonb,
  social_profiles jsonb not null default '[]'::jsonb,
  birthday_month int,
  birthday_day int,
  birthday_year int,
  anniversary_month int,
  anniversary_day int,
  anniversary_year int,
  note_text text,
  related_names jsonb not null default '[]'::jsonb, -- [{label, name}] from Apple's X-ABRELATEDNAMES
                                                      -- -- captured for display only, not written
                                                      -- to the real relationships table this pass
  matched_person_id uuid references people(id) on delete set null,
  match_confidence text not null default 'none' check (match_confidence in ('high', 'none')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  unique (user_id, row_key)
);

alter table contact_import_candidates enable row level security;

create policy "Users manage their own contact import candidates"
  on contact_import_candidates
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Selection-page listing query filters on status = 'pending'; review-page listing filters on
-- 'selected' -- both driven off the same partial index.
create index if not exists contact_import_candidates_pending_idx
  on contact_import_candidates (user_id, full_name)
  where status = 'pending';

create index if not exists contact_import_candidates_selected_idx
  on contact_import_candidates (user_id)
  where status = 'selected';
