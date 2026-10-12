-- ============================================================
-- A blocked activity can be moved to another day (decided 2026-10-12).
--
-- Blocked work stays owed (20270110090100), but until now the only way out
-- of a block was for the day itself to be done after all. Whoever plans the
-- calendar can now put a blocked day on a new date: it is pending again
-- there, and keeps a trace of where it came from and what was blocking it,
-- so neither the planner nor the person doing it has to remember.
--
-- Only blocked days move. Pending work stays on the day it was planned for.
-- ============================================================

alter table public.task_occurrences
  add column rescheduled_from   date,
  add column rescheduled_reason text,
  add column rescheduled_by     uuid references public.profiles (id) on delete set null,
  add column rescheduled_at     timestamptz;

comment on column public.task_occurrences.rescheduled_from is
  'The day this was on before a planner moved it. Set by reschedule_blocked_occurrence(); the latest move wins.';
comment on column public.task_occurrences.rescheduled_reason is
  'What was blocking it on that day — the blocked_reason it had when it was moved.';


-- ============================================================
-- reschedule_blocked_occurrence()
--
-- For whoever places work on the calendar (tasks.manage_occurrences, within
-- their team scope; the production manager's own-areas guard still applies
-- through the trigger on the table). The period label is the caller's, as it
-- is when a day is planned: it is a reporting label, not identity.
-- ============================================================
create or replace function public.reschedule_blocked_occurrence(
  p_occurrence_id uuid,
  p_date          date,
  p_period_key    text
)
returns public.task_occurrences
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.task_occurrences;
begin
  if not public.is_approved()
     or not (public.is_admin() or public.has_permission('tasks.manage_occurrences')) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  select * into v_row from public.task_occurrences where id = p_occurrence_id for update;
  if not found then
    raise exception 'occurrence_not_found' using errcode = 'P0002';
  end if;

  if not public.is_admin() and not public.task_in_team_scope(v_row.task_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  if v_row.status <> 'blocked' then
    raise exception 'not_blocked' using errcode = '22023';
  end if;

  if p_date is null or p_date = v_row.effective_due_date then
    raise exception 'same_day' using errcode = '22023';
  end if;

  -- Moved into the past it would arrive already late.
  if p_date < (now() at time zone 'Europe/Zurich')::date then
    raise exception 'date_in_past' using errcode = '22023';
  end if;

  -- The person already has this activity on that day: one copy each.
  if exists (
    select 1 from public.task_occurrences o
     where o.task_id = v_row.task_id
       and o.due_date = p_date
       and o.assignee_id is not distinct from v_row.assignee_id
       and o.id <> v_row.id
  ) then
    raise exception 'already_planned' using errcode = '23505';
  end if;

  update public.task_occurrences o
     set due_date           = p_date,
         due_date_override  = null,
         period_key         = coalesce(nullif(trim(p_period_key), ''), p_date::text),
         status             = 'pending',
         rescheduled_from   = v_row.effective_due_date,
         rescheduled_reason = v_row.blocked_reason,
         rescheduled_by     = (select auth.uid()),
         rescheduled_at     = now(),
         blocked_by         = null,
         blocked_at         = null,
         blocked_reason     = null
   where o.id = p_occurrence_id
   returning * into v_row;

  return v_row;
end;
$$;

comment on function public.reschedule_blocked_occurrence(uuid, date, text) is
  'Move a blocked day of an activity to another date: pending again there, with the day it came from and what was blocking it kept on the row.';

revoke all on function public.reschedule_blocked_occurrence(uuid, date, text) from public, anon;
grant execute on function public.reschedule_blocked_occurrence(uuid, date, text) to authenticated;
