-- Settings page v1 (backlog items 22/49, scoped down with the founder to account + AI settings
-- only). Only the chat-tone preference needs a DB row here: the profile-link idea was cut
-- (that's app navigation, not a setting), About/Privacy are static frontend content, and
-- email/password changes go straight through Supabase auth (auth.users), never this table.
-- One row per account, same shape as home_suggestions — PK is user_id itself, no separate
-- surrogate key, because there is exactly one settings row per user, never many.
create table if not exists user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  -- Fixed preset list, not free text: keeps the instruction sentence injected into converse's
  -- system prompt fully deterministic (same tone key -> same fixed sentence, always), which is
  -- what keeps the roster cache_control tier cache-friendly (CLAUDE.md's caching rule). Keep in
  -- sync with TONE_INSTRUCTIONS in supabase/functions/_shared/userSettings.ts.
  chat_tone text not null default 'warm' check (chat_tone in ('warm', 'direct', 'playful', 'formal')),
  updated_at timestamptz not null default now()
);

alter table user_settings enable row level security;

create policy "Users manage their own settings"
  on user_settings
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
