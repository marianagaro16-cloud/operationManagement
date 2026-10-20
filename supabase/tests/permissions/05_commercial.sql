-- ============================================================
-- Commercial: Ventas, Cobranza, Marketing requests, Merch.
-- Customer notes, prospects and the sales plan: Ventas, Admin, Owners.
-- Collection cases: the collection team only.
-- Requests to Marketing: not plain Users, not the Production manager.
-- Merch: Admin/Owners, Ventas and Power Users plan it.
-- ============================================================

select pg_temp.person('seller', 'user', 'sales');
select pg_temp.person('admin', 'admin');
select pg_temp.person('owner', 'owner');
select pg_temp.person('pu_ops', 'power_user', 'operations');
select pg_temp.person('pm', 'production_manager', 'production');
select pg_temp.person('user', 'user', 'logistics');
select pg_temp.person('collector', 'user', 'operations');
select pg_temp.person('mkt', 'user', 'marketing');

create temp table _c as select id from public.customers order by created_at limit 1;
grant select on _c to authenticated;

insert into public.customer_notes (customer_id, note_date, body, kind_id, created_by)
values ((select id from _c), current_date, 'ZZ customer note', (select id from public.sales_activity_kinds order by created_at limit 1), pg_temp.id('seller'));
insert into public.prospects (company_name, owner_id, created_by) values ('ZZ prospect', pg_temp.id('seller'), pg_temp.id('seller'));
insert into public.sales_activities (salesperson_id, kind_id, activity_date, title, customer_id)
values (pg_temp.id('seller'), (select id from public.sales_activity_kinds order by created_at limit 1), current_date, 'ZZ sales activity', (select id from _c));

create temp table _q (k text primary key, q text);
grant select on _q to authenticated;
insert into _q values
  ('note', $$select 1 from public.customer_notes where body = 'ZZ customer note'$$),
  ('prospect', $$select 1 from public.prospects where company_name = 'ZZ prospect'$$),
  ('activity', $$select 1 from public.sales_activities where title = 'ZZ sales activity'$$);

select pg_temp.sees('sales ' || k || ': Ventas sees it', 'seller', q) from _q;
select pg_temp.sees('sales ' || k || ': admin sees it', 'admin', q) from _q;
select pg_temp.sees('sales ' || k || ': owner sees it', 'owner', q) from _q;
select pg_temp.hidden('sales ' || k || ': not a power user outside Ventas', 'pu_ops', q) from _q;
select pg_temp.hidden('sales ' || k || ': not the production manager', 'pm', q) from _q;
select pg_temp.hidden('sales ' || k || ': not a plain user', 'user', q) from _q;

-- Collections
insert into public.collection_team (profile_id) values (pg_temp.id('collector'));
insert into public.collection_cases (customer_id, note) values ((select id from _c), 'ZZ case');
select pg_temp.sees('collections: the team sees a case', 'collector', $$select 1 from public.collection_cases where note = 'ZZ case'$$);
select pg_temp.hidden('collections: not an admin outside the team', 'admin', $$select 1 from public.collection_cases where note = 'ZZ case'$$);
select pg_temp.hidden('collections: not Ventas', 'seller', $$select 1 from public.collection_cases where note = 'ZZ case'$$);
select pg_temp.hidden('collections: not a plain user', 'user', $$select 1 from public.collection_cases where note = 'ZZ case'$$);

-- Requests to Marketing
select pg_temp.can('marketing request: Ventas may ask', 'seller',
  $$insert into public.marketing_requests (title, requested_by) values ('ZZ request', auth.uid())$$);
select pg_temp.cannot('marketing request: a plain user may not', 'user',
  $$insert into public.marketing_requests (title, requested_by) values ('ZZ request', auth.uid())$$);
select pg_temp.cannot('marketing request: the production manager may not', 'pm',
  $$insert into public.marketing_requests (title, requested_by) values ('ZZ request', auth.uid())$$);

