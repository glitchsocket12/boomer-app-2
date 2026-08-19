-- "Remind Me" on the import review screens: remember how long the founder likes to put something
-- off for, so the choice is made once rather than on every card.
--
-- Founder ask, 2026-08-19: pressing Remind Me should offer a choice of interval, with a
-- "use this as my default" checkbox. This column is that checkbox. Null = no default yet, so the
-- sheet opens and asks; a number = apply it straight away and don't interrupt.
--
-- Deliberately a plain day count rather than a new enum or an interval type. The UI offers four
-- presets (1 week / 1 month / 3 months / 6 months) but the value it stores is just "how many days",
-- so widening or changing that list later is a frontend edit with no migration behind it. It also
-- feeds `deferUntilIso(now, days)` in src/lib/reviewQueues.ts directly, which already takes days.
--
-- Nothing in the app reads a "frequency" anywhere else: `reminders` is date-based (birthdays and
-- anniversaries), countdowns are target dates, and DueForUpdate.tsx computes "updated N days ago"
-- on the fly without storing a cadence. So this is new vocabulary rather than a second way to say
-- something the schema already says.
--
-- Separate file from 2026-08-19-calendar-triage-and-defer.sql on purpose: that one has already been
-- handed to the founder, and editing a migration after it has gone out means nobody can tell which
-- version of it a given database actually ran.
--
-- Safe to run more than once. Until it IS run the app fails open: the frontend treats a failed read
-- as "no default set", so the sheet simply asks every time instead of remembering.

alter table user_settings
  add column if not exists review_remind_days integer;

comment on column user_settings.review_remind_days is
  'Default "remind me in N days" for the import review queues, set by the "use this as my default" checkbox on the Remind Me sheet. Null = ask every time.';
