-- ============================================================
-- Absence & Coverage, step 3: what the covering person may do.
--
--   coverage_permission_grants   a permission given with one coverage
--       period: active for its coverer exactly from its start to its end
--       (Zurich time), and only while the period stands and the absence is
--       approved. Never deleted: revoked_at. Only operational permissions
--       (permission_catalog.is_configurable) — never users, roles,
--       permission settings or system settings.
--   has_permission()             true as well during an active grant: every
--       rule that asks it honours the grant, and stops when the period ends
--       — no job has to run.
--   get_viewer()                 the screens see the active grants too.
--
--   Their work: during the period, the covering person sees and resolves the
--   absent person's activities and counts their inventories, as they could
--   themselves. task_occurrences.covered_assignment_id records that someone
--   resolved another person's activity while covering them; completed_by is
--   who really did it, assignee_id stays whose it was.
--
-- Who gives a permission: an approver, any operational one; the absent
-- person, only one they hold themselves.
-- ============================================================

-- ---------- the active coverage ----------

/* The caller covers this person right now. */
create or replace function public.covering_for(p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_profile_id is not null and exists (
    select 1
      from public.coverage_assignments c
      join public.absences a on a.id = c.absence_id
     where c.coverer_id = (select auth.uid())
       and a.profile_id = p_profile_id
       and c.removed_at is null
       and a.status = 'approved'
       and now() >= ((c.cover_date + c.start_time) at time zone 'Europe/Zurich')
       and now() <  ((c.cover_date + c.end_time) at time zone 'Europe/Zurich')
  );
$$;

revoke all on function public.covering_for(uuid) from public, anon;
grant execute on function public.covering_for(uuid) to authenticated;

-- ---------- grants ----------

create table public.coverage_permission_grants (
  id            uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.coverage_assignments (id) on delete cascade,
  permission    text not null references public.permission_catalog (key) on delete cascade,
  granted_by    uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  revoked_at    timestamptz,
  revoked_by    uuid references public.profiles (id) on delete set null
);

create unique index coverage_grants_one_live on public.coverage_permission_grants (assignment_id, permission) where revoked_at is null;
create index coverage_grants_permission_idx on public.coverage_permission_grants (permission) where revoked_at is null;

/* Operational only; an approver gives any, the absent person only what they hold. */
create or replace function public.guard_coverage_grant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if new.assignment_id is distinct from old.assignment_id or new.permission is distinct from old.permission
       or old.revoked_at is not null then
      raise exception 'coverage_grant_locked' using errcode = '42501';
    end if;
    return new;
  end if;
  if not exists (select 1 from public.permission_catalog c where c.key = new.permission and c.is_configurable) then
    raise exception 'coverage_grant_not_operational' using errcode = '42501';
  end if;
  if (select auth.uid()) is not null
     and not public.is_absence_approver()
     and not public.has_permission(new.permission) then
    raise exception 'coverage_grant_not_held' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger coverage_permission_grants_guard
  before insert or update on public.coverage_permission_grants
  for each row execute function public.guard_coverage_grant();

/* Given and revoked go into the coverage history. */
create or replace function public.log_coverage_grant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_action text;
  v_c public.coverage_assignments%rowtype;
begin
  if tg_op = 'INSERT' then
    v_action := 'permission_granted';
  elsif new.revoked_at is not null and old.revoked_at is null then
    v_action := 'permission_revoked';
  else
    return new;
  end if;
  select * into v_c from public.coverage_assignments where id = new.assignment_id;
  insert into public.coverage_events (assignment_id, absence_id, actor_id, action, detail)
  values (new.assignment_id, v_c.absence_id, (select auth.uid()), v_action, jsonb_build_object(
    'permission', new.permission, 'coverer_id', v_c.coverer_id, 'cover_date', v_c.cover_date,
    'start_time', v_c.start_time, 'end_time', v_c.end_time));
  return new;
end;
$$;

create trigger coverage_permission_grants_log
  after insert or update on public.coverage_permission_grants
  for each row execute function public.log_coverage_grant();

/*
 * A period given to someone else, or taken off the plan, takes its grants
 * with it: they were given to that person for that period.
 */
create or replace function public.revoke_grants_with_period()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (new.removed_at is not null and old.removed_at is null) or new.coverer_id is distinct from old.coverer_id then
    update public.coverage_permission_grants
       set revoked_at = now(), revoked_by = (select auth.uid())
     where assignment_id = new.id and revoked_at is null;
  end if;
  return new;
end;
$$;

create trigger coverage_assignments_revoke_grants
  after update on public.coverage_assignments
  for each row execute function public.revoke_grants_with_period();

alter table public.coverage_permission_grants enable row level security;

create policy "coverage_grants: approved read" on public.coverage_permission_grants for select to authenticated
  using ((select public.is_approved()));
create policy "coverage_grants: planners give" on public.coverage_permission_grants for insert to authenticated
  with check (
    granted_by = (select auth.uid())
    and public.can_plan_coverage((select c.absence_id from public.coverage_assignments c where c.id = assignment_id))
  );
-- Revoked (revoked_at set) — never deleted.
create policy "coverage_grants: planners revoke" on public.coverage_permission_grants for update to authenticated
  using (public.can_plan_coverage((select c.absence_id from public.coverage_assignments c where c.id = assignment_id)))
  with check (public.can_plan_coverage((select c.absence_id from public.coverage_assignments c where c.id = assignment_id)));

/* The caller's permissions given with a coverage period happening now. */
create or replace function public.active_coverage_permissions()
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(distinct g.permission), '{}')
    from public.coverage_permission_grants g
    join public.coverage_assignments c on c.id = g.assignment_id
    join public.absences a on a.id = c.absence_id
    join public.profiles p on p.id = c.coverer_id
   where c.coverer_id = (select auth.uid())
     and p.status = 'approved'
     and g.revoked_at is null
     and c.removed_at is null
     and a.status = 'approved'
     and now() >= ((c.cover_date + c.start_time) at time zone 'Europe/Zurich')
     and now() <  ((c.cover_date + c.end_time) at time zone 'Europe/Zurich');
