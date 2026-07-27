-- Backlog item 19 (2026-07-26): subgroups — a group (e.g. "22nd Airlift Squadron", "Wings of
-- Blue") can have child subgroups (e.g. one per mission, or per class year/staff/role) with their
-- own independent membership, so events can be tagged to the specific subgroup instead of just
-- the whole parent group. Self-referencing FK, nullable — every existing group defaults to
-- parent_group_id = null (root), so nothing about today's behavior changes until a subgroup is
-- actually created.
--
-- ON DELETE SET NULL, not CASCADE: deleting a parent group must not silently mass-delete its
-- subgroups (and everything tied to them) with no visible warning — orphaned subgroups just
-- become independent top-level groups instead, matching the confirmation copy GroupDetail.tsx
-- shows before a delete.
--
-- The CHECK guards against a group being its own parent (the app never offers this, but it would
-- be a silent infinite-recursion risk for any future tree-walking code).
alter table groups add column if not exists parent_group_id uuid references groups(id) on delete set null;
alter table groups add constraint groups_parent_not_self check (parent_group_id is distinct from id);
create index if not exists groups_parent_group_id_idx on groups(parent_group_id);
