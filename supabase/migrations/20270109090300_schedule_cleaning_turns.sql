-- ============================================================
-- The schedule: the weekly cleaning goes round (2026-10-09).
--
-- Baños and Cocina each have their own turn among the people marked for it:
-- whoever did that one longest ago is next, and nobody does both in a week.
-- A new week comes with both filled in; they can be changed.
--
-- To start with: everyone on the schedule except Freddy, Joselyne and Coople.
-- ============================================================

alter table public.schedule_people
  add column in_cleaning_rotation boolean not null default false;

update public.schedule_people
set in_cleaning_rotation = true
where is_active and coalesce(label, external_name) not in ('Freddy', 'Joselyne', 'Coople');
