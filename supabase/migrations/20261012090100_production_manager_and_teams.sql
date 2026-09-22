-- ============================================================
-- Production manager role, part 2 of 2 — and teams.
--
-- The business has two teams: Producción and Operaciones. The production
-- manager runs Producción and must be unable to touch Operaciones' people
-- or work. Roles alone cannot say that — permissions are role-wide — so
-- people, tasks and incidents now carry a team, and "team scope" narrows
-- what a scoped caller sees and manages.
--
--   team scope      the caller's team, for the roles that are scoped:
--                     user                — sees only their team's tasks
--                     production_manager  — sees and manages only their team's
--                   NULL for admin, manager and power_user: they see everything,
--                   exactly as before.
--
-- What the production manager holds (seeded below; admins can change it in
-- the permission matrix):
--   inventories and goods reception — shared with Operaciones, not split
--   tasks, incidents, push messages  — Producción's only (team scope)
--   incidents                        — reads all, manages Producción's
--   reports and CSV export
--   orders                           — READ ONLY, enforced by a trigger
--
-- Nothing changes for anyone until someone is put on Producción: every
-- existing person, task and incident is Operaciones.
-- ============================================================

create type public.team as enum ('production', 'operations');

comment on type public.team is 'Producción or Operaciones. Scopes what users and production managers see and manage.';


-- ============================================================
-- people
-- ============================================================
alter table public.profiles
  add column team public.team not null default 'operations';

comment on column public.profiles.team is
  'Which team the person works in. Only matters for scoped roles (user, production_manager); set by an admin.';

/*
 * A production manager manages Producción, so their own team is Producción.
 * Forced rather than validated: an admin choosing the role should not also
 * have to remember the team, and a production manager on Operaciones would
 * silently manage the wrong people.
 */
create or replace function public.production_manager_team()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.role = 'production_manager' then
    new.team := 'production';
  end if;
  return new;
end;
$$;

create trigger profiles_production_manager_team
  before insert or update of role, team on public.profiles
  for each row execute function public.production_manager_team();


-- ============================================================
-- team scope
-- ============================================================
create or replace function public.team_scope()
returns public.team
language sql
stable
security definer
set search_path = ''
as $$
  select p.team
    from public.profiles p
   where p.id = (select auth.uid())
     and p.status = 'approved'
     and p.role in ('user', 'production_manager');
$$;

comment on function public.team_scope() is
  'The caller''s team when their role is team-scoped (user, production_manager); NULL means unscoped — sees everything.';

create or replace function public.in_team_scope(p_team public.team)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.team_scope() = p_team, true);
$$;

comment on function public.in_team_scope(public.team) is
  'True when the caller is unscoped, or the team is their own.';

