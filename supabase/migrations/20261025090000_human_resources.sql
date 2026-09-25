-- ============================================================
-- Recursos humanos: a file for every worker.
--
-- A worker is NOT an app account. Some people on the floor never log in, and
-- their file matters just as much, so hr_workers stands on its own and may
-- point at a profile when the person also uses the app — which is what lets
-- the file show what they did here.
--
--   hr_workers           who they are: team, position, start date, contact,
--                        and whether they still work here.
--   hr_note_types        Recognition, Warning, Conversation... — Admin's list.
--   hr_notes             the log. PERMANENT: no update or delete, for anyone.
--                        A correction is a new note, so a file cannot be
--                        rewritten before an evaluation.
--   hr_note_attachments  files on a note (photo, PDF), added when it is written.
--   hr_criteria          what an evaluation rates, per team — Admin's list.
--   hr_evaluations       an evaluation, and hr_evaluation_scores its 1-5
--                        ratings. Permanent, like the notes; each score keeps
--                        the criterion's name as it was.
--
-- Who: hr.manage — Manager and Production manager by default, Admin always.
-- A Production manager sees and writes only Production's workers, the same
-- scope incident_scope() already gives them. The lists are Admin's alone.
-- ============================================================

-- ---------- permission ----------

insert into public.permission_catalog (key, module, is_configurable, sort_order) values
  ('hr.manage', 'hr', true, 199)
on conflict (key) do nothing;

insert into public.role_permissions (role, permission) values
  ('manager', 'hr.manage'),
  ('production_manager', 'hr.manage')
on conflict do nothing;

-- ---------- scope ----------

/* The team whose files the caller may see; NULL = every team. */
create or replace function public.hr_scope()
returns public.team
language sql
stable
security definer
set search_path = ''
as $$
  select public.incident_scope();
$$;

/* May the caller read and write files of this team? */
create or replace function public.hr_can(p_team public.team)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_permission('hr.manage')
     and coalesce(public.hr_scope() = p_team, true);
$$;

-- ---------- workers ----------

