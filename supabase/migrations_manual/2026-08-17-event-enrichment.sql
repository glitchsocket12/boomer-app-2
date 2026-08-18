-- Event enrichment (founder ask, 2026-08-17): a "that day's weather" box and, when the event text
-- names a sports team, a box with the game's score/attendance/recap and a link to the ESPN summary.
-- Closes backlog item 21 ("Internet lookup for added context") and un-parks "weather metadata".
--
-- Cache columns follow the people.key_facts / key_facts_updated_at precedent exactly: the value
-- column plus a fetched_at stamp, populated once by the enrich-event Edge Function and re-served
-- from the DB forever after. That is not just CLAUDE.md rule 3 hygiene here — a past game's final
-- score and a past day's weather are immutable, so a cache hit is correct indefinitely and the
-- only thing that ever re-fetches is the manual refresh button or an edit to the date/location.
--
-- Three states per column, and the difference matters:
--   NULL                      -> never looked. The function will try on next view.
--   {"status":"not_found"}    -> looked, nothing there. Never re-fetch; no box shown.
--   {"status":"ok", ...}      -> real data.
-- Without the middle state, every event with no location would re-hit the weather API on every
-- single page view forever.
--
-- Deliberately NOT reusing the dormant moments.details jsonb: that renders as flat "key: value"
-- rows and is reserved for user-supplied detail, whereas this needs its own timestamps, its own
-- "we checked and there was nothing" state, and must stay visually distinct from what the user
-- actually said (the app's no-fabrication rule).

alter table moments add column if not exists weather jsonb;
alter table moments add column if not exists weather_fetched_at timestamptz;
alter table moments add column if not exists game jsonb;
alter table moments add column if not exists game_fetched_at timestamptz;

-- Populated instead of `game` when the date + team matched more than one real game, which is the
-- normal outcome for a shared nickname ("Giants", "Tigers"). Drives the "Which game was this?"
-- picker rather than letting the app guess — same accept/dismiss shape as dismissed_person_ids.
alter table moments add column if not exists game_candidates jsonb;

-- "Not a game" / "none of these". Suppresses the picker permanently for this event without
-- destroying the candidates, so a mis-click is recoverable via the refresh button.
alter table moments add column if not exists game_dismissed boolean not null default false;

-- No new RLS policies needed: these are columns on `moments`, already covered by its existing
-- user_id-scoped policies, and the Edge Function writes through the caller's JWT.
