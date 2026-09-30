-- ============================================================
-- Absences are entered by the approvers, not requested.
--
-- Holidays are managed in another program; here an absence exists so its
-- coverage can be planned. An approver enters it for someone and it is
-- approved at once — except their own, which waits for another approver
-- (nobody approves their own). People no longer request absences in the
-- app; they see their own and who is away.
--
-- Approvers may also correct an absence entered for someone else (dates,
-- hours, type, note); the status still changes only through the functions.
-- ============================================================

drop policy "absences: request own" on public.absences;

create policy "absences: approvers correct others" on public.absences for update to authenticated
  using ((select public.is_absence_approver()) and profile_id <> (select auth.uid()))
  with check ((select public.is_absence_approver()) and profile_id <> (select auth.uid()));

create or replace function public.absence_register(
  p_profile_id uuid,
  p_type_id uuid,
  p_start_date date,
  p_end_date date,
  p_first_day text,
  p_last_day text,
  p_start_time time,
  p_end_time time,
  p_note text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_own boolean;
  v_id uuid;
begin
  if not public.is_absence_approver() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if not exists (select 1 from public.profiles p where p.id = p_profile_id and p.status = 'approved' and p.deleted_at is null) then
    raise exception 'absence_person_inactive' using errcode = '22023';
  end if;
  v_own := p_profile_id = v_uid;

  perform set_config('app.absence_rpc', 'on', true);
  insert into public.absences (profile_id, type_id, start_date, end_date, first_day, last_day, start_time, end_time, note,
                               status, decided_at, decided_by, created_by)
  values (p_profile_id, p_type_id, p_start_date, p_end_date, coalesce(p_first_day, 'full'), coalesce(p_last_day, 'full'),
          p_start_time, p_end_time, nullif(btrim(coalesce(p_note, '')), ''),
          -- Someone else's: approved as entered. One's own: it waits for another approver.
          case when v_own then 'pending' else 'approved' end,
          case when v_own then null else now() end,
          case when v_own then null else v_uid end,
          v_uid)
  returning id into v_id;
  perform set_config('app.absence_rpc', '', true);
  return v_id;
end;
$$;

revoke all on function public.absence_register(uuid, uuid, date, date, text, text, time, time, text) from public, anon;
grant execute on function public.absence_register(uuid, uuid, date, date, text, text, time, time, text) to authenticated;
