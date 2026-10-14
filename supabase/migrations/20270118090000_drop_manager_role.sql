-- ============================================================
-- The Manager role is retired (2026-10-14): nobody held it, and it only
-- added a column to the permission matrix and an option to the role picker.
--
-- Postgres cannot drop a label from an enum without rebuilding the type and
-- everything that uses it, so 'manager' stays in user_role but nobody may
-- hold it, and the matrix no longer carries it. The few functions that still
-- name it (role_rank, can_manage_merch, ...) answer for a role nobody has.
-- ============================================================

delete from public.role_permissions where role = 'manager';

alter table public.role_permissions drop constraint role_permissions_role_configurable;
alter table public.role_permissions add constraint role_permissions_role_configurable
  check (role in ('power_user', 'production_manager'));

alter table public.profiles add constraint profiles_no_manager check (role <> 'manager');
