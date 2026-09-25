-- ============================================================
-- An activity can belong to several people, and each of them completes it.
--
-- Replaces the single tasks.default_assignee_id of 20261022090000 (never
-- used: no activity had a person yet). An activity now has a SET of people
-- (task_assignees), and each day of it is one occurrence PER PERSON: each
-- completes, skips or blocks their own copy, and each copy counts on its own.
-- With nobody set, the day is one shared occurrence, as before.
--
-- A "day" of an activity is therefore every occurrence with the same
-- (task_id, due_date); the unique key gains the person to allow it.
--
--   materialise_task_days()      puts days on the calendar with one copy per
--                                person — used by the daily generator and by
--                                planning from the calendar.
--   set_task_assignees()         sets an activity's people and moves its
--                                pending days from today onward, except days
--                                changed by hand.
--   set_occurrence_day_people()  changes the people for one day, by hand.
-- ============================================================

-- ---------- the single-person version goes ----------

drop trigger if exists tasks_default_assignee_follows on public.tasks;
drop function if exists public.task_default_assignee_follows();
drop trigger if exists task_occurrences_default_assignee on public.task_occurrences;
drop function if exists public.occurrence_default_assignee();
alter table public.tasks drop column if exists default_assignee_id;

comment on column public.task_occurrences.assignee_manual is
  'The people for this day were chosen by hand, so a change of the activity''s people does not move it.';

-- ---------- an activity's people ----------

