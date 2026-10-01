-- A paused team's RECURRING activities stay off the calendar; an activity
-- that happens once may be planned for it all the same (decided 2026-10-01).

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
                and t.frequency <> 'one_off'
                and public.activity_team_paused(t.team)) then
    raise exception 'team_paused' using errcode = '42501';
  end if;
  return new;
end;
$$;
