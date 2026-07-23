-- Middle name / "goes by" support on people profiles: a real middle-name field, plus a choice
-- of which name (first/middle/last/other) actually displays as this person's name on their
-- profile page (e.g. going by a middle name or a callsign like "Maverick").
alter table people add column if not exists middle_name text;
alter table people add column if not exists goes_by_kind text;
alter table people add column if not exists goes_by_other text;
