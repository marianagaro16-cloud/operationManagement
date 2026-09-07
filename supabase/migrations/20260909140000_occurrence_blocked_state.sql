-- ============================================================
-- A task occurrence can be BLOCKED.
--
-- Until now an occurrence had three outcomes: complete it, skip it, or leave
-- it pending. Skipping is terminal, demands a reason, and is recorded as a
-- DECISION NOT TO DO THE WORK — which is the wrong record for "the pallet has
-- not arrived yet". Leaving it pending is worse: tomorrow it is overdue, under
-- the operator's name, for something that was never theirs to control.
--
-- So the overdue list mixed real lateness with work nobody could have done,
-- and an overdue count that cannot be trusted is one people stop reading.
--
-- `blocked` is neither done nor late. It stays visible until somebody clears
-- it, it never resolves itself, and it is excluded from the overdue bucket so
-- the numbers next to it stay meaningful.
--
-- Adding the enum label ships in its own migration
-- (20260909130000_occurrence_blocked_label.sql), because Postgres will not let
-- a new label be used in the transaction that added it and `supabase db push`
-- runs each file as one transaction. Same reason the role migrations are split.
-- DO NOT MERGE THOSE TWO FILES.
-- ============================================================


-- ---------- what is blocking it, and who said so ----------
alter table public.task_occurrences
  add column blocked_reason text,
  add column blocked_by     uuid references auth.users (id) on delete set null,
  add column blocked_at     timestamptz;

comment on column public.task_occurrences.blocked_reason is
  'Why this work cannot proceed. Mandatory while status = blocked, exactly as skip_reason is mandatory for a skip — a blocker nobody described is indistinguishable from neglect.';

-- A block is only ever valid with an attributed, non-empty reason. Mirrors
-- occurrence_skip_requires_reason rather than inventing a second shape.
alter table public.task_occurrences
  add constraint occurrence_block_requires_reason check (
    status <> 'blocked'
    or (blocked_reason is not null and length(trim(blocked_reason)) > 0
        and blocked_by is not null and blocked_at is not null)
  );

-- Blocked is not a resolution: it cannot coexist with one.
alter table public.task_occurrences
  add constraint occurrence_blocked_not_resolved check (
    status <> 'blocked' or (completed_at is null and skipped_at is null)
  );

-- The dashboard reads blocked work as its own section, so it gets its own
-- partial index rather than widening the open-work one.
create index occurrences_blocked_idx
  on public.task_occurrences (effective_due_date)
  where status = 'blocked';


-- ============================================================
-- block_occurrence()
--
-- Any approved user may block, exactly as any approved user may complete.
-- Deliberately NOT gated on tasks.is_skippable: refusing to do a task and
-- being unable to do it are different statements, and a non-skippable task is
-- precisely the kind that must not silently rot in the overdue list.
-- ============================================================
create or replace function public.block_occurrence(
  p_occurrence_id uuid,
  p_reason        text
)
returns public.task_occurrences
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.task_occurrences;
begin
  if not public.is_approved() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'block_reason_required' using errcode = '22023';
  end if;

  update public.task_occurrences o
     set status         = 'blocked',
         blocked_by     = (select auth.uid()),
         blocked_at     = now(),
         blocked_reason = trim(p_reason),
         -- Blocking something already resolved clears the resolution; the
         -- audit trigger records the transition either way.
         completed_by   = null,
         completed_at   = null,
         skipped_by     = null,
         skipped_at     = null,
         skip_reason    = null
   where o.id = p_occurrence_id
   returning * into v_row;

  if not found then
    raise exception 'occurrence_not_found' using errcode = 'P0002';
  end if;

  return v_row;
end;
$$;

comment on function public.block_occurrence(uuid, text) is
  'Mark an occurrence as waiting on something outside the operator''s control. Requires a reason. Not the same as skipping, which records a decision not to do the work.';


-- ============================================================
-- reopen_occurrence() also clears a block
--
-- The existing guard — only the person who resolved it, or an admin — extends
-- to whoever blocked it. Unblocking someone else's block is a scheduling
-- decision, so it is also allowed to anyone holding tasks.manage_occurrences;
-- an operator can always clear their OWN block without any capability.
-- ============================================================
create or replace function public.reopen_occurrence(p_occurrence_id uuid)
returns public.task_occurrences
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row   public.task_occurrences;
  v_actor uuid := (select auth.uid());
begin
  if not public.is_approved() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  select * into v_row from public.task_occurrences where id = p_occurrence_id;
  if not found then
    raise exception 'occurrence_not_found' using errcode = 'P0002';
  end if;

  if not public.is_admin()
     and not public.has_permission('tasks.manage_occurrences')
     and coalesce(v_row.completed_by, v_row.skipped_by, v_row.blocked_by) is distinct from v_actor then
    raise exception 'not_your_action' using errcode = '42501';
  end if;

  update public.task_occurrences o
     set status = 'pending',
         completed_by = null, completed_at = null,
         skipped_by = null,   skipped_at = null, skip_reason = null,
         blocked_by = null,   blocked_at = null, blocked_reason = null
   where o.id = p_occurrence_id
   returning * into v_row;

  return v_row;
end;
$$;


-- ============================================================
-- The audit trigger learns the two new transitions
--
-- log_occurrence_change() switched on the new status and fell through to
-- 'occurrence_reopened' for anything it did not recognise, which would have
-- filed every block under "reopened".
-- ============================================================
create or replace function public.log_occurrence_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_action text;
begin
  if new.status is distinct from old.status then
    v_action := case new.status
                  when 'completed' then 'occurrence_completed'
                  when 'skipped'   then 'occurrence_skipped'
                  when 'blocked'   then 'occurrence_blocked'
                  else (case when old.status = 'blocked'
                             then 'occurrence_unblocked'
                             else 'occurrence_reopened' end)
                end;
  elsif new.due_date_override is distinct from old.due_date_override then
    v_action := 'occurrence_moved';
  else
    return new;
  end if;

  insert into public.task_audit_log (
    task_id, occurrence_id, actor_id, action, previous_value, new_value
  )
  values (
    new.task_id, new.id, (select auth.uid()), v_action,
    jsonb_build_object('status', old.status, 'due_date', old.effective_due_date,
                       'skip_reason', old.skip_reason,
                       'blocked_reason', old.blocked_reason),
    jsonb_build_object('status', new.status, 'due_date', new.effective_due_date,
                       'skip_reason', new.skip_reason,
                       'blocked_reason', new.blocked_reason)
  );
  return new;
end;
$$;


revoke all on function public.block_occurrence(uuid, text) from public;
grant execute on function public.block_occurrence(uuid, text) to authenticated;
revoke all on function public.reopen_occurrence(uuid) from public;
grant execute on function public.reopen_occurrence(uuid) to authenticated;
