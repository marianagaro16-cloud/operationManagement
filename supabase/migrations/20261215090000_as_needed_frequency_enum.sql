-- ============================================================
-- "Según necesidad": an activity with no rule, placed on days in the work
-- plan as the operation needs it (decided 2026-10-02). In its own migration
-- because Postgres will not let a new enum label be used in the transaction
-- that added it. DO NOT MERGE with the next file.
-- ============================================================

alter type public.task_frequency add value if not exists 'as_needed';
