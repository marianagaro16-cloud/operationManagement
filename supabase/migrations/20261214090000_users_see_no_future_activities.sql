-- ============================================================
-- A plain User sees their activities up to today — not what is planned for
-- them later (decided 2026-10-01). Today's and past days stay visible, in
-- the Agenda and everywhere; whoever plans work sees every day as before.
-- A RESTRICTIVE policy, on top of every existing rule.
-- ============================================================

create policy "users: no future days" on public.task_occurrences as restrictive for select to authenticated
  using (
    (select public.team_scope()) is null
    or effective_due_date <= (now() at time zone 'Europe/Zurich')::date
  );
