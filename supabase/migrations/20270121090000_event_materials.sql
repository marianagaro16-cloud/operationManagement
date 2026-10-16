-- ============================================================
-- Event material: what the stand needs that is not for sale — chairs,
-- calculator, card terminal, charger, flyers, stickers, bags, decoration
-- (decided 2026-10-16).
--
--   event_kind_materials   each kind's standard list, Admin's. Copied into a
--                          new event, then changed on the event.
--   event_materials        an event's list: how many, who brings it (someone
--                          from its staff, optional), packed, came back.
--   event_material_notices the day before an event, its responsible person is
--                          told what is not packed yet — once per event.
--
-- Not an order, no stock. Like the rest of the event: Sales (is_sales());
-- Marketing reads it.
-- ============================================================

create table public.event_kind_materials (
  id         uuid primary key default gen_random_uuid(),
  kind_id    uuid not null references public.event_kinds (id) on delete cascade,
  name       text not null check (length(btrim(name)) > 0),
  quantity   numeric(10, 2) check (quantity is null or quantity > 0),
  sort_order int not null default 100
);

create index event_kind_materials_kind_idx on public.event_kind_materials (kind_id, sort_order);

create table public.event_materials (
  id                uuid primary key default gen_random_uuid(),
  event_id          uuid not null references public.events (id) on delete cascade,
  name              text not null check (length(btrim(name)) > 0),
  quantity          numeric(10, 2) check (quantity is null or quantity > 0),
  -- Who brings it: an app user or a worker without an account, as on a shift.
  bringer_profile   uuid references public.profiles (id) on delete set null,
  bringer_worker    uuid references public.hr_workers (id) on delete set null,
  packed            boolean not null default false,
  came_back         boolean not null default false,
  sort_order        int not null default 100,
  created_at        timestamptz not null default now(),
  constraint event_materials_one_bringer check (bringer_profile is null or bringer_worker is null)
);

create index event_materials_event_idx on public.event_materials (event_id, sort_order, created_at);

create table public.event_material_notices (
  event_id    uuid primary key references public.events (id) on delete cascade,
  sent_at     timestamptz not null default now()
);

alter table public.event_kind_materials   enable row level security;
alter table public.event_materials        enable row level security;
-- Written and read only by the notifier (service role).
alter table public.event_material_notices enable row level security;

create policy "event_kind_materials: sales read" on public.event_kind_materials for select to authenticated
  using ((select public.is_sales()) or (select public.is_marketing()));
create policy "event_kind_materials: admin writes" on public.event_kind_materials for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

create policy "event_materials: sales all" on public.event_materials for all to authenticated
  using ((select public.is_sales())) with check ((select public.is_sales()));
create policy "event_materials: marketing read" on public.event_materials for select to authenticated
  using ((select public.is_marketing()));

grant select on public.event_kind_materials to authenticated;
grant insert, update, delete on public.event_kind_materials to authenticated;
grant select, insert, update, delete on public.event_materials to authenticated;

/* The kind's standard material onto an event; what it already has stays. */
create or replace function public.event_copy_kind_materials(p_event_id uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare v_n int;
begin
  if not public.is_sales() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  insert into public.event_materials (event_id, name, quantity, sort_order)
  select e.id, m.name, m.quantity, m.sort_order
    from public.events e
    join public.event_kind_materials m on m.kind_id = e.kind_id
   where e.id = p_event_id
     and not exists (
       select 1 from public.event_materials x
        where x.event_id = e.id and lower(btrim(x.name)) = lower(btrim(m.name))
     );
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke all on function public.event_copy_kind_materials(uuid) from public, anon;
grant execute on function public.event_copy_kind_materials(uuid) to authenticated;

/* A new event starts with its kind's standard material. */
create or replace function public.event_materials_on_create()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.event_materials (event_id, name, quantity, sort_order)
  select new.id, m.name, m.quantity, m.sort_order
    from public.event_kind_materials m
   where m.kind_id = new.kind_id;
  return new;
end;
$$;

create trigger events_copy_materials after insert on public.events
  for each row execute function public.event_materials_on_create();
