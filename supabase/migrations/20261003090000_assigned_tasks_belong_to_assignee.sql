-- ============================================================
-- An assigned task belongs to its assignee.
--
-- A corrective action raised from an incident is assigned to one person, but
-- nothing used the assignment: every approved account saw it on the
-- dashboard under "También para hoy" and could complete, skip or block it.
-- Two actions assigned to Mariana were open to the whole floor.
--
-- Now, for an occurrence WITH an assignee:
--   seen by        the assignee, and whoever manages scheduled work
--   resolved by    the same people (complete, skip, block, reopen)
--
-- "Whoever manages scheduled work" is tasks.manage_occurrences — Manager and
-- Power User — plus Admin, so an action is never stranded when its assignee
-- is away. Occurrences without an assignee, which is every recurring task,
-- are untouched: shared team work, visible to and done by anyone.
-- ============================================================

create or replace function public.can_act_on_occurrence(p_assignee_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_approved()
     and (
       p_assignee_id is null
       or p_assignee_id = (select auth.uid())
       or public.has_permission('tasks.manage_occurrences')
     );
$$;

comment on function public.can_act_on_occurrence(uuid) is
  'An unassigned occurrence is anyone''s; an assigned one is its assignee''s and task managers''.';

revoke all on function public.can_act_on_occurrence(uuid) from public;
grant execute on function public.can_act_on_occurrence(uuid) to authenticated;

-- ---------- seeing ----------

drop policy if exists "occurrences: approved read" on public.task_occurrences;
create policy "occurrences: approved read" on public.task_occurrences
  for select to authenticated
  using (public.can_act_on_occurrence(assignee_id));

-- ---------- resolving ----------

/*
 * A trigger rather than four edited RPCs: complete, skip, block and reopen
 * all change the status, and a rule in one place cannot be forgotten by the
 * fifth. Only a status change is guarded, so a manager reassigning or moving
 * the occurrence is unaffected. The null-uid escape is the service role
 * (scheduler, seeding).
 */
create or replace function public.guard_assigned_occurrence()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status is distinct from old.status
     and old.assignee_id is not null
     and (select auth.uid()) is not null
     and not public.can_act_on_occurrence(old.assignee_id) then
    raise exception 'not_assigned_to_you' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger occurrences_guard_assigned
  before update on public.task_occurrences
  for each row execute function public.guard_assigned_occurrence();
