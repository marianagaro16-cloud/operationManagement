-- The Palomo: its rounds and what it costs (decided 2026-10-23).
--
-- So that, later, other routes — in Zurich and in other cities — can be
-- planned from real figures: how long a round takes, how many km, what a km
-- costs. Not to watch the driver.
--
--   * A round: "Salgo" and "Regresé a la fábrica", each with the odometer.
--     Logística taps them (and whoever covers someone in Logística); the
--     driver corrects their own the same day, the office (Owners, Admin,
--     Power User) any day, and every correction is kept.
--   * Costs: fuel, parking, tolls and fines from the driver's phone, with a
--     photo of the receipt; insurance, tax, vignette and washing from the
--     office.
--   * Maintenance stays in Mantenimiento: the Palomo is an item of its
--     equipment list, so its planned work and its repairs (with their cost)
--     are that item's history.
--   * The office sees everything; the driver only their own rounds and costs.

-- ---------- the vehicle, as equipment ----------

alter table public.equipment add column if not exists is_vehicle boolean not null default false;
comment on column public.equipment.is_vehicle is
  'A vehicle of ours: its rounds and costs are kept (vehicle_trips, vehicle_costs).';

insert into public.equipment (name, notes, is_vehicle)
values ('Palomo', 'Furgoneta de reparto propia.', true)
on conflict ((lower(btrim(name)))) do update set is_vehicle = true;

-- ---------- who ----------

-- Owners, Admin and the Power User: everything, any day.
create or replace function public.vehicle_office()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles p
     where p.id = (select auth.uid()) and p.status = 'approved' and p.role in ('owner', 'admin', 'power_user')
  );
$$;

-- Who drives: Logística, or whoever covers someone in Logística right now.
create or replace function public.vehicle_driver()
returns boolean language sql stable security definer set search_path = '' as $$
  select 'logistics' = any (public.my_teams())
      or exists (select 1 from public.profiles p where p.team = 'logistics' and p.status = 'approved' and public.covering_for(p.id));
$$;

revoke all on function public.vehicle_office() from public, anon;
revoke all on function public.vehicle_driver() from public, anon;
grant execute on function public.vehicle_office() to authenticated;
grant execute on function public.vehicle_driver() to authenticated;

-- ---------- rounds ----------

