-- ============================================================
-- Meetings that repeat every month, on the same weekday position: the first
-- (1) to fourth (4) such weekday of the month, or the last (-1). Null: the
-- series repeats by weeks (interval_weeks), as before.
-- ============================================================

alter table public.meeting_series
  add column monthly_nth int check (monthly_nth is null or monthly_nth in (1, 2, 3, 4, -1));

comment on column public.meeting_series.monthly_nth is
  'Monthly on the nth weekday of the month (1–4, or -1 for the last); null repeats by interval_weeks.';