create table public.hr_workers (
  id                uuid primary key default gen_random_uuid(),
  -- The app account, when they have one. One file per account.
  profile_id        uuid unique references public.profiles (id) on delete set null,
  name              text not null check (length(btrim(name)) > 0),
  team              public.team not null,
  position          text,
  start_date        date,
  phone             text,
  email             text,
  address           text,
  emergency_contact text,
  is_active         boolean not null default true,
  left_on           date,
  created_by        uuid references public.profiles (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index hr_workers_team_idx on public.hr_workers (team, is_active);

create trigger hr_workers_set_updated_at
  before update on public.hr_workers
  for each row execute function public.set_updated_at();

/* ...of this worker? */
create or replace function public.hr_can_worker(p_worker_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.hr_workers w
     where w.id = p_worker_id and public.hr_can(w.team)
  );
$$;

-- ---------- note types (Admin's list) ----------

create table public.hr_note_types (
  id         uuid primary key default gen_random_uuid(),
  slug       text not null unique,
  name       text not null check (length(btrim(name)) > 0),
  sort_order int not null default 100,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger hr_note_types_set_updated_at
  before update on public.hr_note_types
  for each row execute function public.set_updated_at();

insert into public.hr_note_types (slug, name, sort_order) values
  ('recognition',  'Reconocimiento',           10),
  ('warning',      'Advertencia',              20),
  ('conversation', 'Conversación / Feedback',  30),
  ('training',     'Formación',                40),
  ('other',        'Otro',                     90)
on conflict (slug) do nothing;

-- ---------- the log ----------

create table public.hr_notes (
  id         uuid primary key default gen_random_uuid(),
  worker_id  uuid not null references public.hr_workers (id) on delete cascade,
  type_id    uuid not null references public.hr_note_types (id) on delete restrict,
  note_date  date not null,
  body       text not null check (length(btrim(body)) > 0),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create index hr_notes_worker_idx on public.hr_notes (worker_id, note_date desc);

create table public.hr_note_attachments (
  id           uuid primary key default gen_random_uuid(),
  note_id      uuid not null references public.hr_notes (id) on delete cascade,
  storage_path text not null unique,
  file_name    text not null,
  mime_type    text not null,
  size_bytes   int not null check (size_bytes > 0),
  uploaded_by  uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now()
);

create index hr_note_attachments_note_idx on public.hr_note_attachments (note_id);

-- ---------- evaluation criteria (Admin's list, per team) ----------

create table public.hr_criteria (
  id          uuid primary key default gen_random_uuid(),
  team        public.team not null,
  name        text not null check (length(btrim(name)) > 0),
  description text,
  sort_order  int not null default 100,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index hr_criteria_team_idx on public.hr_criteria (team, is_active, sort_order);

create trigger hr_criteria_set_updated_at
  before update on public.hr_criteria
  for each row execute function public.set_updated_at();

-- ---------- evaluations ----------

create table public.hr_evaluations (
  id           uuid primary key default gen_random_uuid(),
  worker_id    uuid not null references public.hr_workers (id) on delete cascade,
  evaluated_on date not null,
  comment      text,
  created_by   uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now()
);

create index hr_evaluations_worker_idx on public.hr_evaluations (worker_id, evaluated_on desc);

create table public.hr_evaluation_scores (
  evaluation_id  uuid not null references public.hr_evaluations (id) on delete cascade,
  criterion_id   uuid references public.hr_criteria (id) on delete set null,
  -- As it was named when rated: a later rename must not change an old evaluation.
  criterion_name text not null,
  score          int not null check (score between 1 and 5),
  sort_order     int not null default 100,
  primary key (evaluation_id, criterion_name)
);

-- ---------- RLS ----------

alter table public.hr_workers           enable row level security;
alter table public.hr_note_types        enable row level security;
alter table public.hr_notes             enable row level security;
alter table public.hr_note_attachments  enable row level security;
alter table public.hr_criteria          enable row level security;
alter table public.hr_evaluations       enable row level security;
alter table public.hr_evaluation_scores enable row level security;

create policy "hr_workers: read" on public.hr_workers
  for select to authenticated using (public.hr_can(team));
create policy "hr_workers: insert" on public.hr_workers
  for insert to authenticated with check (public.hr_can(team));
-- Editable (a new phone, leaving the company) but never deleted: the file stays.
create policy "hr_workers: update" on public.hr_workers
  for update to authenticated using (public.hr_can(team)) with check (public.hr_can(team));

create policy "hr_note_types: read" on public.hr_note_types
  for select to authenticated using ((select public.has_permission('hr.manage')));
create policy "hr_note_types: admin writes" on public.hr_note_types
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

create policy "hr_criteria: read" on public.hr_criteria
  for select to authenticated using ((select public.has_permission('hr.manage')));
create policy "hr_criteria: admin writes" on public.hr_criteria
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

-- Notes and evaluations: read and add. No update or delete policy exists, so
-- nobody — Admin included — can change or remove one through the API.
create policy "hr_notes: read" on public.hr_notes
  for select to authenticated using (public.hr_can_worker(worker_id));
create policy "hr_notes: add" on public.hr_notes
  for insert to authenticated
  with check (public.hr_can_worker(worker_id) and created_by = (select auth.uid()));

-- Files go on a note while it is being written: by its author, within an hour.
create policy "hr_note_attachments: read" on public.hr_note_attachments
  for select to authenticated
  using (exists (select 1 from public.hr_notes n where n.id = note_id and public.hr_can_worker(n.worker_id)));
create policy "hr_note_attachments: add" on public.hr_note_attachments
  for insert to authenticated
  with check (
    uploaded_by = (select auth.uid())
    and exists (
      select 1 from public.hr_notes n
       where n.id = note_id
         and n.created_by = (select auth.uid())
         and n.created_at > now() - interval '1 hour'
         and public.hr_can_worker(n.worker_id)
    )
  );

create policy "hr_evaluations: read" on public.hr_evaluations
  for select to authenticated using (public.hr_can_worker(worker_id));
create policy "hr_evaluations: add" on public.hr_evaluations
  for insert to authenticated
  with check (public.hr_can_worker(worker_id) and created_by = (select auth.uid()));

create policy "hr_evaluation_scores: read" on public.hr_evaluation_scores
  for select to authenticated
  using (exists (select 1 from public.hr_evaluations e where e.id = evaluation_id and public.hr_can_worker(e.worker_id)));
create policy "hr_evaluation_scores: add" on public.hr_evaluation_scores
  for insert to authenticated
  with check (exists (
    select 1 from public.hr_evaluations e
     where e.id = evaluation_id
       and e.created_by = (select auth.uid())
       and e.created_at > now() - interval '1 hour'
       and public.hr_can_worker(e.worker_id)
  ));

-- ---------- attachment storage ----------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'hr-attachments',
  'hr-attachments',
  false,
  10485760, -- 10 MB
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf']
)
on conflict (id) do nothing;

/* The first path segment is the note id, so access follows the note's worker. */
create or replace function public.hr_can_note(p_note_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.hr_notes n
     where n.id = p_note_id and public.hr_can_worker(n.worker_id)
  );
$$;

create policy "hr attachments: read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'hr-attachments'
    and (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$'
    and public.hr_can_note(((storage.foldername(name))[1])::uuid)
  );

create policy "hr attachments: upload" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'hr-attachments'
    and (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$'
    and public.hr_can_note(((storage.foldername(name))[1])::uuid)
  );

-- ---------- what they did in the app ----------

/*
 * For a worker linked to an app account, what their account did between two
 * business dates (inclusive, Europe/Zurich). NULL for a worker without one.
 */
create or replace function public.hr_worker_stats(p_worker_id uuid, p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_pid   uuid;
  v_team  public.team;
  v_today date := (now() at time zone 'Europe/Zurich')::date;
begin
  select w.profile_id, w.team into v_pid, v_team from public.hr_workers w where w.id = p_worker_id;
  if not found or not public.hr_can(v_team) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if v_pid is null then
    return null;
  end if;

  return jsonb_build_object(
    'activities_completed', (
      select count(*) from public.task_occurrences o
       where o.completed_by = v_pid
         and (o.completed_at at time zone 'Europe/Zurich')::date between p_from and p_to),
    'activities_skipped', (
      select count(*) from public.task_occurrences o
       where o.skipped_by = v_pid
         and (o.skipped_at at time zone 'Europe/Zurich')::date between p_from and p_to),
    -- Their own copies, due in the period and past, still not done.
    'activities_not_done', (
      select count(*) from public.task_occurrences o
       where o.assignee_id = v_pid and o.status = 'pending'
         and o.effective_due_date between p_from and least(p_to, v_today - 1)),
    'incidents_reported', (
      select count(*) from public.incidents i
       where i.created_by = v_pid
         and (i.created_at at time zone 'Europe/Zurich')::date between p_from and p_to),
    'orders_prepared', (
      select count(*) from public.orders o
       where o.ready_by = v_pid
         and (o.ready_at at time zone 'Europe/Zurich')::date between p_from and p_to),
    'orders_shipped', (
      select count(*) from public.orders o
       where o.shipped_by = v_pid
         and (o.shipped_at at time zone 'Europe/Zurich')::date between p_from and p_to),
    'inventories_counted', (
      select count(distinct e.instance_id) from public.inventory_entries e
       where e.created_by = v_pid
         and (e.created_at at time zone 'Europe/Zurich')::date between p_from and p_to),
    'inventory_lines', (
      select count(*) from public.inventory_entries e
       where e.created_by = v_pid
         and (e.created_at at time zone 'Europe/Zurich')::date between p_from and p_to)
  );
end;
$$;

revoke all on function public.hr_scope() from public, anon;
revoke all on function public.hr_can(public.team) from public, anon;
revoke all on function public.hr_can_worker(uuid) from public, anon;
revoke all on function public.hr_can_note(uuid) from public, anon;
revoke all on function public.hr_worker_stats(uuid, date, date) from public, anon;
grant execute on function public.hr_scope() to authenticated;
grant execute on function public.hr_can(public.team) to authenticated;
grant execute on function public.hr_can_worker(uuid) to authenticated;
grant execute on function public.hr_can_note(uuid) to authenticated;
grant execute on function public.hr_worker_stats(uuid, date, date) to authenticated;
