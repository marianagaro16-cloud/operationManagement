-- ============================================================
-- The Palomo round: addresses, a starting point, and an order of stops.
--
-- Deliveries with our own van are planned on paper today, because the app
-- knows WHO gets an order and never WHERE they are. Three things are added,
-- and nothing else changes:
--
--   customers    an address, a delivery note, and the coordinates geocoded
--                from that address
--   app_settings one row for the address the van leaves from and returns to
--   orders       the position of that order in its day's round
--
-- The position lives on the order rather than in a route table: an order has
-- exactly one delivery date and one delivery method, so "the round" is a
-- query over orders, not a record that could disagree with them.
-- ============================================================

alter table public.customers
  add column street        text,
  add column postal_code   text,
  add column city          text,
  -- Switzerland unless stated; the geocoder needs a country to be sure.
  add column country       text not null default 'CH',
  add column delivery_notes text,
  -- Geocoded from the address above, never typed by hand.
  add column latitude      numeric(9, 6),
  add column longitude     numeric(9, 6),
  add column geocoded_at   timestamptz;

comment on column public.customers.delivery_notes is
  'What the driver needs to know: which door, which hours, who to ask for.';
comment on column public.customers.latitude is
  'Filled by geocoding the address when it is saved. NULL means the address could not be found, and the stop is then ordered by hand.';

create index customers_geocoded_idx on public.customers (id) where latitude is not null;


-- ---------- where the van starts and ends ----------
/*
 * A tiny key/value store rather than a column on a table nobody owns. The
 * app has exactly one setting today — the round's origin — and inventing a
 * "company" table for it would be inventing a concept the business has not
 * asked for.
 */
create table public.app_settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null
);

create trigger app_settings_set_updated_at before update on public.app_settings
  for each row execute function public.set_updated_at();

alter table public.app_settings enable row level security;

create policy "app_settings: approved read" on public.app_settings
  for select to authenticated using (public.is_approved());

create policy "app_settings: admin writes" on public.app_settings
  for all to authenticated
  using (public.has_permission('system.configure'))
  with check (public.has_permission('system.configure'));


-- ---------- the order of the stops ----------
alter table public.orders
  add column route_position int;

comment on column public.orders.route_position is
  'Where this order comes in its delivery day''s round. NULL = not placed yet.';

create index orders_route_idx on public.orders (delivery_date, route_position)
  where route_position is not null;

/*
 * Whoever drives arranges the round, and a plain user may not update an
 * order — so the position is written through this function and not through
 * the orders policy. It touches one column and nothing else.
 *
 * Read-only roles are still refused: the update fires
 * guard_orders_read_only(), which is where that rule lives.
 */
create or replace function public.order_set_route_position(p_order_id uuid, p_position int)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_approved() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  update public.orders
     set route_position = p_position
   where id = p_order_id;

  if not found then
    raise exception 'order_not_found' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.order_set_route_position(uuid, int) from public;
grant execute on function public.order_set_route_position(uuid, int) to authenticated;
