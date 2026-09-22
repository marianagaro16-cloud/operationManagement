-- ============================================================
-- The production manager works with every team's tasks and people.
--
-- 20261012090100 confined the production manager to Producción for tasks,
-- incidents, people and push messages. The business has since decided that
-- tasks, push messages and assigning people (inventories, edit grants) work
-- as they do for a Power User — every team. Incidents stay confined:
-- the production manager still reads all and manages Producción's only.
--
-- So the one scope splits in two:
--
--   team_scope()      the caller's team for a plain USER only. Drives task
--                     visibility and acting on people — a production manager
--                     is now unscoped here.
--   incident_scope()  the caller's team for a PRODUCTION MANAGER. Drives
--                     which incidents they may manage.
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
     and p.role = 'user';
$$;

comment on function public.team_scope() is
  'The caller''s team when they are a plain user, who sees only their team''s tasks; NULL means unscoped.';

create or replace function public.incident_scope()
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
     and p.role = 'production_manager';
$$;

comment on function public.incident_scope() is
  'The team whose incidents a production manager may manage; NULL means unscoped.';

create or replace function public.in_incident_scope(p_team public.team)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.incident_scope() = p_team, true);
$$;

revoke all on function public.incident_scope() from public;
revoke all on function public.in_incident_scope(public.team) from public;
grant execute on function public.incident_scope() to authenticated;
grant execute on function public.in_incident_scope(public.team) to authenticated;


-- ---------- incidents: now on their own scope ----------
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
        where i.id = p_incident_id and public.in_incident_scope(i.team)
     );
$$;

drop policy if exists "incidents: manage insert" on public.incidents;
create policy "incidents: manage insert" on public.incidents
  for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and (
      ((select public.has_permission('incidents.manage')) and public.in_incident_scope(team))
      or (goods_reception_id is not null and (select public.is_goods_reception_assignee()))
    )
  );

drop policy if exists "incidents: manage update" on public.incidents;
create policy "incidents: manage update" on public.incidents
  for update to authenticated
  using ((select public.has_permission('incidents.manage')) and public.in_incident_scope(team))
  with check ((select public.has_permission('incidents.manage')) and public.in_incident_scope(team));
