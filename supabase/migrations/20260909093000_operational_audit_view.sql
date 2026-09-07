-- ============================================================
-- One operational audit trail.
--
-- There were two logs with different shapes and no task log at all.
-- getOperationalAudit() read 100 rows from each, merged them in TypeScript,
-- normalised `new_value ?? previous_value` into one `detail` field, and then
-- sliced 100 from the sorted result — so a busy inventory day pushed every
-- order event off a page that calls itself the operational trail.
--
-- Meanwhile the module with the most daily writes — task completions, skips,
-- reopenings and definition edits — was not audited at all.
--
-- This adds the missing log and puts one view over all three, so the page can
-- do ONE query with ONE `order by ... limit` and paging works.
-- ============================================================


-- ============================================================
-- 1. task_audit_log
--
-- Column-for-column the same shape as inventory_audit_log, so the union below
-- stays trivial and a future fourth module has an obvious template.
-- ============================================================
create table public.task_audit_log (
  id            uuid primary key default gen_random_uuid(),
  task_id       uuid references public.tasks (id) on delete cascade,
  occurrence_id uuid references public.task_occurrences (id) on delete cascade,
  actor_id      uuid references public.profiles (id) on delete set null,
  action        text not null,
  previous_value jsonb,
  new_value      jsonb,
  created_at    timestamptz not null default now()
);

create index task_audit_task_idx on public.task_audit_log (task_id, created_at desc);
create index task_audit_occurrence_idx on public.task_audit_log (occurrence_id, created_at desc);
create index task_audit_created_idx on public.task_audit_log (created_at desc);

alter table public.task_audit_log enable row level security;

-- Same audience as the other two operational logs.
create policy "task_audit_log: operational reads" on public.task_audit_log
  for select to authenticated using (public.has_permission('audit.view_operational'));

-- No insert policy anywhere: rows are written by SECURITY DEFINER triggers
-- only, exactly as the inventory and order logs are.


-- ---------- definition changes ----------
create or replace function public.log_task_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if TG_OP = 'INSERT' then
    insert into public.task_audit_log (task_id, actor_id, action, new_value)
    values (new.id, (select auth.uid()), 'task_created',
            jsonb_build_object('title', new.title, 'frequency', new.frequency));
    return new;
  end if;

  -- Only the fields that change what the system DOES. An updated_at touch is
  -- not an audit event, and logging it would bury the ones that are.
  if new.title           is distinct from old.title
     or new.frequency       is distinct from old.frequency
     or new.schedule_config is distinct from old.schedule_config
     or new.is_active       is distinct from old.is_active
     or new.is_skippable    is distinct from old.is_skippable then
    insert into public.task_audit_log (task_id, actor_id, action, previous_value, new_value)
    values (
      new.id, (select auth.uid()),
      case when new.is_active is distinct from old.is_active
           then (case when new.is_active then 'task_activated' else 'task_deactivated' end)
           else 'task_updated' end,
      jsonb_build_object('title', old.title, 'frequency', old.frequency,
                         'schedule_config', old.schedule_config,
                         'is_active', old.is_active, 'is_skippable', old.is_skippable),
      jsonb_build_object('title', new.title, 'frequency', new.frequency,
                         'schedule_config', new.schedule_config,
                         'is_active', new.is_active, 'is_skippable', new.is_skippable)
    );
  end if;
  return new;
end;
$$;

create trigger tasks_audit
  after insert or update on public.tasks
  for each row execute function public.log_task_change();


-- ---------- occurrence state changes ----------
-- A trigger rather than logging inside complete_occurrence() / skip_occurrence()
-- so it cannot be bypassed by a write that does not go through the RPCs.
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
                  else 'occurrence_reopened'
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
                       'skip_reason', old.skip_reason),
    jsonb_build_object('status', new.status, 'due_date', new.effective_due_date,
                       'skip_reason', new.skip_reason)
  );
  return new;
end;
$$;

create trigger occurrences_audit
  after update on public.task_occurrences
  for each row execute function public.log_occurrence_change();


-- ============================================================
-- 2. The unified view
--
-- A view rather than a fourth table: the three logs stay the authority for
-- their own module, keep their own foreign keys, and are not copied anywhere.
--
-- security_invoker so the caller's RLS applies. Without it the view would run
-- as its owner and hand every authenticated user the whole trail, which is
-- precisely the mistake this codebase avoids everywhere else.
-- ============================================================
create or replace view public.operational_audit
with (security_invoker = true)
as
  select
    'inventory'::text as source,
    l.id,
    l.action,
    l.actor_id,
    l.created_at,
    l.previous_value,
    l.new_value
  from public.inventory_audit_log l

  union all

  select
    'order'::text,
    l.id,
    l.action,
    l.actor_id,
    l.created_at,
    -- The order log records one `detail` blob rather than a before/after pair.
    -- It maps to new_value, which is what the merge in TypeScript did too.
    null::jsonb,
    l.detail
  from public.order_audit_log l

  union all

  select
    'task'::text,
    l.id,
    l.action,
    l.actor_id,
    l.created_at,
    l.previous_value,
    l.new_value
  from public.task_audit_log l;

comment on view public.operational_audit is
  'Every operational audit row from all three module logs, in one shape. Query this rather than the tables, so one ORDER BY ... LIMIT applies across the whole trail instead of per source.';

grant select on public.operational_audit to authenticated;