-- Event material: the kind's standard list is copied into a new event; Sales keeps the list.
insert into public.event_kind_materials (kind_id, name, quantity)
values ((select id from public.event_kinds order by sort_order limit 1), 'ZZ standard chair', 4);
insert into public.events (kind_id, name, start_date, end_date, owner_id, created_by)
values ((select id from public.event_kinds order by sort_order limit 1), 'ZZ event', current_date + 7, current_date + 7, pg_temp.id('seller'), pg_temp.id('seller'));
select pg_temp.check('event material: a new event gets the standard list',
  exists (select 1 from public.event_materials m join public.events e on e.id = m.event_id where e.name = 'ZZ event' and m.name = 'ZZ standard chair'));
select pg_temp.can('event material: Ventas adds a thing', 'seller',
  $$insert into public.event_materials (event_id, name) select id, 'ZZ terminal' from public.events where name = 'ZZ event'$$);
select pg_temp.can('event material: Ventas ticks it packed', 'seller',
  $$update public.event_materials set packed = true where name = 'ZZ terminal'$$);
select pg_temp.hidden('event material: not a plain user', 'user', $$select 1 from public.event_materials where name = 'ZZ terminal'$$);
select pg_temp.cannot('event material: the production manager may not tick it', 'pm',
  $$update public.event_materials set came_back = true where name = 'ZZ terminal'$$);
select pg_temp.cannot('event material: Ventas does not change the standard list', 'seller',
  $$insert into public.event_kind_materials (kind_id, name) select id, 'ZZ sneaky' from public.event_kinds limit 1$$);
select pg_temp.can('event material: admin changes the standard list', 'admin',
  $$update public.event_kind_materials set quantity = 6 where name = 'ZZ standard chair'$$);
select pg_temp.can('event material: Marketing adds a thing', 'mkt',
  $$insert into public.event_materials (event_id, name) select id, 'ZZ banner' from public.events where name = 'ZZ event'$$);
select pg_temp.can('event material: Marketing ticks it came back', 'mkt',
  $$update public.event_materials set came_back = true where name = 'ZZ terminal'$$);
select pg_temp.cannot('event material: Marketing does not change the standard list', 'mkt',
  $$update public.event_kind_materials set quantity = 9 where name = 'ZZ standard chair'$$);

-- Marketing does everything on events: tasks, budget, contacts, products, responsible.
select pg_temp.can('event task: Ventas gives one to Marketing', 'seller',
  $$insert into public.sales_activities (salesperson_id, kind_id, activity_date, title, event_id, created_by)
    select pg_temp.id('mkt'), (select id from public.sales_activity_kinds order by created_at limit 1), current_date + 3, 'ZZ photos', id, auth.uid()
      from public.events where name = 'ZZ event'$$);
select pg_temp.can('event task: Marketing plans one for Ventas', 'mkt',
  $$insert into public.sales_activities (salesperson_id, kind_id, activity_date, title, event_id, created_by)
    select pg_temp.id('seller'), (select id from public.sales_activity_kinds order by created_at limit 1), current_date + 3, 'ZZ stand', id, auth.uid()
      from public.events where name = 'ZZ event'$$);
select pg_temp.can('event task: Marketing changes one', 'mkt',
  $$update public.sales_activities set title = 'ZZ stand big' where title = 'ZZ stand'$$);
select pg_temp.can('event task: Marketing ticks one done', 'mkt',
  $$update public.sales_activities set status = 'done', done_at = now() where title = 'ZZ photos'$$);
select pg_temp.hidden('event task: Marketing does not see sales planning', 'mkt', $$select 1 from public.sales_activities where title = 'ZZ sales activity'$$);
select pg_temp.cannot('event task: Marketing does not change sales planning', 'mkt',
  $$update public.sales_activities set title = 'ZZ x' where title = 'ZZ sales activity'$$);
