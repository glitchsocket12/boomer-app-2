-- Backlog item 35 (requested 2026-07-19, founder-flagged important): sub-events — a multi-day
-- event (e.g. a vacation) can have child sub-events (e.g. one per day, or one per notable thing
-- that happened) nested under it, instead of flattening everything into one event or scattering
-- into unrelated standalone events. Self-referencing FK, nullable — every existing moment
-- defaults to parent_moment_id = null (root), so nothing about today's behavior changes until a
-- sub-event is actually created. Mirrors groups.parent_group_id (migrations_manual/2026-07-26-
-- group-subgroups.sql) exactly.
--
-- ON DELETE SET NULL, not CASCADE: deleting a parent event must not silently mass-delete its
-- sub-events (and everything tied to them — notes, photos, group/tag associations) with no
-- visible warning — orphaned sub-events just become independent top-level events instead,
-- matching the confirmation copy EventDetail.tsx shows before a delete.
--
-- The CHECK guards against an event being its own parent (the app never offers this, but it
-- would be a silent infinite-recursion risk for any future tree-walking code).
alter table moments add column if not exists parent_moment_id uuid references moments(id) on delete set null;
alter table moments add constraint moments_parent_not_self check (parent_moment_id is distinct from id);
create index if not exists moments_parent_moment_id_idx on moments(parent_moment_id);
