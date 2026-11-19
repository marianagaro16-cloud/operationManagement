-- ============================================================
-- Mariana enters her own absences without approval (2026-11-19).
--
-- Until now an approver's own absence waited for another approver. The
-- people kept in 'absences.self_register_people' (Mariana) enter theirs and
-- it is approved at once, like one entered for someone else.
-- ============================================================

insert into public.app_settings (key, value)
values (
  'absences.self_register_people',
  '["6249d52a-605a-4caa-a0bf-99cd1b083cf3"]'::jsonb
)
on conflict (key) do nothing;

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
  v_waits boolean;
  v_id uuid;
begin
  if not public.is_absence_approver() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if not exists (select 1 from public.profiles p where p.id = p_profile_id and p.status = 'approved' and p.deleted_at is null) then
    raise exception 'absence_person_inactive' using errcode = '22023';
  end if;
  -- One's own waits for another approver, unless one is kept in the setting.
  v_waits := p_profile_id = v_uid and not coalesce((
    select s.value ? v_uid::text from public.app_settings s where s.key = 'absences.self_register_people'
  ), false);

  perform set_config('app.absence_rpc', 'on', true);
  insert into public.absences (profile_id, type_id, start_date, end_date, first_day, last_day, start_time, end_time, note,
                               status, decided_at, decided_by, created_by)
  values (p_profile_id, p_type_id, p_start_date, p_end_date, coalesce(p_first_day, 'full'), coalesce(p_last_day, 'full'),
          p_start_time, p_end_time, nullif(btrim(coalesce(p_note, '')), ''),
          case when v_waits then 'pending' else 'approved' end,
          case when v_waits then null else now() end,
          case when v_waits then null else v_uid end,
          v_uid)
  returning id into v_id;
  perform set_config('app.absence_rpc', '', true);
  return v_id;
end;
$$;

revoke all on function public.absence_register(uuid, uuid, date, date, text, text, time, time, text) from public, anon;
grant execute on function public.absence_register(uuid, uuid, date, date, text, text, time, time, text) to authenticated;
