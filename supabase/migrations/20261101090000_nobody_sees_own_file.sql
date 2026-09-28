-- ============================================================
-- Nobody sees their own file.
--
-- Whoever holds hr.manage (Admin, Manager, Production manager) could open
-- the file linked to their own account: its log, its evaluations, the
-- overview of what others said about them. A file is now invisible to the
-- person it is about, Admin included — everything reads through
-- hr_can_worker() or the hr_workers policies, which both refuse it. They can
-- neither link their own account to a file nor send an evaluation of
-- themselves.
-- ============================================================

/* Is this worker the caller? */
create or replace function public.hr_is_self(p_worker_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.hr_workers w
     where w.id = p_worker_id and w.profile_id = (select auth.uid())
  );
$$;

revoke all on function public.hr_is_self(uuid) from public, anon;
grant execute on function public.hr_is_self(uuid) to authenticated;

create or replace function public.hr_can_worker(p_worker_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.hr_workers w
     where w.id = p_worker_id
       and public.hr_can(w.team)
       and w.profile_id is distinct from (select auth.uid())
  );
$$;

drop policy if exists "hr_workers: read" on public.hr_workers;
create policy "hr_workers: read" on public.hr_workers
  for select to authenticated
  using (public.hr_can(team) and profile_id is distinct from (select auth.uid()));

drop policy if exists "hr_workers: insert" on public.hr_workers;
create policy "hr_workers: insert" on public.hr_workers
  for insert to authenticated
  with check (public.hr_can(team) and profile_id is distinct from (select auth.uid()));

drop policy if exists "hr_workers: update" on public.hr_workers;
create policy "hr_workers: update" on public.hr_workers
  for update to authenticated
  using (public.hr_can(team) and profile_id is distinct from (select auth.uid()))
  with check (public.hr_can(team) and profile_id is distinct from (select auth.uid()));

-- Admin reads who answered what — except about themselves.
drop policy if exists "hr_eval_assignments: read" on public.hr_eval_assignments;
create policy "hr_eval_assignments: read" on public.hr_eval_assignments
  for select to authenticated
  using (
    evaluator_id = (select auth.uid())
    or ((select public.is_admin()) and exists (
      select 1 from public.hr_eval_requests r where r.id = request_id and not public.hr_is_self(r.worker_id)))
  );

drop policy if exists "hr_eval_answers: read" on public.hr_eval_answers;
create policy "hr_eval_answers: read" on public.hr_eval_answers
  for select to authenticated
  using (exists (
    select 1 from public.hr_eval_assignments a
      join public.hr_eval_requests r on r.id = a.request_id
     where a.id = assignment_id
       and (a.evaluator_id = (select auth.uid())
            or ((select public.is_admin()) and not public.hr_is_self(r.worker_id)))
  ));

-- ---------- the functions that act on a worker ----------

