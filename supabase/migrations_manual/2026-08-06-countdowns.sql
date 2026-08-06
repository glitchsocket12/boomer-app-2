-- Countdowns on the Calendar page (2026-08-06). A countdown card shows how long it's BEEN since a
-- date (↑) or how long UNTIL one (↓). Two sources feed the section and only one of them needs this
-- table:
--
--   1. Auto-derived milestones -- past `moments` tagged "Milestone", plus `reminders` that have a
--      `year` on file -- are computed live from data already on record. They need NO row here.
--   2. Things the founder adds or pins live in this table.
--
-- A row here is one of three shapes, enforced by the CHECK below:
--
--   * standalone   label + target_date, no FK           "Baby due date", not an event
--   * pinned event moment_id only, no label/target_date  an existing/just-created `moments` row
--   * dismissal    moment_id or reminder_id + hidden     suppresses an auto-derived card (1)
--
-- Why a pinned event carries NO label or date of its own: the title and date are read live off the
-- `moments` row, so renaming or re-dating the event on EventDetail keeps its countdown correct.
-- Copying them here would create a second truth that silently drifts -- same reasoning as
-- `notes.moment_id` BEING attendance rather than a duplicated attendee list.
--
-- Why `hidden` exists at all: an auto-derived card has no row to delete, and "get this off my
-- countdowns" must never mean deleting the underlying event or birthday. A dismissal row is the
-- smallest thing that survives a reload.
--
-- Deliberately no `sort_order` column: ordering is computed (upcoming soonest-first, then past
-- most-recent-first). Drag-reordering is a separate feature and would need one.

create table if not exists countdowns (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  label text,            -- standalone countdowns only
  target_date date,      -- standalone countdowns only
  moment_id uuid references moments(id) on delete cascade,
  reminder_id uuid references reminders(id) on delete cascade,
  hidden boolean not null default false,
  created_at timestamptz not null default now(),
  -- Every row must have a subject: its own label+date, or something to point at. Blocks the
  -- half-written row (label with no date) that would render as a card with nothing to count to.
  constraint countdowns_has_subject check (
    (label is not null and target_date is not null) or moment_id is not null or reminder_id is not null
  )
);

alter table countdowns enable row level security;

create policy "Users manage their own countdowns"
  on countdowns
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- The whole section loads as one query per account, so this is the only index the read path needs.
create index if not exists countdowns_user_idx on countdowns (user_id);

-- One row per pinned/dismissed subject. Pinning the same event twice, or dismissing the same
-- derived milestone twice (double-tap, two tabs), is a no-op instead of a duplicate card.
-- Partial so the standalone rows -- all NULL on both FKs -- are unaffected.
create unique index if not exists countdowns_user_moment_idx
  on countdowns (user_id, moment_id) where moment_id is not null;
create unique index if not exists countdowns_user_reminder_idx
  on countdowns (user_id, reminder_id) where reminder_id is not null;
