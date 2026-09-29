-- ============================================================
-- Events, step 2: what we take becomes an order, and what comes back.
--
--   event_products   while the event is an idea: what we plan to take.
--   confirming       turns them into an order of type 'event' — for the
--                    event's customer, or the internal customer "Eventos" —
--                    delivered the day before it starts (changeable), by the
--                    event's delivery method (default: picked up at the
--                    factory). Operations prepares it like any other, lots
--                    included.
--   after that       the event's product list IS the order's lines: changed
--                    from the event until the order is marked ready, then
--                    only in Pedidos.
--   cancelling       the event cancels its order, unless it already left.
--   event_returns    per product: what came back in good condition and what
--                    was thrown away. Recorded only; stock is not touched.
--
-- Event orders are not sales: the sales report and customers going quiet
-- leave them out.
-- ============================================================

-- ---------- the internal customer ----------

do $$
declare
  v_id uuid;
begin
  if not exists (select 1 from public.app_settings where key = 'events.customer') then
    insert into public.customers (company_name) values ('Eventos') returning id into v_id;
    insert into public.app_settings (key, value) values ('events.customer', jsonb_build_object('id', v_id));
  end if;
end $$;

create or replace function public.event_customer_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select (value ->> 'id')::uuid from public.app_settings where key = 'events.customer';
$$;

revoke all on function public.event_customer_id() from public, anon, authenticated;

-- ---------- the event's delivery and order ----------

alter table public.events
  -- Null until chosen: the day before the start.
  add column delivery_date      date,
  add column delivery_method_id uuid references public.delivery_methods (id) on delete set null,
  add column order_id           uuid unique references public.orders (id) on delete set null;

update public.events set delivery_method_id = (select id from public.delivery_methods where slug = 'fabrica')
 where delivery_method_id is null;

