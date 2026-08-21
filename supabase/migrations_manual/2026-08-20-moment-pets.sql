-- Pets at events (founder report, 2026-08-20: "app is not letting me tag pets to events").
--
-- The 2026-08-01 pets migration ended with "Pets stay out of the notes/moments graph in v1" — a
-- deliberate scope line, and this is the follow-up that crosses it. What it does NOT do is widen
-- `notes`: attendance for a PERSON is the existence of a notes row (person_id + moment_id), and
-- reusing that for pets would mean altering the CHECK constraint and the RLS policies on a table
-- holding 700+ real notes, plus teaching every note-rendering path and the `converse` prompt that
-- an "attendee" might not be a person. Wrong trade for "the dog was at the barbecue."
--
-- Instead this is a plain join table, exactly the shape `moment_groups`/`moment_tags` already use
-- for the other things an event gets tagged with. A pet is present at an event or it isn't; there
-- is no per-pet note to hang off the row, so the row needs no columns beyond the two ids.

create table if not exists moment_pets (
  moment_id uuid not null references moments(id) on delete cascade,
  pet_id uuid not null references pets(id) on delete cascade,
  primary key (moment_id, pet_id)
);

alter table moment_pets enable row level security;

-- Both sides are checked, unlike person_pets (which derives ownership through `pets` alone). A
-- one-sided policy here would let an account tag its own pet onto somebody else's event row, since
-- moment_id is only ever supplied by the client. Same silent-failure warning as person_pets: a
-- mistake in a subquery policy makes the write NO-OP rather than error, so verify this with a
-- write-then-read-back, not with a passing build.
create policy "Users manage their own moment-pet links"
  on moment_pets
  for all
  using (
    exists (select 1 from pets p where p.id = moment_pets.pet_id and p.user_id = auth.uid())
    and exists (select 1 from moments m where m.id = moment_pets.moment_id and m.user_id = auth.uid())
  )
  with check (
    exists (select 1 from pets p where p.id = moment_pets.pet_id and p.user_id = auth.uid())
    and exists (select 1 from moments m where m.id = moment_pets.moment_id and m.user_id = auth.uid())
  );

-- Forward lookup (event -> pets) is served by the primary key; this covers the reverse
-- (pet -> events), which PetDetail's "Was at these events" needs.
create index if not exists moment_pets_pet_idx on moment_pets (pet_id);
