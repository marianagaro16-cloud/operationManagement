-- ============================================================
-- Whoever is given something on an event looks after it (decided
-- 2026-10-19, asked for Jefferson): anyone with an account, outside Sales
-- and Marketing too. Their shifts, the material they bring (ticked packed
-- and back) and the event's tasks — which may now go to anyone — show in
-- their Agenda and on Inicio, and a short page of the event shows only
-- their part. No Eventos menu for them: they read nothing else of it.
--
--   my_event_work(from, to)   the caller's shifts, material and tasks
--   my_event(id)              one event, only the caller's part
--   my_event_material_tick()  packed / came back, on what they bring
--   my_event_task_done()      their task, done
-- ============================================================

-- ---------- an event's task may go to anyone ----------

create or replace function public.guard_sales_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Sales work is for sales; an event's own task (no customer, no prospect)
  -- for anyone with an account.
  if (tg_op = 'INSERT' or new.salesperson_id is distinct from old.salesperson_id)
     and not exists (
       select 1 from public.profiles p
        where p.id = new.salesperson_id and p.status = 'approved'
          and (p.team = 'sales' or p.role in ('admin', 'owner')
               or (p.team = 'marketing' and new.event_id is not null)
               or (new.event_id is not null and new.customer_id is null and new.prospect_id is null))
     ) then
    raise exception 'salesperson_not_sales' using errcode = '22023';
  end if;
  if tg_op = 'UPDATE' and old.status <> 'planned'
     and (new.status is distinct from old.status or new.customer_id is distinct from old.customer_id
          or new.prospect_id is distinct from old.prospect_id or new.activity_date is distinct from old.activity_date
          or new.kind_id is distinct from old.kind_id) then
    raise exception 'activity_recorded' using errcode = '42501';
  end if;
  -- Outside sales, only an event's own task (no customer, no prospect) —
  -- besides the follow-up call event_add_contact() plans for sales.
  if (select auth.uid()) is not null and not public.is_sales()
     and current_setting('app.event_contact', true) is distinct from 'on'
     and (new.event_id is null or new.customer_id is not null or new.prospect_id is not null) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- ---------- what the caller was given ----------

/* An event as an assignee sees it: what, when, where. */
create or replace function public.event_brief(e public.events)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', e.id, 'name', e.name, 'stage', e.stage,
    'start_date', e.start_date, 'end_date', e.end_date,
    'open_time', e.open_time, 'close_time', e.close_time,
    'place_name', e.place_name, 'street', e.street, 'postal_code', e.postal_code, 'city', e.city
  );
$$;

/*
 * The caller's shifts and material on confirmed or done events, and their
 * event tasks, between two days. Tasks still open from before come too.
 */
create or replace function public.my_event_work(p_from date, p_to date)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'shifts', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', s.id, 'date', s.shift_date, 'start', s.start_time, 'end', s.end_time,
               'event', public.event_brief(e)) order by s.shift_date, s.start_time)
        from public.event_shifts s
        join public.events e on e.id = s.event_id
       where s.profile_id = (select auth.uid())
         and e.stage in ('confirmed', 'done')
         and s.shift_date between p_from and p_to
    ), '[]'::jsonb),
    'materials', coalesce((
      select jsonb_agg(jsonb_build_object(
               'event', public.event_brief(e),
               'total', m.total, 'packed', m.packed) order by e.start_date)
        from public.events e
        join lateral (
          select count(*) as total, count(*) filter (where x.packed) as packed
            from public.event_materials x
           where x.event_id = e.id and x.bringer_profile = (select auth.uid())
        ) m on m.total > 0
       where e.stage in ('confirmed', 'done')
         and e.start_date between p_from and p_to
    ), '[]'::jsonb),
    'tasks', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', a.id, 'title', a.title, 'date', a.activity_date, 'status', a.status,
               'event', public.event_brief(e)) order by a.activity_date)
        from public.sales_activities a
        join public.events e on e.id = a.event_id
       where a.salesperson_id = (select auth.uid())
         and e.stage <> 'cancelled'
         and a.activity_date <= p_to
         and (a.activity_date >= p_from or a.status = 'planned')
    ), '[]'::jsonb)
  )
  where public.is_approved();
$$;

/* One event, only the caller's part of it. Null when they have nothing on it. */
create or replace function public.my_event(p_event_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with mine as (
    select
      coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'date', s.shift_date, 'start', s.start_time, 'end', s.end_time, 'note', s.note)
                                 order by s.shift_date, s.start_time)
                  from public.event_shifts s where s.event_id = p_event_id and s.profile_id = (select auth.uid())), '[]'::jsonb) as shifts,
      coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'name', m.name, 'quantity', m.quantity, 'packed', m.packed, 'came_back', m.came_back)
                                 order by m.sort_order, m.created_at)
                  from public.event_materials m where m.event_id = p_event_id and m.bringer_profile = (select auth.uid())), '[]'::jsonb) as materials,
      coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'title', a.title, 'date', a.activity_date, 'status', a.status)
                                 order by a.activity_date)
                  from public.sales_activities a where a.event_id = p_event_id and a.salesperson_id = (select auth.uid())), '[]'::jsonb) as tasks
  )
  select public.event_brief(e) || jsonb_build_object('shifts', mine.shifts, 'materials', mine.materials, 'tasks', mine.tasks)
    from public.events e, mine
   where e.id = p_event_id
     and public.is_approved()
     and e.stage <> 'cancelled'
     and (jsonb_array_length(mine.shifts) > 0 or jsonb_array_length(mine.materials) > 0 or jsonb_array_length(mine.tasks) > 0);
$$;

/* Packed before the event, or back after it: on what the caller brings. */
create or replace function public.my_event_material_tick(p_id uuid, p_field text, p_value boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_field not in ('packed', 'came_back') then raise exception 'invalid_material'; end if;
  update public.event_materials m
     set packed = case when p_field = 'packed' then p_value else m.packed end,
         came_back = case when p_field = 'came_back' then p_value else m.came_back end
   where m.id = p_id
     and m.bringer_profile = (select auth.uid())
     and public.is_approved()
     and exists (select 1 from public.events e where e.id = m.event_id and e.stage in ('confirmed', 'done'));
  if not found then raise exception 'not_authorized' using errcode = '42501'; end if;
end;
$$;

/* The caller's own event task, done. */
create or replace function public.my_event_task_done(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.sales_activities a
     set status = 'done', done_at = now()
   where a.id = p_id
     and a.salesperson_id = (select auth.uid())
     and a.event_id is not null
     and a.status = 'planned'
     and public.is_approved();
  if not found then raise exception 'not_authorized' using errcode = '42501'; end if;
end;
$$;

-- ---------- the notice the day before ----------

-- Once per person and day: shifts, material and tasks of tomorrow in one push.
create table public.event_assignee_notices (
  profile_id  uuid not null references public.profiles (id) on delete cascade,
  notice_date date not null,
  primary key (profile_id, notice_date)
);
-- Written and read only by the notifier (service role).
alter table public.event_assignee_notices enable row level security;

revoke all on function public.event_brief(public.events) from public, anon;
revoke all on function public.my_event_work(date, date) from public, anon;
revoke all on function public.my_event(uuid) from public, anon;
revoke all on function public.my_event_material_tick(uuid, text, boolean) from public, anon;
revoke all on function public.my_event_task_done(uuid) from public, anon;
grant execute on function public.my_event_work(date, date) to authenticated;
grant execute on function public.my_event(uuid) to authenticated;
grant execute on function public.my_event_material_tick(uuid, text, boolean) to authenticated;
grant execute on function public.my_event_task_done(uuid) to authenticated;
