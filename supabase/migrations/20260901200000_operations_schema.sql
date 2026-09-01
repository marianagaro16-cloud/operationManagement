-- ============================================================
-- Operation Manager :: operations task-management schema
--
-- Replaces the placeholder scaffolding from 20260901191245 (which held no
-- data) with the real domain model.
--
-- Central invariant: a TASK DEFINITION is not a TASK OCCURRENCE.
-- One definition generates many occurrences, at most one per recurrence
-- period, enforced by UNIQUE(task_id, period_key).
-- ============================================================

-- ---------- tear down placeholder scaffolding ----------
drop trigger if exists on_auth_user_created on auth.users;
drop table if exists public.tasks cascade;
drop table if exists public.projects cascade;
drop table if exists public.clients cascade;
drop table if exists public.profiles cascade;
drop type if exists public.project_status;
drop type if exists public.task_status;
drop type if exists public.task_priority;

-- ---------- enums ----------
create type public.user_role   as enum ('admin', 'user');
create type public.user_status as enum ('pending', 'approved', 'rejected', 'deactivated');

create type public.task_frequency as enum
  ('daily', 'weekly', 'biweekly', 'monthly', 'semiannual');

create type public.occurrence_status as enum ('pending', 'completed', 'skipped');

-- ---------- shared trigger fn ----------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ============================================================
-- profiles
-- ============================================================
create table public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  email         text        not null,
  name          text,
  role          public.user_role   not null default 'user',
  -- Self-registration must never grant access. New accounts land in 'pending'
  -- and stay inert until an admin approves them.
  status        public.user_status not null default 'pending',
  last_seen_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index profiles_status_idx on public.profiles (status);
create index profiles_role_idx   on public.profiles (role);

create trigger profiles_set_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

-- Mirror new auth users into profiles as PENDING.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, name, status, role)
  values (
    new.id,
    new.email,
    nullif(trim(coalesce(new.raw_user_meta_data ->> 'name', '')), ''),
    'pending',
    'user'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================
-- authorization helpers
--
-- SECURITY DEFINER so they can read profiles without tripping the very RLS
-- policies that call them (which would recurse). search_path is pinned.
-- ============================================================
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid())
      and p.role = 'admin'
      and p.status = 'approved'
  );
$$;

create or replace function public.is_approved()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid())
      and p.status = 'approved'
  );
$$;

