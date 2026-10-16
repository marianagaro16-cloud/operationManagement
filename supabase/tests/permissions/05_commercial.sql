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

-- Event tasks: one may go to Marketing; they see the event's tasks and tick only their own.
select pg_temp.can('event task: Ventas gives one to Marketing', 'seller',
  $$insert into public.sales_activities (salesperson_id, kind_id, activity_date, title, event_id, created_by)
    select pg_temp.id('mkt'), (select id from public.sales_activity_kinds order by created_at limit 1), current_date + 3, 'ZZ photos', id, auth.uid()
      from public.events where name = 'ZZ event'$$);
select pg_temp.can('event task: Ventas plans one for themselves', 'seller',
  $$insert into public.sales_activities (salesperson_id, kind_id, activity_date, title, event_id, created_by)
    select auth.uid(), (select id from public.sales_activity_kinds order by created_at limit 1), current_date + 3, 'ZZ stand', id, auth.uid()
      from public.events where name = 'ZZ event'$$);
select pg_temp.sees('event task: Marketing sees the other tasks of the event', 'mkt', $$select 1 from public.sales_activities where title = 'ZZ stand'$$);
select pg_temp.hidden('event task: Marketing does not see sales planning', 'mkt', $$select 1 from public.sales_activities where title = 'ZZ sales activity'$$);
select pg_temp.cannot('event task: Marketing does not tick someone else''s', 'mkt',
  $$update public.sales_activities set status = 'done', done_at = now() where title = 'ZZ stand'$$);
select pg_temp.cannot('event task: Marketing does not rename their own', 'mkt',
  $$update public.sales_activities set title = 'ZZ renamed' where title = 'ZZ photos'$$);
select pg_temp.can('event task: Marketing ticks their own done', 'mkt',
  $$update public.sales_activities set status = 'done', done_at = now() where title = 'ZZ photos'$$);
select pg_temp.cannot('event task: Marketing may not add one', 'mkt',
  $$insert into public.sales_activities (salesperson_id, kind_id, activity_date, title, event_id, created_by)
    select auth.uid(), (select id from public.sales_activity_kinds order by created_at limit 1), current_date + 3, 'ZZ own', id, auth.uid()
      from public.events where name = 'ZZ event'$$);
select pg_temp.cannot('event task: a task outside an event is not for Marketing', 'seller',
  $$insert into public.sales_activities (salesperson_id, kind_id, activity_date, title, created_by)
    values (pg_temp.id('mkt'), (select id from public.sales_activity_kinds order by created_at limit 1), current_date + 3, 'ZZ loose', auth.uid())$$);

-- Merch
select pg_temp.can('merch: Ventas adds an item', 'seller', $$insert into public.merch_items (name) values ('ZZ pen')$$);
select pg_temp.can('merch: a power user adds an item', 'pu_ops', $$insert into public.merch_items (name) values ('ZZ pen 2')$$);
select pg_temp.cannot('merch: a plain user may not', 'user', $$insert into public.merch_items (name) values ('ZZ pen 3')$$);
select pg_temp.cannot('merch: the production manager may not', 'pm', $$insert into public.merch_items (name) values ('ZZ pen 4')$$);
