-- ============================================================
-- Visits: each day starts and ends at home or at the office.
--
-- Home is the salesperson's own address (sales_start_points); the office is
-- the company's, the delivery round's start (app_settings 'route.origin').
-- A day with no choice starts and ends at home.
-- ============================================================

create table public.sales_visit_days (
  salesperson_id uuid not null references public.profiles (id) on delete cascade,
  visit_date     date not null,
  start_at       text not null default 'home' check (start_at in ('home', 'office')),
  end_at         text not null default 'home' check (end_at in ('home', 'office')),
  primary key (salesperson_id, visit_date)
);

alter table public.sales_visit_days enable row level security;

create policy "sales_visit_days: sales read" on public.sales_visit_days
  for select to authenticated using ((select public.is_sales()));
create policy "sales_visit_days: sales write" on public.sales_visit_days
  for all to authenticated using ((select public.is_sales())) with check ((select public.is_sales()));