-- ============================================================
-- categories
-- ============================================================
create table public.categories (
  id          uuid primary key default gen_random_uuid(),
  -- Stable key used for i18n lookup; `name` is the editable fallback label.
  slug        text        not null unique,
  name        text        not null,
  sort_order  int         not null default 100,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create trigger categories_set_updated_at before update on public.categories
  for each row execute function public.set_updated_at();

-- ============================================================
-- tasks  (TASK DEFINITIONS)
-- ============================================================
create table public.tasks (
  id              uuid primary key default gen_random_uuid(),
  title           text                  not null check (length(trim(title)) > 0),
  description     text,
  category_id     uuid references public.categories (id) on delete set null,
  frequency       public.task_frequency not null,
  -- Validated against a zod discriminated union in the domain layer before it
  -- is written. NULL means "not configured yet" and is surfaced to admins
  -- rather than silently guessed.
  schedule_config jsonb,
  is_skippable    boolean               not null default false,
  -- Soft deletion only: deactivating must never destroy occurrence history.
  is_active       boolean               not null default true,
  created_by      uuid references auth.users (id) on delete set null,
  created_at      timestamptz           not null default now(),
  updated_at      timestamptz           not null default now()
);

-- Idempotency key for the Excel import. Three activities legitimately appear
-- on two sheets at different cadences, so title alone is NOT unique.
create unique index tasks_title_frequency_key
  on public.tasks (lower(btrim(title)), frequency);

create index tasks_frequency_idx on public.tasks (frequency);
create index tasks_active_idx    on public.tasks (is_active);
create index tasks_category_idx  on public.tasks (category_id);
-- Partial index powering the admin "needs configuration" health indicator.
create index tasks_unconfigured_idx on public.tasks (id) where schedule_config is null;

create trigger tasks_set_updated_at before update on public.tasks
  for each row execute function public.set_updated_at();

-- ============================================================
-- task_occurrences  (PERIOD REQUIREMENTS)
-- ============================================================
create table public.task_occurrences (
  id                uuid primary key default gen_random_uuid(),
  task_id           uuid not null references public.tasks (id) on delete cascade,
  -- e.g. 2026-09-01 | 2026-W36 | BW-2026-09-08 | 2026-09 | 2026-H2
  period_key        text not null,
  due_date          date not null,
  -- An admin may move a single occurrence without touching the recurrence
  -- rule that produced it.
  due_date_override date,
  status            public.occurrence_status not null default 'pending',
  completed_by      uuid references auth.users (id) on delete set null,
  completed_at      timestamptz,
  skipped_by        uuid references auth.users (id) on delete set null,
  skipped_at        timestamptz,
  skip_reason       text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  -- THE core invariant: one requirement per task per period.
  constraint task_occurrences_task_period_key unique (task_id, period_key),

  -- A skip is only ever valid with an attributed, non-empty reason.
  constraint occurrence_skip_requires_reason check (
    status <> 'skipped'
    or (skip_reason is not null and length(trim(skip_reason)) > 0
        and skipped_by is not null and skipped_at is not null)
  ),
  constraint occurrence_completion_attributed check (
    status <> 'completed' or (completed_by is not null and completed_at is not null)
  ),
  -- Resolved states are mutually exclusive.
  constraint occurrence_single_resolution check (
    not (completed_at is not null and skipped_at is not null)
  )
);

-- The date the UI actually sorts and filters on.
create index occurrences_due_idx      on public.task_occurrences (due_date);
create index occurrences_status_idx   on public.task_occurrences (status);
create index occurrences_task_idx     on public.task_occurrences (task_id);
create index occurrences_open_due_idx on public.task_occurrences (due_date)
  where status = 'pending';

create trigger occurrences_set_updated_at before update on public.task_occurrences
  for each row execute function public.set_updated_at();

-- ============================================================
-- task_comments
--
-- Attached to an occurrence (the operational event) but denormalised with
-- task_id so a definition's whole history is one indexed read.
-- ============================================================
create table public.task_comments (
  id            uuid primary key default gen_random_uuid(),
  occurrence_id uuid not null references public.task_occurrences (id) on delete cascade,
  task_id       uuid not null references public.tasks (id) on delete cascade,
  user_id       uuid not null references auth.users (id) on delete cascade,
  body          text not null check (length(trim(body)) > 0),
  created_at    timestamptz not null default now()
);

create index comments_occurrence_idx on public.task_comments (occurrence_id, created_at);
create index comments_task_idx       on public.task_comments (task_id, created_at);

-- ============================================================
-- Row Level Security
--
-- Frontend role checks are cosmetic. These policies are the real boundary.
-- Note that users get NO direct UPDATE on occurrences: every state change
-- goes through the SECURITY DEFINER functions below, which is what makes the
-- business rules (skip needs a reason, skip needs permission) unbypassable.
-- ============================================================
alter table public.profiles         enable row level security;
alter table public.categories       enable row level security;
alter table public.tasks            enable row level security;
alter table public.task_occurrences enable row level security;
alter table public.task_comments    enable row level security;

-- ---------- profiles ----------
-- Always able to read your own row, so a pending user can discover they are
-- pending without being able to see the team.
create policy "profiles: read own"
  on public.profiles for select to authenticated
  using (id = (select auth.uid()));

create policy "profiles: approved read team"
  on public.profiles for select to authenticated
  using (public.is_approved());

create policy "profiles: admin reads all"
  on public.profiles for select to authenticated
  using (public.is_admin());

-- Only admins change role/status. No self-service profile editing in V1.
create policy "profiles: admin updates"
  on public.profiles for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ---------- categories ----------
create policy "categories: approved read"
  on public.categories for select to authenticated
  using (public.is_approved());

create policy "categories: admin writes"
  on public.categories for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ---------- tasks (definitions) ----------
-- Users may READ definitions but never write them.
create policy "tasks: approved read"
  on public.tasks for select to authenticated
  using (public.is_approved());

create policy "tasks: admin writes"
  on public.tasks for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ---------- task_occurrences ----------
create policy "occurrences: approved read"
  on public.task_occurrences for select to authenticated
  using (public.is_approved());

-- Deliberately admin-only at the table level. Users act via RPC.
create policy "occurrences: admin writes"
  on public.task_occurrences for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ---------- task_comments ----------
create policy "comments: approved read"
  on public.task_comments for select to authenticated
  using (public.is_approved());

-- You may only post as yourself.
create policy "comments: approved insert own"
  on public.task_comments for insert to authenticated
  with check (public.is_approved() and user_id = (select auth.uid()));

create policy "comments: author or admin deletes"
  on public.task_comments for delete to authenticated
  using (user_id = (select auth.uid()) or public.is_admin());

-- ============================================================
-- Mutation RPCs
--
-- These are the ONLY path by which a non-admin changes execution state.
-- Each re-checks authorization and the business rules server-side.
-- ============================================================

create or replace function public.complete_occurrence(p_occurrence_id uuid)
returns public.task_occurrences
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.task_occurrences;
begin
  if not public.is_approved() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  update public.task_occurrences o
     set status       = 'completed',
         completed_by = (select auth.uid()),
         completed_at = now(),
         skipped_by   = null,
         skipped_at   = null,
         skip_reason  = null
   where o.id = p_occurrence_id
   returning * into v_row;

  if not found then
    raise exception 'occurrence_not_found' using errcode = 'P0002';
  end if;
  return v_row;
end;
$$;

create or replace function public.skip_occurrence(p_occurrence_id uuid, p_reason text)
returns public.task_occurrences
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row       public.task_occurrences;
  v_skippable boolean;
begin
  if not public.is_approved() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  -- A reason is mandatory, always, for every role.
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'skip_reason_required' using errcode = '22023';
  end if;

  select t.is_skippable into v_skippable
    from public.task_occurrences o
    join public.tasks t on t.id = o.task_id
   where o.id = p_occurrence_id;

  if v_skippable is null then
    raise exception 'occurrence_not_found' using errcode = 'P0002';
  end if;

  -- Non-skippable tasks cannot be skipped by anyone, admins included.
  if not v_skippable then
    raise exception 'task_not_skippable' using errcode = '42501';
  end if;

  update public.task_occurrences o
     set status       = 'skipped',
         skipped_by   = (select auth.uid()),
         skipped_at   = now(),
         skip_reason  = trim(p_reason),
         completed_by = null,
         completed_at = null
   where o.id = p_occurrence_id
   returning * into v_row;

  return v_row;
end;
$$;

-- Undo. Restricted so one user cannot silently revert another's work.
create or replace function public.reopen_occurrence(p_occurrence_id uuid)
returns public.task_occurrences
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row   public.task_occurrences;
  v_actor uuid := (select auth.uid());
begin
  if not public.is_approved() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  select * into v_row from public.task_occurrences where id = p_occurrence_id;
  if not found then
    raise exception 'occurrence_not_found' using errcode = 'P0002';
  end if;

  if not public.is_admin()
     and coalesce(v_row.completed_by, v_row.skipped_by) is distinct from v_actor then
    raise exception 'not_your_action' using errcode = '42501';
  end if;

  update public.task_occurrences o
     set status = 'pending',
         completed_by = null, completed_at = null,
         skipped_by = null,   skipped_at = null, skip_reason = null
   where o.id = p_occurrence_id
   returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.complete_occurrence(uuid) from public;
revoke all on function public.skip_occurrence(uuid, text) from public;
revoke all on function public.reopen_occurrence(uuid) from public;
grant execute on function public.complete_occurrence(uuid) to authenticated;
grant execute on function public.skip_occurrence(uuid, text) to authenticated;
grant execute on function public.reopen_occurrence(uuid) to authenticated;
