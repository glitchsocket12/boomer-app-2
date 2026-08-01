-- Pets. Founder decision (2026-08-01): a pet is its OWN record joined to one or more people, not a
-- jsonb array on `people`. A household dog belongs to both spouses, shows on both profiles, and is
-- edited in one place. Same real-table-vs-jsonb reasoning already recorded for tags/moment_tags and
-- groups/person_groups: a shared entity needs a canonical identity, which a per-person array can't
-- give it. (Contrast people.phones/emails/addresses, which are genuinely private to one record.)
--
-- "Somewhat customizable to accommodate the variety of pets" (founder): species is FREE TEXT with
-- deliberately NO check constraint -- contrast groups.group_type, a fixed picker -- and `attributes`
-- is an open {label, value} array so a horse gets "Barn: Willow Creek" and a fish gets "Tank: 40
-- gal" without either becoming a column. See PROJECT_CONTEXT.md Section 9, "flexible data over
-- rigid structure."
--
-- This also unblocks backlog item 15's "Braden's dog" example: the chat answers it because the pet
-- is LINKED to both spouses, not because anything walks the relationships graph.

create table if not exists pets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  species text,        -- dog / cat / fish / horse / bearded dragon. No enum, no CHECK, on purpose.
  breed text,          -- nullable by design: a fish has none, a mutt has none, a horse does. Given
                       -- its own slot so the AI doesn't coin three labels ("breed"/"type"/"kind of
                       -- dog") in `attributes` for one fact.
  birth_date date,
  adopted_date date,   -- "gotcha day" -- often the only date known for a rescue.
  deceased_date date,  -- presence = passed away. Exact mirror of people.deceased_date
                       -- (2026-07-24-deceased-and-divorce.sql) so the same tone rules apply.
  notes text,          -- one free-text blurb. Deliberately NOT a row in the `notes` table: that
                       -- means widening its person_id/moment_id/group_id CHECK plus a new RLS
                       -- policy. Pets stay out of the notes/moments graph in v1.
  attributes jsonb not null default '[]'::jsonb,  -- [{label, value}], same shape as people.phones
                       -- /emails/urls, so the existing LabeledValueEditor renders it unchanged.
  created_at timestamptz not null default now()
);

alter table pets enable row level security;

create policy "Users manage their own pets"
  on pets
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Deliberately NO unique index on (user_id, lower(name)), unlike `tags`. Two people in one account
-- can each genuinely have a dog named Bella. Ambiguity is resolved at lookup time (owner-scoped
-- first, then unique-bare-name, else ask) rather than blocked at write time.
create index if not exists pets_user_name_idx on pets (user_id, name);

create table if not exists person_pets (
  person_id uuid not null references people(id) on delete cascade,
  pet_id uuid not null references pets(id) on delete cascade,
  primary key (person_id, pet_id)
);

alter table person_pets enable row level security;

-- No user_id column here: ownership is derived through pets, so there is exactly one place a pet's
-- account is recorded. Note this makes the policy a subquery, which means a mistake here fails
-- SILENTLY (the write no-ops) -- verify with a write-then-read-back, not with a passing build.
create policy "Users manage their own person-pet links"
  on person_pets
  for all
  using (exists (select 1 from pets p where p.id = person_pets.pet_id and p.user_id = auth.uid()))
  with check (exists (select 1 from pets p where p.id = person_pets.pet_id and p.user_id = auth.uid()));

-- Forward lookup (person -> pets) is served by the primary key; this covers the reverse
-- (pet -> owners), which the profile card and the converse roster both need.
create index if not exists person_pets_pet_idx on person_pets (pet_id);
