-- ============================================================
-- Events: fairs and markets, events with a customer, our own events.
--
--   event_kinds        Admin's list, three languages.
--   event_kind_tasks   each kind's standard tasks, with a deadline counted in
--                      days from the start (negative: before) or after the
--                      end. Copied into an event when it is confirmed.
--   events             what, when (from–to, opening hours), where, with whom,
--                      who is responsible, and its stage:
--                      idea → confirmed → done | cancelled (with a reason).
--   event tasks        planned sales activities with event_id: they appear in
--                      their responsible person's Planning and in Now.
--   event_shifts       who works which day, from when to when — an app user
--                      or a Human Resources worker without an account.
--   event_cost_types   Admin's list; event_costs the lines, CHF, planned and
--                      real.
--
-- For sales (is_sales()): the Ventas team, Admin and Owners.
-- ============================================================

-- ---------- lists ----------

create table public.event_kinds (
  id           uuid primary key default gen_random_uuid(),
  name         text not null check (length(btrim(name)) > 0),
  translations jsonb not null default '{}'::jsonb,
  sort_order   int not null default 100,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table public.event_kind_tasks (
  id           uuid primary key default gen_random_uuid(),
  kind_id      uuid not null references public.event_kinds (id) on delete cascade,
  title        text not null check (length(btrim(title)) > 0),
  translations jsonb not null default '{}'::jsonb,
  -- Days from the start (negative: before it), or after the end.
  anchor       text not null default 'start' check (anchor in ('start', 'end')),
  days         int not null default 0 check (days between -365 and 365),
  sort_order   int not null default 100
);

create table public.event_cost_types (
  id           uuid primary key default gen_random_uuid(),
  name         text not null check (length(btrim(name)) > 0),
  translations jsonb not null default '{}'::jsonb,
  sort_order   int not null default 100,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create trigger event_kinds_set_updated_at before update on public.event_kinds
  for each row execute function public.set_updated_at();
create trigger event_cost_types_set_updated_at before update on public.event_cost_types
  for each row execute function public.set_updated_at();

insert into public.event_kinds (name, translations, sort_order) values
  ('Con un cliente', '{"de": {"name": "Mit einem Kunden"}, "en": {"name": "With a customer"}}', 10),
  ('Feria o mercado', '{"de": {"name": "Messe oder Markt"}, "en": {"name": "Fair or market"}}', 20),
  ('Evento propio', '{"de": {"name": "Eigene Veranstaltung"}, "en": {"name": "Our own event"}}', 30);

insert into public.event_cost_types (name, translations, sort_order) values
  ('Stand / cuota', '{"de": {"name": "Stand / Gebühr"}, "en": {"name": "Stand / fee"}}', 10),
  ('Viaje', '{"de": {"name": "Reise"}, "en": {"name": "Travel"}}', 20),
  ('Alojamiento', '{"de": {"name": "Unterkunft"}, "en": {"name": "Accommodation"}}', 30),
  ('Muestras', '{"de": {"name": "Muster"}, "en": {"name": "Samples"}}', 40),
  ('Material e impresión', '{"de": {"name": "Material und Druck"}, "en": {"name": "Material and printing"}}', 50),
  ('Otro', '{"de": {"name": "Anderes"}, "en": {"name": "Other"}}', 90);

-- ---------- the events ----------

create table public.events (
  id            uuid primary key default gen_random_uuid(),
  kind_id       uuid not null references public.event_kinds (id) on delete restrict,
  name          text not null check (length(btrim(name)) > 0),
  stage         text not null default 'idea' check (stage in ('idea', 'confirmed', 'done', 'cancelled')),
  cancel_reason text,
  start_date    date not null,
  end_date      date not null,
  open_time     time,
  close_time    time,
  place_name    text,
  street        text,
  postal_code   text,
  city          text,
  latitude      double precision,
  longitude     double precision,
  customer_id   uuid references public.customers (id) on delete set null,
  owner_id      uuid references public.profiles (id) on delete set null,
  description   text,
  created_by    uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint events_dates check (end_date >= start_date),
  constraint events_cancel_reason check (stage <> 'cancelled' or (cancel_reason is not null and length(btrim(cancel_reason)) > 0))
);

create index events_dates_idx on public.events (start_date, end_date);

create trigger events_set_updated_at before update on public.events
  for each row execute function public.set_updated_at();

/* The responsible person is someone in sales. */
create or replace function public.guard_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.owner_id is not null
     and (tg_op = 'INSERT' or new.owner_id is distinct from old.owner_id)
     and not exists (
       select 1 from public.profiles p
        where p.id = new.owner_id and p.status = 'approved'
          and (p.team = 'sales' or p.role in ('admin', 'owner'))
     ) then
    raise exception 'owner_not_sales' using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger events_guard
  before insert or update on public.events
  for each row execute function public.guard_event();

-- Tasks are planned sales activities of the event.
alter table public.sales_activities add column event_id uuid references public.events (id) on delete cascade;
create index sales_activities_event_idx on public.sales_activities (event_id);

-- The kind an event task is planned as: plain, renamable, like any other.
insert into public.sales_activity_kinds (slug, name, translations, icon, behavior, sort_order, default_minutes)
values ('event_task', 'Tarea de evento', '{"de": {"name": "Veranstaltungsaufgabe"}, "en": {"name": "Event task"}}', 'star', 'plain', 70, 30)
on conflict (slug) do nothing;

create table public.event_shifts (
  id            uuid primary key default gen_random_uuid(),
  event_id      uuid not null references public.events (id) on delete cascade,
  shift_date    date not null,
  start_time    time,
  end_time      time,
  -- An app user, or a worker without an account.
  profile_id    uuid references public.profiles (id) on delete cascade,
  hr_worker_id  uuid references public.hr_workers (id) on delete cascade,
  note          text,
  created_at    timestamptz not null default now(),
  constraint event_shifts_one_person check ((profile_id is null) <> (hr_worker_id is null)),
  constraint event_shifts_times check (end_time is null or (start_time is not null and end_time > start_time))
);

create index event_shifts_event_idx on public.event_shifts (event_id, shift_date);

create table public.event_costs (
  id             uuid primary key default gen_random_uuid(),
  event_id       uuid not null references public.events (id) on delete cascade,
  type_id        uuid not null references public.event_cost_types (id) on delete restrict,
  description    text,
  planned_amount numeric(12, 2),
  actual_amount  numeric(12, 2),
  created_at     timestamptz not null default now()
);

create index event_costs_event_idx on public.event_costs (event_id);

-- ---------- RLS ----------

alter table public.event_kinds      enable row level security;
alter table public.event_kind_tasks enable row level security;
alter table public.event_cost_types enable row level security;
alter table public.events           enable row level security;
alter table public.event_shifts     enable row level security;
alter table public.event_costs      enable row level security;

create policy "event_kinds: sales read" on public.event_kinds for select to authenticated using ((select public.is_sales()));
create policy "event_kinds: admin writes" on public.event_kinds for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "event_kind_tasks: sales read" on public.event_kind_tasks for select to authenticated using ((select public.is_sales()));
create policy "event_kind_tasks: admin writes" on public.event_kind_tasks for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "event_cost_types: sales read" on public.event_cost_types for select to authenticated using ((select public.is_sales()));
create policy "event_cost_types: admin writes" on public.event_cost_types for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

create policy "events: sales read" on public.events for select to authenticated using ((select public.is_sales()));
create policy "events: sales add" on public.events for insert to authenticated
  with check ((select public.is_sales()) and created_by = (select auth.uid()));
create policy "events: sales change" on public.events for update to authenticated
  using ((select public.is_sales())) with check ((select public.is_sales()));
-- An idea can be thrown away; anything further is cancelled instead, and stays.
create policy "events: remove ideas" on public.events for delete to authenticated
  using ((select public.is_sales()) and stage = 'idea');

create policy "event_shifts: sales all" on public.event_shifts for all to authenticated
  using ((select public.is_sales())) with check ((select public.is_sales()));
create policy "event_costs: sales all" on public.event_costs for all to authenticated
  using ((select public.is_sales())) with check ((select public.is_sales()));

-- ---------- confirming ----------

/*
 * Confirm an idea: the kind's standard tasks become planned activities of
 * the event, for its responsible person, each on its deadline.
 */
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
  return v_n;
end;
$$;

revoke all on function public.event_confirm(uuid) from public, anon;
grant execute on function public.event_confirm(uuid) to authenticated;

/* Workers without an account, for scheduling staff: names only, for sales. */
create or replace function public.event_staff_workers()
returns table (id uuid, name text, team public.team)
language sql
stable
security definer
set search_path = ''
as $$
  select w.id, w.name, w.team
    from public.hr_workers w
   where w.is_active and w.profile_id is null and public.is_sales()
   order by w.name;
$$;

revoke all on function public.event_staff_workers() from public, anon;
grant execute on function public.event_staff_workers() to authenticated;
