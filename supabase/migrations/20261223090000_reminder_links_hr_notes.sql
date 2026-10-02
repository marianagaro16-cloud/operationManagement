-- ============================================================
-- Reminders about a note in a worker's log (decided 2026-10-02): one more
-- thing a reminder — or the personal task it becomes — can point at. The
-- note stays as private as the file: whoever cannot open the file sees only
-- that the reminder is linked to something they cannot open.
-- ============================================================

alter table public.reminders add column hr_note_id uuid references public.hr_notes (id) on delete set null;
alter table public.personal_tasks add column hr_note_id uuid references public.hr_notes (id) on delete set null;
create index reminders_hr_note_idx on public.reminders (hr_note_id) where hr_note_id is not null;

alter table public.reminders drop constraint reminders_one_link;
alter table public.reminders add constraint reminders_one_link check (num_nonnulls(customer_id, order_id, incident_id, goods_reception_id, task_id, inventory_instance_id, product_id,
               event_id, marketing_post_id, marketing_request_id, hr_note_id) <= 1);
alter table public.personal_tasks drop constraint personal_tasks_one_link;
alter table public.personal_tasks add constraint personal_tasks_one_link check (num_nonnulls(customer_id, order_id, incident_id, goods_reception_id, task_id, inventory_instance_id, product_id,
               event_id, marketing_post_id, marketing_request_id, hr_note_id) <= 1);

grant insert (hr_note_id) on public.personal_tasks to authenticated;
grant update (hr_note_id) on public.personal_tasks to authenticated;

