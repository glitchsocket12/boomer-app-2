-- Backlog item 57 (feedback widget, 2026-07-25): per-group on/off toggle for the "connections to
-- make" member-suggestion signal — GroupDetail.tsx's own suggestion card AND Home's "Connections
-- to make" card read this same flag (same underlying signal, see lib/suggestConnections.ts).
-- Default true preserves current behavior for every existing group; no backfill needed.
alter table groups add column if not exists suggestions_enabled boolean not null default true;
