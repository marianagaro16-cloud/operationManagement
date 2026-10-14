-- ============================================================
-- External accounts (Marketing team + User role: Tona).
-- They see their own day, events and the catalogue — none of the operation.
-- ============================================================

select pg_temp.person('ext', 'user', 'marketing');
select pg_temp.person('admin', 'admin');

select pg_temp.check('the external person is external', (select public.is_external() from (select pg_temp.act_as('ext')) a));
select pg_temp.as_system();

-- The operation is closed.
select pg_temp.hidden('external: no orders', 'ext', 'select 1 from public.orders');
select pg_temp.hidden('external: no order lines', 'ext', 'select 1 from public.order_lines');
select pg_temp.hidden('external: no lots', 'ext', 'select 1 from public.lot_allocations');
select pg_temp.hidden('external: no inventories', 'ext', 'select 1 from public.inventory_instances');
select pg_temp.hidden('external: no goods receptions', 'ext', 'select 1 from public.goods_receptions');
select pg_temp.hidden('external: no received products', 'ext', 'select 1 from public.goods_reception_lines');
select pg_temp.hidden('external: no expected deliveries', 'ext', 'select 1 from public.expected_deliveries');
select pg_temp.hidden('external: no suppliers', 'ext', 'select 1 from public.suppliers');
select pg_temp.hidden('external: no incidents', 'ext', 'select 1 from public.incidents');
select pg_temp.hidden('external: no absences', 'ext', 'select 1 from public.absences');
select pg_temp.hidden('external: no HR files', 'ext', 'select 1 from public.hr_workers');
select pg_temp.hidden('external: no collection cases', 'ext', 'select 1 from public.collection_cases');
select pg_temp.hidden('external: no customer notes', 'ext', 'select 1 from public.customer_notes');
select pg_temp.hidden('external: no event costs', 'ext', 'select 1 from public.event_costs');
select pg_temp.hidden('external: no merch items', 'ext', 'select 1 from public.merch_items');
select pg_temp.hidden('external: no work schedule', 'ext', 'select 1 from public.schedule_blocks');

-- What is theirs to see.
select pg_temp.sees('external: sees events', 'ext', 'select 1 from public.events');
select pg_temp.sees('external: sees the products', 'ext', 'select 1 from public.products');
select pg_temp.sees('external: sees the customers', 'ext', 'select 1 from public.customers');

-- And cannot change the operation.
select pg_temp.cannot('external: cannot change an order', 'ext',
  $$update public.orders set note = 'zz' where id = (select id from public.orders limit 1)$$);
select pg_temp.cannot('external: cannot add a supplier', 'ext',
  $$insert into public.suppliers (name) values ('ZZ supplier')$$);
select pg_temp.cannot('external: cannot add a customer note', 'ext',
  $$insert into public.customer_notes (customer_id, note_date, body, kind_id)
    select (select id from public.customers limit 1), current_date, 'zz', (select id from public.sales_activity_kinds limit 1)$$);
