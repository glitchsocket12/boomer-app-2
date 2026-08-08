-- Per-card settings for Countdowns (2026-08-06, the same day the section shipped). Founder ask:
-- open a card and choose what it counts in, whether it repeats, whether it keeps counting once the
-- date passes, and what it's called.
--
-- Run `2026-08-06-countdowns.sql` FIRST -- this file only adds columns to the table that one
-- creates. Safe to paste in twice (every statement is IF NOT EXISTS or drop-then-create).
--
-- Until this runs, the Countdowns section still works: `loadCountdowns` asks for these columns,
-- falls back to the original list when the database says they don't exist, and hides the settings
-- gear rather than offering writes that would silently fail.

alter table countdowns add column if not exists custom_title text;
alter table countdowns add column if not exists units text[];
alter table countdowns add column if not exists repeat_rule text;
alter table countdowns add column if not exists keep_counting boolean not null default true;

-- `custom_title` rather than overwriting `label`: a pinned event's title is read live off the
-- `moments` row on purpose (rename the event, the countdown follows). This is the display name
-- ON the countdown, so "Conor & Shelly's wedding" can read as "The wedding!!" here without
-- touching the event, and clearing it falls straight back to the real title.
--
-- `units` is a text[] of 'years' | 'months' | 'weeks' | 'days' | 'hours' | 'minutes' | 'seconds'.
-- NULL/empty means the automatic ladder (largest non-zero unit and the three below it), which is
-- what every existing card keeps doing. Not an enum: adding a unit later shouldn't need a type
-- migration, and lib/countdowns.ts already filters anything it doesn't recognise.

-- Constraints get dropped first because Postgres has no `add constraint if not exists`.
alter table countdowns drop constraint if exists countdowns_repeat_rule_check;
alter table countdowns add constraint countdowns_repeat_rule_check
  check (repeat_rule is null or repeat_rule in ('weekly', 'monthly', 'yearly'));