create or replace function public.hr_worker_stats(p_worker_id uuid, p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_pid   uuid;
  v_today date := (now() at time zone 'Europe/Zurich')::date;
begin
  if not public.hr_can_worker(p_worker_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  select w.profile_id into v_pid from public.hr_workers w where w.id = p_worker_id;
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

/* Admin's actions on a sent evaluation: never on their own. */
create or replace function public.hr_eval_admin_may(p_request_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin() and exists (
    select 1 from public.hr_eval_requests r
     where r.id = p_request_id and not public.hr_is_self(r.worker_id)
  );
$$;

revoke all on function public.hr_eval_admin_may(uuid) from public, anon;
grant execute on function public.hr_eval_admin_may(uuid) to authenticated;

-- The sent-evaluation actions, as before, but never on the caller's own file.

create or replace function public.hr_eval_send(
  p_worker_id  uuid,
  p_deadline   date,
  p_items      jsonb,
  p_evaluators uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_worker  public.hr_workers%rowtype;
  v_request uuid;
  v_item    jsonb;
  v_crit    public.hr_criteria%rowtype;
  v_order   int := 0;
begin
  if not public.is_admin() or public.hr_is_self(p_worker_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if p_deadline is null or p_deadline < (now() at time zone 'Europe/Zurich')::date then
    raise exception 'deadline_past' using errcode = '22023';
  end if;
  if coalesce(jsonb_array_length(p_items), 0) = 0 then
    raise exception 'items_required' using errcode = '22023';
  end if;
  if coalesce(array_length(p_evaluators, 1), 0) = 0 then
    raise exception 'evaluators_required' using errcode = '22023';
  end if;

  select * into v_worker from public.hr_workers where id = p_worker_id;
  if not found then
    raise exception 'worker_not_found' using errcode = 'P0002';
  end if;

  insert into public.hr_eval_requests (worker_id, worker_name, worker_position, worker_team, deadline, created_by)
  values (v_worker.id, v_worker.name, v_worker.position, v_worker.team, p_deadline, (select auth.uid()))
  returning id into v_request;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_order := v_order + 1;
    if v_item ? 'criterion_id' then
      select * into v_crit from public.hr_criteria where id = (v_item ->> 'criterion_id')::uuid;
      if not found then
        raise exception 'invalid_criterion' using errcode = '22023';
      end if;
      insert into public.hr_eval_request_items (request_id, sort_order, kind, criterion_id, name, description, translations)
      values (v_request, v_order, 'scale', v_crit.id, v_crit.name, v_crit.description, v_crit.translations);
    else
      if coalesce(v_item ->> 'kind', '') not in ('scale', 'text')
         or length(btrim(coalesce(v_item ->> 'name', ''))) = 0 then
        raise exception 'invalid_question' using errcode = '22023';
      end if;
      insert into public.hr_eval_request_items (request_id, sort_order, kind, name, description, translations)
      values (
        v_request, v_order, v_item ->> 'kind', btrim(v_item ->> 'name'),
        nullif(btrim(coalesce(v_item ->> 'description', '')), ''),
        coalesce(v_item -> 'translations', '{}'::jsonb)
      );
    end if;
  end loop;

  return jsonb_build_object(
    'request_id', v_request,
    'assignments', public.hr_eval_invite(v_request, p_evaluators)
  );
end;
$$;

create or replace function public.hr_eval_invite(p_request_id uuid, p_evaluators uuid[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_added jsonb;
begin
  if not public.hr_eval_admin_may(p_request_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if not public.hr_eval_is_open(p_request_id) then
    raise exception 'evaluation_closed' using errcode = '42501';
  end if;

  with added as (
    insert into public.hr_eval_assignments (request_id, evaluator_id)
    select p_request_id, p.id
      from public.profiles p
     where p.id = any (p_evaluators)
       and p.status = 'approved'
       and p.deleted_at is null
       and p.id is distinct from (
         select w.profile_id from public.hr_eval_requests r
           join public.hr_workers w on w.id = r.worker_id
          where r.id = p_request_id)
    on conflict (request_id, evaluator_id) do nothing
    returning id, evaluator_id
  )
  select coalesce(jsonb_agg(jsonb_build_object('assignment_id', id, 'evaluator_id', evaluator_id)), '[]'::jsonb)
    into v_added from added;

  return v_added;
end;
$$;

create or replace function public.hr_eval_uninvite(p_assignment_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.hr_eval_admin_may((select a.request_id from public.hr_eval_assignments a where a.id = p_assignment_id)) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  delete from public.hr_eval_assignments where id = p_assignment_id and submitted_at is null;
  if not found then
    raise exception 'already_submitted' using errcode = '42501';
  end if;
end;
$$;

create or replace function public.hr_eval_close(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.hr_eval_admin_may(p_request_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  update public.hr_eval_requests set closed_at = now() where id = p_request_id and closed_at is null;
end;
$$;

create or replace function public.hr_eval_set_deadline(p_request_id uuid, p_deadline date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.hr_eval_admin_may(p_request_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if p_deadline is null or p_deadline < (now() at time zone 'Europe/Zurich')::date then
    raise exception 'deadline_past' using errcode = '22023';
  end if;
  update public.hr_eval_requests
     set deadline = p_deadline
   where id = p_request_id and closed_at is null;
  if not found then
    raise exception 'evaluation_closed' using errcode = '42501';
  end if;
end;
$$;

