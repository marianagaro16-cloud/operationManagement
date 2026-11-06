-- ============================================================
-- Inventory Digital is kept from whoever does the physical count
-- (20270211090000): no digital figure, no difference, no "to review", no
-- digital history or resolutions — straight from the tables or through the
-- functions. Admins see everything; someone who did not count sees it as before.
-- ============================================================

select pg_temp.person('admin', 'admin');
select pg_temp.person('counter', 'user', 'production');   -- assigned, sees only their own
select pg_temp.person('opsCounter', 'power_user', 'operations'); -- assigned, sees every inventory
select pg_temp.person('opsOther', 'power_user', 'operations'); -- not assigned: did not count it
select pg_temp.person('prodOther', 'user', 'production');  -- not assigned and not theirs to see

-- A recent inventory with Inventory Digital on, and one of its lines.
create temp table _inv as
  select i.id from public.inventory_instances i
   where i.digital_enabled
     and exists (select 1 from public.inventory_instance_items ii where ii.instance_id = i.id)
   order by i.inventory_date desc limit 1;
create temp table _item as
  select ii.id, ii.physical_stock from public.inventory_instance_items ii
   where ii.instance_id = (select id from _inv) order by ii.item_sort_order, ii.id limit 1;
grant select on _inv, _item to authenticated;

insert into public.inventory_assignments (instance_id, user_id) values
  ((select id from _inv), pg_temp.id('counter')),
  ((select id from _inv), pg_temp.id('opsCounter'));

-- The admin enters a digital figure that disagrees with the count: the line is "to review".
select pg_temp.act_as('admin');
select public.inventory_set_digital((select id from _item), (select physical_stock + 3 from _item));
select pg_temp.check('admin: sees the digital figure',
  (select digital_quantity from public.inventory_review_items((select id from _inv))
    where item_id = (select id from _item)) = (select physical_stock + 3 from _item));
select pg_temp.check('admin: sees the line to review',
  (select status from public.inventory_review_items((select id from _inv))
    where item_id = (select id from _item)) = 'to_review');
select pg_temp.check('admin: the inventory is not hidden from them',
  (select not digital_hidden and review_count > 0 from public.inventory_review_summary(array[(select id from _inv)])));
select pg_temp.check('admin: sees the digital history',
  exists (select 1 from public.inventory_digital_history where instance_item_id = (select id from _item)));
select pg_temp.as_system();

-- The counters, both kinds.
select pg_temp.act_as('counter');
select pg_temp.check('counter: still sees the inventory and its lines',
  exists (select 1 from public.inventory_instance_items where instance_id = (select id from _inv)));
select pg_temp.check('counter: no digital figure on any line',
  not exists (select 1 from public.inventory_review_items((select id from _inv))
               where digital_quantity is not null or difference is not null or is_resolved)
  and exists (select 1 from public.inventory_review_items((select id from _inv))));
select pg_temp.check('counter: no line or inventory to review or resolved',
  not exists (select 1 from public.inventory_review_items((select id from _inv)) where status in ('to_review', 'resolved'))
  and (select status in ('in_progress', 'completed') and digital_hidden and review_count = 0
         and resolved_count = 0 and digital_pending_count = 0
         from public.inventory_review_summary(array[(select id from _inv)])));
select pg_temp.check('counter: filtering "to review" does not find it',
  not exists (select 1 from public.inventory_ids_by_status('to_review') where id = (select id from _inv)));
select pg_temp.check('counter: no digital history',
  not exists (select 1 from public.inventory_digital_history where instance_id = (select id from _inv)));
select pg_temp.as_system();

select pg_temp.cannot('counter: cannot read the digital figure from the table', 'counter',
  $$select digital_quantity from public.inventory_instance_items where instance_id = (select id from _inv)$$);
select pg_temp.cannot('counter: cannot read the difference from the table', 'counter',
  $$select difference from public.inventory_instance_items where instance_id = (select id from _inv)$$);
select pg_temp.cannot('counter: cannot read the stored status from the table', 'counter',
  $$select status from public.inventory_instances where id = (select id from _inv)$$);
select pg_temp.cannot('counter: cannot set the digital figure', 'counter',
  $$select public.inventory_set_digital((select id from _item), 1)$$);

select pg_temp.act_as('opsCounter');
select pg_temp.check('operations counter: no digital figure either',
  not exists (select 1 from public.inventory_review_items((select id from _inv)) where digital_quantity is not null)
  and (select digital_hidden from public.inventory_review_summary(array[(select id from _inv)])));
select pg_temp.as_system();

-- Someone who did not count it sees it as before.
select pg_temp.act_as('opsOther');
select pg_temp.check('not the counter: sees the digital figure',
  (select digital_quantity from public.inventory_review_items((select id from _inv))
    where item_id = (select id from _item)) = (select physical_stock + 3 from _item));
select pg_temp.check('not the counter: sees the line to review',
  (select not digital_hidden and review_count > 0
     from public.inventory_review_summary(array[(select id from _inv)])));
select pg_temp.as_system();

-- And the functions do not open an inventory someone may not see at all.
select pg_temp.act_as('prodOther');
select pg_temp.check('not theirs: the functions return nothing',
  not exists (select 1 from public.inventory_review_items((select id from _inv)))
  and not exists (select 1 from public.inventory_review_summary(array[(select id from _inv)])));
select pg_temp.as_system();

-- Having written a count line is enough to be its counter, assignment or not.
insert into public.inventory_entries (instance_item_id, instance_id, quantity, created_by)
  values ((select id from _item), (select id from _inv), 1, pg_temp.id('opsOther'));
select pg_temp.act_as('opsOther');
select pg_temp.check('wrote a count line: now the digital side is hidden',
  (select digital_hidden from public.inventory_review_summary(array[(select id from _inv)])));
select pg_temp.as_system();
