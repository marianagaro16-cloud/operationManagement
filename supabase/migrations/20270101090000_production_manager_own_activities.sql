-- ============================================================
-- The production manager works with the activities of the areas they run
-- (decided 2026-10-07).
--
-- 20261013090000 let the production manager see and act on every team's
-- activities, like a Power User. The business has now decided otherwise:
-- only the areas they run — their own team and those in team_managers
-- (Producción and Mantenimiento today). Operaciones' and Logística's
-- activities are no longer theirs to see or touch.
--
-- Still theirs, whatever the team: a day assigned to them or that they cover,
-- and the corrective action of an incident they manage.
--
-- Unchanged: push messages, assigning people to inventories and edit grants,
-- and incidents keep the rules they had.
--
-- Done with RESTRICTIVE policies on top of the existing ones, so no other
-- role's access moves, plus a guard on the days themselves for the functions
-- that write them outside the row rules.
-- ============================================================

/* Is the caller confined to the activities of the areas they run? */
create or replace function public.task_manager_limited()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
     where p.id = (select auth.uid()) and p.status = 'approved' and p.role = 'production_manager'
  );
$$;

/* By the row itself, so a task being added can be checked before it exists. */
create or replace function public.task_row_allowed(p_task_id uuid, p_team public.team, p_incident_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not public.task_manager_limited()
      or p_team = any (public.my_teams())
      or (p_incident_id is not null and public.can_manage_incident(p_incident_id))
      or public.is_assigned_to_task(p_task_id);
$$;

create or replace function public.task_allowed(p_task_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not public.task_manager_limited()
      or exists (
        select 1 from public.tasks t
         where t.id = p_task_id and public.task_row_allowed(t.id, t.team, t.incident_id)
      );
$$;

revoke all on function public.task_manager_limited() from public, anon;
revoke all on function public.task_row_allowed(uuid, public.team, uuid) from public, anon;
revoke all on function public.task_allowed(uuid) from public, anon;
grant execute on function public.task_manager_limited() to authenticated;
grant execute on function public.task_row_allowed(uuid, public.team, uuid) to authenticated;
grant execute on function public.task_allowed(uuid) to authenticated;

-- ---------- on top of what each table already allows ----------

create policy "tasks: manager's own areas" on public.tasks as restrictive for all to authenticated
  using (not (select public.task_manager_limited()) or public.task_row_allowed(id, team, incident_id))
  with check (not (select public.task_manager_limited()) or public.task_row_allowed(id, team, incident_id));

create policy "occurrences: manager's own areas" on public.task_occurrences as restrictive for all to authenticated
  using (not (select public.task_manager_limited()) or public.task_allowed(task_id))
  with check (not (select public.task_manager_limited()) or public.task_allowed(task_id));

create policy "task_assignees: manager's own areas" on public.task_assignees as restrictive for all to authenticated
  using (not (select public.task_manager_limited()) or public.task_allowed(task_id))
  with check (not (select public.task_manager_limited()) or public.task_allowed(task_id));

create policy "task day removals: manager's own areas" on public.task_day_removals as restrictive for all to authenticated
  using (not (select public.task_manager_limited()) or public.task_allowed(task_id))
  with check (not (select public.task_manager_limited()) or public.task_allowed(task_id));

create policy "comments: manager's own areas" on public.task_comments as restrictive for all to authenticated
  using (not (select public.task_manager_limited()) or task_id is null or public.task_allowed(task_id))
  with check (not (select public.task_manager_limited()) or task_id is null or public.task_allowed(task_id));

create policy "task_audit_log: manager's own areas" on public.task_audit_log as restrictive for select to authenticated
  using (not (select public.task_manager_limited()) or task_id is null or public.task_allowed(task_id));

-- ---------- the functions that write days outside the row rules ----------

/*
 * Completing, skipping, blocking, reopening and setting a day's people or
 * target go through functions that do not pass the policies above. The same
 * rule, on the day itself. The nightly generator has no caller and passes.
 */
create or replace function public.guard_occurrence_manager_areas()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is not null and public.task_manager_limited()
     and not public.task_allowed(coalesce(new.task_id, old.task_id)) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger task_occurrences_manager_areas
  before insert or update or delete on public.task_occurrences
  for each row execute function public.guard_occurrence_manager_areas();
