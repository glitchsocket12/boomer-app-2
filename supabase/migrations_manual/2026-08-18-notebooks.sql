-- Notebooks: the internal side of the app.
--
-- Events are Boomer's EXTERNAL record — what happened, who was there. There has never been an
-- internal one. Every piece of writing in the app must hang off a person, a group, or an event:
-- that's not a convention, it's the CHECK constraint notes_person_or_group_or_moment_check
-- (2026-07-25-note-event-only.sql). So there is nowhere to put a movie you loved, a quote worth
-- keeping, or how a Tuesday felt — you'd have to invent a fake event to hang it on.
--
-- A notebook is a container the USER names ("Movies I loved", "How I'm doing", "Things Dad says").
-- The app deliberately ships no categories, no types, and no labels of its own: the founder's
-- point (2026-08-18) is that the product should never print the word "diary" or "journal", which
-- reads as gendered and would put some users off before they'd written anything. You title it,
-- so the app never has to.
--
-- One shape serves both a list and a log. entry_date is optional, and its presence is the ONLY
-- difference: dates present and it reads as a dated log, absent and it reads as a running list.
-- Same table, same screen, no layout mode to pick.

create table if not exists notebooks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  -- Per-notebook privacy switch for the Home chat (converse). On by default so "Movies I loved"
  -- can answer "what did Dana recommend?" out of the box, but a notebook holding the genuinely
  -- internal stuff can be switched off and stay out of every prompt. This governs the AI ONLY —
  -- global search always reads every notebook, because that's the user searching their own app.
  ai_visible boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists notebook_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  notebook_id uuid not null references notebooks(id) on delete cascade,
  content text not null,
  -- Nullable on purpose, and display/sorting only — never ground truth. Same reasoning as
  -- moments.event_date: an entry with no date is a list item, one with a date is a log entry,
  -- and null falls back to created_at for ordering.
  entry_date date,
  created_at timestamptz not null default now()
);

create index if not exists notebook_entries_notebook_id_idx on notebook_entries (notebook_id);

-- People an entry is about — "Dana told me about it", "ran into Marco". A real join table rather
-- than a jsonb array of ids, per the standing rule stated at the top of 2026-07-22-event-tags.sql:
-- a per-row array can't give a shared entity canonical identity for reuse or dedup.
create table if not exists notebook_entry_people (
  entry_id uuid not null references notebook_entries(id) on delete cascade,
  person_id uuid not null references people(id) on delete cascade,
  primary key (entry_id, person_id)
);

-- Reverse lookup ("which entries mention this person") — cheap now, awkward to retrofit.
create index if not exists notebook_entry_people_person_id_idx on notebook_entry_people (person_id);

-- --- RLS ------------------------------------------------------------------------------------
-- create policy has no IF NOT EXISTS, so every policy is dropped first to keep this file
-- re-runnable (see PROJECT_CONTEXT.md §6 and 2026-08-06-countdowns.sql).

alter table notebooks enable row level security;

drop policy if exists "Users manage their own notebooks" on notebooks;
create policy "Users manage their own notebooks"
  on notebooks
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

alter table notebook_entries enable row level security;

drop policy if exists "Users manage their own notebook entries" on notebook_entries;
create policy "Users manage their own notebook entries"
  on notebook_entries
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

alter table notebook_entry_people enable row level security;

-- Two-sided check, copied from moment_tags: `using` gates reads/deletes on owning the entry, and
-- `with check` validates BOTH sides so you can't attach someone else's person row to your entry.
--
-- NOTE FOR WHOEVER RUNS THIS: a subquery policy that's subtly wrong fails SILENTLY here — the
-- insert returns success and simply writes nothing (2026-08-01-pets.sql:57-59). Verify by adding
-- a person to an entry and then HARD-RELOADING the page, not by watching the UI update.
drop policy if exists "Users manage people on their own notebook entries" on notebook_entry_people;
create policy "Users manage people on their own notebook entries"
  on notebook_entry_people
  for all
  using (
    exists (select 1 from notebook_entries e where e.id = entry_id and e.user_id = auth.uid())
  )
  with check (
    exists (select 1 from notebook_entries e where e.id = entry_id and e.user_id = auth.uid())
    and exists (select 1 from people p where p.id = person_id and p.user_id = auth.uid())
  );
