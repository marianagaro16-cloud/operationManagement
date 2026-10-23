-- ============================================================
-- The Palomo's rounds and costs (2026-10-23): Logística taps out and back
-- and enters fuel and parking; the driver sees and corrects only their own,
-- and only the same day; the office (Owners, Admin, Power User) sees and
-- corrects everything; nobody else sees any of it.
-- ============================================================

select pg_temp.person('driver', 'user', 'logistics');
select pg_temp.person('driver2', 'user', 'logistics');
select pg_temp.person('floor', 'user', 'operations');
select pg_temp.person('pm', 'production_manager', 'production');
select pg_temp.person('power', 'power_user', 'operations');
select pg_temp.person('boss', 'admin', 'operations');

create temp table _v as select id from public.equipment where is_vehicle and lower(name) = 'palomo';
grant select on _v to authenticated;

-- Out with no round open on the test's van: close any real one for the test.
update public.vehicle_trips set returned_at = left_at + interval '1 minute', returned_km = left_km where returned_at is null;

-- ---------- rounds ----------

select pg_temp.can('Logística starts a round', 'driver',
  $q$insert into public.vehicle_trips (vehicle_id, driver_id, left_at, left_km, note)
     values ((select id from _v), (select id from _p where key = 'driver'), now(), 120000, 'ZZ trip')$q$);
select pg_temp.cannot('a second round out at once is refused', 'driver2',
  $q$insert into public.vehicle_trips (vehicle_id, driver_id, left_at, left_km, note)
     values ((select id from _v), (select id from _p where key = 'driver2'), now(), 120000, 'ZZ trip 2')$q$);
select pg_temp.cannot('someone outside Logística cannot start one', 'floor',
  $q$insert into public.vehicle_trips (vehicle_id, driver_id, left_at, left_km, note)
     values ((select id from _v), (select id from _p where key = 'floor'), now(), 1, 'ZZ floor')$q$);
select pg_temp.cannot('nor start one in someone else''s name', 'driver2',
  $q$insert into public.vehicle_trips (vehicle_id, driver_id, left_at, left_km, note)
     values ((select id from _v), (select id from _p where key = 'driver'), now(), 1, 'ZZ other')$q$);

select pg_temp.can('the driver comes back', 'driver',
  $q$update public.vehicle_trips set returned_at = now() + interval '2 hours', returned_km = 120042 where note = 'ZZ trip'$q$);
select pg_temp.cannot('km cannot go backwards', 'driver',
  $q$update public.vehicle_trips set returned_km = 100 where note = 'ZZ trip'$q$);

select pg_temp.sees('the driver sees their round', 'driver', $q$select 1 from public.vehicle_trips where note = 'ZZ trip'$q$);
select pg_temp.hidden('another driver does not', 'driver2', $q$select 1 from public.vehicle_trips where note = 'ZZ trip'$q$);
select pg_temp.hidden('the floor does not', 'floor', $q$select 1 from public.vehicle_trips where note = 'ZZ trip'$q$);
select pg_temp.hidden('the Production manager does not', 'pm', $q$select 1 from public.vehicle_trips where note = 'ZZ trip'$q$);
select pg_temp.sees('the Power User does', 'power', $q$select 1 from public.vehicle_trips where note = 'ZZ trip'$q$);
select pg_temp.sees('Admin does', 'boss', $q$select 1 from public.vehicle_trips where note = 'ZZ trip'$q$);

select pg_temp.can('the driver corrects the same day', 'driver',
  $q$update public.vehicle_trips set left_km = 120001 where note = 'ZZ trip'$q$);
select pg_temp.sees('the correction is kept', 'boss', $q$select 1 from public.vehicle_trip_changes c join public.vehicle_trips t on t.id = c.trip_id where t.note = 'ZZ trip'$q$);
select pg_temp.hidden('the driver does not read the corrections', 'driver', $q$select 1 from public.vehicle_trip_changes c join public.vehicle_trips t on t.id = c.trip_id where t.note = 'ZZ trip'$q$);