create or replace function public.reminder_save(
  p_id              uuid,
  p_title           text,
  p_notes           text,
  p_due_at          timestamptz,
  p_timezone        text,
  p_recurrence      text,
  p_notify_before   integer,
  p_link_type       text,
  p_link_id         uuid,
  p_participants    uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid      uuid := public.reminder_guard();
  v_row      public.reminders;
  v_id       uuid;
  v_creator  uuid;
  v_wanted   uuid[];
  v_existing uuid[];
  v_added    uuid[];
  v_removed  uuid[];
  v_changes  jsonb := '{}'::jsonb;
  v_user     uuid;
begin
  if p_title is null or btrim(p_title) = '' then raise exception 'title_required'; end if;
  if p_due_at is null then raise exception 'due_required'; end if;
  if coalesce(p_recurrence, 'none') not in ('none', 'daily', 'weekdays', 'weekly', 'monthly') then
    raise exception 'invalid_recurrence';
  end if;
  if p_link_type is not null and (
       p_link_id is null
       or p_link_type not in ('customer', 'order', 'incident', 'goods_reception', 'task', 'inventory', 'product', 'event', 'marketing_post', 'marketing_request', 'hr_note')
     ) then
    raise exception 'invalid_link';
  end if;

  if p_id is null then
    v_creator := v_uid;
  else
    select * into v_row from public.reminders where id = p_id for update;
    if not found or not public.is_reminder_participant(p_id) then
      raise exception 'reminder_not_found';
    end if;
    if v_row.created_by <> v_uid then raise exception 'not_authorized'; end if;
    if v_row.status <> 'open' then raise exception 'reminder_closed'; end if;
    v_creator := v_row.created_by;
  end if;

  -- The creator is always a participant; duplicates collapse.
  select coalesce(array_agg(distinct u), '{}')
    into v_wanted
    from unnest(coalesce(p_participants, '{}'::uuid[]) || v_creator) as u;

  if p_id is null then
    v_existing := array[]::uuid[];
  else
    select coalesce(array_agg(user_id), '{}') into v_existing
      from public.reminder_participants where reminder_id = p_id;
  end if;

  select coalesce(array_agg(u), '{}') into v_added
    from unnest(v_wanted) u where u <> all (v_existing);
  select coalesce(array_agg(u), '{}') into v_removed
    from unnest(v_existing) u where u <> all (v_wanted);

  -- Only people being ADDED must be eligible now. Somebody already on a
  -- reminder whose role later changed must not make it uneditable; they
  -- simply stop seeing it, because the read policy asks again every time.
  if exists (select 1 from unnest(v_added) u where not public.reminders_eligible(u)) then
    raise exception 'participant_not_eligible';
  end if;

  if p_id is null then
    insert into public.reminders (
      created_by, title, notes, due_at, timezone, recurrence, recurrence_anchor,
      notify_before_minutes, is_shared,
      customer_id, order_id, incident_id, goods_reception_id, task_id, inventory_instance_id, product_id,
      event_id, marketing_post_id, marketing_request_id, hr_note_id
    ) values (
      v_uid, btrim(p_title), nullif(btrim(coalesce(p_notes, '')), ''), p_due_at,
      coalesce(nullif(p_timezone, ''), 'Europe/Zurich'),
      coalesce(p_recurrence, 'none'),
      case when coalesce(p_recurrence, 'none') <> 'none' then p_due_at end,
      p_notify_before, cardinality(v_wanted) > 1,
      case when p_link_type = 'customer'        then p_link_id end,
      case when p_link_type = 'order'           then p_link_id end,
      case when p_link_type = 'incident'        then p_link_id end,
      case when p_link_type = 'goods_reception' then p_link_id end,
      case when p_link_type = 'task'            then p_link_id end,
      case when p_link_type = 'inventory'       then p_link_id end,
      case when p_link_type = 'product'         then p_link_id end,
      case when p_link_type = 'event'             then p_link_id end,
      case when p_link_type = 'marketing_post'    then p_link_id end,
      case when p_link_type = 'marketing_request' then p_link_id end,
      case when p_link_type = 'hr_note'           then p_link_id end
    ) returning id into v_id;

    insert into public.reminder_events (reminder_id, actor_id, action, detail)
    values (v_id, v_uid, 'created', jsonb_build_object(
      'title', btrim(p_title), 'due_at', p_due_at, 'recurrence', coalesce(p_recurrence, 'none'),
      'shared', cardinality(v_wanted) > 1, 'link_type', p_link_type
    ));
  else
    v_id := p_id;

    if btrim(p_title) is distinct from v_row.title then
      v_changes := v_changes || jsonb_build_object('title', jsonb_build_array(v_row.title, btrim(p_title)));
    end if;
    if nullif(btrim(coalesce(p_notes, '')), '') is distinct from v_row.notes then
      v_changes := v_changes || jsonb_build_object('notes', true);
    end if;
    if p_due_at is distinct from v_row.due_at then
      v_changes := v_changes || jsonb_build_object('due_at', jsonb_build_array(v_row.due_at, p_due_at));
    end if;
    if coalesce(p_recurrence, 'none') is distinct from v_row.recurrence then
      v_changes := v_changes || jsonb_build_object('recurrence', jsonb_build_array(v_row.recurrence, coalesce(p_recurrence, 'none')));
    end if;
    if p_notify_before is distinct from v_row.notify_before_minutes then
      v_changes := v_changes || jsonb_build_object('notify_before', jsonb_build_array(v_row.notify_before_minutes, p_notify_before));
    end if;

    update public.reminders set
      title = btrim(p_title),
      notes = nullif(btrim(coalesce(p_notes, '')), ''),
      due_at = p_due_at,
      timezone = coalesce(nullif(p_timezone, ''), v_row.timezone),
      recurrence = coalesce(p_recurrence, 'none'),
      -- A new time or a new rule restarts the series from the new time.
      recurrence_anchor = case
        when coalesce(p_recurrence, 'none') = 'none' then null
        when p_due_at is distinct from v_row.due_at
          or coalesce(p_recurrence, 'none') is distinct from v_row.recurrence then p_due_at
        else v_row.recurrence_anchor
      end,
      -- A snooze belonged to the old time. Keeping it would fire at a moment
      -- that has nothing to do with what was just chosen.
      snoozed_until = case when p_due_at is distinct from v_row.due_at then null else v_row.snoozed_until end,
      notify_before_minutes = p_notify_before,
      is_shared = cardinality(v_wanted) > 1,
      customer_id           = case when p_link_type = 'customer'        then p_link_id end,
      order_id              = case when p_link_type = 'order'           then p_link_id end,
      incident_id           = case when p_link_type = 'incident'        then p_link_id end,
      goods_reception_id    = case when p_link_type = 'goods_reception' then p_link_id end,
      task_id               = case when p_link_type = 'task'            then p_link_id end,
      inventory_instance_id = case when p_link_type = 'inventory'       then p_link_id end,
      product_id            = case when p_link_type = 'product'         then p_link_id end,
      event_id              = case when p_link_type = 'event'             then p_link_id end,
      marketing_post_id     = case when p_link_type = 'marketing_post'    then p_link_id end,
      marketing_request_id  = case when p_link_type = 'marketing_request' then p_link_id end,
      hr_note_id            = case when p_link_type = 'hr_note'           then p_link_id end
    where id = p_id;

    if v_changes <> '{}'::jsonb then
      insert into public.reminder_events (reminder_id, actor_id, action, detail)
      values (v_id, v_uid, 'edited', v_changes);
    end if;
  end if;

  foreach v_user in array v_removed loop
    delete from public.reminder_participants where reminder_id = v_id and user_id = v_user;
    insert into public.reminder_events (reminder_id, actor_id, action, detail)
    values (v_id, v_uid, 'participant_removed', jsonb_build_object('user_id', v_user));
  end loop;

  foreach v_user in array v_added loop
    insert into public.reminder_participants (reminder_id, user_id, added_by)
    values (v_id, v_user, v_uid);
    -- The creator joining their own new reminder is not news.
    if v_user <> v_creator then
      insert into public.reminder_events (reminder_id, actor_id, action, detail)
      values (v_id, v_uid, 'participant_added', jsonb_build_object('user_id', v_user));
    end if;
  end loop;

  return v_id;
end;
$$;

create or replace function public.reminder_convert(p_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := public.reminder_guard();
  v_row  public.reminders;
  v_task uuid;
  v_local timestamp;
begin
  select * into v_row from public.reminders where id = p_id for update;
  if not found or not public.is_reminder_participant(p_id) then raise exception 'reminder_not_found'; end if;
  if v_row.created_by <> v_uid then raise exception 'not_authorized'; end if;
  if v_row.status <> 'open' then raise exception 'reminder_closed'; end if;
  if v_row.is_shared then raise exception 'shared_cannot_convert'; end if;

  v_local := v_row.next_at at time zone v_row.timezone;

  insert into public.personal_tasks (
    owner_id, title, notes, due_date, due_time,
    customer_id, order_id, incident_id, goods_reception_id, task_id, inventory_instance_id, product_id,
    event_id, marketing_post_id, marketing_request_id, hr_note_id,
    source_reminder_id
  ) values (
    v_uid, v_row.title, v_row.notes, v_local::date, v_local::time,
    v_row.customer_id, v_row.order_id, v_row.incident_id, v_row.goods_reception_id,
    v_row.task_id, v_row.inventory_instance_id, v_row.product_id,
    v_row.event_id, v_row.marketing_post_id, v_row.marketing_request_id, v_row.hr_note_id,
    v_row.id
  ) returning id into v_task;

  update public.reminders
     set status = 'converted', converted_at = now(), personal_task_id = v_task
   where id = p_id;

  insert into public.reminder_events (reminder_id, actor_id, action, detail)
  values (p_id, v_uid, 'converted', jsonb_build_object('personal_task_id', v_task));

  return v_task;
end;
$$;

create or replace function public.list_reminders(
  p_view      text,
  p_query     text default null,
  p_link_type text default null,
  p_scope     text default null,
  p_creator   text default null,
  p_from      date default null,
  p_to        date default null,
  p_limit     integer default 30,
  p_offset    integer default 0
)
returns table (id uuid, total bigint)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_tz        constant text := 'Europe/Zurich';
  v_today     date := (now() at time zone v_tz)::date;
  v_day_start timestamptz := (v_today::timestamp) at time zone v_tz;
  v_day_end   timestamptz := ((v_today + 1)::timestamp) at time zone v_tz;
  v_uid       uuid := (select auth.uid());
  v_like      text;
begin
  if nullif(btrim(coalesce(p_query, '')), '') is not null then
    v_like := '%' || replace(replace(replace(btrim(p_query), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;

  return query
  select r.id, count(*) over () as total
    from public.reminders r
    left join public.customers c           on c.id = r.customer_id
    left join public.orders o              on o.id = r.order_id
    left join public.incidents i           on i.id = r.incident_id
    left join public.goods_receptions g    on g.id = r.goods_reception_id
    left join public.tasks t               on t.id = r.task_id
    left join public.inventory_instances v on v.id = r.inventory_instance_id
    left join public.products pr           on pr.id = r.product_id
   where case p_view
           when 'today'     then r.status = 'open' and r.next_at >= v_day_start and r.next_at < v_day_end
           when 'overdue'   then r.status = 'open' and r.next_at < now()
           when 'upcoming'  then r.status = 'open' and r.next_at >= v_day_end
           when 'shared'    then r.status = 'open' and r.is_shared
           when 'completed' then r.status in ('completed', 'converted')
           when 'cancelled' then r.status = 'cancelled'
           else r.status = 'open'
         end
     and (p_scope is null
          or (p_scope = 'personal' and not r.is_shared)
          or (p_scope = 'shared' and r.is_shared))
     and (p_creator is null
          or (p_creator = 'me' and r.created_by = v_uid)
          or (p_creator = 'others' and r.created_by <> v_uid))
     and (p_link_type is null
          or (p_link_type = 'none' and num_nonnulls(r.customer_id, r.order_id, r.incident_id,
                r.goods_reception_id, r.task_id, r.inventory_instance_id, r.product_id,
                r.event_id, r.marketing_post_id, r.marketing_request_id, r.hr_note_id) = 0)
          or (p_link_type = 'customer'        and r.customer_id is not null)
          or (p_link_type = 'order'           and r.order_id is not null)
          or (p_link_type = 'incident'        and r.incident_id is not null)
          or (p_link_type = 'goods_reception' and r.goods_reception_id is not null)
          or (p_link_type = 'task'            and r.task_id is not null)
          or (p_link_type = 'inventory'       and r.inventory_instance_id is not null)
          or (p_link_type = 'product'         and r.product_id is not null)
          or (p_link_type = 'event'             and r.event_id is not null)
          or (p_link_type = 'marketing_post'    and r.marketing_post_id is not null)
          or (p_link_type = 'marketing_request' and r.marketing_request_id is not null)
          or (p_link_type = 'hr_note'           and r.hr_note_id is not null))
     and (p_from is null or (r.next_at at time zone v_tz)::date >= p_from)
     and (p_to   is null or (r.next_at at time zone v_tz)::date <= p_to)
     and (v_like is null
          or r.title ilike v_like
          or r.notes ilike v_like
          or c.name ilike v_like
          or ('#' || o.reference::text) ilike v_like
          or i.incident_number ilike v_like
          or g.reception_number ilike v_like
          or t.title ilike v_like
          or v.name_snapshot ilike v_like
          or pr.name ilike v_like
          or pr.family ilike v_like
          or pr.code ilike v_like
          or exists (
               select 1 from public.reminder_participants rp
                 join public.profiles p on p.id = rp.user_id
                where rp.reminder_id = r.id
                  and (p.name ilike v_like or p.email ilike v_like)
             ))
   order by
     case when p_view in ('completed', 'cancelled') then null else r.next_at end asc nulls last,
     case when p_view in ('completed', 'cancelled')
          then coalesce(r.completed_at, r.converted_at, r.cancelled_at) end desc nulls last,
     r.created_at desc
   limit least(greatest(coalesce(p_limit, 30), 1), 100)
   offset greatest(coalesce(p_offset, 0), 0);
end;
$$;
