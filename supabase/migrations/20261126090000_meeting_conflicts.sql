-- ============================================================
-- What a meeting's time collides with, for whoever organises it: for each
-- person, their sales activities (planned, or joined as a participant),
-- their other meetings, and their approved absences that day.
--
-- Only what an organiser needs to find a better time: the kind of activity
-- and its hours — never which customer — a meeting's title, and that an
-- absence exists (with its hours, not its type). The app decides from the
-- absence's hours whether it really overlaps.
-- ============================================================

create or replace function public.meeting_conflicts(
  p_people uuid[],
  p_date date,
  p_start time,
  p_end time,
  p_exclude uuid default null
)
returns table (
  profile_id uuid, kind text, label text, start_time time, end_time time,
  start_date date, end_date date, first_day text, last_day text
)
language sql
stable
security definer
set search_path = ''
as $$
  select * from (
    -- Sales activities with hours, their own or joined.
    select distinct x.person, 'activity'::text, k.name, a.activity_time, a.activity_end,
           null::date, null::date, null::text, null::text
      from public.sales_activities a
      join public.sales_activity_kinds k on k.id = a.kind_id
      cross join lateral (
        select a.salesperson_id as person
        union
        select sp.profile_id from public.sales_activity_participants sp where sp.activity_id = a.id
      ) x
     where a.activity_date = p_date
       and a.status = 'planned'
       and a.activity_time is not null and a.activity_end is not null
       and a.activity_time < p_end and a.activity_end > p_start
       and x.person = any (p_people)
    union all
    -- Other meetings, organised or invited to (unless they said no).
    select distinct x.person, 'meeting'::text, m.title, m.start_time, m.end_time,
           null::date, null::date, null::text, null::text
      from public.meetings m
      cross join lateral (
        select m.organizer_id as person
        union
        select i.profile_id from public.meeting_invitees i where i.meeting_id = m.id and i.response <> 'no'
      ) x
     where m.meeting_date = p_date
       and m.status = 'scheduled'
       and (p_exclude is null or m.id <> p_exclude)
       and m.start_time < p_end and m.end_time > p_start
       and x.person = any (p_people)
    union all
    -- Approved absences that day: the app checks their hours.
    select a.profile_id, 'absence'::text, null::text, a.start_time, a.end_time,
           a.start_date, a.end_date, a.first_day, a.last_day
      from public.absences a
     where a.status = 'approved'
       and a.start_date <= p_date and a.end_date >= p_date
       and a.profile_id = any (p_people)
  ) r
  where public.can_organize_meetings();
$$;

revoke all on function public.meeting_conflicts(uuid[], date, time, time, uuid) from public, anon;
grant execute on function public.meeting_conflicts(uuid[], date, time, time, uuid) to authenticated;
