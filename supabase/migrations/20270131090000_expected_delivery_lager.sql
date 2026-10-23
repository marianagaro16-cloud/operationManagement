-- Which Lager an expected delivery goes to (2026-10-23).
--
-- The places are the inventory locations already kept in Gestión →
-- Inventario, so a Lager added there is offered here too. "Fábrica" is the
-- Lager on the 2nd floor; it is named so. Counts already recorded keep the
-- name they were counted against.
--
-- One Lager per delivery; the form requires it. The column stays nullable:
-- entries made before this have none until someone edits them.
--
-- A reception may say where the goods went as well: filled in from the
-- expected delivery it closes, otherwise optional.

update public.inventory_locations
   set name = 'Lager 2do Piso (Fábrica)'
 where slug = 'fabrica' and name = 'Fábrica';

alter table public.expected_deliveries
  add column if not exists location_id uuid references public.inventory_locations (id);

alter table public.goods_receptions
  add column if not exists location_id uuid references public.inventory_locations (id);

comment on column public.expected_deliveries.location_id is
  'The Lager it goes to (inventory_locations). Required by the form; null only on entries made before 2026-10-23.';
comment on column public.goods_receptions.location_id is
  'The Lager the goods went to. Copied from the expected delivery it closes; optional otherwise.';
