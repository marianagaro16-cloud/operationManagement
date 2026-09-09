-- ============================================================
-- A task says when it starts applying
--
-- The daily checklist is materialised on demand: opening the Calendar on a
-- month creates that month's slots. Nothing told the generator when the work
-- actually began, so it happily produced a checklist for days before the app
-- was in use — and every one of those days reads as OVERDUE, because nobody
-- ticked a box on a system nobody was using yet.
--
-- Deleting them does not hold. They are recreated the next time somebody
-- opens that month, which is exactly what happened: 21 slots removed at
-- 12:40 were back at 13:13.
--
-- This is also a bug beyond the go-live. A task defined in November would
-- generate a September checklist for itself the moment anyone browsed back,
-- inventing a requirement that did not exist at the time.
--
-- NULL means "since the task existed" — see the generator, which falls back
-- to created_at. So the sensible behaviour is the default and nobody has to
-- remember to set this on a new task; the column is for saying something
-- OTHER than that, which is what go-live is.
-- ============================================================

alter table public.tasks
  add column if not exists starts_on date;

comment on column public.tasks.starts_on is
  'First date this task may produce a checklist requirement. NULL means the date the task was created, so a task never backfills into a time before it existed. Set explicitly to say otherwise — a go-live date, or a task that begins next quarter.';

/*
 * Go-live: 10 September 2026.
 *
 * Every task here was created on 1 September during setup, so created_at
 * alone would still leave the first nine days of testing showing as missed
 * work. The operation starts on the 10th and nothing before it was ever a
 * requirement — that is a fact about the business, not about the data, so it
 * is stated rather than inferred.
 *
 * Only tasks that predate go-live are touched. One created afterwards keeps
 * NULL and correctly starts from its own creation date.
 */
update public.tasks
   set starts_on = date '2026-09-10'
 where starts_on is null
   and created_at < timestamptz '2026-09-10 00:00:00+02';

/*
 * And remove what the old behaviour already produced.
 *
 * Only PENDING ones. A slot somebody actually completed or skipped is a
 * record of work done, and deleting it because the rules changed afterwards
 * would be rewriting their history — the point of this migration is that
 * nothing was required before go-live, not that nothing happened.
 */
delete from public.task_occurrences o
 using public.tasks t
 where t.id = o.task_id
   and o.status = 'pending'
   and t.starts_on is not null
   and coalesce(o.due_date_override, o.due_date) < t.starts_on;