create table public.event_products (
  id         uuid primary key default gen_random_uuid(),
  event_id   uuid not null references public.events (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete restrict,
  quantity   numeric(12, 3) not null check (quantity > 0),
  note       text,
  position   int not null default 0,
  unique (event_id, product_id)
);

create table public.event_returns (
  event_id           uuid not null references public.events (id) on delete cascade,
  product_id         uuid not null references public.products (id) on delete restrict,
  back_quantity      numeric(12, 3) not null default 0 check (back_quantity >= 0),
  discarded_quantity numeric(12, 3) not null default 0 check (discarded_quantity >= 0),
  updated_at         timestamptz not null default now(),
  updated_by         uuid references public.profiles (id) on delete set null,
  primary key (event_id, product_id)
);

create trigger event_returns_set_updated_at before update on public.event_returns
  for each row execute function public.set_updated_at();

alter table public.event_products enable row level security;
alter table public.event_returns  enable row level security;

-- Products are written by event_set_products() only.
create policy "event_products: sales read" on public.event_products for select to authenticated
  using ((select public.is_sales()));
create policy "event_returns: sales all" on public.event_returns for all to authenticated
  using ((select public.is_sales())) with check ((select public.is_sales()));

-- ---------- making the order ----------

/* The event's planned products become its order; internal, called by the RPCs below. */
create or replace function public.event_make_order(p_event_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_e      public.events%rowtype;
  v_today  date := (now() at time zone 'Europe/Zurich')::date;
  v_date   date;
  v_method uuid;
  v_order  uuid;
begin
  select * into v_e from public.events where id = p_event_id;
  if not exists (select 1 from public.event_products where event_id = p_event_id) then
    return null;
  end if;
  v_date   := greatest(coalesce(v_e.delivery_date, v_e.start_date - 1), v_today);
  v_method := coalesce(v_e.delivery_method_id, (select id from public.delivery_methods where slug = 'fabrica'));

  insert into public.orders (customer_id, delivery_date, preparation_date, delivery_method_id,
                             status, order_type, note, created_by, updated_by)
  values (coalesce(v_e.customer_id, public.event_customer_id()), v_date, v_date, v_method,
          'confirmed', 'event', 'Evento: ' || v_e.name, (select auth.uid()), (select auth.uid()))
  returning id into v_order;

  insert into public.order_lines (order_id, product_id, ordered_quantity, note, position)
  select v_order, product_id, quantity, note, position
    from public.event_products where event_id = p_event_id order by position;
  delete from public.event_products where event_id = p_event_id;

  update public.events
     set order_id = v_order, delivery_date = v_date, delivery_method_id = v_method
   where id = p_event_id;
  return v_order;
end;
$$;

revoke all on function public.event_make_order(uuid) from public, anon, authenticated;

/* Confirm an idea: the kind's standard tasks are planned, and what we take becomes an order. */
create or replace function public.event_confirm(p_event_id uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_e    public.events%rowtype;
  v_kind uuid := (select id from public.sales_activity_kinds where slug = 'event_task');
  v_n    int;
begin
  if not public.is_sales() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  select * into v_e from public.events where id = p_event_id for update;
  if not found then
    raise exception 'event_not_found' using errcode = 'P0002';
  end if;
  if v_e.stage <> 'idea' then
    raise exception 'event_not_idea' using errcode = '22023';
  end if;
  if v_e.owner_id is null then
    raise exception 'owner_required' using errcode = '22023';
  end if;

  insert into public.sales_activities (salesperson_id, kind_id, activity_date, title, event_id, created_by)
  select v_e.owner_id, v_kind,
         case t.anchor when 'end' then v_e.end_date + t.days else v_e.start_date + t.days end,
         t.title, v_e.id, (select auth.uid())
    from public.event_kind_tasks t
   where t.kind_id = v_e.kind_id
   order by t.sort_order;
  get diagnostics v_n = row_count;

  update public.events set stage = 'confirmed' where id = p_event_id;
  perform public.event_make_order(p_event_id);
  return v_n;
end;
$$;

/*
 * What we take: [{product_id, quantity, note}]. An idea keeps its list; a
 * confirmed event's list is its order's lines — created if it has none,
 * cancelled when emptied, locked once the order is ready.
 */
create or replace function public.event_set_products(p_event_id uuid, p_lines jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_e public.events%rowtype;
  v_o public.orders%rowtype;
begin
  if not public.is_sales() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  select * into v_e from public.events where id = p_event_id for update;
  if not found then
    raise exception 'event_not_found' using errcode = 'P0002';
  end if;
  if v_e.stage not in ('idea', 'confirmed') then
    raise exception 'event_closed' using errcode = '22023';
  end if;
  if jsonb_typeof(p_lines) <> 'array'
     or exists (select 1 from jsonb_array_elements(p_lines) x where coalesce((x ->> 'quantity')::numeric, 0) <= 0) then
    raise exception 'invalid_quantity' using errcode = '22023';
  end if;
  if (select count(*) from jsonb_array_elements(p_lines))
     <> (select count(distinct x ->> 'product_id') from jsonb_array_elements(p_lines) x) then
    raise exception 'duplicate_product' using errcode = '22023';
  end if;

  create temp table if not exists pg_temp.event_lines (product_id uuid, quantity numeric, note text, position int) on commit drop;
  delete from pg_temp.event_lines;
  insert into pg_temp.event_lines
  select (x ->> 'product_id')::uuid, (x ->> 'quantity')::numeric, nullif(btrim(x ->> 'note'), ''), (n - 1)::int
    from jsonb_array_elements(p_lines) with ordinality t(x, n);

  if v_e.order_id is not null then
    select * into v_o from public.orders where id = v_e.order_id for update;
  end if;

  -- An idea, or a confirmed event without a live order: the event's own list.
  if v_e.stage = 'idea' or v_e.order_id is null or v_o.status <> 'confirmed' then
    delete from public.event_products where event_id = p_event_id;
    insert into public.event_products (event_id, product_id, quantity, note, position)
    select p_event_id, product_id, quantity, note, position from pg_temp.event_lines;
    if v_e.stage = 'confirmed' then
      perform public.event_make_order(p_event_id);
    end if;
    return;
  end if;

  if v_o.ready_at is not null then
    raise exception 'event_order_ready' using errcode = '22023';
  end if;

  if not exists (select 1 from pg_temp.event_lines) then
    update public.orders set status = 'cancelled', updated_by = (select auth.uid()) where id = v_o.id;
    update public.events set order_id = null where id = p_event_id;
    return;
  end if;

  delete from public.order_lines l
   where l.order_id = v_o.id and l.product_id not in (select product_id from pg_temp.event_lines);
  update public.order_lines l
     set ordered_quantity = n.quantity, note = n.note, position = n.position
    from pg_temp.event_lines n
   where l.order_id = v_o.id and l.product_id = n.product_id;
  insert into public.order_lines (order_id, product_id, ordered_quantity, note, position)
  select v_o.id, n.product_id, n.quantity, n.note, n.position
    from pg_temp.event_lines n
   where not exists (select 1 from public.order_lines l where l.order_id = v_o.id and l.product_id = n.product_id);
  update public.orders set updated_by = (select auth.uid()) where id = v_o.id;
end;
$$;

revoke all on function public.event_set_products(uuid, jsonb) from public, anon;
grant execute on function public.event_set_products(uuid, jsonb) to authenticated;

/* When and how it goes: on the event, and on its order until that has left. */
create or replace function public.event_set_delivery(p_event_id uuid, p_date date, p_method_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_e public.events%rowtype;
  v_o public.orders%rowtype;
begin
  if not public.is_sales() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if p_date is null or p_method_id is null then
    raise exception 'invalid_delivery' using errcode = '22023';
  end if;
  select * into v_e from public.events where id = p_event_id for update;
  if not found then
    raise exception 'event_not_found' using errcode = 'P0002';
  end if;
  if v_e.stage not in ('idea', 'confirmed') then
    raise exception 'event_closed' using errcode = '22023';
  end if;

  if v_e.order_id is not null then
    select * into v_o from public.orders where id = v_e.order_id for update;
    if v_o.status = 'confirmed' then
      if v_o.shipped_at is not null then
        raise exception 'event_order_shipped' using errcode = '22023';
      end if;
      update public.orders
         set delivery_date = p_date,
             delivery_method_id = p_method_id,
             -- Prepared the day it goes, unless someone moved it earlier.
             preparation_date = case when preparation_date = delivery_date then p_date else least(preparation_date, p_date) end,
             updated_by = (select auth.uid())
       where id = v_o.id;
    end if;
  end if;
  update public.events set delivery_date = p_date, delivery_method_id = p_method_id where id = p_event_id;
end;
$$;

revoke all on function public.event_set_delivery(uuid, date, uuid) from public, anon;
grant execute on function public.event_set_delivery(uuid, date, uuid) to authenticated;

/*
 * Cancel an event, with a reason: what was still planned for it comes off the
 * plans, and its order is cancelled unless it already left.
 * Returns 'none' (no order), 'cancelled' or 'kept'.
 */
create or replace function public.event_cancel(p_event_id uuid, p_reason text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_e public.events%rowtype;
  v_o public.orders%rowtype;
begin
  if not public.is_sales() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'events_cancel_reason' using errcode = '22023';
  end if;
  select * into v_e from public.events where id = p_event_id for update;
  if not found then
    raise exception 'event_not_found' using errcode = 'P0002';
  end if;
  if v_e.stage not in ('idea', 'confirmed') then
    raise exception 'event_closed' using errcode = '22023';
  end if;

  update public.events set stage = 'cancelled', cancel_reason = btrim(p_reason) where id = p_event_id;
  delete from public.sales_activities where event_id = p_event_id and status = 'planned';

  if v_e.order_id is null then
    return 'none';
  end if;
  select * into v_o from public.orders where id = v_e.order_id for update;
  if v_o.status <> 'confirmed' then
    return 'none';
  end if;
  if v_o.shipped_at is not null then
    return 'kept';
  end if;
  update public.orders
     set status = 'cancelled', ready_at = null, ready_by = null, updated_by = (select auth.uid())
   where id = v_o.id;
  return 'cancelled';
end;
$$;

revoke all on function public.event_cancel(uuid, text) from public, anon;
grant execute on function public.event_cancel(uuid, text) to authenticated;

-- ---------- sales may correct their event orders ----------

/*
 * As 20261001091000, plus: an event's order is corrected by sales through
 * the event (delivery, cancelling), without orders.correct_completed.
 */
create or replace function public.guard_confirmed_order_edit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status = 'confirmed'
     and (select auth.uid()) is not null
     and not public.has_permission('orders.correct_completed')
     and not (old.order_type = 'event' and new.order_type = 'event' and public.is_sales())
     and (
          new.customer_id        is distinct from old.customer_id
       or new.order_date         is distinct from old.order_date
       or new.delivery_date      is distinct from old.delivery_date
       or new.delivery_time      is distinct from old.delivery_time
       or new.preparation_date   is distinct from old.preparation_date
       or new.delivery_method_id is distinct from old.delivery_method_id
       or new.status             is distinct from old.status
       or new.order_type         is distinct from old.order_type
       or new.note               is distinct from old.note
       or new.replaces_incident_id is distinct from old.replaces_incident_id
     ) then
    raise exception 'order_correction_denied' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- ---------- not sales ----------

create or replace function public.sales_quiet_customers_all()
returns table (
  id uuid, company_name text, company_name_addition text, city text,
  last_order date, rhythm_days numeric, days_since int,
  late boolean, last30 numeric, prev30 numeric, change_pct int
)
language sql
stable
security definer
set search_path = ''
as $$
  with today as (select (now() at time zone 'Europe/Zurich')::date d),
  days as (
    select distinct o.customer_id, o.delivery_date d
      from public.orders o, today
     where o.status = 'confirmed' and o.order_type <> 'event' and o.delivery_date <= today.d
  ),
  rhythm as (
    select customer_id, count(*) n, max(d) last_order,
           avg(gap) filter (where gap is not null) avg_gap
      from (select customer_id, d, d - lag(d) over (partition by customer_id order by d) gap from days) g
     group by customer_id
  ),
  volume as (
    select o.customer_id,
           coalesce(sum(l.ordered_quantity) filter (where o.delivery_date > today.d - 30), 0) last30,
           coalesce(sum(l.ordered_quantity) filter (where o.delivery_date <= today.d - 30), 0) prev30
      from public.orders o
      join public.order_lines l on l.order_id = o.id, today
     where o.status = 'confirmed' and o.order_type <> 'event'
       and o.delivery_date > today.d - 60 and o.delivery_date <= today.d
     group by o.customer_id
  ),
  scored as (
    select c.id, c.company_name, c.company_name_addition, c.city,
           r.last_order, round(r.avg_gap::numeric, 1) rhythm_days,
           (today.d - r.last_order)::int days_since,
           (today.d - r.last_order) > 2 * r.avg_gap
             and not exists (select 1 from public.orders o
                              where o.customer_id = c.id and o.status <> 'cancelled'
                                and o.order_type <> 'event' and o.delivery_date > today.d) late,
           coalesce(v.last30, 0) last30, coalesce(v.prev30, 0) prev30
      from public.customers c
      join rhythm r on r.customer_id = c.id
      left join volume v on v.customer_id = c.id, today
     where c.is_active and r.n >= 4 and r.avg_gap is not null
  )
  select id, company_name, company_name_addition, city, last_order, rhythm_days, days_since, late,
         last30, prev30,
         case when prev30 > 0 then round((last30 - prev30) / prev30 * 100)::int end change_pct
    from scored
   where late or (prev30 > 0 and last30 <= prev30 * 0.7)
   order by late desc, days_since desc;
$$;

revoke all on function public.sales_quiet_customers_all() from public, anon, authenticated;

create or replace function public.sales_report(p_month date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today    date := (now() at time zone 'Europe/Zurich')::date;
  v_start    date := date_trunc('month', p_month)::date;
  v_end      date;
  v_prev     date;
  v_prev_end date;
begin
  if not public.is_sales() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  v_end  := least((v_start + interval '1 month - 1 day')::date, v_today);
  v_prev := (v_start - interval '1 month')::date;
  -- The same days of the month before, as far as that month has them.
  v_prev_end := least(v_prev + (v_end - v_start), (v_start - 1));

  return (
    with lines as (
      select o.customer_id, l.product_id, o.delivery_date d,
             l.ordered_quantity q, l.ordered_quantity * p.net_weight_kg kg
        from public.orders o
        join public.order_lines l on l.order_id = o.id
        left join public.products p on p.id = l.product_id
       where o.status = 'confirmed' and o.order_type <> 'event' and o.delivery_date <= v_today
    ),
    scoped as (
      select *, (d between v_start and v_end) cur, (d between v_prev and v_prev_end) prev
        from lines
       where d between v_prev and v_end
    )
    select jsonb_build_object(
      'period',   jsonb_build_object('from', v_start, 'to', v_end),
      'previous', jsonb_build_object('from', v_prev, 'to', v_prev_end),
      'totals', (
        select jsonb_build_object(
          'quantity', coalesce(sum(q) filter (where cur), 0),
          'kg', round(coalesce(sum(kg) filter (where cur), 0)::numeric, 1),
          'prev_quantity', coalesce(sum(q) filter (where prev), 0),
          'prev_kg', round(coalesce(sum(kg) filter (where prev), 0)::numeric, 1),
          'customers', count(distinct customer_id) filter (where cur))
          from scoped),
      'customers', (
        select coalesce(jsonb_agg(x order by x.quantity desc, x.prev_quantity desc), '[]'::jsonb)
          from (select c.id, c.company_name name, c.city,
                       coalesce(sum(s.q) filter (where s.cur), 0) quantity,
                       round(coalesce(sum(s.kg) filter (where s.cur), 0)::numeric, 1) kg,
                       coalesce(sum(s.q) filter (where s.prev), 0) prev_quantity,
                       round(coalesce(sum(s.kg) filter (where s.prev), 0)::numeric, 1) prev_kg
                  from scoped s join public.customers c on c.id = s.customer_id
                 group by c.id, c.company_name, c.city) x),
      'products', (
        select coalesce(jsonb_agg(x order by x.quantity desc, x.prev_quantity desc), '[]'::jsonb)
          from (select p.id, p.code, p.name,
                       coalesce(sum(s.q) filter (where s.cur), 0) quantity,
                       round(coalesce(sum(s.kg) filter (where s.cur), 0)::numeric, 1) kg,
                       coalesce(sum(s.q) filter (where s.prev), 0) prev_quantity,
                       round(coalesce(sum(s.kg) filter (where s.prev), 0)::numeric, 1) prev_kg
                  from scoped s join public.products p on p.id = s.product_id
                 group by p.id, p.code, p.name) x),
      'types', (
        select coalesce(jsonb_agg(x order by x.quantity desc, x.prev_quantity desc), '[]'::jsonb)
          from (select t.id, coalesce(t.name, '—') name,
                       count(distinct s.customer_id) filter (where s.cur) customers,
                       coalesce(sum(s.q) filter (where s.cur), 0) quantity,
                       round(coalesce(sum(s.kg) filter (where s.cur), 0)::numeric, 1) kg,
                       coalesce(sum(s.q) filter (where s.prev), 0) prev_quantity,
                       round(coalesce(sum(s.kg) filter (where s.prev), 0)::numeric, 1) prev_kg
                  from scoped s
                  join public.customers c on c.id = s.customer_id
                  left join public.customer_types t on t.id = c.customer_type_id
                 group by t.id, t.name) x),
      'trend', (
        select coalesce(jsonb_agg(x order by x.month), '[]'::jsonb)
          from (select date_trunc('month', d)::date as month,
                       sum(q) quantity, round(coalesce(sum(kg), 0)::numeric, 1) kg
                  from lines group by 1) x)
    )
  );
end;
$$;
