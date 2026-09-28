-- ============================================================
-- Sales: visits and the salesperson's route.
--
--   sales_start_points   where each salesperson's day starts and ends
--                        (their own address), placed on the map on save.
--   sales_visits         a day's plan: customers and prospects to visit,
--                        each optionally at a set time, in route order. After
--                        the visit it is marked done or not done; what
--                        happened becomes a Visit note on the customer or
--                        prospect. A planned visit can be taken off the plan;
--                        a visit with a result stays, as the record.
--   prospects            gain a map position, placed from their address on
--                        save, so they can be on a route like customers.
--
-- For sales (is_sales()): the Ventas team, Admin and Owners.
-- ============================================================

alter table public.prospects
  add column latitude  double precision,
  add column longitude double precision;

create table public.sales_start_points (
  user_id     uuid primary key references public.profiles (id) on delete cascade,
  street      text,
  postal_code text,
  city        text,
  latitude    double precision,
  longitude   double precision,
  updated_at  timestamptz not null default now()
);

create trigger sales_start_points_set_updated_at before update on public.sales_start_points
  for each row execute function public.set_updated_at();

create table public.sales_visits (
  id             uuid primary key default gen_random_uuid(),
  visit_date     date not null,
  salesperson_id uuid not null references public.profiles (id) on delete cascade,
  customer_id    uuid references public.customers (id) on delete cascade,
  prospect_id    uuid references public.prospects (id) on delete cascade,
  planned_time   time,
  purpose        text,
  position       int not null default 0,
  status         text not null default 'planned' check (status in ('planned', 'done', 'not_done')),
  done_at        timestamptz,
  created_by     uuid references public.profiles (id) on delete set null,
  created_at     timestamptz not null default now(),
  -- A visit is to a customer or to a prospect, never both, never neither.
  constraint sales_visits_one_target check ((customer_id is null) <> (prospect_id is null))
);

create index sales_visits_day_idx on public.sales_visits (salesperson_id, visit_date, position);

alter table public.sales_start_points enable row level security;
alter table public.sales_visits       enable row level security;

create policy "sales_start_points: sales read" on public.sales_start_points
  for select to authenticated using ((select public.is_sales()));
-- Each salesperson their own; Admin and Owners anyone's.
create policy "sales_start_points: own or admin writes" on public.sales_start_points
  for all to authenticated
  using ((select public.is_sales()) and (user_id = (select auth.uid()) or (select public.is_admin())))
  with check ((select public.is_sales()) and (user_id = (select auth.uid()) or (select public.is_admin())));

create policy "sales_visits: sales read" on public.sales_visits
  for select to authenticated using ((select public.is_sales()));
create policy "sales_visits: sales add" on public.sales_visits
  for insert to authenticated
  with check ((select public.is_sales()) and created_by = (select auth.uid()) and status = 'planned');
create policy "sales_visits: sales change" on public.sales_visits
  for update to authenticated
  using ((select public.is_sales())) with check ((select public.is_sales()));
-- Off the plan while still planned; a visit with a result is the record.
create policy "sales_visits: remove planned" on public.sales_visits
  for delete to authenticated using ((select public.is_sales()) and status = 'planned');

/* The salesperson is someone in sales; a visit's result, once set, stays. */
create or replace function public.guard_sales_visit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (tg_op = 'INSERT' or new.salesperson_id is distinct from old.salesperson_id)
     and not exists (
       select 1 from public.profiles p
        where p.id = new.salesperson_id and p.status = 'approved'
          and (p.team = 'sales' or p.role in ('admin', 'owner'))
     ) then
    raise exception 'salesperson_not_sales' using errcode = '22023';
  end if;
  if tg_op = 'UPDATE' and old.status <> 'planned'
     and (new.status is distinct from old.status or new.customer_id is distinct from old.customer_id
          or new.prospect_id is distinct from old.prospect_id or new.visit_date is distinct from old.visit_date) then
    raise exception 'visit_recorded' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger sales_visits_guard
  before insert or update on public.sales_visits
  for each row execute function public.guard_sales_visit();