$$;

revoke all on function public.active_coverage_permissions() from public, anon;
grant execute on function public.active_coverage_permissions() to authenticated;

-- ---------- the permission check honours them ----------

create or replace function public.has_permission(p_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin()
      or exists (
        select 1
          from public.profiles p
          join public.role_permissions rp on rp.role = p.role
         where p.id = (select auth.uid())
           and p.status = 'approved'
           and rp.permission = p_key
      )
      -- A permission given with a coverage period, while it lasts.
      or p_key = any (public.active_coverage_permissions());
$$;

comment on function public.has_permission(text) is
  'Operational capability check. True for any approved admin; otherwise the caller''s role in role_permissions, or a permission given with a coverage period happening now.';

create or replace function public.get_viewer()
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'profile', to_jsonb(p),
    'permissions', (
      select coalesce(jsonb_agg(distinct x), '[]'::jsonb)
        from (
          select rp.permission as x from public.role_permissions rp where rp.role = p.role
          union
          select unnest(public.active_coverage_permissions())
        ) perms
    )
  )
  from public.profiles p
  where p.id = (select auth.uid());
$$;

comment on function public.get_viewer() is
  'The caller profile plus the permissions of their role and of any coverage period happening now, in one round trip.';

-- ---------- their activities ----------

alter table public.task_occurrences
  add column covered_assignment_id uuid references public.coverage_assignments (id) on delete set null;

