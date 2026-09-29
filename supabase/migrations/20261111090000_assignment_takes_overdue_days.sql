-- ============================================================
-- Assigning people to an activity also takes its overdue days.
--
-- Only days from today onward passed to an activity's people. A day still
-- pending from before — created shared, when the activity had nobody — kept
-- no person, and since Users see only what is theirs, it belonged to nobody:
-- the one overdue day on 2026-09-29 ("Mantener un stock de 50 unidades de
-- Chile Poblano 500g", 11 Sept) was invisible to Jefferson, who does it.
--
-- Now every day still wholly pending and not arranged by hand follows the
-- activity's people, overdue ones included. Days with anything resolved, and
-- days somebody arranged by hand, stay as they are — as before.
--
-- Re-assigning a day replaces its copies; the comments on a replaced copy
-- now move to the day's new copy instead of going with it.
-- ============================================================

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
  v_gone    uuid[];
  v_keep    uuid;
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

  -- The copies no longer wanted: pending ones whose person is not among them.
  v_gone := array(
    select o.id from public.task_occurrences o
     where o.task_id = p_task_id
       and o.due_date = p_due_date
       and o.status = 'pending'
       and not exists (select 1 from unnest(v_desired) d(u) where d.u is not distinct from o.assignee_id)
  );

  insert into public.task_occurrences
    (task_id, period_key, due_date, due_date_override, source, assignee_id, assignee_manual)
  select p_task_id, v_tpl.period_key, p_due_date, v_tpl.due_date_override, v_tpl.source, d.u, p_manual
    from unnest(v_desired) d(u)
  on conflict do nothing;

  -- What was said about the day stays with the day.
  if cardinality(v_gone) > 0 then
    select o.id into v_keep
      from public.task_occurrences o
     where o.task_id = p_task_id and o.due_date = p_due_date and not (o.id = any (v_gone))
     order by o.created_at
     limit 1;
    if v_keep is not null then
      update public.task_comments set occurrence_id = v_keep where occurrence_id = any (v_gone);
    end if;
    delete from public.task_occurrences where id = any (v_gone);
  end if;

  if p_manual then
    update public.task_occurrences
       set assignee_manual = true
     where task_id = p_task_id and due_date = p_due_date and not assignee_manual;
  end if;
end;
$$;

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
  -- Every day still wholly pending and not arranged by hand — overdue ones
  -- included, so nothing late is left with nobody.
  for r in
    select o.due_date
      from public.task_occurrences o
     where o.task_id = p_task_id
     group by o.due_date
    having bool_and(o.status = 'pending')
       and not bool_or(o.assignee_manual)
  loop
    perform public.task_day_set_people(p_task_id, r.due_date, v_people, false);
  end loop;
end;
$$;

-- ---------- the days already left behind ----------

-- Overdue days still shared on activities that have people now: give them
-- to those people, as an assignment made today would have.
do $$
declare
  r record;
begin
  for r in
    select distinct o.task_id
      from public.task_occurrences o
      join public.tasks t on t.id = o.task_id and t.is_active
     where o.status = 'pending'
       and o.assignee_id is null
       and not o.assignee_manual
       and o.effective_due_date < (now() at time zone 'Europe/Zurich')::date
       and exists (select 1 from public.task_assignees a where a.task_id = o.task_id)
  loop
    perform public.task_resync_days(r.task_id);
  end loop;
end;
$$;
