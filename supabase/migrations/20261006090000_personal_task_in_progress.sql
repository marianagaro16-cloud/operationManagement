-- ============================================================
-- Personal tasks: "in progress"
--
-- A personal task was open, completed or cancelled. Somebody juggling several
-- of them wants to mark the one they have started, so 'in_progress' joins
-- the list. It is still an OPEN task in every sense that matters: it is due,
-- it counts toward "left for today", and ticking it off completes it.
--
-- Nothing else changes. The stamps constraint already ties completed_at and
-- cancelled_at to their own statuses, so an in-progress task carries neither.
-- ============================================================

alter table public.personal_tasks
  drop constraint if exists personal_tasks_status_known;

alter table public.personal_tasks
  add constraint personal_tasks_status_known
  check (status in ('open', 'in_progress', 'completed', 'cancelled'));
