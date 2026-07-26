-- Founder feedback 2026-07-25/26: the per-group "suggest new members" signal (item 57) defaulted
-- to on for every group, but the founder isn't acting on it for any group in practice. Flip the
-- default for groups created from here on, and turn it off for every existing group too (all of
-- them are still sitting at the auto-applied default, none intentionally re-enabled yet).
alter table groups alter column suggestions_enabled set default false;
update groups set suggestions_enabled = false;
