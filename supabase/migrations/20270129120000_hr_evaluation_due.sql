-- ============================================================
-- Next evaluation due (decided 2026-10-22).
--
-- How often each team is evaluated lives in app_settings
-- ('hr_eval_interval_months': {"production": 6, ...}; a team left out has no
-- rule). The due day is worked out in the app; this only lets its notices be
-- recorded like the file's other dates.
-- ============================================================

alter table public.hr_date_notices drop constraint hr_date_notices_kind_check;
alter table public.hr_date_notices add constraint hr_date_notices_kind_check
  check (kind in ('trial_end', 'contract_end', 'custom', 'training', 'evaluation'));

insert into public.app_settings (key, value) values ('hr_eval_interval_months', '{}'::jsonb)
on conflict (key) do nothing;
