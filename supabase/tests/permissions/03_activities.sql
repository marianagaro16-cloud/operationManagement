-- ============================================================
-- Activities.
-- A User sees only their own days, up to today — not someone else's, not
-- shared (unassigned) ones, not future ones — and only their team's
-- activities. Assigned work is resolved by its person or a planner
-- (through complete_occurrence, as the app does).
-- The Production manager acts only on the areas they run.
-- ============================================================

select pg_temp.person('admin', 'admin');
select pg_temp.person('pu', 'power_user', 'sales');
select pg_temp.person('pm', 'production_manager', 'production');
select pg_temp.person('userA', 'user', 'logistics');
select pg_temp.person('userB', 'user', 'logistics');

-- Production is paused for real; lifted here only (rolled back with the rest).
update public.app_settings set value = '[]'::jsonb where key = 'paused_activity_teams';

create temp table _t (k text primary key, id uuid default gen_random_uuid());
insert into _t (k) values ('logistics'), ('production');
insert into public.tasks (id, title, frequency, team)
select id, 'ZZ task ' || k, 'as_needed', k::public.team from _t;

create function pg_temp.today() returns date language sql as $$ select (now() at time zone 'Europe/Zurich')::date $$;

-- Days of the Logistics activity: A today, B today, A tomorrow, nobody today; one Production day.
insert into public.task_occurrences (task_id, period_key, due_date, assignee_id)
values
  ((select id from _t where k = 'logistics'), 'zz-a-today', pg_temp.today(), pg_temp.id('userA')),
  ((select id from _t where k = 'logistics'), 'zz-b-today', pg_temp.today(), pg_temp.id('userB')),
  ((select id from _t where k = 'logistics'), 'zz-a-tomorrow', pg_temp.today() + 1, pg_temp.id('userA')),
  ((select id from _t where k = 'logistics'), 'zz-shared', pg_temp.today(), null),
  ((select id from _t where k = 'production'), 'zz-prod', pg_temp.today(), null);

-- A refusal is tested with the id itself (resolved here, unrestricted), so the
-- function's own guard answers, not just RLS hiding the row.
create function pg_temp.day(k text) returns text language sql as $$
  select format('select 1 from public.task_occurrences where period_key = %L', k)
$$;

select pg_temp.sees('user: sees their own day today', 'userA', pg_temp.day('zz-a-today'));
select pg_temp.hidden('user: not someone else''s day', 'userA', pg_temp.day('zz-b-today'));
select pg_temp.hidden('user: not their own future day', 'userA', pg_temp.day('zz-a-tomorrow'));
select pg_temp.hidden('user: not a shared (unassigned) day', 'userA', pg_temp.day('zz-shared'));
select pg_temp.hidden('user: not another team''s activity', 'userA', $$select 1 from public.tasks where title = 'ZZ task production'$$);

select pg_temp.can('user: completes their own day', 'userA',
  $$select public.complete_occurrence(id) from public.task_occurrences where period_key = 'zz-a-today'$$);
select pg_temp.cannot('user: cannot complete someone else''s day', 'userA',
  format('select public.complete_occurrence(%L)', (select id from public.task_occurrences where period_key = 'zz-b-today')));

select pg_temp.sees('power user: sees someone''s day', 'pu', pg_temp.day('zz-b-today'));
select pg_temp.sees('power user: sees a future day', 'pu', pg_temp.day('zz-a-tomorrow'));
select pg_temp.sees('admin: sees a shared day', 'admin', pg_temp.day('zz-shared'));

select pg_temp.sees('production manager: sees a Production day', 'pm', pg_temp.day('zz-prod'));
select pg_temp.hidden('production manager: not a Logistics day', 'pm', pg_temp.day('zz-shared'));
select pg_temp.cannot('production manager: cannot complete a Logistics day', 'pm',
  format('select public.complete_occurrence(%L)', (select id from public.task_occurrences where period_key = 'zz-b-today')));
