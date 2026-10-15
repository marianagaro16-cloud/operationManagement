-- ============================================================
-- Accounts and the operation.
-- Nobody raises their own role; only an Owner changes an Owner; the
-- permission matrix is Admin's. Orders are read-only for the Production
-- manager. A User sees only the inventories assigned to them. A completed
-- reception's products are corrected by the office only. History is
-- permanent.
-- ============================================================

select pg_temp.person('admin', 'admin');
select pg_temp.person('owner1', 'owner');
select pg_temp.person('owner2', 'owner');
select pg_temp.person('pu', 'power_user', 'sales');
select pg_temp.person('pm', 'production_manager', 'production');
select pg_temp.person('userA', 'user', 'logistics');
select pg_temp.person('userB', 'user', 'logistics');  -- made a Power User below
select pg_temp.person('userC', 'user', 'logistics');

-- Accounts
select pg_temp.cannot('account: a user cannot make themselves admin', 'userA',
  $$update public.profiles set role = 'admin' where id = auth.uid()$$);
select pg_temp.cannot('account: a power user cannot make themselves admin', 'pu',
  $$update public.profiles set role = 'admin' where id = auth.uid()$$);
select pg_temp.cannot('account: a user cannot change someone else', 'userA',
  format('update public.profiles set status = %L where id = %L', 'deactivated', pg_temp.id('userB')));
select pg_temp.cannot('account: admin cannot change an owner''s role', 'admin',
  format('update public.profiles set role = %L where id = %L', 'admin', pg_temp.id('owner1')));
select pg_temp.cannot('account: admin cannot make someone an owner', 'admin',
  format('update public.profiles set role = %L where id = %L', 'owner', pg_temp.id('userB')));
select pg_temp.can('account: an owner can change another owner', 'owner2',
  format('update public.profiles set role = %L where id = %L', 'admin', pg_temp.id('owner1')));
select pg_temp.can('account: admin changes a user''s role', 'admin',
  format('update public.profiles set role = %L where id = %L', 'power_user', pg_temp.id('userB')));
select pg_temp.cannot('account: nobody is made a Manager (retired role)', 'owner2',
  format('update public.profiles set role = %L where id = %L', 'manager', pg_temp.id('userC')));
select pg_temp.cannot('permissions: a power user cannot grant capabilities', 'pu',
  $$insert into public.role_permissions (role, permission) values ('user', 'orders.manage')$$);

-- Orders
select pg_temp.sees('orders: the production manager reads them', 'pm', 'select 1 from public.orders');
select pg_temp.cannot('orders: the production manager cannot change one', 'pm',
  $$update public.orders set note = 'zz' where id = (select id from public.orders order by created_at desc limit 1)$$);
select pg_temp.sees('orders: a logistics user reads them', 'userA', 'select 1 from public.orders');
select pg_temp.cannot('orders: nobody deletes the order history', 'admin',
  $$delete from public.order_audit_log where id = (select id from public.order_audit_log limit 1)$$);

-- Inventories: userA assigned to one; userC to none.
create temp table _inv as select id from public.inventory_instances order by inventory_date desc limit 1;
grant select on _inv to authenticated;
insert into public.inventory_assignments (instance_id, user_id) values ((select id from _inv), pg_temp.id('userA'));
select pg_temp.sees('inventory: a user sees the one assigned to them', 'userA', 'select 1 from public.inventory_instances where id in (select id from _inv)');
select pg_temp.hidden('inventory: a user does not see one not assigned to them', 'userC', 'select 1 from public.inventory_instances where id in (select id from _inv)');
select pg_temp.cannot('inventory: nobody deletes the inventory history', 'admin',
  $$delete from public.inventory_audit_log where id = (select id from public.inventory_audit_log limit 1)$$);

-- Received products on a completed reception: the office, not the floor.
create temp table _gr as select id from public.goods_receptions where status = 'completed' order by received_at desc limit 1;
grant select on _gr to authenticated;
-- userA is on the reception list, so only the reception's state stops them.
insert into public.goods_reception_assignees (user_id) values (pg_temp.id('userA'));
select pg_temp.cannot('reception: a receiver cannot add products to a completed reception', 'userA',
  $$insert into public.goods_reception_lines (reception_id, description, quantity) select id, 'ZZ line', 1 from _gr$$);
select pg_temp.can('reception: the office corrects a completed reception', 'admin',
  $$insert into public.goods_reception_lines (reception_id, description, quantity) select id, 'ZZ line', 1 from _gr$$);

-- Expected deliveries: the office and the Production manager announce them
select pg_temp.sees('expected: the production manager announces them', 'pm',
  'select 1 where public.can_manage_expected_deliveries()');
select pg_temp.sees('expected: a power user announces them', 'pu',
  'select 1 where public.can_manage_expected_deliveries()');
