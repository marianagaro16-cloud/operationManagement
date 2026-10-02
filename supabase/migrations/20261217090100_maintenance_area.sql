-- ============================================================
-- Maintenance (decided 2026-10-02).
--
-- Freddy is the Production manager AND the Maintenance manager: he plans and
-- does every maintenance of the company, with Bruce as his helper. A person
-- can now run more than one area: team_managers lists the extra areas, and
-- what used to check "my team" checks "the areas I run".
--
-- Bruce, a plain User, sees the maintenance days assigned to him ahead of
-- time — Freddy leaves him a plan when away. Every other area keeps "only up
-- to today" for plain Users.
-- ============================================================

create table public.team_managers (
  profile_id uuid not null references public.profiles (id) on delete cascade,
  team       public.team not null,
  primary key (profile_id, team)
);

alter table public.team_managers enable row level security;
create policy "team_managers: approved read" on public.team_managers for select to authenticated
  using ((select public.is_approved()));
create policy "team_managers: admin writes" on public.team_managers for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
grant select, insert, update, delete on public.team_managers to authenticated;

-- Freddy runs Maintenance too.
insert into public.team_managers (profile_id, team)
values ('faf0e71f-f350-4703-8ba7-01c5c997797a', 'maintenance')
on conflict do nothing;

/* The areas the caller runs: their own team, and any listed for them. */
create or replace function public.my_teams()
returns public.team[]
language sql
stable
security definer
set search_path = ''
as $$
  select array(
    select p.team from public.profiles p where p.id = (select auth.uid()) and p.status = 'approved'
    union
    select m.team from public.team_managers m
      join public.profiles p on p.id = m.profile_id and p.status = 'approved'
     where m.profile_id = (select auth.uid())
  );
$$;

revoke all on function public.my_teams() from public, anon;
grant execute on function public.my_teams() to authenticated;

-- An area's manager configures that area's activities: every area they run.
drop policy "tasks: own team config writes" on public.tasks;
create policy "tasks: own team config writes" on public.tasks
  for all to authenticated
  using ((select public.has_permission('tasks.manage_own_team')) and team = any (public.my_teams()))
  with check ((select public.has_permission('tasks.manage_own_team')) and team = any (public.my_teams()));

/*
 * Whoever configures every activity sets anyone; an area's manager sets, on
 * that area's activities, its people — and the area's managers themselves.
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
  select t.team into v_team from public.tasks t where t.id = p_task_id;
  if not public.has_permission('tasks.manage_definitions') then
    if not public.has_permission('tasks.manage_own_team')
       or not (v_team = any (public.my_teams())) then
      raise exception 'not_authorized' using errcode = '42501';
    end if;
  end if;
  -- An area's people: its team, and whoever runs it.
  if not public.has_permission('tasks.manage_definitions') and exists (
       select 1 from unnest(v_ids) u
        where not exists (select 1 from public.profiles p where p.id = u and p.team = v_team)
          and not exists (select 1 from public.team_managers m where m.profile_id = u and m.team = v_team)
     ) then
    raise exception 'not_authorized' using errcode = '42501';
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

-- HR files: an area's manager keeps the files of every area they run.
create or replace function public.hr_can(p_team public.team)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_permission('hr.manage')
     and (public.hr_scope() is null or p_team = any (public.my_teams()));
$$;

-- Bruce sees his maintenance days ahead; every other area stays "up to today".
drop policy "users: no future days" on public.task_occurrences;
create policy "users: no future days" on public.task_occurrences as restrictive for select to authenticated
  using (
    (select public.team_scope()) is null
    or effective_due_date <= (now() at time zone 'Europe/Zurich')::date
    or exists (select 1 from public.tasks t where t.id = task_id and t.team = 'maintenance')
  );