create or replace function public.can_act_on_task_occurrence(p_task_id uuid, p_assignee_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    public.is_approved()
    and (
      (p_assignee_id is not null and p_assignee_id = (select auth.uid()))
      or (
        public.task_in_team_scope(p_task_id)
        and (
          (p_assignee_id is null and public.team_scope() is null)
          or public.has_permission('tasks.manage_occurrences')
        )
      )
      -- Covering its person right now. Last: the cheaper answers usually settle it.
      or public.covering_for(p_assignee_id)
    ),
    false
  );
$$;

comment on function public.can_act_on_task_occurrence(uuid, uuid) is
  'An occurrence is the caller''s to see and resolve when assigned to them, or to someone they cover right now; otherwise, when in their scope and either unassigned (not for a plain User) or they manage scheduled work.';

/* The task behind an occurrence the caller may see: their own, or of someone they cover now. */
create or replace function public.is_assigned_to_task(p_task_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.task_occurrences o
     where o.task_id = p_task_id
       and (o.assignee_id = (select auth.uid()) or public.covering_for(o.assignee_id))
  );
$$;

/* Resolved by someone covering its person: which coverage period. Reopened: cleared. */
create or replace function public.mark_covered_occurrence()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status is distinct from old.status then
    if new.status = 'pending' then
      new.covered_assignment_id := null;
    elsif (select auth.uid()) is not null and old.assignee_id is not null and old.assignee_id <> (select auth.uid()) then
      new.covered_assignment_id := (
        select c.id
          from public.coverage_assignments c
          join public.absences a on a.id = c.absence_id
         where c.coverer_id = (select auth.uid())
           and a.profile_id = old.assignee_id
           and c.removed_at is null
           and a.status = 'approved'
           and now() >= ((c.cover_date + c.start_time) at time zone 'Europe/Zurich')
           and now() <  ((c.cover_date + c.end_time) at time zone 'Europe/Zurich')
         limit 1);
    end if;
  end if;
  return new;
end;
$$;

create trigger occurrences_mark_covered
  before update on public.task_occurrences
  for each row execute function public.mark_covered_occurrence();

-- ---------- their inventories ----------

create or replace function public.inventory_is_mine(p_instance_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
           select 1 from public.inventory_assignments a
            where a.instance_id = p_instance_id
              and (a.user_id = (select auth.uid()) or public.covering_for(a.user_id))
         )
      or exists (
           select 1 from public.inventory_edit_grants g
            where g.user_id = (select auth.uid())
              and g.revoked_at is null
              and now() >= g.starts_at
              and now() <= g.ends_at
              and (g.scope = 'all' or g.instance_id = p_instance_id)
         );
$$;

create or replace function public.inventory_can_edit(p_instance_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := (select auth.uid());
  v_date date;
  v_completed timestamptz;
begin
  if v_uid is null or not public.is_approved() then
    return false;
  end if;
  -- is_admin() is implied by has_permission(), which short-circuits on it.
  if public.has_permission('inventory.manage_instances') then
    return true;
  end if;

  select i.inventory_date, i.completed_at
    into v_date, v_completed
    from public.inventory_instances i
   where i.id = p_instance_id;

  if not found then
    return false;
  end if;

  -- An explicit, time-boxed, attributed grant. Overrides both the assignment
  -- requirement and the deadline, which is the entire purpose of granting one.
  -- It expires by ceasing to match, never by a cleanup job.
  if exists (
    select 1
      from public.inventory_edit_grants g
     where g.user_id = v_uid
       and g.revoked_at is null
       and now() >= g.starts_at
       and now() <= g.ends_at
       and (g.scope = 'all' or g.instance_id = p_instance_id)
  ) then
    return true;
  end if;

  -- Otherwise: assigned — to them, or to someone they cover right now —
  -- still open, still before the deadline. All three.
  return v_completed is null
     and now() <= public.inventory_edit_deadline(v_date)
     and exists (
       select 1 from public.inventory_assignments a
        where a.instance_id = p_instance_id
          and (a.user_id = v_uid or public.covering_for(a.user_id))
     );
end;
$$;
