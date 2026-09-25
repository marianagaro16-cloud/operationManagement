-- ============================================================
-- A plain User sees only the activities assigned to them — switched on.
--
-- Decided with 20261021090000 and put on hold by 20261021100000, because
-- recurring activities could not yet be given to anyone. Now they can
-- (20261023090000: each person has their own copy of every day), so the
-- activity rules of 20261021090000 return: a User sees and resolves only
-- the copies that are theirs, and the task definitions and comments of the
-- activities they hold. Shared (unassigned) days are for whoever plans the
-- work. Every other role is unchanged.
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
        and (
          (p_assignee_id is null and public.team_scope() is null)
          or public.has_permission('tasks.manage_occurrences')
        )
      )
    ),
    false
  );
$$;

comment on function public.can_act_on_task_occurrence(uuid, uuid) is
  'An occurrence is the caller''s to see and resolve when assigned to them; otherwise, when in their scope and either unassigned (not for a plain User) or they manage scheduled work.';

drop policy if exists "tasks: approved read" on public.tasks;
create policy "tasks: approved read" on public.tasks
  for select to authenticated
  using (
    (select public.is_approved())
    and ((select public.team_scope()) is null or public.is_assigned_to_task(id))
  );

drop policy if exists "comments: approved read" on public.task_comments;
create policy "comments: approved read" on public.task_comments
  for select to authenticated
  using (
    (select public.is_approved())
    and (task_id is null or (select public.team_scope()) is null or public.is_assigned_to_task(task_id))
  );

drop policy if exists "comments: approved insert own" on public.task_comments;
create policy "comments: approved insert own" on public.task_comments
  for insert to authenticated
  with check (
    (select public.is_approved()) and user_id = (select auth.uid())
    and (task_id is null or (select public.team_scope()) is null or public.is_assigned_to_task(task_id))
  );

