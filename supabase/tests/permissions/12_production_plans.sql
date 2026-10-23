-- ============================================================
-- Production plans (2026-10-23): Admin and Owners make them (and whoever is
-- given production_plans.manage with a coverage period); the Production
-- manager reads every plan; Production's users read today's only; nobody
-- else sees them.
-- ============================================================

select pg_temp.person('boss', 'admin', 'operations');
select pg_temp.person('power', 'power_user', 'sales');
select pg_temp.person('pm', 'production_manager', 'production');
select pg_temp.person('maker', 'user', 'production');
select pg_temp.person('floor', 'user', 'logistics');

delete from public.production_plans where plan_date in ((now() at time zone 'Europe/Zurich')::date, (now() at time zone 'Europe/Zurich')::date + 1);

select pg_temp.can('Admin makes today''s plan', 'boss',
  $q$insert into public.production_plans (line_id, plan_date, notes)
     values ((select id from public.production_lines where slug = 'bio'), (now() at time zone 'Europe/Zurich')::date, 'ZZ today')$q$);
select pg_temp.can('and tomorrow''s', 'boss',
  $q$insert into public.production_plans (line_id, plan_date, notes)
     values ((select id from public.production_lines where slug = 'bio'), (now() at time zone 'Europe/Zurich')::date + 1, 'ZZ tomorrow')$q$);
select pg_temp.can('Admin adds a customer row', 'boss',
  $q$insert into public.production_plan_rows (plan_id, label) select id, 'ZZ customer' from public.production_plans where notes = 'ZZ tomorrow'$q$);
select pg_temp.cannot('two plans for one line and day are refused', 'boss',
  $q$insert into public.production_plans (line_id, plan_date)
     values ((select id from public.production_lines where slug = 'bio'), (now() at time zone 'Europe/Zurich')::date)$q$);

select pg_temp.hidden('a Power User who isn''t covering sees no plan', 'power', $q$select 1 from public.production_plans where notes like 'ZZ %'$q$);
select pg_temp.cannot('nor makes one', 'power',
  $q$insert into public.production_plans (line_id, plan_date) values ((select id from public.production_lines where slug = 'blue'), (now() at time zone 'Europe/Zurich')::date)$q$);

select pg_temp.sees('the Production manager sees tomorrow''s plan', 'pm', $q$select 1 from public.production_plans where notes = 'ZZ tomorrow'$q$);
select pg_temp.sees('and its rows', 'pm', $q$select 1 from public.production_plan_rows where label = 'ZZ customer'$q$);
select pg_temp.cannot('but does not change it', 'pm', $q$update public.production_plans set notes = 'x' where notes = 'ZZ tomorrow'$q$);
select pg_temp.cannot('nor the line''s factors', 'pm', $q$update public.production_lines set waste = 0.3 where slug = 'bio'$q$);

select pg_temp.sees('Production''s user sees today''s plan', 'maker', $q$select 1 from public.production_plans where notes = 'ZZ today'$q$);
select pg_temp.hidden('not tomorrow''s', 'maker', $q$select 1 from public.production_plans where notes = 'ZZ tomorrow'$q$);
select pg_temp.hidden('nor its rows', 'maker', $q$select 1 from public.production_plan_rows where label = 'ZZ customer'$q$);
select pg_temp.cannot('and changes nothing', 'maker', $q$update public.production_plans set notes = 'x' where notes = 'ZZ today'$q$);

select pg_temp.hidden('someone outside Production sees no plan', 'floor', $q$select 1 from public.production_plans where notes like 'ZZ %'$q$);
