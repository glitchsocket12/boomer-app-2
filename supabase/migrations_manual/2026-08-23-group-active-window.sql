-- Groups get a "when and where": the window a group is actually relevant for, and the place it
-- happens. Backlog item: CRM school, 2026-08-23.
--
-- Before this, a group was a name, a type and a member list, so nothing in the app could connect
-- "just landed in Pensacola" on Aug 23 to a group called "CRM School" that runs Aug 23-27 in
-- Pensacola. `converse` had no such fact to put in its prompt, and lib/suggestEventGroups.ts
-- could only fire on shared attendees (>= 2, all members), which a brand-new group has none of.
--
-- Semantics every consumer follows (see src/lib/groupWindow.ts):
--   start null, end null  -> no window; the group is always relevant. Family, friends, a
--                            squadron. This is MOST groups, and the default.
--   start set,  end set   -> a bounded thing. A school, a trip, a conference.
--   start set,  end null  -> open-ended: started, still going. A current job.
-- A row with no start_date never matches on dates at all.
--
-- Nullable with no default and no backfill: every existing group keeps the "always relevant"
-- behavior it has today, so this migration changes nothing until a date is actually typed.
-- Subgroups are ordinary `groups` rows and get their own window - deliberately NOT inherited
-- from a parent, since "22 AS" runs for years while a mission under it runs for a week.
--
-- No RLS change needed: the policies on `groups` are table-level, not column-level.

alter table groups add column if not exists start_date date;
alter table groups add column if not exists end_date   date;
alter table groups add column if not exists location   text;
