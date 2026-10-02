-- ============================================================
-- Maintenance step 3: repair requests (decided 2026-10-02).
--
-- Anyone in the company reports something broken: what, which equipment (or
-- none — the building, a door), and how urgent — normal, urgent, or stopping
-- production. Maintenance (Freddy, Bruce) sees every report, plans it as a
-- maintenance day, and closes it with what was done and what it cost. The
-- reporter sees their own and is told when it is fixed. Not for the external
-- account.
-- ============================================================

create table public.repair_requests (
  id           uuid primary key default gen_random_uuid(),
  title        text not null check (length(btrim(title)) between 1 and 200),
  description  text check (description is null or length(description) <= 4000),
  equipment_id uuid references public.equipment (id) on delete set null,
  place        text check (place is null or length(place) <= 120),
  urgency      text not null default 'normal' check (urgency in ('normal', 'urgent', 'stops_production')),
  status       text not null default 'new' check (status in ('new', 'in_progress', 'fixed', 'cancelled')),
  reported_by  uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  task_id      uuid references public.tasks (id) on delete set null,
  resolution   text check (resolution is null or length(resolution) <= 4000),
  cost         numeric(10, 2) check (cost is null or cost >= 0),
  fixed_by     uuid references public.profiles (id) on delete set null,
  fixed_at     timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index repair_requests_status_idx on public.repair_requests (status, created_at desc);
create index repair_requests_equipment_idx on public.repair_requests (equipment_id) where equipment_id is not null;

create trigger repair_requests_set_updated_at before update on public.repair_requests
  for each row execute function public.set_updated_at();

/* Maintenance's people: whoever runs it, and its team (Bruce). */
create or replace function public.is_maintenance()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.can_manage_maintenance() or exists (
    select 1 from public.profiles p where p.id = (select auth.uid()) and p.status = 'approved' and p.team = 'maintenance'
  );
$$;

revoke all on function public.is_maintenance() from public, anon;
grant execute on function public.is_maintenance() to authenticated;

/*
 * Maintenance moves a request and closes it; whoever reported it may change
 * it while new, and cancel it then. Fixed is stamped with who and when.
 */
create or replace function public.guard_repair_request()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.reported_by := old.reported_by;
  if not public.is_maintenance() then
    if old.status <> 'new' or new.status not in ('new', 'cancelled')
       or new.resolution is distinct from old.resolution or new.cost is distinct from old.cost
       or new.task_id is distinct from old.task_id then
      raise exception 'not_authorized' using errcode = '42501';
    end if;
  end if;
  if new.status = 'fixed' and old.status <> 'fixed' then
    new.fixed_at := now();
    new.fixed_by := (select auth.uid());
  elsif new.status <> 'fixed' then
    new.fixed_at := null;
    new.fixed_by := null;
  end if;
  return new;
end;
$$;

create trigger repair_requests_guard before update on public.repair_requests
  for each row execute function public.guard_repair_request();

alter table public.repair_requests enable row level security;

create policy "repair_requests: read" on public.repair_requests for select to authenticated
  using ((select public.is_approved()) and (reported_by = (select auth.uid()) or (select public.is_maintenance())));
create policy "repair_requests: report" on public.repair_requests for insert to authenticated
  with check ((select public.is_approved()) and not (select public.is_external()) and reported_by = (select auth.uid()) and status = 'new');
create policy "repair_requests: change" on public.repair_requests for update to authenticated
  using ((select public.is_approved()) and (reported_by = (select auth.uid()) or (select public.is_maintenance())))
  with check ((select public.is_approved()));

grant select, insert, update on public.repair_requests to authenticated;
