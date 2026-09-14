-- ============================================================
-- Reminders and Personal Tasks.
--
-- Three things that must never be confused:
--
--   Operational Task  team work. tasks / task_occurrences. UNTOUCHED here.
--   Personal Task     my own action. personal_tasks. Owner-only.
--   Reminder          "don't forget this". reminders. Participants-only.
--
-- WHY personal_tasks IS NOT A KIND OF tasks
--
-- Extending tasks with a kind column was considered and rejected. Every
-- approved user reads every task, occurrence and comment (RLS "approved
-- read"), and nine application queries — the dashboard, the calendar, the
-- history screen, the task statistics in Reports, the admin task list, the
-- schedule health check — read those tables without a filter that would
-- exclude a new kind. Permissive policies combine with OR, so owner-only
-- visibility could not be added beside them; they would all have to be
-- rewritten. A personal task would have been one missed WHERE clause away
-- from appearing in somebody else's statistics. A separate owner-only table
-- makes that impossible rather than merely avoided.
--
-- WHY WRITES GO THROUGH FUNCTIONS
--
-- A reminder write touches three tables (the row, its participants, its
-- history) and carries rules RLS cannot express: only the creator edits or
-- cancels, only eligible users may be added, a shared reminder cannot be
-- converted. Direct writes are therefore not granted at all; the functions
-- below are the only way in, as with task occurrences.
--
-- PRIVACY
--
-- A reminder is visible only to its participants. The creator is always a
-- participant; a personal reminder has exactly one. Admins included: this
-- application already keeps private rows private from admins
-- (push_subscriptions), and nothing here asks for an exception.
-- ============================================================

-- ---------- capability ----------

insert into public.permission_catalog (key, module, is_configurable, sort_order) values
  ('reminders.use', 'reminders', true, 196);

-- Admin is not a row: has_permission() short-circuits for admins.
insert into public.role_permissions (role, permission) values
  ('manager',    'reminders.use'),
  ('power_user', 'reminders.use');

/*
 * May THIS user (not the caller) use reminders?
 *
 * has_permission() answers for auth.uid(); choosing participants and sending
 * notifications need the same answer about somebody else.
 */
create or replace function public.reminders_eligible(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.profiles p
     where p.id = p_user
       and p.status = 'approved'
       and (
         p.role = 'admin'
         or exists (
           select 1 from public.role_permissions rp
            where rp.role = p.role and rp.permission = 'reminders.use'
         )
       )
  );
$$;

revoke all on function public.reminders_eligible(uuid) from public;
grant execute on function public.reminders_eligible(uuid) to authenticated;

-- ---------- personal tasks ----------

create table public.personal_tasks (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references public.profiles (id) on delete cascade,
  title       text not null,
  notes       text,
  due_date    date,
  due_time    time,
  status      text not null default 'open',

  -- Linked entity: real foreign keys, at most one set. A polymorphic
  -- (type, id) pair could not be a foreign key, so it could silently point at
  -- nothing. SET NULL rather than CASCADE: a deleted order must not take
  -- somebody's own to-do with it.
  customer_id           uuid references public.customers (id)           on delete set null,
  order_id              uuid references public.orders (id)              on delete set null,
  incident_id           uuid references public.incidents (id)           on delete set null,
  goods_reception_id    uuid references public.goods_receptions (id)    on delete set null,
  task_id               uuid references public.tasks (id)               on delete set null,
  inventory_instance_id uuid references public.inventory_instances (id) on delete set null,
  product_id            uuid references public.products (id)            on delete set null,

  -- Set only by reminder_convert(); the foreign key is added below, once
  -- reminders exists.
  source_reminder_id uuid,

  completed_at timestamptz,
  cancelled_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint personal_tasks_title_present check (length(btrim(title)) between 1 and 200),
  constraint personal_tasks_notes_length check (notes is null or length(notes) <= 4000),
  constraint personal_tasks_status_known check (status in ('open', 'completed', 'cancelled')),
  constraint personal_tasks_time_needs_date check (due_time is null or due_date is not null),
  constraint personal_tasks_one_link check (
    num_nonnulls(customer_id, order_id, incident_id, goods_reception_id,
                 task_id, inventory_instance_id, product_id) <= 1
  ),
  constraint personal_tasks_stamps_match_status check (
    (status = 'completed') = (completed_at is not null)
    and (status = 'cancelled') = (cancelled_at is not null)
  )
);

create index personal_tasks_owner_status_idx on public.personal_tasks (owner_id, status, due_date);
create index personal_tasks_source_idx on public.personal_tasks (source_reminder_id) where source_reminder_id is not null;

create trigger personal_tasks_set_updated_at before update on public.personal_tasks
  for each row execute function public.set_updated_at();

comment on table public.personal_tasks is
  'A user''s own action. Owner-only. Deliberately NOT a kind of tasks: nothing that reads operational tasks can see these.';

-- ---------- reminders ----------

create table public.reminders (
  id          uuid primary key default gen_random_uuid(),
  created_by  uuid not null references public.profiles (id) on delete cascade,
  title       text not null,
  notes       text,

  -- The moment, never a bare local time. `timezone` is what the wall-clock
  -- time was chosen in, and what a recurrence keeps: "every Monday 09:00" in
  -- Zurich stays 09:00 across the DST change rather than drifting an hour.
  due_at      timestamptz not null,
  timezone    text not null default 'Europe/Zurich',

  recurrence        text not null default 'none',
  -- The first occurrence. Every later one is counted from here, so a monthly
  -- reminder on the 31st lands on the 30th in April and back on the 31st in
  -- May, instead of stepping from the previous month and drifting to the 28th.
  recurrence_anchor timestamptz,

  -- Optional early warning. Null means "at the time", which is the default.
  notify_before_minutes integer,

  -- A snooze moves when the reminder next fires without rewriting when it
  -- was due, so history still says what was originally asked for.
  snoozed_until timestamptz,
  next_at       timestamptz generated always as (coalesce(snoozed_until, due_at)) stored,

  -- Denormalised from the participant count, kept by the functions below.
  -- Filtering "shared" is on every list screen; counting rows per reminder
  -- to answer it would be a join on every page.
  is_shared   boolean not null default false,

  status      text not null default 'open',

  customer_id           uuid references public.customers (id)           on delete set null,
  order_id              uuid references public.orders (id)              on delete set null,
  incident_id           uuid references public.incidents (id)           on delete set null,
  goods_reception_id    uuid references public.goods_receptions (id)    on delete set null,
  task_id               uuid references public.tasks (id)               on delete set null,
  inventory_instance_id uuid references public.inventory_instances (id) on delete set null,
  product_id            uuid references public.products (id)            on delete set null,

  personal_task_id uuid references public.personal_tasks (id) on delete set null,

  completed_at  timestamptz,
  completed_by  uuid references public.profiles (id) on delete set null,
  cancelled_at  timestamptz,
  cancelled_by  uuid references public.profiles (id) on delete set null,
  converted_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint reminders_title_present check (length(btrim(title)) between 1 and 200),
  constraint reminders_notes_length check (notes is null or length(notes) <= 4000),
  constraint reminders_status_known check (status in ('open', 'completed', 'cancelled', 'converted')),
  constraint reminders_recurrence_known check (recurrence in ('none', 'daily', 'weekdays', 'weekly', 'monthly')),
  constraint reminders_recurring_has_anchor check ((recurrence = 'none') = (recurrence_anchor is null)),
  constraint reminders_notify_before_known check (
    notify_before_minutes is null or notify_before_minutes in (5, 15, 30, 60, 120, 1440)
  ),
  constraint reminders_one_link check (
    num_nonnulls(customer_id, order_id, incident_id, goods_reception_id,
                 task_id, inventory_instance_id, product_id) <= 1
  ),
  constraint reminders_stamps_match_status check (
    (status = 'completed') = (completed_at is not null)
    and (status = 'cancelled') = (cancelled_at is not null)
    and (status = 'converted') = (converted_at is not null)
  )
);

alter table public.personal_tasks
  add constraint personal_tasks_source_reminder_fkey
  foreign key (source_reminder_id) references public.reminders (id) on delete set null;

create index reminders_open_next_idx on public.reminders (next_at) where status = 'open';
create index reminders_status_next_idx on public.reminders (status, next_at);
create index reminders_created_by_idx on public.reminders (created_by);
create index reminders_created_at_idx on public.reminders (created_at);
create index reminders_recurrence_idx on public.reminders (recurrence) where recurrence <> 'none';
create index reminders_customer_idx on public.reminders (customer_id) where customer_id is not null;
create index reminders_order_idx on public.reminders (order_id) where order_id is not null;
create index reminders_incident_idx on public.reminders (incident_id) where incident_id is not null;
create index reminders_reception_idx on public.reminders (goods_reception_id) where goods_reception_id is not null;
create index reminders_task_idx on public.reminders (task_id) where task_id is not null;
create index reminders_inventory_idx on public.reminders (inventory_instance_id) where inventory_instance_id is not null;
create index reminders_product_idx on public.reminders (product_id) where product_id is not null;
create index reminders_personal_task_idx on public.reminders (personal_task_id) where personal_task_id is not null;

create trigger reminders_set_updated_at before update on public.reminders
  for each row execute function public.set_updated_at();

comment on table public.reminders is
  '"Don''t forget this." Visible to participants only. Never an assignment: a shared reminder names who is aware, not who is responsible.';

-- ---------- participants ----------

create table public.reminder_participants (
  reminder_id uuid not null references public.reminders (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  added_by    uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  primary key (reminder_id, user_id)
);

-- The primary key serves "who is on this reminder"; this serves the far more
-- frequent "which reminders am I on", which every list starts from.
create index reminder_participants_user_idx on public.reminder_participants (user_id, reminder_id);

-- ---------- history ----------

create table public.reminder_events (
  id          uuid primary key default gen_random_uuid(),
  reminder_id uuid not null references public.reminders (id) on delete cascade,
  actor_id    uuid references public.profiles (id) on delete set null,
  action      text not null,
  detail      jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),

  constraint reminder_events_action_known check (action in (
    'created', 'edited', 'participant_added', 'participant_removed',
    'snoozed', 'completed', 'occurrence_completed', 'cancelled', 'converted'
  ))
);

create index reminder_events_reminder_idx on public.reminder_events (reminder_id, created_at);

comment on table public.reminder_events is
  'What happened to a reminder, written by the reminder_* functions in the same transaction as the change.';

-- ---------- notification ledger ----------

/*
 * One row per alert that has gone out. The unique key is what makes a run
 * that overlaps another harmless: the second insert fails and the second run
 * skips.
 *
 * slot_at is the moment the alert belongs to (reminders.next_at when it was
 * sent). Snoozing or completing a recurring occurrence moves next_at, so the
 * new moment gets its own alerts without anything having to be cleared.
 */
create table public.reminder_notifications (
  id          uuid primary key default gen_random_uuid(),
  reminder_id uuid not null references public.reminders (id) on delete cascade,
  kind        text not null,
  step        smallint not null default 0,
  slot_at     timestamptz not null,
  recipients  integer not null default 0,
  sent_at     timestamptz not null default now(),

  constraint reminder_notifications_kind_known check (kind in ('before', 'due', 'overdue')),
  constraint reminder_notifications_once unique (reminder_id, kind, step, slot_at)
);

create index reminder_notifications_reminder_idx on public.reminder_notifications (reminder_id, slot_at);

-- ---------- row level security ----------

alter table public.personal_tasks         enable row level security;
alter table public.reminders              enable row level security;
alter table public.reminder_participants  enable row level security;
alter table public.reminder_events        enable row level security;
alter table public.reminder_notifications enable row level security;

create or replace function public.is_reminder_participant(p_reminder uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.reminder_participants rp
     where rp.reminder_id = p_reminder and rp.user_id = (select auth.uid())
  );
$$;

revoke all on function public.is_reminder_participant(uuid) from public;
grant execute on function public.is_reminder_participant(uuid) to authenticated;

create policy "reminders: participants read" on public.reminders
  for select to authenticated
  using (
    ( select has_permission('reminders.use'::text))
    and exists (
      select 1 from public.reminder_participants rp
       where rp.reminder_id = reminders.id and rp.user_id = ( select auth.uid())
    )
  );

create policy "reminder_participants: co-participants read" on public.reminder_participants
  for select to authenticated
  using (( select has_permission('reminders.use'::text)) and public.is_reminder_participant(reminder_id));

create policy "reminder_events: participants read" on public.reminder_events
  for select to authenticated
  using (( select has_permission('reminders.use'::text)) and public.is_reminder_participant(reminder_id));

-- reminder_notifications: no policies. Written and read by the scheduler
-- with the service role only.

-- No insert/update/delete policies on reminders, participants or events:
-- the functions below are the only writers.

create policy "personal_tasks: owner reads" on public.personal_tasks
  for select to authenticated
  using (owner_id = ( select auth.uid()) and ( select has_permission('reminders.use'::text)));

create policy "personal_tasks: owner creates" on public.personal_tasks
  for insert to authenticated
  with check (owner_id = ( select auth.uid()) and ( select has_permission('reminders.use'::text)));

create policy "personal_tasks: owner updates" on public.personal_tasks
  for update to authenticated
  using (owner_id = ( select auth.uid()) and ( select has_permission('reminders.use'::text)))
  with check (owner_id = ( select auth.uid()) and ( select has_permission('reminders.use'::text)));

-- No delete: completed and cancelled tasks stay as history.

/*
 * Column grants for personal_tasks.
 *
 * source_reminder_id is the audit trail of a conversion, so only
 * reminder_convert() may set it. RLS is row-level and cannot say that; column
 * privileges can. Supabase grants whole tables to authenticated by default,
 * which covers every column, so the table grant is withdrawn first.
 */
revoke insert, update on public.personal_tasks from authenticated, anon;
grant insert (owner_id, title, notes, due_date, due_time, status,
              customer_id, order_id, incident_id, goods_reception_id,
              task_id, inventory_instance_id, product_id,
              completed_at, cancelled_at)
  on public.personal_tasks to authenticated;
grant update (title, notes, due_date, due_time, status,
              customer_id, order_id, incident_id, goods_reception_id,
              task_id, inventory_instance_id, product_id,
              completed_at, cancelled_at)
  on public.personal_tasks to authenticated;

revoke insert, update, delete on public.reminders, public.reminder_participants,
  public.reminder_events, public.reminder_notifications from authenticated, anon;

-- ---------- helpers for the functions ----------

create or replace function public.reminder_guard()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null or not public.has_permission('reminders.use') then
    raise exception 'not_authorized';
  end if;
  return v_uid;
end;
$$;

revoke all on function public.reminder_guard() from public;

-- ---------- create / edit ----------

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
       or p_link_type not in ('customer', 'order', 'incident', 'goods_reception', 'task', 'inventory', 'product')
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
      customer_id, order_id, incident_id, goods_reception_id, task_id, inventory_instance_id, product_id
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
      case when p_link_type = 'product'         then p_link_id end
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
      product_id            = case when p_link_type = 'product'         then p_link_id end
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

-- ---------- snooze / complete / cancel / convert ----------

create or replace function public.reminder_snooze(p_id uuid, p_until timestamptz)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.reminder_guard();
  v_row public.reminders;
begin
  select * into v_row from public.reminders where id = p_id for update;
  if not found or not public.is_reminder_participant(p_id) then raise exception 'reminder_not_found'; end if;
  if v_row.status <> 'open' then raise exception 'reminder_closed'; end if;
  if p_until is null or p_until <= now() then raise exception 'snooze_in_past'; end if;
  if p_until > now() + interval '1 year' then raise exception 'snooze_too_far'; end if;

  update public.reminders set snoozed_until = p_until where id = p_id;

  insert into public.reminder_events (reminder_id, actor_id, action, detail)
  values (p_id, v_uid, 'snoozed', jsonb_build_object('from', v_row.next_at, 'until', p_until));
end;
$$;

/*
 * Complete a reminder, or the current occurrence of a recurring one.
 *
 * For a recurring reminder the caller supplies the next occurrence, computed
 * by the tested recurrence code in src/domain/reminders. The database checks
 * only that it really is later — it is the participant's own reminder, and
 * the rule is one of four simple steps, not a place where a wrong value can
 * reach anybody else.
 */
create or replace function public.reminder_complete(p_id uuid, p_next_due_at timestamptz)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.reminder_guard();
  v_row public.reminders;
begin
  select * into v_row from public.reminders where id = p_id for update;
  if not found or not public.is_reminder_participant(p_id) then raise exception 'reminder_not_found'; end if;
  if v_row.status <> 'open' then raise exception 'reminder_closed'; end if;

  if v_row.recurrence = 'none' then
    update public.reminders
       set status = 'completed', completed_at = now(), completed_by = v_uid
     where id = p_id;
    insert into public.reminder_events (reminder_id, actor_id, action, detail)
    values (p_id, v_uid, 'completed', jsonb_build_object('due_at', v_row.due_at));
  else
    if p_next_due_at is null or p_next_due_at <= v_row.due_at then
      raise exception 'invalid_next_occurrence';
    end if;
    update public.reminders
       set due_at = p_next_due_at, snoozed_until = null
     where id = p_id;
    insert into public.reminder_events (reminder_id, actor_id, action, detail)
    values (p_id, v_uid, 'occurrence_completed',
            jsonb_build_object('due_at', v_row.due_at, 'next_due_at', p_next_due_at));
  end if;
end;
$$;

create or replace function public.reminder_cancel(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.reminder_guard();
  v_row public.reminders;
begin
  select * into v_row from public.reminders where id = p_id for update;
  if not found or not public.is_reminder_participant(p_id) then raise exception 'reminder_not_found'; end if;
  -- Cancelling a shared reminder ends it for everybody on it, so it is the
  -- creator's call, as editing is.
  if v_row.created_by <> v_uid then raise exception 'not_authorized'; end if;
  if v_row.status <> 'open' then raise exception 'reminder_closed'; end if;

  update public.reminders
     set status = 'cancelled', cancelled_at = now(), cancelled_by = v_uid
   where id = p_id;

  insert into public.reminder_events (reminder_id, actor_id, action, detail)
  values (p_id, v_uid, 'cancelled', jsonb_build_object('recurrence', v_row.recurrence));
end;
$$;

/*
 * Reminder -> Personal Task. NEVER an operational task.
 *
 * The only table written besides the reminder is personal_tasks, owned by the
 * caller. Nothing here can reach tasks or task_occurrences.
 *
 * A shared reminder is refused: converting it would end it for every other
 * participant and hand the follow-up to one of them, which is exactly the
 * assignment a shared reminder is not.
 */
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
    source_reminder_id
  ) values (
    v_uid, v_row.title, v_row.notes, v_local::date, v_local::time,
    v_row.customer_id, v_row.order_id, v_row.incident_id, v_row.goods_reception_id,
    v_row.task_id, v_row.inventory_instance_id, v_row.product_id,
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

-- ---------- reads ----------

create or replace function public.reminder_participant_candidates()
returns table (id uuid, name text, email text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.reminder_guard();
  return query
    select p.id, p.name, p.email
      from public.profiles p
     where public.reminders_eligible(p.id)
     order by coalesce(nullif(p.name, ''), p.email);
end;
$$;

/*
 * One page of reminders for a list view, with search.
 *
 * SECURITY INVOKER: every table below is read under the caller's own RLS, so
 * the search can only ever match reminders they participate in, and can only
 * match on a linked order or incident they could open anyway.
 *
 * Returns ids and the total; the page then reads those rows with their
 * embeds in one PostgREST call.
 */
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
                r.goods_reception_id, r.task_id, r.inventory_instance_id, r.product_id) = 0)
          or (p_link_type = 'customer'        and r.customer_id is not null)
          or (p_link_type = 'order'           and r.order_id is not null)
          or (p_link_type = 'incident'        and r.incident_id is not null)
          or (p_link_type = 'goods_reception' and r.goods_reception_id is not null)
          or (p_link_type = 'task'            and r.task_id is not null)
          or (p_link_type = 'inventory'       and r.inventory_instance_id is not null)
          or (p_link_type = 'product'         and r.product_id is not null))
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

