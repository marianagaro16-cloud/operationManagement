-- ============================================================
-- can_act_on_task_occurrence() must answer true or false, never NULL.
--
-- For an unassigned occurrence, `p_assignee_id = auth.uid()` is NULL, and
-- NULL OR false is NULL. A policy reads NULL as "no", so reading was right;
-- but guard_assigned_occurrence() asks `if not can_act...`, and NOT NULL is
-- NULL, which an IF treats as false — so the guard let an Operaciones user
-- complete a Producción task by its id. Found by scripts/verify-teams.mjs.
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
