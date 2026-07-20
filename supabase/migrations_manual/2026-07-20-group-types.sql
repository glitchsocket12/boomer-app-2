-- Group Types (backlog item 35): a small fixed picker categorizing what kind of group each
-- one is (Family/Friend group/School/Team/Work) — nullable, existing groups start untyped.
alter table groups add column if not exists group_type text;

alter table groups add constraint groups_group_type_check
  check (group_type is null or group_type in ('Family', 'Friend group', 'School', 'Team', 'Work'));
