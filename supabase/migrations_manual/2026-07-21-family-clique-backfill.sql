-- Retroactive reconciliation for the family-clique sync feature (see PROJECT_CONTEXT.md §6/§8,
-- 2026-07-21): going forward, adding a sibling or parent link now propagates to the WHOLE
-- transitive sibling group (syncFamilyClique in supabase/functions/_shared/relationships.ts and
-- src/lib/writeRelationship.ts), not just the pair directly linked. This one-time backfill applies
-- that same logic to relationships already on file before the fix shipped, so existing data ends
-- up consistent too instead of only newly-added links. Safe to re-run (every insert is
-- ON CONFLICT DO NOTHING).

-- Step 1: fill in every missing pairwise sibling edge within each transitive sibling group.
-- sibling_edges treats each existing 'sibling' row as an undirected edge (both directions);
-- closure is the standard recursive-CTE transitive-closure pattern (plain UNION, not UNION ALL,
-- so Postgres dedupes and the recursion terminates on this finite graph) — for every person who
-- has at least one sibling link, closure lists every person reachable via a chain of sibling
-- links, including a self-row (person_id = other_id) which is filtered out below.
with recursive sibling_edges as (
  select person_a_id as a, person_b_id as b from relationships where kind = 'sibling'
  union all
  select person_b_id as a, person_a_id as b from relationships where kind = 'sibling'
),
closure as (
  select a as person_id, a as other_id from sibling_edges
  union
  select a as person_id, b as other_id from sibling_edges
  union
  select c.person_id, e.b as other_id
  from closure c
  join sibling_edges e on e.a = c.other_id
)
insert into relationships (user_id, person_a_id, person_b_id, kind)
select distinct p.user_id, least(c.person_id, c.other_id), greatest(c.person_id, c.other_id), 'sibling'
from closure c
join people p on p.id = c.person_id
where c.person_id <> c.other_id
on conflict (person_a_id, person_b_id, kind) do nothing;

-- Step 2: give every member of a sibling group every parent known for any other member.
-- Re-derives the same closure (sibling rows may have changed after step 1, but the closure itself
-- is unaffected by step 1's inserts since those only fill in edges already implied by it).
with recursive sibling_edges as (
  select person_a_id as a, person_b_id as b from relationships where kind = 'sibling'
  union all
  select person_b_id as a, person_a_id as b from relationships where kind = 'sibling'
),
closure as (
  select a as person_id, a as other_id from sibling_edges
  union
  select a as person_id, b as other_id from sibling_edges
  union
  select c.person_id, e.b as other_id
  from closure c
  join sibling_edges e on e.a = c.other_id
)
insert into relationships (user_id, person_a_id, person_b_id, kind)
select distinct p.user_id, par.person_a_id, c.person_id, 'parent'
from closure c
join relationships par on par.kind = 'parent' and par.person_b_id = c.other_id
join people p on p.id = c.person_id
where par.person_a_id <> c.person_id
on conflict (person_a_id, person_b_id, kind) do nothing;
