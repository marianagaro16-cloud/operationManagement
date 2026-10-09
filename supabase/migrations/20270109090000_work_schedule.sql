-- ============================================================
-- The weekly work schedule (decided 2026-10-09).
--
-- Mariana made it in Excel — four sheets reused week after week, so a past
-- week survived only as the PDF shared in Basecamp. Here a week is a record:
-- Sunday to Saturday, one row per person, up to two blocks a day, each of a
-- kind (no kind = production). Published in versions; what changed after a
-- version is worked out against it, never typed in.
--
-- Who: Admin and Owners write it. The Production manager reads it. Nobody
-- else sees it — the floor gets the PDF.
--
-- The people on it are worker files, or external help by name (an agency, a
-- temp) with no file. The Sunday and holiday register is kept with it: who
-- came, in which order the turn goes round, and what is planned ahead.
-- ============================================================

/* Reads the schedule: Admin, Owners and the Production manager. */
create or replace function public.schedule_can_read()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_approved() and (
    public.is_admin()
    or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'production_manager')
  );
$$;

revoke all on function public.schedule_can_read() from public, anon;
grant execute on function public.schedule_can_read() to authenticated;

-- ------------------------------------------------------------
-- The lists: kinds of block, and what is produced on a day.
-- ------------------------------------------------------------

create table public.schedule_kinds (
  id           uuid primary key default gen_random_uuid(),
  name         text not null check (length(btrim(name)) > 0),
  -- '#RRGGBB', as drawn in the grid and on the PDF.
  color        text not null check (color ~ '^#[0-9A-Fa-f]{6}$'),
  -- Hatched, as the Excel drew the days nobody works.
  hatched      boolean not null default false,
  -- False for a day off: its hours are not working time.
  counts_hours boolean not null default true,
  -- The three the app itself knows; they cannot be removed.
  system_key   text unique check (system_key in ('vacation', 'free', 'sick')),
  sort_order   integer not null default 0,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint schedule_kinds_off check (system_key is null or not counts_hours)
);

create trigger schedule_kinds_set_updated_at before update on public.schedule_kinds
  for each row execute function public.set_updated_at();

insert into public.schedule_kinds (name, color, hatched, counts_hours, system_key, sort_order) values
  ('Vacaciones',            '#C6E0B4', true,  false, 'vacation', 10),
  ('Libre',                 '#595959', true,  false, 'free',     20),
  ('Oficina',               '#FF91ED', false, true,  null,       30),
  ('Enfermedad',            '#C0504D', true,  false, 'sick',     40),
  ('Entregas',              '#F8CBAD', false, true,  null,       50),
  ('Cocción de maíz',       '#FFE699', false, true,  null,       60),
  ('Limpieza',              '#84E8E8', false, true,  null,       70),
  ('Mantenimiento',         '#B4C6E7', false, true,  null,       80),
  ('Actividades diversas',  '#9EF830', false, true,  null,       90);

