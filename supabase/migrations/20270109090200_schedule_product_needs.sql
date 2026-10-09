-- ============================================================
-- The schedule: how many people a product takes (2026-10-09).
--
-- From the "Planificación" sheet: a day of Chip takes 6.5 people, Azul 6,
-- Bio Fresco 5, Mesa 7. Kept on the product of the day so the schedule can
-- say whether a day has enough people. Bio has no figure yet: without one
-- there is nothing to compare against.
-- ============================================================

alter table public.schedule_products
  add column people_needed numeric(4, 1) check (people_needed > 0);

update public.schedule_products set people_needed = 6.5 where name = 'Chip';
update public.schedule_products set people_needed = 6   where name = 'Azul';
update public.schedule_products set people_needed = 5   where name = 'Bio Fresco';
update public.schedule_products set people_needed = 7   where name = 'Mesa';
