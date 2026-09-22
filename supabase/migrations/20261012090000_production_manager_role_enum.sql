-- ============================================================
-- Production manager role, part 1 of 2: the enum label ONLY.
--
-- Postgres will not let a new enum label be referenced in the transaction
-- that added it, and `supabase db push` runs each file as one transaction —
-- the same reason 20260908090000_roles_enum.sql stands alone. Everything
-- that mentions 'production_manager' lives in the next file.
--
-- Inert on its own: nobody holds the role until an admin assigns it.
-- ============================================================

alter type public.user_role add value if not exists 'production_manager';
