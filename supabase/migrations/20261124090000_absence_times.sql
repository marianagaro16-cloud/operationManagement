-- ============================================================
-- Absences by the hour: the first day may start at a time, the last may end
-- at a time — a doctor from 10:00 to 12:00 is away those two hours, not the
-- whole morning. Morning-only and afternoon-only stay as they were
-- (first_day / last_day); a time takes their place on that day.
-- ============================================================

alter table public.absences
  add column start_time time,
  add column end_time   time,
  add constraint absences_start_time_or_half check (start_time is null or first_day = 'full'),
  add constraint absences_end_time_or_half check (end_time is null or last_day = 'full'),
  add constraint absences_times check (
    start_date <> end_date or start_time is null or end_time is null or end_time > start_time
  );

-- The history notices a change of hours too.
create or replace function public.log_absence()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_action text;
begin
  if tg_op = 'INSERT' then
    v_action := 'requested';
  elsif new.status is distinct from old.status then
    v_action := new.status; -- approved | rejected | cancelled
  elsif (new.start_date, new.end_date, new.first_day, new.last_day, new.start_time, new.end_time, new.type_id, coalesce(new.note, ''))
        is distinct from (old.start_date, old.end_date, old.first_day, old.last_day, old.start_time, old.end_time, old.type_id, coalesce(old.note, '')) then
    v_action := 'changed';
  else
    return new;
  end if;
  insert into public.absence_events (absence_id, actor_id, action, detail)
  values (new.id, (select auth.uid()), v_action, jsonb_build_object(
    'start_date', new.start_date, 'end_date', new.end_date, 'first_day', new.first_day, 'last_day', new.last_day,
    'start_time', new.start_time, 'end_time', new.end_time,
    'type_id', new.type_id, 'reason', coalesce(new.rejection_reason, '')));
  return new;
end;
$$;

-- Who is away and when, now with the hours: dropped and made again, since what they return grows.
drop function public.absence_calendar(date, date);
create function public.absence_calendar(p_from date, p_to date)
returns table (
  id uuid, profile_id uuid, person_name text,
  start_date date, end_date date, first_day text, last_day text, start_time time, end_time time
)
language sql
stable
security definer
set search_path = ''
as $$
  select a.id, a.profile_id, coalesce(nullif(p.name, ''), p.email), a.start_date, a.end_date, a.first_day, a.last_day,
         a.start_time, a.end_time
    from public.absences a
    join public.profiles p on p.id = a.profile_id
   where public.is_approved()
     and a.status = 'approved'
     and a.start_date <= p_to and a.end_date >= p_from
   order by a.start_date, 3;
$$;

revoke all on function public.absence_calendar(date, date) from public, anon;
grant execute on function public.absence_calendar(date, date) to authenticated;

drop function public.absence_brief(uuid);
create function public.absence_brief(p_absence_id uuid)
returns table (
  id uuid, profile_id uuid, person_name text,
  start_date date, end_date date, first_day text, last_day text, start_time time, end_time time, status text
)
language sql
stable
security definer
set search_path = ''
as $$
  select a.id, a.profile_id, coalesce(nullif(p.name, ''), p.email), a.start_date, a.end_date, a.first_day, a.last_day,
         a.start_time, a.end_time, a.status
    from public.absences a
    join public.profiles p on p.id = a.profile_id
   where a.id = p_absence_id
     and public.is_approved()
     -- Everyone sees approved ones; the person and approvers see theirs in any state.
     and (a.status = 'approved' or a.profile_id = (select auth.uid()) or public.is_absence_approver());
$$;

revoke all on function public.absence_brief(uuid) from public, anon;
grant execute on function public.absence_brief(uuid) to authenticated;
