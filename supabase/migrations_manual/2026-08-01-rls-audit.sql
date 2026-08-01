-- ============================================================================
-- RLS AUDIT — read-only. Nothing here changes anything.
-- ============================================================================
--
-- WHAT THIS IS FOR
--
-- Every table is supposed to have a rule attached saying "only hand back rows
-- belonging to the person asking." That's RLS (Row Level Security), and it's
-- enforced by the database itself rather than by app code — which is what
-- makes it trustworthy.
--
-- The original worry: the oldest tables (people, moments, notes, groups,
-- person_groups, reminders, home_suggestions) were created by hand in the
-- Supabase dashboard before migrations were being written down, so nothing in
-- this repo proved they'd got the rule.
--
-- RESULT, 2026-08-01: all 23 tables protected, every read rule scoped to the
-- owner, nothing wide open. The reason the undocumented tables were covered is
-- `rls_auto_enable` (section 3 below) — an event trigger installed by the
-- original Bolt/StackBlitz scaffold that switches RLS on automatically for
-- every new table in `public`. Re-run this script any time to re-confirm.
--
-- HOW TO RUN IT
--
--   1. Supabase Dashboard -> SQL Editor -> New query
--   2. Paste this whole file, click Run
--   3. Read the single table of results
--
-- It only ever SELECTs. It cannot break anything. Run it as often as you like.
--
-- NOTE: this is deliberately ONE query returning one combined table. An
-- earlier version used four separate statements, and Supabase's SQL Editor
-- only displays the LAST result set — so three quarters of the audit silently
-- vanished. If you extend this, keep it to a single UNION'd statement.
--
-- WHAT GOOD LOOKS LIKE
--
--   Section 1 - every row says "protected".
--               Anything saying "*** NOT PROTECTED - LEAK ***" means that
--               table is readable by any logged-in account. Fix immediately.
--
--   Section 2 - every row says "scoped to owner - good" or "write-only rule".
--               Anything saying "*** WIDE OPEN ***" is a lock that's never
--               locked. Anything saying "READ THIS ONE MANUALLY" needs eyes.
--
--   Section 3 - the WITH CHECK expressions (the rules for WRITING rows).
--               Every row should mention auth.uid(). A bare "true" here would
--               let someone create rows owned by another account — data being
--               pushed in rather than pulled out, so less severe than a read
--               leak, but still wrong.
--
--   Section 4 - the auto-protect hook's source, for reference.
--
--   Section 5 - functions allowed to ignore RLS entirely. Should be exactly
--               ONE: platform_stats, the Landing page's counter, which returns
--               four numbers and nothing else. Anything else here, especially
--               anything returning rows, is a public data leak.
--
-- ============================================================================

with t as (
  select
    n.nspname  as sch,
    c.relname  as obj,
    c.relrowsecurity as rls_on,
    (select count(*) from pg_policies p
      where p.schemaname = n.nspname and p.tablename = c.relname) as pols
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where c.relkind = 'r'
    and (n.nspname = 'public' or (n.nspname = 'storage' and c.relname = 'objects'))
)
select
  '1. IS THE TABLE PROTECTED'                     as section,
  sch || '.' || obj                               as item,
  case when rls_on then 'protected'
       else '*** NOT PROTECTED - LEAK ***' end    as verdict,
  pols || ' rule(s)'                              as detail
from t

union all

select
  '2. WHAT EACH RULE SAYS (reading)',
  tablename || ' / ' || policyname,
  case when qual is null              then 'write-only rule'
       when btrim(qual) = 'true'      then '*** WIDE OPEN ***'
       when qual ilike '%auth.uid()%' then 'scoped to owner - good'
       else '*** READ THIS ONE MANUALLY ***' end,
  coalesce(qual, '')
from pg_policies
where schemaname = 'public' or (schemaname = 'storage' and tablename = 'objects')

union all

select
  '3. WHAT EACH RULE SAYS (writing)',
  tablename || ' / ' || policyname,
  case when with_check is null              then 'no write rule (read-only policy)'
       when btrim(with_check) = 'true'      then '*** WIDE OPEN - can write rows owned by others ***'
       when with_check ilike '%auth.uid()%' then 'scoped to owner - good'
       else '*** READ THIS ONE MANUALLY ***' end,
  coalesce(with_check, '')
from pg_policies
where schemaname = 'public' or (schemaname = 'storage' and tablename = 'objects')

union all

select
  '4. THE AUTO-PROTECT HOOK',
  p.proname,
  'enables RLS automatically on every new table in public',
  pg_get_functiondef(p.oid)
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'rls_auto_enable'

union all

select
  '5. FUNCTIONS THAT BYPASS RLS',
  p.proname,
  case when p.proname = 'platform_stats' then 'expected - counts only'
       when p.prorettype = 'pg_catalog.event_trigger'::regtype then 'event trigger - cannot be called directly'
       else '*** UNEXPECTED - CHECK THIS ***' end,
  pg_get_function_result(p.oid)
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prosecdef = true

order by section, item;