create table public.vehicle_trips (
  id           uuid primary key default gen_random_uuid(),
  vehicle_id   uuid not null references public.equipment (id),
  trip_date    date not null default ((now() at time zone 'Europe/Zurich')::date),
  driver_id    uuid not null default auth.uid() references public.profiles (id),
  left_at      timestamptz not null,
  left_km      integer not null check (left_km >= 0),
  returned_at  timestamptz,
  returned_km  integer check (returned_km >= 0),
  note         text check (length(note) <= 1000),
  created_by   uuid default auth.uid() references public.profiles (id),
  updated_by   uuid references public.profiles (id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint vehicle_trips_back_whole check ((returned_at is null) = (returned_km is null)),
  constraint vehicle_trips_back_after check (returned_at is null or returned_at > left_at),
  constraint vehicle_trips_km_forward check (returned_km is null or returned_km >= left_km)
);
create index vehicle_trips_vehicle_date_idx on public.vehicle_trips (vehicle_id, trip_date);
create index vehicle_trips_driver_idx on public.vehicle_trips (driver_id, trip_date);
-- One round out at a time per vehicle.
create unique index vehicle_trips_one_out on public.vehicle_trips (vehicle_id) where returned_at is null;

create trigger vehicle_trips_set_updated_at before update on public.vehicle_trips
  for each row execute function public.set_updated_at();

alter table public.vehicle_trips enable row level security;

create policy "vehicle_trips: read" on public.vehicle_trips for select to authenticated
  using ((select public.vehicle_office()) or driver_id = (select auth.uid()));
create policy "vehicle_trips: start" on public.vehicle_trips for insert to authenticated
  with check ((select public.vehicle_office()) or ((select public.vehicle_driver()) and driver_id = (select auth.uid())));
create policy "vehicle_trips: correct" on public.vehicle_trips for update to authenticated
  using ((select public.vehicle_office())
         or (driver_id = (select auth.uid()) and trip_date = (now() at time zone 'Europe/Zurich')::date and (select public.vehicle_driver())))
  with check ((select public.vehicle_office())
         or (driver_id = (select auth.uid()) and trip_date = (now() at time zone 'Europe/Zurich')::date));
create policy "vehicle_trips: office deletes" on public.vehicle_trips for delete to authenticated
  using ((select public.vehicle_office()));

grant select, insert, update, delete on public.vehicle_trips to authenticated;

-- Every correction, kept: what it said before and after, and who changed it.
create table public.vehicle_trip_changes (
  id         uuid primary key default gen_random_uuid(),
  trip_id    uuid not null references public.vehicle_trips (id) on delete cascade,
  actor_id   uuid references public.profiles (id),
  before     jsonb not null,
  after      jsonb not null,
  changed_at timestamptz not null default now()
);
create index vehicle_trip_changes_trip_idx on public.vehicle_trip_changes (trip_id);
alter table public.vehicle_trip_changes enable row level security;
create policy "vehicle_trip_changes: office reads" on public.vehicle_trip_changes for select to authenticated
  using ((select public.vehicle_office()));
grant select on public.vehicle_trip_changes to authenticated;

create or replace function public.log_vehicle_trip_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_before jsonb := jsonb_build_object('left_at', old.left_at, 'left_km', old.left_km, 'returned_at', old.returned_at, 'returned_km', old.returned_km, 'note', old.note);
  v_after  jsonb := jsonb_build_object('left_at', new.left_at, 'left_km', new.left_km, 'returned_at', new.returned_at, 'returned_km', new.returned_km, 'note', new.note);
begin
  -- Coming back is the round's second tap, not a correction.
  if old.returned_at is null and new.returned_at is not null
     and new.left_at = old.left_at and new.left_km = old.left_km and new.note is not distinct from old.note then
    return new;
  end if;
  if v_before <> v_after then
    insert into public.vehicle_trip_changes (trip_id, actor_id, before, after)
    values (new.id, (select auth.uid()), v_before, v_after);
  end if;
  return new;
end $$;

create trigger vehicle_trips_log after update on public.vehicle_trips
  for each row execute function public.log_vehicle_trip_change();

-- ---------- costs ----------

create table public.vehicle_costs (
  id           uuid primary key default gen_random_uuid(),
  vehicle_id   uuid not null references public.equipment (id),
  kind         text not null check (kind in ('fuel', 'parking', 'toll', 'fine', 'insurance', 'tax', 'vignette', 'washing', 'other')),
  spent_on     date not null default ((now() at time zone 'Europe/Zurich')::date),
  amount       numeric(10, 2) not null check (amount > 0),
  litres       numeric(8, 2) check (litres > 0),
  odometer_km  integer check (odometer_km >= 0),
  note         text check (length(note) <= 1000),
  receipt_path text,
  created_by   uuid not null default auth.uid() references public.profiles (id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint vehicle_costs_litres_fuel check (litres is null or kind = 'fuel')
);
create index vehicle_costs_vehicle_date_idx on public.vehicle_costs (vehicle_id, spent_on);

create trigger vehicle_costs_set_updated_at before update on public.vehicle_costs
  for each row execute function public.set_updated_at();

alter table public.vehicle_costs enable row level security;

-- What the driver pays on the road.
create or replace function public.vehicle_driver_cost(p_kind text)
returns boolean language sql immutable set search_path = '' as $$
  select p_kind in ('fuel', 'parking', 'toll', 'fine');
$$;

create policy "vehicle_costs: read" on public.vehicle_costs for select to authenticated
  using ((select public.vehicle_office()) or created_by = (select auth.uid()));
create policy "vehicle_costs: enter" on public.vehicle_costs for insert to authenticated
  with check ((select public.vehicle_office())
              or ((select public.vehicle_driver()) and created_by = (select auth.uid()) and public.vehicle_driver_cost(kind)));
create policy "vehicle_costs: correct" on public.vehicle_costs for update to authenticated
  using ((select public.vehicle_office())
         or (created_by = (select auth.uid()) and spent_on = (now() at time zone 'Europe/Zurich')::date))
  with check ((select public.vehicle_office())
         or (created_by = (select auth.uid()) and spent_on = (now() at time zone 'Europe/Zurich')::date and public.vehicle_driver_cost(kind)));
create policy "vehicle_costs: remove" on public.vehicle_costs for delete to authenticated
  using ((select public.vehicle_office())
         or (created_by = (select auth.uid()) and spent_on = (now() at time zone 'Europe/Zurich')::date));

grant select, insert, update, delete on public.vehicle_costs to authenticated;

-- ---------- receipts ----------

-- Each person uploads into their own folder: <their id>/<file>.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('vehicle-receipts', 'vehicle-receipts', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf'])
on conflict (id) do nothing;

create policy "vehicle receipts: read" on storage.objects for select to authenticated
  using (bucket_id = 'vehicle-receipts'
         and ((select public.vehicle_office()) or (storage.foldername(name))[1] = (select auth.uid())::text));
create policy "vehicle receipts: upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'vehicle-receipts'
              and ((select public.vehicle_office()) or (select public.vehicle_driver()))
              and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "vehicle receipts: remove" on storage.objects for delete to authenticated
  using (bucket_id = 'vehicle-receipts'
         and ((select public.vehicle_office()) or (storage.foldername(name))[1] = (select auth.uid())::text));
