-- Retroactive reconciliation for the shared-parentage sibling fix (see PROJECT_CONTEXT.md §3/§8,
-- 2026-07-25): syncFamilyClique (src/lib/writeRelationship.ts and
-- supabase/functions/_shared/relationships.ts) previously only propagated sibling/parent links
-- across an EXISTING sibling closure — it never derived "these two people are siblings" purely
-- from sharing a recorded parent. So two kids given the same parent independently (the normal way
-- of building a tree one child at a time, or from each kid's own profile) never became siblings
-- anywhere, and never shared each other's other parent either. This one-time backfill applies the
-- fixed logic to relationships already on file before the fix shipped. Safe to re-run (every
-- insert is ON CONFLICT DO NOTHING).
--
-- Run this SECOND, after 2026-07-25-spouse-coparent-backfill.sql — that file's new parent rows
-- (a spouse retroactively linked as a parent) feed additional shared-parent sibling pairs here that
-- wouldn't otherwise be found.

-- Step 1: derive a direct sibling edge for every pair of DISTINCT children who share at least one
-- recorded parent. A one-hop join, not a recursive rule — this alone can't chain together two
-- people who share no parent with each other (that would be a real error; sharing a grandparent,
-- for instance, doesn't make two people siblings).
insert into relationships (user_id, person_a_id, person_b_id, kind)
select distinct p.user_id, least(r1.person_b_id, r2.person_b_id), greatest(r1.person_b_id, r2.person_b_id), 'sibling'
from relationships r1
join relationships r2
  on r2.person_a_id = r1.person_a_id
  and r2.kind = 'parent'
  and r2.person_b_id <> r1.person_b_id
join people p on p.id = r1.person_b_id
where r1.kind = 'parent'
on conflict (person_a_id, person_b_id, kind) do nothing;

-- Step 2: fill in every missing pairwise sibling edge within each transitive sibling group, now
-- that step 1 may have introduced new edges into some existing chains. Identical mechanism to
-- 2026-07-21-family-clique-backfill.sql's own step 1.
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

-- Step 3: give every member of a sibling group the parents known for other members — but only where
-- that can be done without guessing. REWRITTEN 2026-08-10 (backlog item 86). This step used to hand
-- every member the union of every parent in the clique, which is right for a nuclear family and
-- wrong for a blended one: on real data, accepting Lisa Dunn as a step-parent of Liam and Cormac
-- merged all three Dunn children into one clique and the union then wrote Tara Dunn (Brian's
-- ex-wife) in as Elizabeth's mother. Run unchanged, this file would have done that to every blended
-- family in the database at once, additively and irreversibly.
--
-- The rule now matches inheritableParents() in src/lib/writeRelationship.ts and its Deno twin in
-- supabase/functions/_shared/relationships.ts exactly — only fill an EMPTY parent seat, and never
-- guess which one. A person with two parents already recorded is left alone (a third is the blended
-- shape above), and so is one whose open seats are outnumbered by candidates (picking one would be
-- a coin flip; there's no half/step/adoptive qualifier column to record the answer — item 24).
--
-- DRY RUN: replace the `insert into relationships (...)` line with `select * from` at the bottom to
-- see exactly which parent rows this would add before committing to them.
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
),
-- Every parent a clique member could pick up that isn't already recorded as theirs.
candidate as (
  select distinct c.person_id, par.person_a_id as parent_id
  from closure c
  join relationships par on par.kind = 'parent' and par.person_b_id = c.other_id
  where par.person_a_id <> c.person_id
    and not exists (
      select 1 from relationships mine
      where mine.kind = 'parent' and mine.person_b_id = c.person_id and mine.person_a_id = par.person_a_id
    )
),
-- How many parents each of them already has.
existing as (
  select person_b_id as person_id, count(distinct person_a_id) as n
  from relationships where kind = 'parent'
  group by person_b_id
)
insert into relationships (user_id, person_a_id, person_b_id, kind)
select distinct p.user_id, cd.parent_id, cd.person_id, 'parent'
from candidate cd
join people p on p.id = cd.person_id
left join existing e on e.person_id = cd.person_id
-- Recorded + proposed must fit inside two seats. Anyone already at two, and anyone whose remaining
-- seats can't hold all their candidates, gets nothing at all rather than an arbitrary pick.
where coalesce(e.n, 0) + (select count(*) from candidate c2 where c2.person_id = cd.person_id) <= 2
on conflict (person_a_id, person_b_id, kind) do nothing;

-- Step 4: invalidate the cached Key Facts (person-facts/index.ts) for anyone with any family
-- relationship on file, so their next profile visit regenerates fresh chips instead of serving a
-- cache that predates this backfill. Broader than strictly necessary (touches everyone with any
-- parent/sibling link, not just those actually changed above) but this is a rare one-time op
-- against a few hundred people, not a hot path.
update people set key_facts = null, key_facts_updated_at = null
where id in (
  select person_a_id from relationships where kind in ('parent', 'sibling')
  union
  select person_b_id from relationships where kind in ('parent', 'sibling')
);
