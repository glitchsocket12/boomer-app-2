-- Auto-tagging existing events (founder ask 2026-08-23). Three passes: scan-event-tags reads each
-- never-scanned event and applies tags already on the roster; suggest-tag-trends clusters the
-- off-roster names it collected into "create this tag and put it on these 11 events" proposals;
-- ManageTags.tsx is where those get approved.
--
-- Every column here is additive and every statement is re-runnable.

-- ---------------------------------------------------------------------------------------------
-- moments: the scan's own bookkeeping.
-- ---------------------------------------------------------------------------------------------

-- null = this event has never been read by the scan. THIS IS THE COST GUARANTEE — no event is
-- ever sent to the API twice. Stamped LAST in each batch so a crash leaves the event retryable
-- rather than silently skipped.
alter table moments add column if not exists tag_scan_at timestamptz;

-- The scan's group pick, waiting for a yes/no on Home's existing "Tag this event as X?" card.
-- Never written straight to moment_groups — the founder asked to be asked about groups.
-- Same name/shape as moment_import_candidates.suggested_group_ids.
alter table moments add column if not exists suggested_group_ids jsonb not null default '[]'::jsonb;

-- Tag names the scan proposed that AREN'T on the roster yet. Deliberately not applied: a new name
-- gets coined once, deliberately, with its whole event list visible (see tag_suggestions below),
-- instead of appearing across hundreds of rows one event at a time. suggest-tag-trends is the
-- only reader.
alter table moments add column if not exists suggested_tag_names jsonb not null default '[]'::jsonb;

-- Partial index: every run's driving query is "where tag_scan_at is null", and it shrinks to
-- nothing once the backlog is done, which is exactly when a full-table scan would start to hurt.
create index if not exists moments_unscanned_idx on moments (id) where tag_scan_at is null;

-- ---------------------------------------------------------------------------------------------
-- moment_tags: provenance, so the founder can undo.
-- ---------------------------------------------------------------------------------------------

-- null = added by hand (every row that already exists), 'ai_scan' = added by this feature, either
-- auto-applied by the scan or landed by approving a trend proposal. Without this there is no undo
-- for a pass that writes hundreds of rows unattended. Note the scan's upsert uses
-- ignoreDuplicates, so a tag you added yourself is never rewritten as 'ai_scan'.
alter table moment_tags add column if not exists source text;

-- ---------------------------------------------------------------------------------------------
-- tag_suggestions: the trend proposals.
-- ---------------------------------------------------------------------------------------------
create table if not exists tag_suggestions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- The proposed wording, after synonym clustering ("Concert"/"live music"/"show" -> "Concerts").
  name text not null,
  -- Set when the cluster turns out to BE an existing tag under different words — the proposal
  -- then reads "add Vacation to these 6" and skips the create step. ON DELETE CASCADE because a
  -- proposal to apply a deleted tag is meaningless, not merely stale.
  existing_tag_id uuid references tags(id) on delete cascade,
  -- The events this would land on. Plain jsonb rather than a join table: it's a short-lived
  -- proposal, always read whole, and an id pointing at a since-deleted moment is filtered at
  -- render time anyway.
  moment_ids jsonb not null default '[]'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'rejected')),
  created_at timestamptz not null default now()
);

-- Case-insensitive per user, so a re-run updates the existing proposal (refreshing its event list)
-- instead of stacking a second copy — and so a 'rejected' row keeps saying no.
create unique index if not exists tag_suggestions_unique_per_user on tag_suggestions (user_id, lower(name));

alter table tag_suggestions enable row level security;

-- create policy has no IF NOT EXISTS, so the drop is what makes this file re-runnable
-- (2026-08-06 lesson, see PROJECT_CONTEXT.md section 10).
drop policy if exists "Users manage their own tag suggestions" on tag_suggestions;
create policy "Users manage their own tag suggestions"
  on tag_suggestions
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
