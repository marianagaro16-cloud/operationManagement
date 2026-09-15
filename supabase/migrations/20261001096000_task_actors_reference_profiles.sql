-- ============================================================
-- Task actors point at profiles, not at logins
--
-- tasks.created_by and task_occurrences.completed_by / skipped_by /
-- blocked_by were the only public columns still referencing auth.users.
-- Deleting a user's login (admin_delete_user) therefore nulled them, and the
-- occurrence checks — a completed task must say who completed it, a skipped
-- one who skipped it — refused the change, so the delete failed for anybody
-- who had ever ticked off a task.
--
-- Every other "who did it" column already references public.profiles, which
-- is exactly the row a deleted user keeps. These four now do the same.
-- ============================================================

alter table public.tasks
  drop constraint if exists tasks_created_by_fkey,
  add constraint tasks_created_by_fkey
    foreign key (created_by) references public.profiles (id) on delete set null;

alter table public.task_occurrences
  drop constraint if exists task_occurrences_completed_by_fkey,
  add constraint task_occurrences_completed_by_fkey
    foreign key (completed_by) references public.profiles (id) on delete set null;

alter table public.task_occurrences
  drop constraint if exists task_occurrences_skipped_by_fkey,
  add constraint task_occurrences_skipped_by_fkey
    foreign key (skipped_by) references public.profiles (id) on delete set null;

alter table public.task_occurrences
  drop constraint if exists task_occurrences_blocked_by_fkey,
  add constraint task_occurrences_blocked_by_fkey
    foreign key (blocked_by) references public.profiles (id) on delete set null;
