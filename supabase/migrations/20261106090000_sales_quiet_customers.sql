-- ============================================================
-- Sales: customers going quiet.
--
-- Two signals, per active customer, from confirmed orders:
--
--   late         no order for more than twice their usual gap — the
--                average days between the days they received an order —
--                and nothing scheduled ahead. Needs 4 past order days, or
--                there is no rhythm to be late against.
--   ordering less the last 30 days 30% or more below the 30 before, in
--                units. The same 4 order days, so a new customer's first
--                weeks are not read as a trend.
--
-- A customer stays listed until they order again; notes do not hide them.
--
--   sales_quiet_customers_all()  the computation, for the weekly notice
--                                (service role only).
--   sales_quiet_customers()      the same, for sales (is_sales()).
--   sales_quiet_notices          one weekly summary per person and week.
-- ============================================================

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
     where o.status = 'confirmed' and o.delivery_date <= today.d
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
     where o.status = 'confirmed' and o.delivery_date > today.d - 60 and o.delivery_date <= today.d
     group by o.customer_id
  ),
  scored as (
    select c.id, c.company_name, c.company_name_addition, c.city,
           r.last_order, round(r.avg_gap::numeric, 1) rhythm_days,
           (today.d - r.last_order)::int days_since,
           (today.d - r.last_order) > 2 * r.avg_gap
             and not exists (select 1 from public.orders o
                              where o.customer_id = c.id and o.status <> 'cancelled' and o.delivery_date > today.d) late,
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

create or replace function public.sales_quiet_customers()
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
  select * from public.sales_quiet_customers_all() where public.is_sales();
$$;

revoke all on function public.sales_quiet_customers() from public, anon;
grant execute on function public.sales_quiet_customers() to authenticated;

create table public.sales_quiet_notices (
  user_id    uuid not null references public.profiles (id) on delete cascade,
  week_start date not null,
  sent_at    timestamptz not null default now(),
  primary key (user_id, week_start)
);

-- Written and read only by the notifier (service role).
alter table public.sales_quiet_notices enable row level security;
