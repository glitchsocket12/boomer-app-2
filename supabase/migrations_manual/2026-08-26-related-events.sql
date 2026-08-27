-- Related events (founder ask, 2026-08-26): "Need to be able to associate events too — either as
-- a sub event (make it clear which direction it's going) or just as a related event."
--
-- The sub-event half of that ask needs no schema at all: `moments.parent_moment_id` has existed
-- since 2026-07-30, and the new "Associate an event" flow simply points it in whichever direction
-- the founder picks. This table is the OTHER half — a link between two events that is NOT a
-- hierarchy. A wedding and the rehearsal dinner the night before are two real events; neither is
-- a part of the other, so nesting misfiles one of them, and merging destroys one outright. Until
-- now the app had no way at all to say "these two go together."
--
-- Symmetric and stored ONCE, exactly the way `relationships` stores spouse/sibling: the pair is
-- normalized to moment_a_id < moment_b_id (uuid sort) before insert, which is what makes the
-- unique index a real duplicate guard instead of a guard against only one of the two orderings.
-- The CHECK enforces that normalization in the database too, so a future caller that forgets to
-- sort gets an error rather than a silent second row for the same pair.

create table if not exists moment_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  moment_a_id uuid not null references moments(id) on delete cascade,
  moment_b_id uuid not null references moments(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint moment_links_normalized check (moment_a_id < moment_b_id),
  unique (moment_a_id, moment_b_id)
);

alter table moment_links enable row level security;

-- Both moment ids are checked against `moments`, not just user_id — same reasoning as
-- moment_pets: the ids only ever arrive from the client, so a user_id-only policy would let an
-- account link its own event to somebody else's row. Note the usual silent-failure warning: a
-- mistake in a subquery policy makes the write a no-op instead of an error, so verify with a
-- write-then-read-back rather than with a passing build.
create policy "Users manage their own event links"
  on moment_links
  for all
  using (
    user_id = auth.uid()
    and exists (select 1 from moments m where m.id = moment_links.moment_a_id and m.user_id = auth.uid())
    and exists (select 1 from moments m where m.id = moment_links.moment_b_id and m.user_id = auth.uid())
  )
  with check (
    user_id = auth.uid()
    and exists (select 1 from moments m where m.id = moment_links.moment_a_id and m.user_id = auth.uid())
    and exists (select 1 from moments m where m.id = moment_links.moment_b_id and m.user_id = auth.uid())
  );

-- Every read is "the links touching THIS event", which has to match either side of the pair. The
-- unique index above already serves the a-side; this covers the b-side.
create index if not exists moment_links_b_idx on moment_links (moment_b_id);
