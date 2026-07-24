-- Death/divorce/remarriage on the family tree — see PROJECT_CONTEXT.md for the feature writeup.
-- Two additive, nullable columns; no backfill needed.

-- Presence = deceased. No separate boolean: a date carries strictly more information and "is this
-- set" already answers the yes/no question everywhere it's checked.
alter table people add column if not exists deceased_date date;

-- Only meaningful for kind in ('spouse','partner'). Deliberately has no 'death' option — death is
-- read off people.deceased_date on either party instead, so there's exactly one place to record
-- that fact and every union involving a deceased person reads as ended automatically. 'divorce' is
-- the only case that needs its own explicit flag, since nothing else implies it.
alter table relationships add column if not exists ended_reason text
  check (ended_reason is null or ended_reason in ('divorce'));
