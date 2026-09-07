-- ============================================================
-- Add the `blocked` label to occurrence_status.
--
-- ITS OWN MIGRATION ON PURPOSE. Postgres refuses to use a new enum label in
-- the same transaction that added it, and `supabase db push` runs each file as
-- one transaction — so the columns, constraints and functions that reference
-- 'blocked' have to land in the NEXT file
-- (20260909140000_occurrence_blocked_state.sql).
--
-- The role migrations are split for exactly this reason. Do not merge them.
-- ============================================================

alter type public.occurrence_status add value if not exists 'blocked';
