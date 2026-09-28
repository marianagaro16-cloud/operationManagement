-- ============================================================
-- Sales: the Ventas team, and a file for every customer.
--
--   is_sales()             whoever is on the Ventas team, Admin and Owners.
--                          The sales section and its data are theirs.
--   customer_notes         calls, visits, messages and offers with a
--                          customer. PERMANENT, like HR notes: no update or
--                          delete, for anyone; a correction is a new note.
--   sales_customer_file()  what a customer orders and how: history, rhythm,
--                          the last month against the one before, what they
--                          buy most, recent orders and incidents. Computed
--                          for sales whatever their role, so a future sales
--                          person who is a plain User still sees the history.
--
-- Quantities and kg only: the app has no prices. Weights are net, on ordered
-- quantities of confirmed orders, as in the orders report.
-- ============================================================

create or replace function public.is_sales()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
     where p.id = (select auth.uid())
       and p.status = 'approved'
       and (p.team = 'sales' or p.role in ('admin', 'owner'))
  );
$$;

revoke all on function public.is_sales() from public, anon;
grant execute on function public.is_sales() to authenticated;

-- ---------- notes ----------

create table public.customer_notes (
  id          uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id) on delete cascade,
  kind        text not null check (kind in ('call', 'visit', 'message', 'offer')),
  note_date   date not null,
  body        text not null check (length(btrim(body)) > 0),
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now()
);

create index customer_notes_customer_idx on public.customer_notes (customer_id, note_date desc, created_at desc);

alter table public.customer_notes enable row level security;

create policy "customer_notes: sales read" on public.customer_notes
  for select to authenticated using ((select public.is_sales()));
-- No update or delete policy: nobody can change or remove a note.
create policy "customer_notes: sales add" on public.customer_notes
  for insert to authenticated
  with check ((select public.is_sales()) and created_by = (select auth.uid()));

-- ---------- the file ----------

create or replace function public.sales_customer_file(p_customer_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'Europe/Zurich')::date;
  v_customer jsonb;
begin
  if not public.is_sales() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  select jsonb_build_object(
           'id', c.id, 'company_name', c.company_name, 'company_name_addition', c.company_name_addition,
           'name', c.name, 'street', c.street, 'postal_code', c.postal_code, 'city', c.city,
           'is_active', c.is_active, 'type', t.name)
    into v_customer
    from public.customers c
    left join public.customer_types t on t.id = c.customer_type_id
   where c.id = p_customer_id;
  if v_customer is null then
    return null;
  end if;

  return jsonb_build_object(
    'customer', v_customer,
    'orders', (
      select jsonb_build_object(
        'total', count(*),
        'first', min(o.delivery_date),
        'last', max(o.delivery_date) filter (where o.delivery_date <= v_today),
        'next', min(o.delivery_date) filter (where o.delivery_date > v_today))
        from public.orders o
       where o.customer_id = p_customer_id and o.status = 'confirmed'),
    -- Average days between the days they received an order, once there are two.
    'rhythm_days', (
      select round(avg(gap)::numeric, 1)
        from (select d - lag(d) over (order by d) as gap
                from (select distinct o.delivery_date d from public.orders o
                       where o.customer_id = p_customer_id and o.status = 'confirmed'
                         and o.delivery_date <= v_today) days) gaps
       where gap is not null),
    'periods', (
      select jsonb_build_object(
        'last30', jsonb_build_object(
          'quantity', coalesce(sum(l.ordered_quantity) filter (where o.delivery_date > v_today - 30), 0),
          'kg', round(coalesce(sum(l.ordered_quantity * p.net_weight_kg) filter (where o.delivery_date > v_today - 30), 0)::numeric, 1)),
        'prev30', jsonb_build_object(
          'quantity', coalesce(sum(l.ordered_quantity) filter (where o.delivery_date <= v_today - 30), 0),
          'kg', round(coalesce(sum(l.ordered_quantity * p.net_weight_kg) filter (where o.delivery_date <= v_today - 30), 0)::numeric, 1)))
        from public.orders o
        join public.order_lines l on l.order_id = o.id
        left join public.products p on p.id = l.product_id
       where o.customer_id = p_customer_id and o.status = 'confirmed'
         and o.delivery_date > v_today - 60 and o.delivery_date <= v_today),
    -- What they buy most over the last 90 days.
    'top_products', (
      select coalesce(jsonb_agg(x order by x.quantity desc), '[]'::jsonb)
        from (select p.id, p.code, p.name, sum(l.ordered_quantity) quantity,
                     round(sum(l.ordered_quantity * p.net_weight_kg)::numeric, 1) kg,
                     count(distinct o.id) orders
                from public.orders o
                join public.order_lines l on l.order_id = o.id
                join public.products p on p.id = l.product_id
               where o.customer_id = p_customer_id and o.status = 'confirmed'
                 and o.delivery_date > v_today - 90 and o.delivery_date <= v_today
               group by p.id, p.code, p.name
               order by quantity desc
               limit 10) x),
    'recent_orders', (
      select coalesce(jsonb_agg(x order by x.delivery_date desc), '[]'::jsonb)
        from (select o.id, o.reference, o.delivery_date,
                     count(l.id) lines, coalesce(sum(l.ordered_quantity), 0) quantity,
                     round(coalesce(sum(l.ordered_quantity * p.net_weight_kg), 0)::numeric, 1) kg
                from public.orders o
                left join public.order_lines l on l.order_id = o.id
                left join public.products p on p.id = l.product_id
               where o.customer_id = p_customer_id and o.status = 'confirmed'
               group by o.id
               order by o.delivery_date desc
               limit 10) x),
    'incidents', (
      select coalesce(jsonb_agg(x order by x.created_at desc), '[]'::jsonb)
        from (select i.id, i.incident_number, i.created_at, i.status, left(i.description, 160) description
                from public.incidents i
               where i.customer_id = p_customer_id
               order by i.created_at desc
               limit 10) x)
  );
end;
$$;

revoke all on function public.sales_customer_file(uuid) from public, anon;
grant execute on function public.sales_customer_file(uuid) to authenticated;

/* The customer list for sales: last order and orders in the last 90 days. */
create or replace function public.sales_customer_list()
returns table (
  id uuid, company_name text, company_name_addition text, city text, is_active boolean,
  last_order date, orders_90d int, notes int
)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, c.company_name, c.company_name_addition, c.city, c.is_active,
         (select max(o.delivery_date) from public.orders o
           where o.customer_id = c.id and o.status = 'confirmed'
             and o.delivery_date <= (now() at time zone 'Europe/Zurich')::date),
         (select count(*)::int from public.orders o
           where o.customer_id = c.id and o.status = 'confirmed'
             and o.delivery_date > (now() at time zone 'Europe/Zurich')::date - 90
             and o.delivery_date <= (now() at time zone 'Europe/Zurich')::date),
         (select count(*)::int from public.customer_notes n where n.customer_id = c.id)
    from public.customers c
   where public.is_sales();
$$;

revoke all on function public.sales_customer_list() from public, anon;
grant execute on function public.sales_customer_list() to authenticated;