-- Yesterday's round: only the office corrects it.
update public.vehicle_trips set trip_date = current_date - 3 where note = 'ZZ trip';
select pg_temp.cannot('the driver cannot correct another day', 'driver',
  $q$update public.vehicle_trips set left_km = 120002 where note = 'ZZ trip'$q$);
select pg_temp.can('the office corrects any day', 'power',
  $q$update public.vehicle_trips set left_km = 120003 where note = 'ZZ trip'$q$);
select pg_temp.cannot('the driver cannot delete a round', 'driver',
  $q$delete from public.vehicle_trips where note = 'ZZ trip'$q$);

-- ---------- costs ----------

select pg_temp.can('the driver enters fuel', 'driver',
  $q$insert into public.vehicle_costs (vehicle_id, kind, amount, litres, odometer_km, note, created_by)
     values ((select id from _v), 'fuel', 85.40, 45.2, 120040, 'ZZ fuel', (select id from _p where key = 'driver'))$q$);
select pg_temp.can('and parking', 'driver',
  $q$insert into public.vehicle_costs (vehicle_id, kind, amount, note, created_by)
     values ((select id from _v), 'parking', 4, 'ZZ parking', (select id from _p where key = 'driver'))$q$);
select pg_temp.cannot('but not insurance', 'driver',
  $q$insert into public.vehicle_costs (vehicle_id, kind, amount, note, created_by)
     values ((select id from _v), 'insurance', 900, 'ZZ insurance d', (select id from _p where key = 'driver'))$q$);
select pg_temp.cannot('litres only on fuel', 'driver',
  $q$insert into public.vehicle_costs (vehicle_id, kind, amount, litres, note, created_by)
     values ((select id from _v), 'parking', 4, 3, 'ZZ bad', (select id from _p where key = 'driver'))$q$);
select pg_temp.cannot('the floor enters no costs', 'floor',
  $q$insert into public.vehicle_costs (vehicle_id, kind, amount, note, created_by)
     values ((select id from _v), 'fuel', 10, 'ZZ floor fuel', (select id from _p where key = 'floor'))$q$);
select pg_temp.can('the office enters insurance', 'boss',
  $q$insert into public.vehicle_costs (vehicle_id, kind, amount, note, created_by)
     values ((select id from _v), 'insurance', 1200, 'ZZ insurance', (select id from _p where key = 'boss'))$q$);

select pg_temp.hidden('the driver does not see the office''s costs', 'driver', $q$select 1 from public.vehicle_costs where note = 'ZZ insurance'$q$);
select pg_temp.hidden('another driver does not see this one''s fuel', 'driver2', $q$select 1 from public.vehicle_costs where note = 'ZZ fuel'$q$);
select pg_temp.hidden('the Production manager sees no costs', 'pm', $q$select 1 from public.vehicle_costs where note = 'ZZ fuel'$q$);
select pg_temp.sees('the Power User sees the driver''s fuel', 'power', $q$select 1 from public.vehicle_costs where note = 'ZZ fuel'$q$);

select pg_temp.cannot('the driver cannot turn fuel into insurance', 'driver',
  $q$update public.vehicle_costs set kind = 'insurance', litres = null where note = 'ZZ fuel'$q$);
update public.vehicle_costs set spent_on = current_date - 3 where note = 'ZZ fuel';
select pg_temp.cannot('the driver cannot change another day''s cost', 'driver',
  $q$update public.vehicle_costs set amount = 1 where note = 'ZZ fuel'$q$);
select pg_temp.cannot('nor delete it', 'driver', $q$delete from public.vehicle_costs where note = 'ZZ fuel'$q$);
select pg_temp.can('the office can', 'power', $q$update public.vehicle_costs set amount = 86 where note = 'ZZ fuel'$q$);
