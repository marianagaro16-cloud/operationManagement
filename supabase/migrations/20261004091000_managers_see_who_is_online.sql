-- ============================================================
-- Managers see who is online too
--
-- Was users.manage, which only an admin can ever hold. Seeing who has the app
-- open is not account administration, so it gets a key of its own that the
-- permission matrix can grant: the Manager holds it by default, the Power
-- User does not, and an Admin holds it always because has_permission()
-- short-circuits on is_admin().
--
-- Its own module rather than 'system': every system capability is admin-only
-- by construction, and this one is delegable.
-- ============================================================

insert into public.permission_catalog (key, module, is_configurable, sort_order) values
  ('team.view_online', 'team', true, 197)
on conflict (key) do nothing;

insert into public.role_permissions (role, permission) values
  ('manager', 'team.view_online')
on conflict do nothing;

drop policy if exists user_presence_select_admin on public.user_presence;
drop policy if exists user_presence_select on public.user_presence;
create policy user_presence_select on public.user_presence
  for select to authenticated
  using (public.has_permission('team.view_online'));

comment on table public.user_presence is
  'Last check-in from each person''s open app. Readable with team.view_online. One row per user, overwritten on every heartbeat.';
