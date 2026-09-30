-- ============================================================
-- One approved absence as everyone may see it: who and when — never the
-- type or the note. For its coverage page, which everyone can open.
-- ============================================================

create or replace function public.absence_brief(p_absence_id uuid)
returns table (
  id uuid, profile_id uuid, person_name text,
  start_date date, end_date date, first_day text, last_day text, status text
)
language sql
stable
security definer
set search_path = ''
as $$
  select a.id, a.profile_id, coalesce(nullif(p.name, ''), p.email), a.start_date, a.end_date, a.first_day, a.last_day, a.status
    from public.absences a
    join public.profiles p on p.id = a.profile_id
   where a.id = p_absence_id
     and public.is_approved()
     -- Everyone sees approved ones; the person and approvers see theirs in any state.
     and (a.status = 'approved' or a.profile_id = (select auth.uid()) or public.is_absence_approver());
$$;

revoke all on function public.absence_brief(uuid) from public, anon;
grant execute on function public.absence_brief(uuid) to authenticated;
