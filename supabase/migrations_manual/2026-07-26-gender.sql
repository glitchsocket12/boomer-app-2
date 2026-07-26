-- Gender icon on family tree tiles (item 44). Manual field only this pass — the auto-fill
-- name-lookup heuristic from the original spec is deferred; founder can revisit later.
alter table people add column if not exists gender text
  check (gender is null or gender in ('male', 'female', 'non-binary', 'other'));
