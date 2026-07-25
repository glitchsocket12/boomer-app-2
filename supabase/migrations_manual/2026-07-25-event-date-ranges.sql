-- Date-range support (founder feedback, 2026-07-25): an event can span more than one day.
-- event_end_date mirrors event_date (nullable date, null = single-day/unknown). Also adds
-- AI tag/group suggestions on calendar-import candidates, folded into the existing per-event
-- extraction call in scan-calendar-sources (no new Anthropic API call).
alter table moments add column if not exists event_end_date date;
alter table moment_import_candidates add column if not exists event_end_date date;
alter table moment_import_candidates add column if not exists suggested_tags jsonb not null default '[]'::jsonb;
alter table moment_import_candidates add column if not exists suggested_group_ids jsonb not null default '[]'::jsonb;
