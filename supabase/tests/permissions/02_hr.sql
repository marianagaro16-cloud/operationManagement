-- ============================================================
-- Human resources.
-- hr.manage: Admin/Owners, Production manager (own team only).
-- Nobody sees their own file; nobody sees an Owner's file, other Owners
-- included. A confidential note: only its writer, Admin and Owners.
-- Notes are permanent.
-- ============================================================

select pg_temp.person('admin', 'admin');
select pg_temp.person('owner1', 'owner');
select pg_temp.person('owner2', 'owner');
select pg_temp.person('pm', 'production_manager', 'production');
select pg_temp.person('pu', 'power_user', 'sales');
select pg_temp.person('user', 'user', 'logistics');

create temp table _w as
select k, gen_random_uuid() as id from unnest(array['prod', 'ops', 'pm_own', 'owner_own', 'admin_own']) k;

insert into public.hr_workers (id, name, team, profile_id)
select w.id, 'ZZ worker ' || w.k,
       (case when w.k in ('prod', 'pm_own') then 'production' else 'operations' end)::public.team,
       case w.k when 'pm_own' then pg_temp.id('pm') when 'owner_own' then pg_temp.id('owner1') when 'admin_own' then pg_temp.id('admin') end
  from _w w;
grant select on _w to authenticated;

create function pg_temp.w(k text) returns text language sql as $$
  select format('select 1 from public.hr_workers where id = %L', (select id from _w where _w.k = w.k))
$$;

-- Files
select pg_temp.sees('admin: sees a Production file', 'admin', pg_temp.w('prod'));
select pg_temp.sees('admin: sees an Operations file', 'admin', pg_temp.w('ops'));
select pg_temp.hidden('admin: not their own file', 'admin', pg_temp.w('admin_own'));
select pg_temp.hidden('admin: not an owner''s file', 'admin', pg_temp.w('owner_own'));
select pg_temp.hidden('owner: not another owner''s file', 'owner2', pg_temp.w('owner_own'));
select pg_temp.hidden('owner: not their own file', 'owner1', pg_temp.w('owner_own'));
select pg_temp.sees('production manager: sees a Production file', 'pm', pg_temp.w('prod'));
select pg_temp.hidden('production manager: not an Operations file', 'pm', pg_temp.w('ops'));
select pg_temp.hidden('production manager: not their own file', 'pm', pg_temp.w('pm_own'));
select pg_temp.hidden('power user: no HR files', 'pu', 'select 1 from public.hr_workers where name like ''ZZ worker%''');
select pg_temp.hidden('user: no HR files', 'user', 'select 1 from public.hr_workers where name like ''ZZ worker%''');
select pg_temp.cannot('user: cannot add a file', 'user',
  $$insert into public.hr_workers (name, team) values ('ZZ sneaky', 'operations')$$);

-- Notes on the Production worker: one ordinary, one confidential.
insert into public.hr_notes (id, worker_id, type_id, note_date, body, created_by, topic, asked_by, confidential)
select gen_random_uuid(), (select id from _w where k = 'prod'), (select id from public.hr_note_types order by created_at limit 1),
       current_date, 'ZZ ' || c, pg_temp.id('admin'), 'other', 'employee', c = 'confidential'
  from unnest(array['open', 'confidential']) c;

select pg_temp.sees('production manager: reads an ordinary note', 'pm', $$select 1 from public.hr_notes where body = 'ZZ open'$$);
select pg_temp.hidden('production manager: not a confidential note', 'pm', $$select 1 from public.hr_notes where body = 'ZZ confidential'$$);
select pg_temp.sees('admin (writer): reads the confidential note', 'admin', $$select 1 from public.hr_notes where body = 'ZZ confidential'$$);
select pg_temp.sees('owner: reads the confidential note', 'owner2', $$select 1 from public.hr_notes where body = 'ZZ confidential'$$);
select pg_temp.hidden('user: no notes', 'user', $$select 1 from public.hr_notes where body like 'ZZ %'$$);

-- Permanent
select pg_temp.cannot('admin: cannot change a note', 'admin', $$update public.hr_notes set body = 'zz changed' where body = 'ZZ open'$$);
select pg_temp.cannot('admin: cannot delete a note', 'admin', $$delete from public.hr_notes where body = 'ZZ open'$$);

-- Arrivals and keys follow the file.
insert into public.hr_late_arrivals (worker_id, arrival_date, expected_time, arrived_time)
values ((select id from _w where k = 'ops'), current_date, '07:00', '07:30');
select pg_temp.sees('admin: sees an arrival', 'admin', $$select 1 from public.hr_late_arrivals a join public.hr_workers w on w.id = a.worker_id where w.name = 'ZZ worker ops'$$);
select pg_temp.hidden('production manager: not an Operations arrival', 'pm', $$select 1 from public.hr_late_arrivals a where a.worker_id in (select id from _w where k = 'ops')$$);
select pg_temp.hidden('user: no arrivals', 'user', 'select 1 from public.hr_late_arrivals');
select pg_temp.hidden('user: no keys register', 'user', 'select 1 from public.hr_keys');
