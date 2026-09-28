-- ============================================================
-- Days of a daily activity taken off the calendar stay off.
--
-- The daily checklist is generated for every day with no occurrence, so a
-- day removed from the calendar looked like a missing one and came straight
-- back. A removal is now remembered, and the generator skips it. Planning
-- that day again by hand forgets the removal.
-- ============================================================

create table public.task_day_removals (
  task_id    uuid not null references public.tasks (id) on delete cascade,
  due_date   date not null,
  removed_by uuid references public.profiles (id) on delete set null default auth.uid(),
  removed_at timestamptz not null default now(),
  primary key (task_id, due_date)
);

alter table public.task_day_removals enable row level security;

-- Whoever may take a day off the calendar may record, see and undo that.
create policy "task day removals: manager writes" on public.task_day_removals
  for all to authenticated
  using ((select public.has_permission('tasks.manage_occurrences')) and public.task_in_team_scope(task_id))
  with check ((select public.has_permission('tasks.manage_occurrences')) and public.task_in_team_scope(task_id));
