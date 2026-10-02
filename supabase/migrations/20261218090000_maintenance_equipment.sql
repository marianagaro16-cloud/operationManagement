-- ============================================================
-- Maintenance step 2: the equipment list (decided 2026-10-02).
--
-- The company's machines and installations: name and location, brand, model
-- and serial number, and who services them. A maintenance activity can be
-- about one of them; its days, once done, are the equipment's history.
--
-- Whoever runs Maintenance (Freddy), Admin and Owners keep the list; anyone
-- in the company reads it (repair requests will point at it) — not the
-- external account.
-- ============================================================

create or replace function public.can_manage_maintenance()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin()
      or public.has_permission('tasks.manage_definitions')
      or (public.has_permission('tasks.manage_own_team') and 'maintenance' = any (public.my_teams()));
$$;

revoke all on function public.can_manage_maintenance() from public, anon;
grant execute on function public.can_manage_maintenance() to authenticated;

create table public.equipment (
  id               uuid primary key default gen_random_uuid(),
  name             text not null check (length(btrim(name)) between 1 and 120),
  location         text check (location is null or length(location) <= 120),
  brand            text check (brand is null or length(brand) <= 80),
  model            text check (model is null or length(model) <= 80),
  serial_number    text check (serial_number is null or length(serial_number) <= 80),
  service_contact  text check (service_contact is null or length(service_contact) <= 120),
  service_phone    text check (service_phone is null or length(service_phone) <= 40),
  service_email    text check (service_email is null or length(service_email) <= 120),
  notes            text check (notes is null or length(notes) <= 2000),
  is_active        boolean not null default true,
  created_by       uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create unique index equipment_name_key on public.equipment (lower(btrim(name)));

create trigger equipment_set_updated_at before update on public.equipment
  for each row execute function public.set_updated_at();

alter table public.equipment enable row level security;
create policy "equipment: read" on public.equipment for select to authenticated
  using ((select public.is_approved()) and not (select public.is_external()));
create policy "equipment: maintenance writes" on public.equipment for all to authenticated
  using ((select public.can_manage_maintenance())) with check ((select public.can_manage_maintenance()));
grant select, insert, update, delete on public.equipment to authenticated;

-- An activity about a piece of equipment: its days are the equipment's history.
alter table public.tasks add column equipment_id uuid references public.equipment (id) on delete set null;
create index tasks_equipment_idx on public.tasks (equipment_id) where equipment_id is not null;
