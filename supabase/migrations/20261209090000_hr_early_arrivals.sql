-- ============================================================
-- Arrivals too early, beside the late ones (decided 2026-10-01).
--
-- The company accepts a start up to a tolerance before the agreed time (10
-- minutes, Admin's setting); earlier than that is recorded like a late
-- arrival. One table holds both: an arrival after the expected time is late,
-- one before it is early. minutes_late is negative for an early one, and
-- minutes_off is the distance either way.
-- ============================================================

alter table public.hr_late_arrivals drop constraint hr_late_arrivals_after;
alter table public.hr_late_arrivals add constraint hr_late_arrivals_not_on_time check (arrived_time <> expected_time);

alter table public.hr_late_arrivals
  add column kind text generated always as (case when arrived_time > expected_time then 'late' else 'early' end) stored,
  add column minutes_off int generated always as (abs((extract(epoch from (arrived_time - expected_time)) / 60)::int)) stored;

-- How many minutes before the agreed time are still fine, and from how many
-- unexcused early arrivals in a month HR is told.
insert into public.app_settings (key, value) values
  ('hr_early_tolerance_minutes', '10'::jsonb),
  ('hr_early_alert_threshold', '3'::jsonb)
on conflict (key) do nothing;