create table public.task_assignees (
  task_id    uuid not null references public.tasks (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (task_id, user_id)
);

comment on table public.task_assignees is
  'Who does a recurring activity. Each day of it gets one occurrence per person here.';

create index task_assignees_user_idx on public.task_assignees (user_id);

alter table public.task_assignees enable row level security;

-- A plain User sees only their own row; everyone else sees who does what.
-- Written only through set_task_assignees().
create policy "task_assignees: read" on public.task_assignees
  for select to authenticated
  using ((select public.is_approved())
         and ((select public.team_scope()) is null or user_id = (select auth.uid())));

-- ---------- one copy per person per day ----------

alter table public.task_occurrences drop constraint task_occurrences_task_date_key;
alter table public.task_occurrences
  add constraint task_occurrences_task_date_person_key
  unique nulls not distinct (task_id, due_date, assignee_id);

/*
 * Make one day of an activity hold exactly these people (or one shared copy
 * when there are none). Resolved copies are never touched: who completed a
 * day is its record. New copies take the day's label and any move of date
 * from a copy already there.
 */
create or replace function public.task_day_set_people(
  p_task_id uuid, p_due_date date, p_people uuid[], p_manual boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tpl     public.task_occurrences%rowtype;
  v_desired uuid[];
begin
  select * into v_tpl
    from public.task_occurrences
   where task_id = p_task_id and due_date = p_due_date
   order by created_at
   limit 1;
  if not found then
    return;
  end if;

  v_desired := case
                 when coalesce(cardinality(p_people), 0) = 0 then array[null::uuid]
                 else p_people
               end;

  delete from public.task_occurrences o
   where o.task_id = p_task_id
     and o.due_date = p_due_date
     and o.status = 'pending'
     and not exists (select 1 from unnest(v_desired) d(u) where d.u is not distinct from o.assignee_id);

  insert into public.task_occurrences
    (task_id, period_key, due_date, due_date_override, source, assignee_id, assignee_manual)
  select p_task_id, v_tpl.period_key, p_due_date, v_tpl.due_date_override, v_tpl.source, d.u, p_manual
    from unnest(v_desired) d(u)
  on conflict do nothing;

  if p_manual then
    update public.task_occurrences
       set assignee_manual = true
     where task_id = p_task_id and due_date = p_due_date and not assignee_manual;
  end if;
end;
$$;

/* The activity's people, oldest first; NULL when nobody is set. */
create or replace function public.task_people(p_task_id uuid)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select array_agg(a.user_id order by a.created_at, a.user_id)
    from public.task_assignees a
   where a.task_id = p_task_id;
$$;

/* Bring every pending, untouched day from today onward in line with the activity's people. */
create or replace function public.task_resync_days(p_task_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_people uuid[] := public.task_people(p_task_id);
  r record;
begin
  for r in
    select o.due_date
      from public.task_occurrences o
     where o.task_id = p_task_id
     group by o.due_date
    having bool_and(o.status = 'pending')
       and not bool_or(o.assignee_manual)
       and min(o.effective_due_date) >= (now() at time zone 'Europe/Zurich')::date
  loop
    perform public.task_day_set_people(p_task_id, r.due_date, v_people, false);
  end loop;
end;
$$;

-- ---------- putting days on the calendar ----------

/*
 * p_rows: [{task_id, due_date, period_key, source}]. A day that already
 * exists in any form is left alone, so running this twice never duplicates
 * and never disturbs work somebody arranged. Returns the copies written.
 */
create or replace function public.materialise_task_days(p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_system boolean := (select auth.uid()) is null;
  v_count  integer := 0;
  v_n      integer;
  r        record;
begin
  if not v_system and not public.has_permission('tasks.manage_occurrences') then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  for r in
    select * from jsonb_to_recordset(p_rows)
      as x(task_id uuid, due_date date, period_key text, source public.schedule_source)
  loop
    if not v_system and not public.task_in_team_scope(r.task_id) then
      continue;
    end if;
    if exists (select 1 from public.task_occurrences o
                where o.task_id = r.task_id and o.due_date = r.due_date) then
      continue;
    end if;

    insert into public.task_occurrences (task_id, period_key, due_date, source, assignee_id)
    select r.task_id, r.period_key, r.due_date, coalesce(r.source, 'manual'), p.u
      from unnest(coalesce(public.task_people(r.task_id), array[null::uuid])) p(u)
    on conflict do nothing;

    get diagnostics v_n = row_count;
    v_count := v_count + v_n;
  end loop;

  return v_count;
end;
$$;

-- ---------- setting an activity's people ----------

/* Returns the people newly added, so they can be told. */
create or replace function public.set_task_assignees(p_task_id uuid, p_user_ids uuid[])
returns uuid[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids   uuid[] := array(select distinct u from unnest(coalesce(p_user_ids, '{}')) u where u is not null);
  v_added uuid[];
begin
  if not public.has_permission('tasks.manage_definitions') then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  v_added := array(
    select u from unnest(v_ids) u
     where not exists (select 1 from public.task_assignees a where a.task_id = p_task_id and a.user_id = u)
  );

  delete from public.task_assignees
   where task_id = p_task_id and not (user_id = any (v_ids));
  insert into public.task_assignees (task_id, user_id)
  select p_task_id, u from unnest(v_ids) u
  on conflict do nothing;

  perform public.task_resync_days(p_task_id);
  return v_added;
end;
$$;

-- ---------- changing the people for one day ----------

/*
 * p_occurrence_id is any copy of the day. Returns the people newly added.
 * Emptying a day that somebody already resolved removes the pending copies
 * without putting a shared one back: the work was done.
 */
create or replace function public.set_occurrence_day_people(p_occurrence_id uuid, p_user_ids uuid[])
returns uuid[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids   uuid[] := array(select distinct u from unnest(coalesce(p_user_ids, '{}')) u where u is not null);
  v_task  uuid;
  v_date  date;
  v_added uuid[];
begin
  select o.task_id, o.due_date into v_task, v_date
    from public.task_occurrences o where o.id = p_occurrence_id;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if not public.has_permission('tasks.manage_occurrences') or not public.task_in_team_scope(v_task) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  v_added := array(
    select u from unnest(v_ids) u
     where not exists (select 1 from public.task_occurrences o
                        where o.task_id = v_task and o.due_date = v_date and o.assignee_id = u)
  );

  if cardinality(v_ids) = 0 and exists (
    select 1 from public.task_occurrences o
     where o.task_id = v_task and o.due_date = v_date and o.status <> 'pending'
  ) then
    delete from public.task_occurrences o
     where o.task_id = v_task and o.due_date = v_date and o.status = 'pending';
    update public.task_occurrences set assignee_manual = true
     where task_id = v_task and due_date = v_date;
  else
    perform public.task_day_set_people(v_task, v_date, v_ids, true);
  end if;

  return v_added;
end;
$$;

revoke all on function public.task_day_set_people(uuid, date, uuid[], boolean) from public, anon, authenticated;
revoke all on function public.task_people(uuid) from public, anon, authenticated;
revoke all on function public.task_resync_days(uuid) from public, anon, authenticated;
revoke all on function public.materialise_task_days(jsonb) from public, anon;
revoke all on function public.set_task_assignees(uuid, uuid[]) from public, anon;
revoke all on function public.set_occurrence_day_people(uuid, uuid[]) from public, anon;
grant execute on function public.materialise_task_days(jsonb) to authenticated, service_role;
grant execute on function public.set_task_assignees(uuid, uuid[]) to authenticated;
grant execute on function public.set_occurrence_day_people(uuid, uuid[]) to authenticated;