/* How many of my reminders need attention now — the nav badge. */
create or replace function public.reminder_attention_count()
returns integer
language sql
stable
security invoker
set search_path = ''
as $$
  select count(*)::integer
    from public.reminders r
   where r.status = 'open'
     and r.next_at <= now();
$$;

revoke all on function
  public.reminder_save(uuid, text, text, timestamptz, text, text, integer, text, uuid, uuid[]),
  public.reminder_snooze(uuid, timestamptz),
  public.reminder_complete(uuid, timestamptz),
  public.reminder_cancel(uuid),
  public.reminder_convert(uuid),
  public.reminder_participant_candidates(),
  public.list_reminders(text, text, text, text, text, date, date, integer, integer),
  public.reminder_attention_count()
from public;

grant execute on function
  public.reminder_save(uuid, text, text, timestamptz, text, text, integer, text, uuid, uuid[]),
  public.reminder_snooze(uuid, timestamptz),
  public.reminder_complete(uuid, timestamptz),
  public.reminder_cancel(uuid),
  public.reminder_convert(uuid),
  public.reminder_participant_candidates(),
  public.list_reminders(text, text, text, text, text, date, date, integer, integer),
  public.reminder_attention_count()
to authenticated;

-- ---------- scheduler ----------

/*
 * Reminders are set for a minute of the day, so they cannot ride the order
 * notifier's quarter-hourly 05:00-20:59 UTC window: a reminder for 22:30
 * would never fire. A separate job every five minutes, all day, calls a
 * separate route, so the order and inventory checks keep their own cadence.
 */
create or replace function private.notify_reminders()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  base_url text;
  secret   text;
  req_id   bigint;
begin
  select decrypted_secret into base_url from vault.decrypted_secrets where name = 'app_url';
  select decrypted_secret into secret   from vault.decrypted_secrets where name = 'cron_secret';

  if base_url is null or secret is null then
    raise notice 'reminder notifier skipped: set the app_url and cron_secret vault secrets';
    return;
  end if;

  select net.http_get(
    url     => rtrim(base_url, '/') || '/api/cron/reminders',
    headers => jsonb_build_object('Authorization', 'Bearer ' || secret),
    timeout_milliseconds => 30000
  ) into req_id;

  insert into private.notification_dispatch (request_id) values (req_id);
end;
$$;

revoke all on function private.notify_reminders() from public;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'reminder-notifications') then
    perform cron.unschedule('reminder-notifications');
  end if;

  perform cron.schedule(
    'reminder-notifications',
    '*/5 * * * *',
    $job$select private.notify_reminders();$job$
  );
end;
$$;
