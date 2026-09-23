-- ============================================================
-- Which delivery methods we drive ourselves.
--
-- The round only concerns deliveries made with our own van: DHL, Die Post and
-- Dachser plan their own day, and "Se recoge en la fábrica" never moves. The
-- Ruta tab needs to know which is which, and a slug is not the place to ask —
-- 'zurich' is the Palomo's slug for historical reasons, and a second van
-- tomorrow would need a second special case.
--
-- Palomo is marked here because it is the van the business drives today.
-- Anything else is marked on the Formas de envío screen.
-- ============================================================

alter table public.delivery_methods
  add column own_vehicle boolean not null default false;

comment on column public.delivery_methods.own_vehicle is
  'We drive it ourselves, so its orders form a delivery round. Carriers and pickups are false.';

update public.delivery_methods set own_vehicle = true where slug = 'zurich';
