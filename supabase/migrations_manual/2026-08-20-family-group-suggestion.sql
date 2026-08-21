-- Home's "Connections to make" card gains a fourth question type: "these three are a household —
-- make them a group?" (founder request via the feedback widget, 2026-08-08: "Any time a family
-- tree is populated with 3 or more people (i.e. husband, wife, and child), I would like to
-- automatically suggest creating a family group based off of them.")
--
-- The dismissal table's `kind` is a CHECK list, exactly as its own comment predicted ("the next
-- suggestion kind is a new CHECK value instead of another migration") — so this is that one line.
-- family_group: subject/object = the couple the household is built from, normalized subject < object.
--
-- Safe to re-run: drops the old constraint by name first, and the name is stable.

alter table dismissed_suggestions drop constraint if exists dismissed_suggestions_kind_check;

alter table dismissed_suggestions
  add constraint dismissed_suggestions_kind_check
  check (kind in ('family_coparent', 'family_couple', 'event_group', 'family_group'));
