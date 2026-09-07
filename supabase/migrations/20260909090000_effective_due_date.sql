-- ============================================================
-- task_occurrences.effective_due_date
--
-- An admin may move a single occurrence with `due_date_override` without
-- touching the recurrence rule that produced it. The date the application
-- actually means is therefore coalesce(due_date_override, due_date).
--
-- That coalesce was written out by hand at four call sites in TypeScript
-- (server/data.ts, domain/stats.ts, the task card, the calendar) while every
-- SQL query — and both indexes — filtered and ordered on the RAW due_date.
-- The two disagreed for exactly the rows the override exists to serve: an
-- occurrence moved beyond the fetched window was never returned at all and
-- vanished from the dashboard, and one moved INTO the window was returned but
-- ordered by the date it no longer had.
--
-- A generated column so the effective date can never disagree with its
-- inputs, and so it is indexable — the same reasoning as
-- inventory_instance_items.difference and customers.name.
-- ============================================================

alter table public.task_occurrences
  add column effective_due_date date
  generated always as (coalesce(due_date_override, due_date)) stored;

comment on column public.task_occurrences.effective_due_date is
  'The date this requirement is actually due. Derived from due_date_override, falling back to due_date. Filter, order and bucket on THIS column, never on due_date.';

-- ---------- indexes move to the effective date ----------
-- Nothing filters on the raw due_date any more: generation keys on
-- (task_id, period_key), and every read is about when the work is due.
create index occurrences_effective_due_idx
  on public.task_occurrences (effective_due_date);

create index occurrences_open_effective_idx
  on public.task_occurrences (effective_due_date)
  where status = 'pending';

drop index if exists public.occurrences_due_idx;
drop index if exists public.occurrences_open_due_idx;
