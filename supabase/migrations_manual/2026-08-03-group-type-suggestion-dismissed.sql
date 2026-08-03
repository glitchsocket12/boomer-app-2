-- Home-page "looks like a family group — tag it Family?" suggestion (founder request, 2026-08-03).
-- Needs its own dismissal flag, separate from dismissed_person_ids/dismissed_group_ids (those are
-- about membership suggestions, not the group_type suggestion). Default false preserves current
-- behavior for every existing group; no backfill needed.
alter table groups add column if not exists group_type_suggestion_dismissed boolean not null default false;
