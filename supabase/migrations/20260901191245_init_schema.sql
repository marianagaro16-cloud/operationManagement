-- ============================================================
-- Operation Manager :: initial schema
-- ============================================================

-- ---------- enums ----------
create type public.project_status as enum
  ('planning', 'active', 'on_hold', 'completed', 'cancelled');

create type public.task_status as enum
  ('todo', 'in_progress', 'blocked', 'done', 'cancelled');

create type public.task_priority as enum
  ('low', 'medium', 'high', 'urgent');

-- ---------- shared updated_at trigger ----------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------- profiles ----------
-- Mirrors auth.users so we can store app-level user data.
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  full_name   text,
  email       text,
  role        text        not null default 'member',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Auto-create a profile row whenever a user signs up.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data ->> 'full_name'
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- clients ----------
create table public.clients (
  id             uuid primary key default gen_random_uuid(),
  name           text        not null,
  contact_email  text,
  contact_phone  text,
  notes          text,
  created_by     uuid        not null references auth.users (id) on delete cascade,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- ---------- projects ----------
create table public.projects (
  id           uuid primary key default gen_random_uuid(),
  name         text                  not null,
  description  text,
  status       public.project_status not null default 'planning',
  client_id    uuid references public.clients (id) on delete set null,
  owner_id     uuid                  not null references auth.users (id) on delete cascade,
  start_date   date,
  due_date     date,
  created_at   timestamptz           not null default now(),
  updated_at   timestamptz           not null default now(),
  constraint projects_dates_valid
    check (due_date is null or start_date is null or due_date >= start_date)
);

-- ---------- tasks ----------
create table public.tasks (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid                  not null references public.projects (id) on delete cascade,
  title        text                  not null,
  description  text,
  status       public.task_status    not null default 'todo',
  priority     public.task_priority  not null default 'medium',
  assignee_id  uuid references auth.users (id) on delete set null,
  due_date     date,
  created_at   timestamptz           not null default now(),
  updated_at   timestamptz           not null default now()
);

-- ---------- indexes ----------
create index clients_created_by_idx  on public.clients  (created_by);
create index projects_owner_id_idx   on public.projects (owner_id);
create index projects_client_id_idx  on public.projects (client_id);
create index projects_status_idx     on public.projects (status);
create index tasks_project_id_idx    on public.tasks    (project_id);
create index tasks_assignee_id_idx   on public.tasks    (assignee_id);
create index tasks_status_idx        on public.tasks    (status);

-- ---------- updated_at triggers ----------
create trigger profiles_set_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();
create trigger clients_set_updated_at before update on public.clients
  for each row execute function public.set_updated_at();
create trigger projects_set_updated_at before update on public.projects
  for each row execute function public.set_updated_at();
create trigger tasks_set_updated_at before update on public.tasks
  for each row execute function public.set_updated_at();

-- ============================================================
-- Row Level Security
--
-- Model: any signed-in user can READ everything (internal ops
-- tool). WRITES are restricted to the owner/creator of a record,
-- plus task assignees on tasks assigned to them.
-- Tighten or loosen these to match your real access rules.
-- ============================================================

alter table public.profiles enable row level security;
alter table public.clients  enable row level security;
alter table public.projects enable row level security;
alter table public.tasks    enable row level security;

-- profiles
create policy "profiles readable by authenticated"
  on public.profiles for select to authenticated
  using (true);

create policy "profiles updatable by self"
  on public.profiles for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- clients
create policy "clients readable by authenticated"
  on public.clients for select to authenticated
  using (true);

create policy "clients insertable by creator"
  on public.clients for insert to authenticated
  with check ((select auth.uid()) = created_by);

create policy "clients updatable by creator"
  on public.clients for update to authenticated
  using ((select auth.uid()) = created_by)
  with check ((select auth.uid()) = created_by);

create policy "clients deletable by creator"
  on public.clients for delete to authenticated
  using ((select auth.uid()) = created_by);

-- projects
create policy "projects readable by authenticated"
  on public.projects for select to authenticated
  using (true);

create policy "projects insertable by owner"
  on public.projects for insert to authenticated
  with check ((select auth.uid()) = owner_id);

create policy "projects updatable by owner"
  on public.projects for update to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

create policy "projects deletable by owner"
  on public.projects for delete to authenticated
  using ((select auth.uid()) = owner_id);

-- tasks (project owner or the assignee may write)
create policy "tasks readable by authenticated"
  on public.tasks for select to authenticated
  using (true);

create policy "tasks insertable by project owner"
  on public.tasks for insert to authenticated
  with check (
    exists (
      select 1 from public.projects p
      where p.id = project_id
        and p.owner_id = (select auth.uid())
    )
  );

create policy "tasks updatable by project owner or assignee"
  on public.tasks for update to authenticated
  using (
    assignee_id = (select auth.uid())
    or exists (
      select 1 from public.projects p
      where p.id = project_id
        and p.owner_id = (select auth.uid())
    )
  )
  with check (
    assignee_id = (select auth.uid())
    or exists (
      select 1 from public.projects p
      where p.id = project_id
        and p.owner_id = (select auth.uid())
    )
  );

create policy "tasks deletable by project owner"
  on public.tasks for delete to authenticated
  using (
    exists (
      select 1 from public.projects p
      where p.id = project_id
        and p.owner_id = (select auth.uid())
    )
  );
