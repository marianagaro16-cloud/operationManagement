-- ============================================================
-- Own absences (2026-11-19): an approver kept in
-- 'absences.self_register_people' (Mariana) enters hers approved at once;
-- any other approver's own still waits for another approver.
-- ============================================================

select pg_temp.person('self_reg', 'power_user', 'operations');
select pg_temp.person('approver', 'power_user', 'operations');
insert into public.absence_approvers (profile_id) select id from _p where key in ('self_reg', 'approver');
update public.app_settings set value = value || to_jsonb(pg_temp.id('self_reg')::text)
 where key = 'absences.self_register_people';

-- The logs stay off, or they would use up their numbers (rolled back).
alter table public.absences disable trigger absences_log;

select pg_temp.act_as('self_reg');
select public.absence_register(pg_temp.id('self_reg'), (select id from public.absence_types order by created_at limit 1),
  current_date + 40, current_date + 41, 'full', 'full', null, null, 'ZZ self');
select pg_temp.act_as('approver');
select public.absence_register(pg_temp.id('approver'), (select id from public.absence_types order by created_at limit 1),
  current_date + 40, current_date + 41, 'full', 'full', null, null, 'ZZ other');
select pg_temp.as_system();

alter table public.absences enable trigger absences_log;

select pg_temp.check('absences: Mariana''s own is approved as entered',
  (select status = 'approved' and decided_by = pg_temp.id('self_reg') from public.absences where note = 'ZZ self'));
select pg_temp.check('absences: another approver''s own still waits',
  (select status = 'pending' from public.absences where note = 'ZZ other'));
