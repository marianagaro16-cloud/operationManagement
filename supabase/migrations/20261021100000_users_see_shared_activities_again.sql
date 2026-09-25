-- ============================================================
-- Temporarily: a User sees their team's shared activities again.
--
-- 20261021090000 hid unassigned occurrences from plain Users, but recurring
-- activities could not yet be assigned to anyone, so Users were left with
-- nothing to do. Until assigning exists, the activity rules return to what
-- 20261012090100/20261012090200 defined. The inventory rule from
-- 20261021090000 is untouched.
-- ============================================================

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
        and (p_assignee_id is null or public.has_permission('tasks.manage_occurrences'))
      )
    ),
    false
  );
$$;

comment on function public.can_act_on_task_occurrence(uuid, uuid) is
  'An occurrence is the caller''s to see and resolve when assigned to them; otherwise, when in their scope and either unassigned or they manage scheduled work.';

drop policy if exists "tasks: approved read" on public.tasks;
create policy "tasks: approved read" on public.tasks
  for select to authenticated
  using (
    (select public.is_approved())
    and (public.in_team_scope(team) or public.is_assigned_to_task(id))
  );

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
