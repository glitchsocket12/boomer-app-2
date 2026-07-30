-- Google Photos import (Picker API + OAuth). Plan: i-want-to-build-mutable-hippo.md.
-- First OAuth flow and first Supabase Storage usage in this app — see PROJECT_CONTEXT.md §2/§10.

-- One row per connected Google account. refresh_token is as sensitive as an API key: no SELECT
-- policy for `authenticated` at all, deliberately — only service-role Edge Functions ever read it,
-- same trust boundary as ANTHROPIC_API_KEY (never reaches the browser). INSERT/UPDATE/DELETE are
-- still user-scoped so the owning user's own client can create/replace/remove their own connection
-- (the actual token value is written by google-photos-oauth-callback, which runs with the user's JWT).
create table if not exists photo_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  google_email text,
  refresh_token text not null,
  created_at timestamptz not null default now(),
  unique (user_id)
);

alter table photo_connections enable row level security;

create policy "Users manage their own photo connection (no read)"
  on photo_connections
  for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own photo connection (no read)"
  on photo_connections
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can delete their own photo connection (no read)"
  on photo_connections
  for delete
  using (auth.uid() = user_id);

-- One row per picker session's worth of picked-but-not-yet-reviewed photos, used only by the
-- general-import flow (PhotoImportReview.tsx). The quick-add flow from a specific EventDetail
-- page skips this entirely and writes straight to `photos` with moment_id already set.
create table if not exists photo_clusters (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  date_range_start date,
  date_range_end date,
  matched_moment_id uuid references moments(id) on delete set null,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'rejected')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);

alter table photo_clusters enable row level security;

create policy "Users manage their own photo clusters"
  on photo_clusters
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index if not exists photo_clusters_pending_idx
  on photo_clusters (user_id)
  where status = 'pending';

-- Resized (~1600px longest edge) copies live permanently in the `photos` Storage bucket — Google's
-- own access to a picked item expires with its picker session, so nothing here can be a lazy
-- pointer back to Google. google_media_id dedupes re-picking the same photo across sessions.
create table if not exists photos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  moment_id uuid references moments(id) on delete cascade,
  photo_cluster_id uuid references photo_clusters(id) on delete set null,
  storage_path text not null,
  google_media_id text,
  taken_at timestamptz,
  width int,
  height int,
  created_at timestamptz not null default now(),
  unique (user_id, google_media_id)
);

alter table photos enable row level security;

create policy "Users manage their own photos"
  on photos
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index if not exists photos_moment_idx on photos (moment_id);

-- Storage: create the `photos` bucket itself first (Supabase dashboard -> Storage -> New bucket,
-- name "photos", Private) — bucket creation isn't expressible as plain SQL. Once it exists, run the
-- block below. Objects are stored under a `{user_id}/...` path prefix, which is what these policies
-- scope on (storage.foldername(name) splits the object path on "/", element 1 is that prefix).
create policy "Users manage their own photo objects"
  on storage.objects
  for all
  using (bucket_id = 'photos' and auth.uid()::text = (storage.foldername(name))[1])
  with check (bucket_id = 'photos' and auth.uid()::text = (storage.foldername(name))[1]);
