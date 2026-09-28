-- ============================================================
-- Only managers skip.
--
-- A skip closes the day and takes it out of the completion rate, so letting
-- whoever does the work skip it let unwelcome work disappear without a mark.
-- Deciding that work will not be done is now for whoever plans it —
-- tasks.manage_occurrences: Manager, Power User, Production manager, Admin.
-- Everyone who can complete an activity can still BLOCK it, with a reason,
-- which leaves it open for a manager to decide.
--
-- Otherwise as in 20260901200000_operations_schema.sql. The occurrence
-- guard trigger still decides team and assignee scope.
-- ============================================================

create or replace function public.skip_occurrence(p_occurrence_id uuid, p_reason text)
returns public.task_occurrences
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row       public.task_occurrences;
  v_skippable boolean;
begin
  if not public.is_approved() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  if not public.has_permission('tasks.manage_occurrences') then
    raise exception 'skip_managers_only' using errcode = '42501';
  end if;

  -- A reason is mandatory, always, for every role.
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'skip_reason_required' using errcode = '22023';
  end if;

  select t.is_skippable into v_skippable
    from public.task_occurrences o
    join public.tasks t on t.id = o.task_id
   where o.id = p_occurrence_id;

  if v_skippable is null then
    raise exception 'occurrence_not_found' using errcode = 'P0002';
  end if;

  -- Non-skippable tasks cannot be skipped by anyone, admins included.
  if not v_skippable then
    raise exception 'task_not_skippable' using errcode = '42501';
  end if;

  update public.task_occurrences o
     set status       = 'skipped',
         skipped_by   = (select auth.uid()),
         skipped_at   = now(),
         skip_reason  = trim(p_reason),
         completed_by = null,
         completed_at = null
   where o.id = p_occurrence_id
   returning * into v_row;

  return v_row;
end;
$$;
