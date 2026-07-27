-- Founder ask (2026-07-26): adding someone to a subgroup should automatically make them a
-- member of the parent group too (subgroups are a subset of the parent's people, not a separate
-- roster) — see 2026-07-26-group-subgroups.sql (item 19) for the parent_group_id column itself.
--
-- Implemented as a trigger, not app code, because person_groups gets inserted from several
-- independent places (GroupDetail.tsx's "+ Add member" / "approve all" buttons, and three
-- chat-driven Edge Functions — converse, add-fact, update-group — that can also tag someone into
-- a group by name). A trigger guarantees the invariant everywhere at once instead of needing the
-- same parent-lookup-and-upsert duplicated in four call sites and re-duplicated in every future
-- one. Only fires on INSERT — removing someone from a subgroup does NOT remove them from the
-- parent (parent membership may be broader/independent), matching how the founder described it.
--
-- Self-terminating even if a future change ever lets subgroups nest: each pass upserts into the
-- next group up, which re-fires this trigger, which stops the moment it reaches a group whose
-- parent_group_id is null. Today subgroups are only ever one level deep (GroupDetail.tsx doesn't
-- offer subgroups of subgroups), so in practice this always fires at most twice per insert.
create or replace function sync_subgroup_member_to_parent()
returns trigger as $$
declare
  parent_id uuid;
begin
  select parent_group_id into parent_id from groups where id = new.group_id;
  if parent_id is not null then
    insert into person_groups (person_id, group_id)
    values (new.person_id, parent_id)
    on conflict (person_id, group_id) do nothing;
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists person_groups_sync_parent on person_groups;
create trigger person_groups_sync_parent
after insert on person_groups
for each row
execute function sync_subgroup_member_to_parent();

-- One-time backfill: apply the same rule retroactively to whatever subgroup membership already
-- exists today, so existing subgroups aren't left inconsistent with new ones going forward.
-- Idempotent (ON CONFLICT DO NOTHING) — safe to re-run.
insert into person_groups (person_id, group_id)
select pg.person_id, g.parent_group_id
from person_groups pg
join groups g on g.id = pg.group_id
where g.parent_group_id is not null
on conflict (person_id, group_id) do nothing;
