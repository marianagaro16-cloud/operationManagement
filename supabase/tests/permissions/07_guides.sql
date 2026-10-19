-- ============================================================
-- Guías: closed to the Ventas team, even on the days they cover someone
-- (2026-10-19). Admin and Owners on the team keep them; a power user
-- outside Ventas who covers reads the guide, its articles, the supplier
-- conditions and the customer specifications.
-- ============================================================

select pg_temp.person('away', 'user', 'operations');
select pg_temp.person('seller', 'power_user', 'sales');
select pg_temp.person('cover_ops', 'power_user', 'operations');
select pg_temp.person('sales_owner', 'owner', 'sales');

insert into public.guides (profile_id, intro) values (pg_temp.id('away'), 'ZZ guide');
insert into public.guide_points (guide_id, weekdays, title)
values (pg_temp.id('away'), array[1, 2, 3, 4, 5, 6, 7]::smallint[], 'ZZ point');
insert into public.guide_articles (title) values ('ZZ article');
insert into public.suppliers (name) values ('ZZ supplier');
insert into public.supplier_order_info (supplier_id, how)
select id, 'ZZ how' from public.suppliers where name = 'ZZ supplier';
insert into public.customer_specifications (customer_id, type_id, body)
values ((select id from public.customers order by created_at limit 1), (select id from public.customer_specification_types order by sort_order limit 1), 'ZZ spec');

-- Both of them cover the absent person today. Approved straight away, as the
-- RPCs do; the logs stay off, or they would use up their numbers (rolled back).
select set_config('app.absence_rpc', 'on', true);
alter table public.absences disable trigger absences_log;
alter table public.coverage_assignments disable trigger coverage_assignments_log;
insert into public.absences (profile_id, type_id, start_date, end_date, status)
values (pg_temp.id('away'), (select id from public.absence_types order by created_at limit 1), current_date, current_date, 'approved');
insert into public.coverage_assignments (absence_id, coverer_id, cover_date, start_time, end_time)
select a.id, p.id, current_date, '08:00', '17:00'
  from public.absences a, _p p
 where a.profile_id = pg_temp.id('away') and p.key in ('seller', 'cover_ops');
alter table public.absences enable trigger absences_log;
alter table public.coverage_assignments enable trigger coverage_assignments_log;
select set_config('app.absence_rpc', '', true);

create temp table _q (k text primary key, q text);
grant select on _q to authenticated;
insert into _q values
  ('guide', $$select 1 from public.guides where intro = 'ZZ guide'$$),
  ('point', $$select 1 from public.guide_points where title = 'ZZ point'$$),
  ('article', $$select 1 from public.guide_articles where title = 'ZZ article'$$),
  ('supplier conditions', $$select 1 from public.supplier_order_info where how = 'ZZ how'$$),
  ('customer specification', $$select 1 from public.customer_specifications where body = 'ZZ spec'$$);

select pg_temp.sees('guides ' || k || ': a covering power user outside Ventas', 'cover_ops', q) from _q;
select pg_temp.hidden('guides ' || k || ': not Ventas, even covering', 'seller', q) from _q;
select pg_temp.sees('guides ' || k || ': an owner on Ventas', 'sales_owner', q) from _q;

select pg_temp.cannot('guides: Ventas covering cannot tick', 'seller',
  $$select public.guide_check((select id from public.guide_points where title = 'ZZ point'), 'done', null)$$);
select pg_temp.can('guides: the covering power user ticks', 'cover_ops',
  $$select public.guide_check((select id from public.guide_points where title = 'ZZ point'), 'done', null)$$);
select pg_temp.cannot('guides: Ventas cannot write a customer specification', 'seller',
  $$update public.customer_specifications set body = 'ZZ changed' where body = 'ZZ spec' returning 1$$);
