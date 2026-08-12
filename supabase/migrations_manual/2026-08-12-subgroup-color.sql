-- Backlog item 82, the manual-override half. Subgroup tiles get an automatic colour assigned by
-- position; this column is what lets the founder pin one instead, by tapping the swatch on a tile.
--
-- Stores the INDEX into `subgroupPalette` (src/lib/theme.ts), not a hex string, so the palette
-- stays the single source of truth for what the app's colours actually are — a future palette
-- change re-tints every pinned tile instead of stranding a hardcoded hex nobody remembers.
-- NULL means "no pin, colour me automatically", which is every existing row.
--
-- Safe to run more than once. Until it IS run, the app fails open: the colour query returns 42703,
-- the page treats that as "no pins" and every tile keeps its automatic colour, with the swatch
-- control hidden. Nothing else on the page depends on it.

alter table groups add column if not exists color_index smallint;

-- The palette has 8 entries; the app also wraps out-of-range values defensively, so this constraint
-- is about keeping obviously-wrong data out of the column rather than about what the UI can send.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'groups_color_index_range'
  ) then
    alter table groups
      add constraint groups_color_index_range
      check (color_index is null or (color_index >= 0 and color_index < 64));
  end if;
end $$;

comment on column groups.color_index is
  'Pinned subgroup swatch: index into subgroupPalette in src/lib/theme.ts. NULL = auto-assigned by position.';
