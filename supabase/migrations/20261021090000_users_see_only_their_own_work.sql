-- ============================================================
-- A plain User sees only the work assigned to them — on either team.
--
-- Activities: until now a User saw every unassigned ("shared") occurrence of
-- their team's tasks, along with who completed it. Now a User sees — and can
-- resolve — only occurrences assigned to them by name. Shared work is for
-- whoever plans (tasks.manage_occurrences) to assign or do. The task
-- definitions and task comments a User reads narrow the same way: only tasks
-- they hold an occurrence of.
--
-- Inventories: the rule introduced for Production Users in
-- 20261020090000_production_users_see_own_inventories.sql now covers every
-- User — only inventories assigned (or temporarily granted) to them, and not
-- who else is assigned.
--
-- Every other role is unchanged. team_scope() is non-NULL exactly for a plain
-- User, which is what "(select public.team_scope()) is null" tests below.
-- ============================================================

-- ---------- activities ----------

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

-- ---------- inventories: every User, not only Production ----------

create or replace function public.inventory_own_only()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
     where p.id = (select auth.uid())
       and p.status = 'approved'
       and p.role = 'user'
  );
$$;

comment on function public.inventory_own_only() is
  'True for a plain User, who sees only the inventories assigned (or temporarily granted) to them.';
