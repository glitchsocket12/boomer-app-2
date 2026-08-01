-- ============================================================================
-- RLS AUDIT — read-only. Nothing here changes anything.
-- ============================================================================
--
-- WHAT THIS IS FOR
--
-- Every table in Boomer is supposed to have a rule attached that says "only
-- hand back rows belonging to the person asking." That rule is called RLS
-- (Row Level Security). It's enforced by the database itself, not by app
-- code — which is what makes it trustworthy.
--
-- The problem: the oldest tables (people, moments, notes, groups,
-- person_groups, reminders, home_suggestions) were created by hand in the
-- Supabase dashboard, before we started writing migration files down. So
-- there is no record in this repo proving they got that rule. PROJECT_CONTEXT
-- says "RLS on everything" — but that's a claim, not evidence.
--
-- This script produces the evidence.
--
-- HOW TO RUN IT
--
--   1. Supabase Dashboard -> SQL Editor -> New query
--   2. Paste this whole file, click Run
--   3. Read the results below (four separate result sets)
--
-- It only ever SELECTs. It cannot break anything. Run it as often as you like.
--
-- ============================================================================


-- ----------------------------------------------------------------------------
-- QUERY 1 — Is the rule switched on for every table?
-- ----------------------------------------------------------------------------
--
-- WHAT GOOD LOOKS LIKE:  every row shows rls_enabled = true
--                        and policy_count of 1 or more.
--
-- WHAT BAD LOOKS LIKE:   any row showing rls_enabled = false.
--                        That table is readable by ANY logged-in account,
--                        not just its owner. That is a live data leak.
--
-- Results are sorted so that any problem rows appear at the TOP.
-- ----------------------------------------------------------------------------

select
  n.nspname                                                as schema,
  c.relname                                                as table_name,
  c.relrowsecurity                                         as rls_enabled,
  c.relforcerowsecurity                                    as rls_forced,
  (select count(*)
     from pg_policies p
    where p.schemaname = n.nspname
      and p.tablename  = c.relname)                        as policy_count
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where c.relkind = 'r'                       -- ordinary tables only
  and (
        n.nspname = 'public'
     or (n.nspname = 'storage' and c.relname = 'objects')  -- the photos bucket
      )
order by
  c.relrowsecurity asc,                     -- false (bad) floats to the top
  n.nspname,
  c.relname;


-- ----------------------------------------------------------------------------
-- QUERY 2 — What does each rule actually SAY?
-- ----------------------------------------------------------------------------
--
-- A table can have the rule switched ON and still be wide open, if the rule
-- itself says "allow everything." Query 1 can't see that. This one can.
--
-- WHAT GOOD LOOKS LIKE:  using_expression reads something like
--                          (auth.uid() = user_id)
--                        i.e. it mentions auth.uid(). That's the database
--                        comparing the logged-in person against the row's
--                        owner.
--
-- WHAT BAD LOOKS LIKE:   using_expression is literally  true
--                        That is a door with a lock on it that's never
--                        actually locked. Same effect as no rule at all.
--
-- KNOWN EXCEPTION, not a bug: storage.objects uses
--   (bucket_id = 'photos' AND auth.uid()::text = (storage.foldername(name))[1])
-- which is the same idea expressed against a file path instead of a column.
-- ----------------------------------------------------------------------------

select
  schemaname   as schema,
  tablename    as table_name,
  policyname   as policy_name,
  cmd          as applies_to,          -- SELECT / INSERT / UPDATE / DELETE / ALL
  roles        as applies_to_roles,
  qual         as using_expression,    -- the rule for READING rows
  with_check   as with_check_expression -- the rule for WRITING rows
from pg_policies
where schemaname = 'public'
   or (schemaname = 'storage' and tablename = 'objects')
order by tablename, policyname;


-- ----------------------------------------------------------------------------
-- QUERY 3 — Tables where the rule is ON but there are NO rules written
-- ----------------------------------------------------------------------------
--
-- This combination means "deny everybody." It is not a leak — it's the safe
-- direction to fail — but it usually means a feature is quietly broken,
-- because the app can't read its own data either.
--
-- WHAT GOOD LOOKS LIKE:  zero rows returned.
-- ----------------------------------------------------------------------------

select
  n.nspname  as schema,
  c.relname  as table_name,
  'RLS is on but no policies exist - nobody can read or write this table'
             as what_this_means
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where c.relkind = 'r'
  and n.nspname = 'public'
  and c.relrowsecurity = true
  and not exists (
        select 1
          from pg_policies p
         where p.schemaname = n.nspname
           and p.tablename  = c.relname
      )
order by c.relname;


-- ----------------------------------------------------------------------------
-- QUERY 4 — Functions that are allowed to ignore the rules
-- ----------------------------------------------------------------------------
--
-- A "SECURITY DEFINER" function runs with the permissions of whoever created
-- it, which means it can see across every account regardless of RLS. That's
-- sometimes exactly what you want — but each one is a deliberate hole in the
-- wall, and there should be a very short list of them.
--
-- WHAT GOOD LOOKS LIKE:  exactly ONE row -> platform_stats
--                        That's the Landing page's "X people, Y events"
--                        counter. It returns four numbers and nothing else,
--                        which is why it's safe to expose publicly.
--
-- WHAT BAD LOOKS LIKE:   any function you don't recognise, especially one
--                        that returns rows rather than counts.
-- ----------------------------------------------------------------------------

select
  n.nspname                              as schema,
  p.proname                              as function_name,
  pg_get_userbyid(p.proowner)            as runs_as,
  has_function_privilege('anon', p.oid, 'EXECUTE')
                                         as callable_without_logging_in,
  has_function_privilege('authenticated', p.oid, 'EXECUTE')
                                         as callable_by_any_logged_in_user,
  pg_get_function_result(p.oid)          as returns
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.prosecdef = true                 -- SECURITY DEFINER only
order by p.proname;


-- ============================================================================
-- AFTER YOU RUN IT
--
-- Query 1 all true, Query 2 all mentioning auth.uid(), Query 3 empty, and
-- Query 4 showing only platform_stats
--   -> the isolation wall is real and verified. Nothing further to do.
--
-- Anything else
--   -> paste the output back and it becomes the top priority, ahead of
--      everything else on the list.
-- ============================================================================
