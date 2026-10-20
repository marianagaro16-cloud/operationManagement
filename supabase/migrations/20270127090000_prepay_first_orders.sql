-- A new customer's first N orders paid in advance.
-- Set by whoever creates the customer; changed afterwards by the collections
-- team only. Counted, not ticked: an order is "in advance" when it is among
-- the customer's first N sale orders by creation, cancelled ones not counted.
-- Like prepay_required, it only warns, never blocks.

alter table public.customers
  add column prepay_first_orders integer not null default 0
    check (prepay_first_orders between 0 and 99);

create or replace function public.guard_customer_prepay()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.prepay_required is distinct from old.prepay_required then
    if not public.is_collections() then
      raise exception 'not_authorized';
    end if;
    new.prepay_since := case when new.prepay_required then current_date else null end;
  else
    new.prepay_since := old.prepay_since;
  end if;
  if new.prepay_first_orders is distinct from old.prepay_first_orders and not public.is_collections() then
    raise exception 'not_authorized';
  end if;
  return new;
end;
$$;

create or replace function public.set_customer_prepay_first_orders(p_customer_id uuid, p_count integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_collections() then
    raise exception 'not_authorized';
  end if;
  update public.customers set prepay_first_orders = p_count where id = p_customer_id;
  if not found then
    raise exception 'not_found';
  end if;
end;
$$;

revoke all on function public.set_customer_prepay_first_orders(uuid, integer) from public, anon;
grant execute on function public.set_customer_prepay_first_orders(uuid, integer) to authenticated;

-- Which place an order takes among the customer's counted orders (1 = first),
-- or null when it is not counted. Definer: the count must include orders the
-- viewer may not see; only the number comes out.
create or replace function public.order_prepay_place(p_order_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select 1 + (
    select count(*)::integer from public.orders e
     where e.customer_id = o.customer_id
       and e.order_type = 'sale' and e.status <> 'cancelled'
       and (e.created_at, e.id) < (o.created_at, o.id)
  )
  from public.orders o
  where o.id = p_order_id and o.order_type = 'sale' and o.status <> 'cancelled';
$$;

revoke all on function public.order_prepay_place(uuid) from public, anon;
grant execute on function public.order_prepay_place(uuid) to authenticated;

-- Read as a column of orders (`in_advance` in a select): one of the first N.
create or replace function public.in_advance(o public.orders)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(
    public.order_prepay_place(o.id) <= (select c.prepay_first_orders from public.customers c where c.id = o.customer_id),
    false
  );
$$;

grant execute on function public.in_advance(public.orders) to authenticated;

-- Customers with a first-orders count, and how many orders have counted so far.
create or replace function public.prepay_first_orders_status()
returns table (customer_id uuid, first_orders integer, counted integer)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, c.prepay_first_orders,
         (select count(*)::integer from public.orders o
           where o.customer_id = c.id and o.order_type = 'sale' and o.status <> 'cancelled')
  from public.customers c
  where c.prepay_first_orders > 0 and public.is_approved();
$$;

revoke all on function public.prepay_first_orders_status() from public, anon;
grant execute on function public.prepay_first_orders_status() to authenticated;
