-- ============================================================
-- Direct notifications: the capability to send one.
--
-- A Power User, Manager or Admin can push a short message to specific people
-- on the floor. Delivery is Web Push and nothing else — there is no table of
-- messages, no inbox and no read receipt, which is a deliberate choice and
-- not an omission. The message exists on the recipient's device or it does
-- not exist at all.
--
-- Consequently this migration adds NO table. Sending needs the service role
-- (push endpoints are hidden from everyone but their owner by RLS), so the
-- authorization boundary for this one feature is the server action rather
-- than a policy — see src/server/notify-actions.ts, which re-checks this key
-- against the signed-in user before it touches the service-role client.
--
-- The key is catalogued here anyway so the permission matrix can render it,
-- so an Admin can withdraw it from a role, and so has_permission() is the
-- single vocabulary the app asks — the same question, whether or not the
-- answer happens to be enforced by a policy.
--
-- WHO CAN RECEIVE: only the 'user' role, enforced in the action. The feature
-- is for reaching the people executing the work, not for messaging sideways
-- or upward between the people directing it.
-- ============================================================

insert into public.permission_catalog (key, module, is_configurable, sort_order) values
  ('notifications.send', 'notifications', true, 195);

-- Both roles the user asked for. Admin is not a row: has_permission()
-- short-circuits on is_admin(), so an admin holds this without being granted
-- it, and cannot lose it by an edit to the matrix.
insert into public.role_permissions (role, permission) values
  ('manager',    'notifications.send'),
  ('power_user', 'notifications.send');