select pg_temp.cannot('event task: Marketing does not plan outside an event', 'mkt',
  $$insert into public.sales_activities (salesperson_id, kind_id, activity_date, title, created_by)
    values (auth.uid(), (select id from public.sales_activity_kinds order by created_at limit 1), current_date + 3, 'ZZ loose', auth.uid())$$);
select pg_temp.cannot('event task: Marketing does not tie one to a customer', 'mkt',
  $$update public.sales_activities set customer_id = (select id from _c) where title = 'ZZ stand big'$$);
select pg_temp.cannot('event task: a task outside an event is not for Marketing', 'seller',
  $$insert into public.sales_activities (salesperson_id, kind_id, activity_date, title, created_by)
    values (pg_temp.id('mkt'), (select id from public.sales_activity_kinds order by created_at limit 1), current_date + 3, 'ZZ loose', auth.uid())$$);
select pg_temp.can('event task: Marketing removes a planned one', 'mkt',
  $$delete from public.sales_activities where title = 'ZZ stand big'$$);

select pg_temp.can('event: Marketing may be the responsible person', 'seller',
  $$update public.events set owner_id = pg_temp.id('mkt') where name = 'ZZ event'$$);
select pg_temp.cannot('event: a plain user may not be the responsible person', 'seller',
  $$update public.events set owner_id = pg_temp.id('user') where name = 'ZZ event'$$);

select pg_temp.can('event budget: Marketing adds a cost', 'mkt',
  $$insert into public.event_costs (event_id, type_id, description, planned_amount)
    select e.id, (select id from public.event_cost_types limit 1), 'ZZ stand fee', 100 from public.events e where e.name = 'ZZ event'$$);
select pg_temp.sees('event budget: Marketing sees it', 'mkt', $$select 1 from public.event_costs where description = 'ZZ stand fee'$$);
select pg_temp.hidden('event budget: not a plain user', 'user', $$select 1 from public.event_costs where description = 'ZZ stand fee'$$);

select pg_temp.can('event contact: Marketing adds one, followed up by Ventas', 'mkt',
  $$select public.event_add_contact((select id from public.events where name = 'ZZ event'), 'ZZ fair contact', null, null, null, null, current_date + 5, pg_temp.id('seller'))$$);
select pg_temp.sees('event contact: Marketing sees the event''s contacts', 'mkt', $$select 1 from public.prospects where company_name = 'ZZ fair contact'$$);
select pg_temp.sees('event contact: the follow-up call is in Ventas'' planning', 'seller',
  $$select 1 from public.sales_activities a join public.prospects p on p.id = a.prospect_id where p.company_name = 'ZZ fair contact'$$);
select pg_temp.hidden('event contact: Marketing does not see the rest of the pipeline', 'mkt', $$select 1 from public.prospects where company_name = 'ZZ prospect'$$);
select pg_temp.cannot('event contact: Marketing may not follow it up itself', 'mkt',
  $$select public.event_add_contact((select id from public.events where name = 'ZZ event'), 'ZZ fair contact 2', null, null, null, null, current_date + 5, auth.uid())$$);
select pg_temp.cannot('event contact: a plain user may not add one', 'user',
  $$select public.event_add_contact((select id from public.events where name = 'ZZ event'), 'ZZ fair contact 3', null, null, null, null, current_date + 5, pg_temp.id('seller'))$$);

select pg_temp.can('event products: Marketing sets them', 'mkt',
  $$select public.event_set_products((select id from public.events where name = 'ZZ event'),
      jsonb_build_array(jsonb_build_object('product_id', (select id from public.products limit 1), 'quantity', 5)))$$);
select pg_temp.cannot('event products: a plain user may not', 'user',
  $$select public.event_set_products((select id from public.events where name = 'ZZ event'), '[]'::jsonb)$$);
select pg_temp.hidden('event products: Orders stay closed to the external account', 'mkt', 'select 1 from public.orders');
select pg_temp.sees('event products: Marketing reads the event''s order through the event', 'mkt',
  $$select 1 from public.events e where e.order_id is not null and jsonb_array_length(public.event_order(e.id) -> 'lines') > 0$$);
