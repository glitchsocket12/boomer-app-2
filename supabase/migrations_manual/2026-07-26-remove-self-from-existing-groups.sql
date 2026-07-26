-- One-time data cleanup, not a schema change (see PROJECT_CONTEXT.md — "auto-add to groups"
-- item): Groups.tsx's "+ Add Group" handler (and Onboarding.tsx's Stage 4 group creation) used to
-- unconditionally tag the founder's own self-person as a member of every new group, so they could
-- browse a group they made themselves (e.g. their own family) from their own Circle page. That
-- fired even for groups that were never about them (a relative's other social circle, a coworker
-- group, a grandkid's team) — confusing, and it also meant searching the Groups list for the
-- founder's own last name matched almost every group, since they were a member of all of them.
-- The runtime fix (this repo, same date) stops NEW groups from doing this. This file cleans up
-- EXISTING data: there's no way to tell, after the fact, which of the founder's current
-- `person_groups` rows are real memberships versus ones the bug created, so this is an
-- all-or-nothing removal — re-add yourself afterward to whichever groups are genuinely yours
-- (e.g. your real family group), the same way you'd add anyone else.
--
-- Run the SELECT below FIRST, by itself, and check the output — every row is a group you're
-- about to be removed from. If you see an email that isn't yours (a test/disposable account
-- sharing this project), add `and p.user_id = '<your id from this preview>'` to the DELETE's
-- WHERE clause below before running it, so it only affects your own account.

-- 1. Preview — read-only, changes nothing.
select u.email, g.id as group_id, g.name as group_name
from person_groups pg
join people p on p.id = pg.person_id and p.is_self = true
join groups g on g.id = pg.group_id
join auth.users u on u.id = p.user_id
order by u.email, g.name;

-- 2. Only after reviewing the preview above — removes the self-membership rows it showed.
delete from person_groups
where person_id in (select id from people where is_self = true);
