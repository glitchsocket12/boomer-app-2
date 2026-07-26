-- Retroactive reconciliation for the spouse-as-co-parent fix (see PROJECT_CONTEXT.md §3/§8,
-- 2026-07-25): syncSpouseParenthood (src/lib/writeRelationship.ts and
-- supabase/functions/_shared/relationships.ts) now auto-links a newly-added spouse as a parent of
-- the other spouse's existing kids. This one-time backfill applies that same logic to spouse pairs
-- already on file before the fix shipped. Safe to re-run (every insert is ON CONFLICT DO NOTHING).
--
-- RUN THIS FIRST, before 2026-07-25-shared-parent-sibling-backfill.sql — the parent rows this file
-- adds feed additional shared-parent sibling pairs that file wouldn't otherwise find.
--
-- Remarriage guard, mirroring the runtime fix exactly: only propagate when the CHILD-OWNING side
-- of the pair has EXACTLY ONE spouse/partner on file (this pairing). Backlog item 24 is still open
-- (no half/step/adoptive qualifier column exists yet) — without this guard, a remarried widow(er)'s
-- new spouse would be written in as a "parent" of kids from the earlier marriage. Concretely, this
-- guard is what keeps this backfill from writing Michael Galchinsky in as a parent of Andy Volin's
-- kids (Andy died, his widow Andi remarried Michael — Andi has two spouse rows on file, so neither
-- direction through her passes the "exactly one spouse" check). DRY RUN FIRST: run the inner
-- `select` below on its own (without the `insert into ... select`) and eyeball the result before
-- executing this file for real, specifically checking the Volin family isn't in it.
insert into relationships (user_id, person_a_id, person_b_id, kind)
select distinct p.user_id, x.spouse_id, x.child_id, 'parent'
from (
  select s.person_b_id as spouse_id, pc.person_b_id as child_id, pc.person_a_id as owning_parent
  from relationships s
  join relationships pc on pc.kind = 'parent' and pc.person_a_id = s.person_a_id
  where s.kind = 'spouse'
  union
  select s.person_a_id as spouse_id, pc.person_b_id as child_id, pc.person_a_id as owning_parent
  from relationships s
  join relationships pc on pc.kind = 'parent' and pc.person_a_id = s.person_b_id
  where s.kind = 'spouse'
) x
join people p on p.id = x.spouse_id
where x.spouse_id <> x.child_id
  and (
    select count(*) from relationships s2
    where s2.kind in ('spouse', 'partner') and (s2.person_a_id = x.owning_parent or s2.person_b_id = x.owning_parent)
  ) = 1
on conflict (person_a_id, person_b_id, kind) do nothing;

-- Invalidate the cached Key Facts (person-facts/index.ts) for anyone with a spouse or parent
-- relationship on file, so their next profile visit regenerates fresh chips. Broader than strictly
-- necessary, same trade-off as the sibling backfill's own invalidation step.
update people set key_facts = null, key_facts_updated_at = null
where id in (
  select person_a_id from relationships where kind in ('parent', 'spouse')
  union
  select person_b_id from relationships where kind in ('parent', 'spouse')
);
