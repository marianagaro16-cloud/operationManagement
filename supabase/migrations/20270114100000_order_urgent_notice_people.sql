-- ============================================================
-- Orders: who hears that an order is urgent or late (2026-10-13).
--
-- The "Urgente — …" and "Pedido atrasado — …" notices went to everybody.
-- They are for whoever prepares the orders: Jefferson — and whoever covers
-- him, on the days they do (read from the coverage plan, not kept here).
-- Change the list here to change who.
-- ============================================================

insert into public.app_settings (key, value)
values (
  'orders.urgent_notice_people',
  '["ae76299a-64ed-4f0b-a07a-88bb65f8f18d"]'::jsonb
)
on conflict (key) do nothing;
