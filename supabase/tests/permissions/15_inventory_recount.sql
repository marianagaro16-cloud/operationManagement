-- ============================================================
-- A product reopened for a recount (20270212090000): the inventory's
-- assignees may count that product again on any day, even though the
-- inventory is closed — only that product, and only until it is done again.
-- ============================================================

select pg_temp.person('admin', 'admin');
select pg_temp.person('counter', 'user', 'production');  -- assigned
select pg_temp.person('other', 'user', 'production');    -- not assigned

-- A closed inventory with two counted products that carry a quantity.
create temp table _inv as
  select i.id from public.inventory_instances i
   where i.completed_at is not null
     and (select count(*) from public.inventory_instance_items ii
           where ii.instance_id = i.id and ii.counted_at is not null
             and exists (select 1 from public.inventory_entries e
                          where e.instance_item_id = ii.id and e.quantity is not null)) >= 2
   order by i.inventory_date desc limit 1;
create temp table _items as
  select ii.id, row_number() over (order by ii.item_sort_order, ii.id) as n
    from public.inventory_instance_items ii
   where ii.instance_id = (select id from _inv) and ii.counted_at is not null
     and exists (select 1 from public.inventory_entries e
                  where e.instance_item_id = ii.id and e.quantity is not null)
   order by ii.item_sort_order, ii.id limit 2;
grant select on _inv, _items to authenticated;

insert into public.inventory_assignments (instance_id, user_id)
  values ((select id from _inv), pg_temp.id('counter'));

-- Before any reopen: closed for the counter.
select pg_temp.cannot('closed: the counter cannot change a product', 'counter',
  $$update public.inventory_entries set quantity = quantity where instance_item_id = (select id from _items where n = 1)$$);

-- The digital side reopens product 1.
select pg_temp.can('admin: reopens a product of a closed inventory', 'admin',
  $$select public.inventory_item_set_done((select id from _items where n = 1), false)$$);
select pg_temp.check('the reopen asks for a recount',
  (select recount_requested_at is not null from public.inventory_instance_items where id = (select id from _items where n = 1)));

select pg_temp.can('counter: changes the reopened product', 'counter',
  $$update public.inventory_entries set quantity = quantity where instance_item_id = (select id from _items where n = 1)$$);
select pg_temp.can('counter: adds a line to the reopened product', 'counter',
  $$insert into public.inventory_entries (instance_item_id, instance_id, quantity, created_by, position)
    values ((select id from _items where n = 1), (select id from _inv), 0, (select id from _p where key = 'counter'), 999)$$);
select pg_temp.cannot('counter: the other products stay locked', 'counter',
  $$update public.inventory_entries set quantity = quantity where instance_item_id = (select id from _items where n = 2)$$);
select pg_temp.cannot('not assigned: cannot change the reopened product', 'other',
  $$update public.inventory_entries set quantity = quantity where instance_item_id = (select id from _items where n = 1)$$);

select pg_temp.act_as('counter');
select pg_temp.check('counter: the screen lists the reopened product, not the other',
  exists (select 1 from public.inventory_recount_item_ids((select id from _inv)) x where x = (select id from _items where n = 1))
  and not exists (select 1 from public.inventory_recount_item_ids((select id from _inv)) x where x = (select id from _items where n = 2)));
select pg_temp.check('counter: cannot see who asked for the recount',
  pg_temp.try($$select recount_requested_by from public.inventory_instance_items limit 1$$) like 'error:%');
select pg_temp.as_system();

-- Marked done: the recount is over and it locks again.
select pg_temp.can('counter: marks the reopened product done', 'counter',
  $$select public.inventory_item_set_done((select id from _items where n = 1), true)$$);
select pg_temp.check('done clears the recount',
  (select recount_requested_at is null from public.inventory_instance_items where id = (select id from _items where n = 1)));
select pg_temp.cannot('counter: after done the product is locked again', 'counter',
  $$update public.inventory_entries set quantity = quantity where instance_item_id = (select id from _items where n = 1)$$);
select pg_temp.cannot('counter: cannot reopen it themselves', 'counter',
  $$select public.inventory_item_set_done((select id from _items where n = 1), false)$$);

-- "Volver a contar" (20270213090000): the reviewer sends a product back.
select pg_temp.cannot('counter: cannot send products back themselves', 'counter',
  $$select public.inventory_request_recount(array[(select id from _items where n = 2)])$$);
select pg_temp.cannot('not assigned user: cannot send products back', 'other',
  $$select public.inventory_request_recount(array[(select id from _items where n = 2)])$$);
select pg_temp.can('admin: sends product 2 back to be counted again', 'admin',
  $$select public.inventory_request_recount(array[(select id from _items where n = 2)])$$);
select pg_temp.check('sent back: not done, recount asked, notice still to go',
  (select counted_at is null and recount_requested_at is not null and recount_notified_at is null
     from public.inventory_instance_items where id = (select id from _items where n = 2)));
select pg_temp.check('sent back: the counted lines stay',
  exists (select 1 from public.inventory_entries where instance_item_id = (select id from _items where n = 2) and quantity is not null));
select pg_temp.can('counter: changes the product sent back', 'counter',
  $$update public.inventory_entries set quantity = quantity where instance_item_id = (select id from _items where n = 2)$$);
select pg_temp.act_as('counter');
select pg_temp.check('counter: sees that product 2 is to count again',
  (select recount_requested_at is not null from public.inventory_instance_items where id = (select id from _items where n = 2)));
select pg_temp.as_system();