/* Is this person inside the caller's scope? Used where a manager acts ON someone. */
create or replace function public.person_in_team_scope(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.team_scope() is null
      or exists (
        select 1 from public.profiles p
         where p.id = p_user_id and p.team = public.team_scope()
      );
$$;

revoke all on function public.team_scope() from public;
revoke all on function public.in_team_scope(public.team) from public;
revoke all on function public.person_in_team_scope(uuid) from public;
grant execute on function public.team_scope() to authenticated;
grant execute on function public.in_team_scope(public.team) to authenticated;
grant execute on function public.person_in_team_scope(uuid) to authenticated;


-- ============================================================
-- the role
-- ============================================================
create or replace function public.role_rank(r public.user_role)
returns integer
language sql
immutable
as $$
  select case r
    when 'admin'              then 4
    when 'manager'            then 3
    -- Beside the Power User: both run the day without changing its setup.
    -- The rank only opens the Gestión area; what is inside is permissions.
    when 'power_user'         then 2
    when 'production_manager' then 2
    when 'user'               then 1
  end;
$$;

alter table public.role_permissions drop constraint role_permissions_role_configurable;
alter table public.role_permissions add constraint role_permissions_role_configurable
  check (role in ('manager', 'power_user', 'production_manager'));

insert into public.role_permissions (role, permission) values
  ('production_manager', 'inventory.manage_instances'),
  ('production_manager', 'inventory.resolve_differences'),
  ('production_manager', 'inventory.grant_temporary_edit'),
  ('production_manager', 'goods_reception.manage_all'),
  ('production_manager', 'tasks.manage_occurrences'),
  ('production_manager', 'incidents.manage'),
  ('production_manager', 'incidents.view_all'),
  ('production_manager', 'notifications.send'),
  ('production_manager', 'reports.view'),
  ('production_manager', 'reports.export')
on conflict do nothing;


-- ============================================================
-- orders are read-only for the production manager
-- ============================================================
/*
 * One guard on the four tables every order change ends in — orders,
 * order_lines, order_boxes, lot_allocations — instead of edits to each RPC
 * (ready, shipped, boxes, shortfalls) and policy (lots). A path added later
 * cannot forget it. The service role (auth.uid() null) is unaffected.
 */
create or replace function public.guard_orders_read_only()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is not null and exists (
    select 1 from public.profiles p
     where p.id = (select auth.uid()) and p.role = 'production_manager'
  ) then
    raise exception 'orders_read_only' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger orders_read_only_guard
  before insert or update or delete on public.orders
  for each row execute function public.guard_orders_read_only();
create trigger order_lines_read_only_guard
  before insert or update or delete on public.order_lines
  for each row execute function public.guard_orders_read_only();
create trigger order_boxes_read_only_guard
  before insert or update or delete on public.order_boxes
  for each row execute function public.guard_orders_read_only();
create trigger lot_allocations_read_only_guard
  before insert or update or delete on public.lot_allocations
  for each row execute function public.guard_orders_read_only();


-- ============================================================
-- tasks
-- ============================================================
alter table public.tasks
  add column team public.team not null default 'operations';

comment on column public.tasks.team is
  'Whose work this is. Scoped users see only their team''s tasks; a production manager manages only Producción''s.';

create index tasks_team_idx on public.tasks (team);

/* Is this task assigned to the caller anywhere? Their own work stays visible whatever its team. */
create or replace function public.is_assigned_to_task(p_task_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.task_occurrences o
     where o.task_id = p_task_id and o.assignee_id = (select auth.uid())
  );
$$;

create or replace function public.task_in_team_scope(p_task_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.team_scope() is null
      or exists (
        select 1 from public.tasks t
         where t.id = p_task_id and t.team = public.team_scope()
      );
$$;

/*
 * Replaces can_act_on_occurrence(assignee) with a version that also knows
 * the team. An occurrence is the caller's to see and resolve when:
 *   it is assigned to them — always, whatever the team; or
 *   its task is in their team scope, AND it is unassigned or they manage
 *   scheduled work.
 */
create or replace function public.can_act_on_task_occurrence(p_task_id uuid, p_assignee_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_approved()
     and (
       p_assignee_id = (select auth.uid())
       or (
         public.task_in_team_scope(p_task_id)
         and (p_assignee_id is null or public.has_permission('tasks.manage_occurrences'))
       )
     );
$$;

revoke all on function public.is_assigned_to_task(uuid) from public;
revoke all on function public.task_in_team_scope(uuid) from public;
revoke all on function public.can_act_on_task_occurrence(uuid, uuid) from public;
grant execute on function public.is_assigned_to_task(uuid) to authenticated;
grant execute on function public.task_in_team_scope(uuid) to authenticated;
grant execute on function public.can_act_on_task_occurrence(uuid, uuid) to authenticated;

-- ---------- tasks ----------
drop policy if exists "tasks: approved read" on public.tasks;
create policy "tasks: approved read" on public.tasks
  for select to authenticated
  using (
    (select public.is_approved())
    and (public.in_team_scope(team) or public.is_assigned_to_task(id))
  );

/* Corrective actions belong to their incident's team, whoever creates them. */
create or replace function public.task_team_from_incident()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.incident_id is not null then
    select i.team into new.team from public.incidents i where i.id = new.incident_id;
  end if;
  return new;
end;
$$;

-- ---------- occurrences ----------
drop policy if exists "occurrences: approved read" on public.task_occurrences;
create policy "occurrences: approved read" on public.task_occurrences
  for select to authenticated
  using (public.can_act_on_task_occurrence(task_id, assignee_id));

drop policy if exists "occurrences: manager writes" on public.task_occurrences;
create policy "occurrences: manager writes" on public.task_occurrences
  for all to authenticated
  using ((select public.has_permission('tasks.manage_occurrences')) and public.task_in_team_scope(task_id))
  with check ((select public.has_permission('tasks.manage_occurrences')) and public.task_in_team_scope(task_id));

/*
 * complete/skip/block/reopen are SECURITY DEFINER and update by id, so the
 * read policy alone would not stop someone resolving another team's task by
 * its id. This guard is where resolving is decided, as it already was for
 * assigned work.
 */
create or replace function public.guard_assigned_occurrence()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status is distinct from old.status
     and (select auth.uid()) is not null
     and not public.can_act_on_task_occurrence(old.task_id, old.assignee_id) then
    if old.assignee_id is not null then
      raise exception 'not_assigned_to_you' using errcode = '42501';
    end if;
    raise exception 'not_your_team' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- ---------- comments and history follow their task ----------
drop policy if exists "comments: approved read" on public.task_comments;
create policy "comments: approved read" on public.task_comments
  for select to authenticated
  using ((select public.is_approved()) and (task_id is null or public.task_in_team_scope(task_id) or public.is_assigned_to_task(task_id)));

drop policy if exists "comments: approved insert own" on public.task_comments;
create policy "comments: approved insert own" on public.task_comments
  for insert to authenticated
  with check (
    (select public.is_approved()) and user_id = (select auth.uid())
    and (task_id is null or public.task_in_team_scope(task_id) or public.is_assigned_to_task(task_id))
  );

drop policy if exists "comments: author or manager deletes" on public.task_comments;
create policy "comments: author or manager deletes" on public.task_comments
  for delete to authenticated
  using (
    user_id = (select auth.uid())
    or ((select public.has_permission('tasks.manage_occurrences')) and (task_id is null or public.task_in_team_scope(task_id)))
  );

drop policy if exists "task_audit_log: task manage reads" on public.task_audit_log;
create policy "task_audit_log: task manage reads" on public.task_audit_log
  for select to authenticated
  using ((select public.has_permission('tasks.manage_occurrences')) and (task_id is null or public.task_in_team_scope(task_id)));


-- ============================================================
-- incidents
-- ============================================================
/*
 * Nullable only for the moment of insert: the trigger fills it from the
 * reporter's team when the caller did not choose one, then NOT NULL holds.
 */
alter table public.incidents add column team public.team;
update public.incidents i
   set team = coalesce((select p.team from public.profiles p where p.id = i.created_by), 'operations');
alter table public.incidents alter column team set not null;

comment on column public.incidents.team is
  'Whose incident this is — by default the reporter''s team. A production manager manages only Producción''s.';

create index incidents_team_idx on public.incidents (team);

create or replace function public.incident_default_team()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.team is null then
    new.team := coalesce(
      (select p.team from public.profiles p where p.id = coalesce(new.created_by, (select auth.uid()))),
      'operations'
    );
  end if;
  return new;
end;
$$;

create trigger incidents_default_team
  before insert on public.incidents
  for each row execute function public.incident_default_team();

-- Declared after the incidents column exists, since it reads it.
create trigger tasks_team_from_incident
  before insert or update of incident_id, team on public.tasks
  for each row execute function public.task_team_from_incident();

/* May the caller manage this incident? incidents.manage, within their team scope. */
create or replace function public.can_manage_incident(p_incident_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_permission('incidents.manage')
     and exists (
       select 1 from public.incidents i
        where i.id = p_incident_id and public.in_team_scope(i.team)
     );
$$;

revoke all on function public.can_manage_incident(uuid) from public;
grant execute on function public.can_manage_incident(uuid) to authenticated;

drop policy if exists "incidents: manage insert" on public.incidents;
create policy "incidents: manage insert" on public.incidents
  for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and (
      ((select public.has_permission('incidents.manage')) and public.in_team_scope(team))
      or (goods_reception_id is not null and (select public.is_goods_reception_assignee()))
    )
  );

-- USING and CHECK both scoped: a production manager can neither edit an
-- Operaciones incident nor move one of theirs over to Operaciones.
drop policy if exists "incidents: manage update" on public.incidents;
create policy "incidents: manage update" on public.incidents
  for update to authenticated
  using ((select public.has_permission('incidents.manage')) and public.in_team_scope(team))
  with check ((select public.has_permission('incidents.manage')) and public.in_team_scope(team));

drop policy if exists "incident_items: manage writes" on public.incident_affected_items;
create policy "incident_items: manage writes" on public.incident_affected_items
  for all to authenticated
  using (public.can_manage_incident(incident_id))
  with check (public.can_manage_incident(incident_id));

drop policy if exists "incident_replacements: manage writes" on public.incident_replacements;
create policy "incident_replacements: manage writes" on public.incident_replacements
  for all to authenticated
  using (public.can_manage_incident(incident_id))
  with check (public.can_manage_incident(incident_id));

drop policy if exists "incident_causes: manage writes" on public.incident_secondary_causes;
create policy "incident_causes: manage writes" on public.incident_secondary_causes
  for all to authenticated
  using (public.can_manage_incident(incident_id))
  with check (public.can_manage_incident(incident_id));

drop policy if exists "incident_evidence: manage insert" on public.incident_evidence;
create policy "incident_evidence: manage insert" on public.incident_evidence
  for insert to authenticated
  with check (public.can_manage_incident(incident_id) and uploaded_by = (select auth.uid()));

drop policy if exists "incident_evidence: uploader or manager deletes" on public.incident_evidence;
create policy "incident_evidence: uploader or manager deletes" on public.incident_evidence
  for delete to authenticated
  using (
    public.can_manage_incident(incident_id)
    and (uploaded_by = (select auth.uid()) or (select public.has_permission('incidents.close')))
  );

drop policy if exists "tasks: corrective actions" on public.tasks;
create policy "tasks: corrective actions" on public.tasks
  for insert to authenticated
  with check (frequency = 'one_off' and incident_id is not null and public.can_manage_incident(incident_id));

drop policy if exists "tasks: correct corrective actions" on public.tasks;
create policy "tasks: correct corrective actions" on public.tasks
  for update to authenticated
  using (frequency = 'one_off' and incident_id is not null and public.can_manage_incident(incident_id))
  with check (frequency = 'one_off' and incident_id is not null and public.can_manage_incident(incident_id));


-- ============================================================
-- acting on people: only within the team scope
-- ============================================================
/*
 * Assigning someone to an inventory, or granting them temporary edit, is
 * acting on that person. A production manager may do it for Producción
 * people only. A trigger covers the policy writes and the grant RPC alike.
 */
create or replace function public.guard_person_in_team_scope()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := case when tg_op = 'DELETE' then old.user_id else new.user_id end;
begin
  if (select auth.uid()) is not null and not public.person_in_team_scope(v_user) then
    raise exception 'not_your_team' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger inventory_assignments_team_scope
  before insert or update or delete on public.inventory_assignments
  for each row execute function public.guard_person_in_team_scope();

create trigger inventory_edit_grants_team_scope
  before insert or update or delete on public.inventory_edit_grants
  for each row execute function public.guard_person_in_team_scope();