select pg_temp.sees('event products: Ventas reads it the same way', 'seller',
  $$select 1 from public.events e where e.order_id is not null and public.event_order(e.id) is not null$$);
create temp table _eo as select id from public.events where order_id is not null limit 1;
grant select on _eo to authenticated;
select pg_temp.act_as('user');
create temp table _eo_seen as select public.event_order(id) r from _eo;
select pg_temp.as_system();
select pg_temp.check('event products: not a plain user', (select count(*) = 1 and bool_and(r is null) from _eo_seen));

-- Merch
select pg_temp.can('merch: Ventas adds an item', 'seller', $$insert into public.merch_items (name) values ('ZZ pen')$$);
select pg_temp.can('merch: a power user adds an item', 'pu_ops', $$insert into public.merch_items (name) values ('ZZ pen 2')$$);
select pg_temp.cannot('merch: a plain user may not', 'user', $$insert into public.merch_items (name) values ('ZZ pen 3')$$);
select pg_temp.cannot('merch: the production manager may not', 'pm', $$insert into public.merch_items (name) values ('ZZ pen 4')$$);

-- First orders paid in advance: set by whoever creates the customer; changed later by the collections team only.
select pg_temp.can('prepay first orders: a new customer carries it', 'admin',
  $$insert into public.customers (company_name, prepay_first_orders) values ('ZZ prepay customer', 3)$$);
select pg_temp.cannot('prepay first orders: an admin outside the team cannot change it later', 'admin',
  $$update public.customers set prepay_first_orders = 5 where company_name = 'ZZ prepay customer'$$);
select pg_temp.cannot('prepay first orders: not through the team''s function either', 'admin',
  $$select public.set_customer_prepay_first_orders((select id from public.customers where company_name = 'ZZ prepay customer'), 5)$$);
select pg_temp.can('prepay first orders: the collections team changes it', 'collector',
  $$select public.set_customer_prepay_first_orders((select id from public.customers where company_name = 'ZZ prepay customer'), 5)$$);
select pg_temp.check('prepay first orders: the change is kept',
  (select prepay_first_orders = 5 from public.customers where company_name = 'ZZ prepay customer'));

-- Counted: the customer's first N sale orders by creation, cancelled ones not counted.
create temp table _po as
  select o.customer_id, array_agg(o.id order by o.created_at, o.id) as ids
  from public.orders o where o.order_type = 'sale' and o.status <> 'cancelled'
  group by o.customer_id having count(*) >= 2 limit 1;
grant select on _po to authenticated;
select pg_temp.can('prepay first orders: the team sets one on a customer with orders', 'collector',
  $$select public.set_customer_prepay_first_orders((select customer_id from _po), 1)$$);
select pg_temp.check('prepay first orders: the first order is in advance',
  (select public.in_advance(o) from public.orders o where o.id = (select ids[1] from _po)));
select pg_temp.check('prepay first orders: the second is not',
  (select not public.in_advance(o) from public.orders o where o.id = (select ids[2] from _po)));
select pg_temp.check('prepay first orders: the status counts every sale order',
  coalesce((select s.counted = cardinality(p.ids) from (select pg_temp.act_as('user')) a, public.prepay_first_orders_status() s join _po p on p.customer_id = s.customer_id), false));
select pg_temp.as_system();

-- Winning a prospect sets the new customer's first orders paid in advance, like the new-customer form.
insert into public.prospects (company_name, owner_id, created_by) values ('ZZ won prospect', pg_temp.id('seller'), pg_temp.id('seller'));
select pg_temp.can('prepay first orders: Ventas sets them when winning a prospect', 'seller',
  $$select public.sales_prospect_win((select id from public.prospects where company_name = 'ZZ won prospect'), 2)$$);
select pg_temp.check('prepay first orders: the won customer carries them',
  (select prepay_first_orders = 2 from public.customers where company_name = 'ZZ won prospect'));
