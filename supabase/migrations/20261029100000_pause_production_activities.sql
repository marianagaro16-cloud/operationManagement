-- ============================================================
-- Production's activities are paused: none of them goes on the calendar.
--
-- Production is not using the app for its activities yet. Its activities
-- stay configured — the production manager may keep setting them up — but
-- no day of them is generated, planned or created until the pause is lifted:
--
--   update public.app_settings
--      set value = '[]'::jsonb
--    where key = 'paused_activity_teams';
--
-- The pause lives here, not in the app, so the nightly generator, the
-- calendar and anything written later are all held by the same rule.
-- ============================================================

insert into public.app_settings (key, value)
values ('paused_activity_teams', '["production"]'::jsonb)
on conflict (key) do update set value = excluded.value;

/* Is this team's work kept off the calendar? */
create or replace function public.activity_team_paused(p_team public.team)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select s.value ? p_team::text from public.app_settings s where s.key = 'paused_activity_teams'),
    false);
$$;

revoke all on function public.activity_team_paused(public.team) from public, anon;
grant execute on function public.activity_team_paused(public.team) to authenticated;

/*
 * No day of a paused team's activity is written, by anyone. A corrective
 * action is its incident's follow-up, not planned work, and is not held.
 */
create or replace function public.refuse_paused_team_occurrence()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.tasks t
              where t.id = new.task_id
                and t.incident_id is null
                and public.activity_team_paused(t.team)) then
    raise exception 'team_paused' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger task_occurrences_refuse_paused_team
  before insert on public.task_occurrences
  for each row execute function public.refuse_paused_team_occurrence();

/*
 * The generator and the planner write in batches; a paused activity in one is
 * skipped rather than failing the rest. Otherwise as before.
 */
create or replace function public.materialise_task_days(p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_system boolean := (select auth.uid()) is null;
  v_count  integer := 0;
  v_n      integer;
  r        record;
begin
  if not v_system and not public.has_permission('tasks.manage_occurrences') then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  for r in
    select * from jsonb_to_recordset(p_rows)
      as x(task_id uuid, due_date date, period_key text, source public.schedule_source)
  loop
    if not v_system and not public.task_in_team_scope(r.task_id) then
      continue;
    end if;
    if exists (select 1 from public.tasks t
                where t.id = r.task_id
                  and t.incident_id is null
                  and public.activity_team_paused(t.team)) then
      continue;
    end if;
    if exists (select 1 from public.task_occurrences o
                where o.task_id = r.task_id and o.due_date = r.due_date) then
      continue;
    end if;

    insert into public.task_occurrences (task_id, period_key, due_date, source, assignee_id)
    select r.task_id, r.period_key, r.due_date, coalesce(r.source, 'manual'), p.u
      from unnest(coalesce(public.task_people(r.task_id), array[null::uuid])) p(u)
    on conflict do nothing;

    get diagnostics v_n = row_count;
    v_count := v_count + v_n;
  end loop;

  return v_count;
end;
$$;

-- What was already generated comes off. Nothing of it was resolved; were
-- anything, it would stay as the record.
delete from public.task_occurrences o
 using public.tasks t
 where t.id = o.task_id
   and t.team = 'production'
   and t.incident_id is null
   and o.status = 'pending';