create table public.schedule_products (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (length(btrim(name)) > 0),
  sort_order integer not null default 0,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger schedule_products_set_updated_at before update on public.schedule_products
  for each row execute function public.set_updated_at();

insert into public.schedule_products (name, sort_order) values
  ('Chip', 10), ('Bio', 20), ('Azul', 30), ('Bio Fresco', 40), ('Mesa', 50);

-- ------------------------------------------------------------
-- Who is on the schedule.
-- ------------------------------------------------------------

create table public.schedule_people (
  id            uuid primary key default gen_random_uuid(),
  worker_id     uuid unique references public.hr_workers (id) on delete restrict,
  -- External help: an agency or a temp, by name, without a file.
  external_name text,
  sort_order    integer not null default 0,
  -- The contract's share, and the week's bounds: under or over is a warning.
  percent       integer check (percent between 1 and 100),
  min_hours     numeric(5, 2) check (min_hours >= 0),
  max_hours     numeric(5, 2) check (max_hours >= 0),
  -- Counts as a production lead: one must be there every working day.
  is_lead       boolean not null default false,
  -- Takes a turn on Sundays and holidays, in this order.
  in_sunday_rotation boolean not null default false,
  sunday_order  integer not null default 0,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  -- A file or a name, never both.
  constraint schedule_people_who check ((worker_id is null) <> (length(btrim(coalesce(external_name, ''))) = 0)),
  constraint schedule_people_bounds check (min_hours is null or max_hours is null or max_hours >= min_hours)
);

create trigger schedule_people_set_updated_at before update on public.schedule_people
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------
-- A week, and its blocks.
-- ------------------------------------------------------------

create table public.schedule_weeks (
  id          uuid primary key default gen_random_uuid(),
  -- The Sunday it starts on. Null only for the usual week new ones can start from.
  week_start  date unique,
  is_pattern  boolean not null default false,
  -- The last published version; 0 while it is still a draft.
  version     integer not null default 0 check (version >= 0),
  published_at timestamptz,
  published_by uuid references public.profiles (id) on delete set null,
  -- Per day, 0 = Sunday … 6 = Saturday: {"1": ["<product id>"]}, {"1": "Fritura Jorge"}.
  day_products jsonb not null default '{}'::jsonb,
  day_notes    jsonb not null default '{}'::jsonb,
  -- Days of this week that are public holidays (0–6).
  holidays     smallint[] not null default '{}',
  cleaning_bathroom uuid references public.schedule_people (id) on delete set null,
  cleaning_kitchen  uuid references public.schedule_people (id) on delete set null,
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint schedule_weeks_kind check (
    (is_pattern and week_start is null and version = 0)
    or (not is_pattern and week_start is not null and extract(dow from week_start) = 0)
  )
);

create unique index schedule_weeks_one_pattern on public.schedule_weeks (is_pattern) where is_pattern;

create trigger schedule_weeks_set_updated_at before update on public.schedule_weeks
  for each row execute function public.set_updated_at();

create table public.schedule_blocks (
  id         uuid primary key default gen_random_uuid(),
  week_id    uuid not null references public.schedule_weeks (id) on delete cascade,
  person_id  uuid not null references public.schedule_people (id) on delete restrict,
  day        smallint not null check (day between 0 and 6),
  slot       smallint not null check (slot in (1, 2)),
  -- No times: the whole day, for a day off.
  start_time time,
  end_time   time,
  -- Null = production.
  kind_id    uuid references public.schedule_kinds (id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (week_id, person_id, day, slot),
  constraint schedule_blocks_times check ((start_time is null) = (end_time is null) and (start_time is null or end_time > start_time)),
  -- Production needs its hours.
  constraint schedule_blocks_production check (kind_id is not null or start_time is not null)
);

create index schedule_blocks_person_idx on public.schedule_blocks (person_id);

/* What a week was each time it was published. */
create table public.schedule_week_versions (
  week_id      uuid not null references public.schedule_weeks (id) on delete cascade,
  version      integer not null check (version >= 1),
  published_at timestamptz not null default now(),
  published_by uuid references public.profiles (id) on delete set null,
  snapshot     jsonb not null,
  primary key (week_id, version)
);

-- ------------------------------------------------------------
-- Sundays and holidays: who came, and who is planned.
-- ------------------------------------------------------------

create table public.schedule_sunday_duty (
  id          uuid primary key default gen_random_uuid(),
  duty_date   date not null,
  person_id   uuid references public.schedule_people (id) on delete set null,
  -- As written, so a person who left stays in the record.
  person_name text not null check (length(btrim(person_name)) > 0),
  note        text,
  -- planned = set ahead by hand; schedule = taken from a published week; import = from the Excel.
  origin      text not null default 'planned' check (origin in ('planned', 'schedule', 'import')),
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now()
);

create index schedule_sunday_duty_date_idx on public.schedule_sunday_duty (duty_date);

-- ------------------------------------------------------------
-- Access: read by schedule_can_read(), written by Admin and Owners.
-- ------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array['schedule_kinds', 'schedule_products', 'schedule_people', 'schedule_weeks', 'schedule_blocks', 'schedule_week_versions', 'schedule_sunday_duty']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "%s: read" on public.%I for select to authenticated using ((select public.schedule_can_read()))', t, t);
    execute format('create policy "%s: admin writes" on public.%I for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()))', t, t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

/*
 * The agreed start of a worker on a day: the first working block of a
 * published week. For the arrivals form, which whoever keeps the worker's file
 * fills in — so it answers by the file's access, not the schedule's.
 */
create or replace function public.schedule_start_time(p_worker_id uuid, p_date date)
returns time
language sql
stable
security definer
set search_path = ''
as $$
  select min(b.start_time)
  from public.schedule_blocks b
  join public.schedule_weeks w on w.id = b.week_id
  join public.schedule_people p on p.id = b.person_id
  left join public.schedule_kinds k on k.id = b.kind_id
  where public.hr_can_worker(p_worker_id)
    and p.worker_id = p_worker_id
    and w.version >= 1
    and w.week_start = p_date - extract(dow from p_date)::int
    and b.day = extract(dow from p_date)::int
    and b.start_time is not null
    and coalesce(k.counts_hours, true);
$$;

revoke all on function public.schedule_start_time(uuid, date) from public, anon;
grant execute on function public.schedule_start_time(uuid, date) to authenticated;
