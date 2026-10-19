-- ============================================================
-- Whoever is given something on an event (2026-10-19): they see and handle
-- their own shifts, material and tasks — nothing else of the event, and
-- nothing of someone else's part.
-- ============================================================

select pg_temp.person('jeff', 'user', 'logistics');
select pg_temp.person('other', 'user', 'operations');
select pg_temp.person('seller', 'user', 'sales');

insert into public.events (kind_id, name, stage, start_date, end_date, created_by)
values ((select id from public.event_kinds order by sort_order limit 1), 'ZZ fair', 'confirmed', current_date + 1, current_date + 2, pg_temp.id('seller'));
-- Only the test's own material, not the kind's standard list.
delete from public.event_materials where event_id = (select id from public.events where name = 'ZZ fair');

create temp table _e as select id from public.events where name = 'ZZ fair';
grant select on _e to authenticated;

insert into public.event_shifts (event_id, shift_date, start_time, end_time, profile_id)
values ((select id from _e), current_date + 1, '09:00', '17:00', pg_temp.id('jeff'));
insert into public.event_materials (event_id, name, bringer_profile) values
  ((select id from _e), 'ZZ terminal', pg_temp.id('jeff')),
  ((select id from _e), 'ZZ chairs', pg_temp.id('other'));
insert into public.sales_activities (salesperson_id, kind_id, activity_date, title, event_id, created_by)
values (pg_temp.id('jeff'), (select id from public.sales_activity_kinds where slug = 'event_task'), current_date + 1, 'ZZ task', (select id from _e), pg_temp.id('seller'));

-- Their ids, looked up here: the people acting cannot read these tables.
create temp table _ids as
  select name as k, id from public.event_materials where name in ('ZZ terminal', 'ZZ chairs')
  union all select title, id from public.sales_activities where title = 'ZZ task';
grant select on _ids to authenticated;

-- What each one is given
create function pg_temp.mine(p_who text, p_part text) returns int language plpgsql as $$
declare c int;
begin
  perform pg_temp.act_as(p_who);
  c := jsonb_array_length(public.my_event_work(current_date, current_date + 7) -> p_part);
  perform pg_temp.as_system();
  return c;
end $$;
select pg_temp.check('event assignee: sees their shift', pg_temp.mine('jeff', 'shifts') = 1);
select pg_temp.check('event assignee: sees what they bring', pg_temp.mine('jeff', 'materials') = 1);
select pg_temp.check('event assignee: sees their task', pg_temp.mine('jeff', 'tasks') = 1);
select pg_temp.check('event assignee: someone else gets no shift of theirs', pg_temp.mine('other', 'shifts') = 0);

create function pg_temp.page(p_who text) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  perform pg_temp.act_as(p_who);
  v := public.my_event((select id from _e));
  perform pg_temp.as_system();
  return v;
end $$;
select pg_temp.check('event assignee: the page shows only their material',
  (select jsonb_agg(m ->> 'name') from jsonb_array_elements(pg_temp.page('jeff') -> 'materials') m) = '["ZZ terminal"]'::jsonb);
select pg_temp.check('event assignee: no page for someone with nothing on it', pg_temp.page('seller') is null);

select pg_temp.hidden('event assignee: still does not read the event itself', 'jeff', $$select 1 from public.events where name = 'ZZ fair'$$);

-- Handling their part
select pg_temp.cannot('event assignee: cannot tick what someone else brings', 'jeff',
  $$select public.my_event_material_tick((select id from _ids where k = 'ZZ chairs'), 'packed', true)$$);
select pg_temp.can('event assignee: ticks what they bring as packed', 'jeff',
  $$select public.my_event_material_tick((select id from _ids where k = 'ZZ terminal'), 'packed', true)$$);
select pg_temp.cannot('event assignee: someone else cannot do their task', 'other',
  $$select public.my_event_task_done((select id from _ids where k = 'ZZ task'))$$);
select pg_temp.can('event assignee: does their task', 'jeff',
  $$select public.my_event_task_done((select id from _ids where k = 'ZZ task'))$$);

-- Giving tasks
select pg_temp.can('event task: Ventas gives one to someone in Logística', 'seller',
  $$insert into public.sales_activities (salesperson_id, kind_id, activity_date, title, event_id, created_by)
    values (pg_temp.id('jeff'), (select id from public.sales_activity_kinds where slug = 'event_task'), current_date + 1, 'ZZ task 2', (select id from _e), pg_temp.id('seller'))$$);
select pg_temp.cannot('sales work: not for someone outside Ventas', 'seller',
  $$insert into public.sales_activities (salesperson_id, kind_id, activity_date, title, customer_id, created_by)
    values (pg_temp.id('jeff'), (select id from public.sales_activity_kinds where slug = 'event_task'), current_date + 1, 'ZZ call', (select id from public.customers order by created_at limit 1), pg_temp.id('seller'))$$);
