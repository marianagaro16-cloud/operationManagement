-- ============================================================
-- Manual scheduling for everything except daily tasks
--
-- Until now every frequency materialised itself from a recurrence rule, and
-- so did all five inventory templates. The calendar filled months ahead
-- whether or not anyone intended that work to happen.
--
-- From here the daily checklist keeps generating itself and NOTHING ELSE
-- does. Weekly, biweekly, monthly and semiannual tasks — and every inventory
-- — are placed deliberately by an admin, manager or power user, onto a day or
-- across a planned week or month.
--
-- Three things happen below, in this order, because the cleanup has to run
-- while the old key is still in place:
--
--   1. clear the future that was generated on the old assumption
--   2. re-key occurrences by DATE instead of by period
--   3. record where each row came from
--
-- The recurrence engine itself is untouched. Its weekly/monthly/semiannual
-- generators remain correct, tested code; they simply stop having a caller.
-- ============================================================


-- ============================================================
-- 1. clear the future
-- ============================================================
/*
 * Only work nobody has touched, and only ahead of today.
 *
 * "Today" is Europe/Zurich, never current_date — the database runs in UTC and
 * for the first two hours of a Zurich day those disagree, which would delete
 * a requirement that is due today.
 *
 * Anything completed or skipped is history and is never in scope, which the
 * status filter already guarantees.
 */
do $$
declare
  v_today date := (now() at time zone 'Europe/Zurich')::date;
  v_tasks int;
  v_inventories int;
begin
  delete from public.task_occurrences o
   using public.tasks t
   where t.id = o.task_id
     and t.frequency <> 'daily'
     and o.status = 'pending'
     and o.effective_due_date > v_today;
  get diagnostics v_tasks = row_count;

  -- An inventory is only removable if it is genuinely untouched. Somebody may
  -- already be counting a future date — deleting that would destroy entered
  -- data, and the cascade would take the items and comments with it.
  delete from public.inventory_instances i
   where i.inventory_date > v_today
     and i.completed_at is null
     and not exists (select 1 from public.inventory_entries e  where e.instance_id = i.id)
     and not exists (select 1 from public.inventory_comments c where c.instance_id = i.id);
  get diagnostics v_inventories = row_count;

  raise notice 'manual_scheduling: cleared % future occurrences and % future inventories',
    v_tasks, v_inventories;
end;
$$;


-- ============================================================
-- 2. re-key occurrences by date
-- ============================================================
/*
 * UNIQUE(task_id, period_key) meant "at most one requirement per period",
 * which was exactly right while a rule produced the dates. It is exactly
 * wrong once a person does: putting the same weekly task on Monday AND
 * Wednesday of one week is now a legitimate thing to ask for, and the old key
 * rejected it.
 *
 * This is the same move the inventory module already made, for the same
 * reason — see the comment on inventory_instances.period_key. period_key
 * survives as a REPORTING LABEL: the History screen renders it and the report
 * groupings read it. It is simply no longer identity.
 *
 * Keyed on due_date rather than the generated effective_due_date because
 * due_date_override is now vestigial — nothing writes it, the action that did
 * is being removed, and the planner moves work by setting the date itself.
 */
alter table public.task_occurrences
  drop constraint task_occurrences_task_period_key;

alter table public.task_occurrences
  add constraint task_occurrences_task_date_key unique (task_id, due_date);

comment on column public.task_occurrences.period_key is
  'Reporting label (2026-09-01 | 2026-W36 | BW-2026-09-08 | 2026-09 | 2026-H2). NOT an identity: a task may legitimately be placed on several dates within one period.';


-- ============================================================
-- 3. provenance
-- ============================================================
/*
 * Which rows the system made and which a person placed.
 *
 * Earns its place three times over: the nightly generator can own only its
 * own rows, the stalled-scheduler warning can ask "is the GENERATOR alive"
 * rather than "does any work exist" — which would otherwise go off the moment
 * a quiet week was planned — and the planner can refuse to delete something
 * it did not create.
 *
 * CREATE TYPE and then using the type in the same migration is fine. The
 * in-transaction restriction that split the roles migration in two applies
 * only to ALTER TYPE ... ADD VALUE.
 */
create type public.schedule_source as enum ('auto', 'manual');

alter table public.task_occurrences
  add column source public.schedule_source not null default 'manual';

alter table public.inventory_instances
  add column source public.schedule_source not null default 'manual';

-- Everything that survived the cleanup was made by the generator.
update public.task_occurrences   set source = 'auto';
update public.inventory_instances set source = 'auto';

comment on column public.task_occurrences.source is
  'auto = materialised by the nightly generator (daily tasks only). manual = placed by a person from the calendar.';
comment on column public.inventory_instances.source is
  'auto = materialised by the generator, which no longer runs for inventories. manual = placed by a person from the calendar.';

create index occurrences_source_idx on public.task_occurrences (source);
