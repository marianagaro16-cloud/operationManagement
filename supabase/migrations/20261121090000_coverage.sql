-- ============================================================
-- Absence & Coverage, step 2: who covers someone who is away.
--
--   coverage_assignments   on one day of an approved absence, someone with
--                          an account covers from a time until a time. Several
--                          people and several periods on one day. Removed
--                          ones stay (removed_at), for the history.
--   coverage_events        history: added, changed, removed — who and when.
--   absence_needs_cover    the people who must be covered when away (Admin's
--                          list); only their absences get "no coverage"
--                          warnings.
--   app_settings 'absences.hours'  the working days and hours coverage has
--                          to fill: Mon–Fri 08:00–18:00, noon at 12:00.
--   coverage_notices       ledger of "you cover tomorrow" notices.
--
-- Conflicts (the person covering is away, or already covering then) are
-- warnings shown before saving, not refusals: the planner decides.
-- Everyone sees the plan; approvers and the absent person plan it.
-- ============================================================

insert into public.app_settings (key, value)
values ('absences.hours', '{"days": [1, 2, 3, 4, 5], "start": "08:00", "noon": "12:00", "end": "18:00"}'::jsonb)
on conflict (key) do nothing;

create table public.absence_needs_cover (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  added_by   uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.absence_needs_cover enable row level security;
create policy "absence_needs_cover: approved read" on public.absence_needs_cover for select to authenticated
  using ((select public.is_approved()));
create policy "absence_needs_cover: admin writes" on public.absence_needs_cover for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- ---------- coverage ----------

create table public.coverage_assignments (
  id          uuid primary key default gen_random_uuid(),
  absence_id  uuid not null references public.absences (id) on delete cascade,
  coverer_id  uuid not null references public.profiles (id) on delete cascade,
  cover_date  date not null,
  start_time  time not null,
  end_time    time not null,
  note        text,
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  removed_at  timestamptz,
  removed_by  uuid references public.profiles (id) on delete set null,
  constraint coverage_times check (end_time > start_time)
);

create index coverage_absence_idx on public.coverage_assignments (absence_id, cover_date) where removed_at is null;
create index coverage_coverer_idx on public.coverage_assignments (coverer_id, cover_date) where removed_at is null;
create index coverage_date_idx on public.coverage_assignments (cover_date) where removed_at is null;

create trigger coverage_assignments_set_updated_at before update on public.coverage_assignments
  for each row execute function public.set_updated_at();

/* Planned by an approver, or by the person who is away. */
create or replace function public.can_plan_coverage(p_absence_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_absence_approver()
      or exists (select 1 from public.absences a where a.id = p_absence_id and a.profile_id = (select auth.uid()));
$$;

revoke all on function public.can_plan_coverage(uuid) from public, anon;
grant execute on function public.can_plan_coverage(uuid) to authenticated;

/* On a day of an approved absence; by someone with an account who is not the absent person. */
create or replace function public.guard_coverage()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_a public.absences%rowtype;
begin
  select * into v_a from public.absences where id = new.absence_id;
  if v_a.status <> 'approved' and new.removed_at is null then
    raise exception 'coverage_absence_not_approved' using errcode = '22023';
  end if;
  if new.cover_date < v_a.start_date or new.cover_date > v_a.end_date then
    raise exception 'coverage_outside_absence' using errcode = '22023';
  end if;
  if new.coverer_id = v_a.profile_id then
    raise exception 'coverage_self' using errcode = '22023';
  end if;
  if not exists (select 1 from public.profiles p where p.id = new.coverer_id and p.status = 'approved' and p.deleted_at is null) then
    raise exception 'coverage_coverer_inactive' using errcode = '22023';
  end if;
  if tg_op = 'UPDATE' and (new.absence_id is distinct from old.absence_id or old.removed_at is not null) then
    raise exception 'coverage_locked' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger coverage_assignments_guard
  before insert or update on public.coverage_assignments
  for each row execute function public.guard_coverage();

-- ---------- history ----------

create table public.coverage_events (
  id            bigserial primary key,
  assignment_id uuid not null references public.coverage_assignments (id) on delete cascade,
  absence_id    uuid not null references public.absences (id) on delete cascade,
  actor_id      uuid references public.profiles (id) on delete set null,
  action        text not null,
  detail        jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);

create index coverage_events_absence_idx on public.coverage_events (absence_id, created_at);

create or replace function public.log_coverage()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_action text;
begin
  if tg_op = 'INSERT' then
    v_action := 'added';
  elsif new.removed_at is not null and old.removed_at is null then
    v_action := 'removed';
  elsif (new.coverer_id, new.cover_date, new.start_time, new.end_time, coalesce(new.note, ''))
        is distinct from (old.coverer_id, old.cover_date, old.start_time, old.end_time, coalesce(old.note, '')) then
    v_action := 'changed';
  else
    return new;
  end if;
  insert into public.coverage_events (assignment_id, absence_id, actor_id, action, detail)
  values (new.id, new.absence_id, (select auth.uid()), v_action, jsonb_build_object(
    'coverer_id', new.coverer_id, 'cover_date', new.cover_date, 'start_time', new.start_time, 'end_time', new.end_time,
    'previous', case when tg_op = 'UPDATE' then jsonb_build_object(
      'coverer_id', old.coverer_id, 'cover_date', old.cover_date, 'start_time', old.start_time, 'end_time', old.end_time) end));
  return new;
end;
$$;

create trigger coverage_assignments_log
  after insert or update on public.coverage_assignments
  for each row execute function public.log_coverage();

-- ---------- RLS ----------

alter table public.coverage_assignments enable row level security;
alter table public.coverage_events      enable row level security;

create policy "coverage: approved read" on public.coverage_assignments for select to authenticated
  using ((select public.is_approved()));
create policy "coverage: planners add" on public.coverage_assignments for insert to authenticated
  with check (public.can_plan_coverage(absence_id) and created_by = (select auth.uid()));
-- Changed, or removed (removed_at set) — never deleted.
create policy "coverage: planners change" on public.coverage_assignments for update to authenticated
  using (public.can_plan_coverage(absence_id)) with check (public.can_plan_coverage(absence_id));

create policy "coverage_events: approved read" on public.coverage_events for select to authenticated
  using ((select public.is_approved()));

-- ---------- "you cover tomorrow" ----------

create table public.coverage_notices (
  assignment_id uuid not null references public.coverage_assignments (id) on delete cascade,
  kind          text not null,
  sent_at       timestamptz not null default now(),
  primary key (assignment_id, kind)
);

-- Written and read only by the notifier (service role).
alter table public.coverage_notices enable row level security;
