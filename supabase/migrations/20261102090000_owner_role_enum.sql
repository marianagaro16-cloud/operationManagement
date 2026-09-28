-- ============================================================
-- The Owner role (Dueño): the company's owners.
--
-- Adding the label ships in its own migration because Postgres will not let
-- a new enum label be used in the transaction that added it, and
-- `supabase db push` runs each file as one. What the role means is in
-- 20261102090100_owner_role.sql. DO NOT MERGE THESE TWO FILES.
-- ============================================================

alter type public.user_role add value if not exists 'owner';
