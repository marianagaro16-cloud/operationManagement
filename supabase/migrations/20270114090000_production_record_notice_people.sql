-- ============================================================
-- Production: who hears that something was produced (2026-10-13).
--
-- As soon as a production is recorded — and again when it is corrected —
-- these people get a notice with the units and the best-before date, to
-- enter it in bexio. Mariana, for now. Change the list here to change who.
-- ============================================================

insert into public.app_settings (key, value)
values (
  'production.record_notice_people',
  '["6249d52a-605a-4caa-a0bf-99cd1b083cf3"]'::jsonb
)
on conflict (key) do nothing;
