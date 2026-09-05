-- Map view on the Events page (backlog item 117, founder ask 2026-09-04): pin events to where they
-- happened, click a place, see its events.
--
-- The map was never the hard part. `moments.location` is free text with no id and no coordinates
-- behind it, so before this table there was nothing in the database that could be plotted at all.
-- This is the geocoding cache that makes the pins possible.
--
-- Keyed by the NORMALIZED location string (lib/locationGroups.ts `clusterKey`), not by moment, for
-- three reasons. The founder's account is ~105 events across ~99 distinct locations, so per-moment
-- rows would geocode the same address five times over. ManageLocations rewrites `moments.location`
-- in bulk, so a per-moment cache would be invalidated wholesale by a rename that didn't actually
-- move anything. And the same key is what already decides "these are the same place" everywhere
-- else in the app, so the map agrees with ManageLocations by construction instead of by accident.
--
-- Per-user rather than one shared gazetteer on purpose: a global cache would be cheaper but would
-- make one account's places readable from another, and §6's rule is RLS on everything scoped to
-- auth.uid(). The duplication is a handful of rows per account.
--
-- THREE states, not two — the same shape as the event-enrichment columns (2026-08-17), and the
-- reason is CLAUDE.md rule 3. A missing row means "never looked". A row with `source = 'none'`
-- means "looked, found nothing" and is what stops a bad address being re-sent to the geocoder on
-- every single page load forever. Without that sentinel the cache silently becomes a per-view API
-- call, which is exactly the failure mode rule 3 exists to prevent.
--
-- `source = 'manual'` is the correction path, and it is not optional: §12 records that a geocoder
-- answers a vague query confidently rather than with an error, so some pins WILL land in the wrong
-- state. A manual row is how the founder overrides one, and it must never be overwritten by a
-- later automatic pass.

create table if not exists location_coords (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- The clusterKey() form of the location text — the comparison form, never displayed.
  location_key text not null,
  -- One real spelling behind that key, kept only so the row is legible in the dashboard.
  sample_value text not null,
  latitude double precision,
  longitude double precision,
  -- What the geocoder said it found ("Parker, Colorado, United States"). Shown to the founder so a
  -- wrong pin is recognisable as wrong without opening the map and squinting at it.
  resolved_label text,
  source text not null check (source in ('geoapify', 'manual', 'none')),
  resolved_at timestamptz not null default now(),
  unique (user_id, location_key)
);

-- The three states are enforced here rather than trusted from the client: a resolved row must
-- carry both coordinates, and a 'none' row must carry neither. Without this a half-written row
-- (lat but no lng after a partial response) would plot on the null island off West Africa.
alter table location_coords
  drop constraint if exists location_coords_coords_match_source;
alter table location_coords
  add constraint location_coords_coords_match_source check (
    (source = 'none' and latitude is null and longitude is null)
    or (source <> 'none' and latitude is not null and longitude is not null)
  );

alter table location_coords enable row level security;

-- No subquery against another table here, unlike moment_links: this row references a location
-- STRING, not a moment id, so there is no second ownership to check. user_id = auth.uid() is the
-- whole rule. The usual warning still applies — a policy mistake makes writes a silent no-op
-- rather than an error, so verify with a write-then-read-back, not with a passing build.
create policy "Users manage their own location coordinates"
  on location_coords
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Every read is "all of my cached places at once" (the map loads the whole set on open), which the
-- unique index above already serves as its leading column.
