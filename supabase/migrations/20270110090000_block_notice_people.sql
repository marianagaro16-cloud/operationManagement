-- ============================================================
-- Blocked activities: whose blocks the Admins hear about (2026-10-09).
--
-- When one of these people blocks an activity, every Admin gets a notice
-- with the reason; and another when it is free again. Jefferson, and Marco,
-- who covers him. Change the list here to change whose.
-- ============================================================

insert into public.app_settings (key, value)
values (
  'activities.block_notice_people',
  '["ae76299a-64ed-4f0b-a07a-88bb65f8f18d", "eff9eef3-b66f-4cd2-8fef-9d2a137af6b2"]'::jsonb
)
on conflict (key) do nothing;
