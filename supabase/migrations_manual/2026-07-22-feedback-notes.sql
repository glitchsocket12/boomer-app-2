-- Click-to-comment feedback widget: lets the founder click any element in the live app and leave
-- a note (bug/UX feedback) without needing to describe it from memory later. Claude Code reads
-- this table directly as a punch list. One row per note; page_label/element_label are best-effort
-- descriptive context (not a DOM selector — the app has no stable selectors to re-target).
create table if not exists feedback_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  page_label text,
  element_label text,
  note text not null,
  status text not null default 'open' check (status in ('open', 'done')),
  created_at timestamptz not null default now()
);

alter table feedback_notes enable row level security;

create policy "Users manage their own feedback notes"
  on feedback_notes
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
