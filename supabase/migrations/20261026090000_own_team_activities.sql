-- ============================================================
-- A team's manager configures their own team's activities.
--
-- tasks.manage_definitions configures every activity of every team. The
-- Production manager decides Production's work — what it is, when, and which
-- of Production's people do it — and nothing of Operations'. So a narrower
-- key, granted to the Production manager by default:
--
--   tasks.manage_own_team   create and edit activities of the caller's own
--                           team, and set their people from that team only.
-- ============================================================

insert into public.permission_catalog (key, module, is_configurable, sort_order) values
  ('tasks.manage_own_team', 'tasks', true, 41)
on conflict (key) do nothing;

insert into public.role_permissions (role, permission) values
  ('production_manager', 'tasks.manage_own_team')
on conflict do nothing;

/* The caller's team, when approved. */
create or replace function public.my_team()
returns public.team
language sql
stable
security definer
set search_path = ''
as $$
  select p.team from public.profiles p
   where p.id = (select auth.uid()) and p.status = 'approved';
$$;

revoke all on function public.my_team() from public, anon;
grant execute on function public.my_team() to authenticated;

-- The same row can never be moved to another team: WITH CHECK holds the team too.
create policy "tasks: own team config writes" on public.tasks
  for all to authenticated
  using ((select public.has_permission('tasks.manage_own_team')) and team = (select public.my_team()))
  with check ((select public.has_permission('tasks.manage_own_team')) and team = (select public.my_team()));

/*
 * Whoever configures every activity sets anyone; whoever configures their own
 * team's sets only that team's people, on that team's activities.
 */
create or replace function public.set_task_assignees(p_task_id uuid, p_user_ids uuid[])
returns uuid[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids   uuid[] := array(select distinct u from unnest(coalesce(p_user_ids, '{}')) u where u is not null);
  v_added uuid[];
  v_team  public.team;
begin
  if not public.has_permission('tasks.manage_definitions') then
    select t.team into v_team from public.tasks t where t.id = p_task_id;
    if not public.has_permission('tasks.manage_own_team')
       or v_team is distinct from public.my_team()
       or exists (
         select 1 from unnest(v_ids) u
          where not exists (select 1 from public.profiles p where p.id = u and p.team = v_team)
       ) then
      raise exception 'not_authorized' using errcode = '42501';
    end if;
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
