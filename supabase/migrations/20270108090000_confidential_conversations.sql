-- ============================================================
-- Confidential by choice, not always (changed 2026-10-08).
--
-- A conversation the employee asked for was read only by whoever wrote it,
-- Admin and the Owners. That is now a tick on the note:
--
--   hr_notes.confidential   only on a conversation the employee asked for.
--                           Without it the note is read with the file, like
--                           any other.
--
-- Whoever opens the file and cannot read a confidential note is told how many
-- there are — never what they say (hr_confidential_hidden()).
-- ============================================================

alter table public.hr_notes
  add column confidential boolean not null default false,
  add constraint hr_notes_confidential_check check (not confidential or asked_by = 'employee');

create or replace function public.hr_can_note(p_note_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.hr_notes n
     where n.id = p_note_id
       and public.hr_can_worker(n.worker_id)
       and (not n.confidential or n.created_by = (select auth.uid()) or public.is_admin())
  );
$$;

drop policy "hr_notes: read" on public.hr_notes;
create policy "hr_notes: read" on public.hr_notes
  for select to authenticated
  using (
    public.hr_can_worker(worker_id)
    and (not confidential or created_by = (select auth.uid()) or (select public.is_admin()))
  );

/* How many confidential notes of a file the caller may open but not read. */
create or replace function public.hr_confidential_hidden(p_worker_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select case when public.hr_can_worker(p_worker_id) and not public.is_admin() then (
    select count(*)::integer from public.hr_notes n
     where n.worker_id = p_worker_id and n.confidential and n.created_by is distinct from (select auth.uid())
  ) else 0 end;
$$;

revoke all on function public.hr_confidential_hidden(uuid) from public, anon;
grant execute on function public.hr_confidential_hidden(uuid) to authenticated;

-- ---------- writing a note ----------

drop function public.hr_note_add(uuid, uuid, date, jsonb, text, text, date, text, jsonb, text, date, time, public.team, jsonb, text);

create function public.hr_note_add(
  p_worker_id           uuid,
  p_type_id             uuid,
  p_note_date           date,
  p_sections            jsonb,
  p_warning_level       text,
  p_follow_up_text      text,
  p_follow_up_on        date,
  p_no_follow_up_reason text,
  p_participants        jsonb,
  p_topic               text,
  p_event_on            date,
  p_event_time          time,
  p_event_area          public.team,
  p_agreements          jsonb,
  -- Who asked to talk; a conversation only. Left out: the company.
  p_asked_by            text default null,
  -- Read only by whoever writes it, Admin and the Owners; only when the employee asked.
  p_confidential        boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid       uuid := (select auth.uid());
  v_structure text;
  v_asked     text;
  v_id        uuid;
begin
  if v_uid is null or not public.hr_can_worker(p_worker_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  select t.structure into v_structure from public.hr_note_types t where t.id = p_type_id and t.is_active;
  if not found then raise exception 'type_required'; end if;
  if p_note_date is null or p_note_date > (now() at time zone 'Europe/Zurich')::date then
    raise exception 'invalid_date';
  end if;

  if v_structure = 'conversation' then
    v_asked := coalesce(p_asked_by, 'company');
    if v_asked not in ('company', 'employee') then raise exception 'invalid_note'; end if;
  elsif p_asked_by is not null then
    raise exception 'invalid_note';
  end if;
  if coalesce(p_confidential, false) and v_asked is distinct from 'employee' then
    raise exception 'invalid_note';
  end if;

  perform public.hr_note_check_content(
    case when v_asked = 'employee' then 'employee_talk' else v_structure end,
    p_sections, p_warning_level, p_follow_up_text, p_follow_up_on, p_no_follow_up_reason, p_note_date,
    p_topic, p_event_on, p_event_time, p_event_area, p_agreements);

  insert into public.hr_notes (
    worker_id, type_id, note_date, sections, warning_level,
    follow_up_text, follow_up_on, no_follow_up_reason,
    topic, event_on, event_time, event_area, asked_by, confidential, created_by
  ) values (
    p_worker_id, p_type_id, p_note_date, jsonb_strip_nulls(p_sections), p_warning_level,
    nullif(btrim(coalesce(p_follow_up_text, '')), ''), p_follow_up_on,
    nullif(btrim(coalesce(p_no_follow_up_reason, '')), ''),
    p_topic, p_event_on, p_event_time, p_event_area, v_asked, coalesce(p_confidential, false), v_uid
  ) returning id into v_id;

  perform public.hr_note_put_agreements(v_id, null, p_agreements);
  perform public.hr_note_put_participants(v_id, null, p_participants, v_uid);
  return v_id;
end;
$$;

revoke all on function public.hr_note_add(uuid, uuid, date, jsonb, text, text, date, text, jsonb, text, date, time, public.team, jsonb, text, boolean) from public, anon;
grant execute on function public.hr_note_add(uuid, uuid, date, jsonb, text, text, date, text, jsonb, text, date, time, public.team, jsonb, text, boolean) to authenticated;

/* Of a confidential note, only whoever wrote it, Admin and the Owners are reminded. */
create or replace function public.hr_note_reminder_audience(p_note_id uuid, p_followup_id uuid default null)
returns uuid[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_worker public.hr_workers;
  v_conf   boolean;
  v_author uuid;
begin
  select n.confidential, n.created_by into v_conf, v_author from public.hr_notes n where n.id = p_note_id;
  select w.* into v_worker
    from public.hr_notes n join public.hr_workers w on w.id = n.worker_id
   where n.id = p_note_id;
  if not found or not public.hr_can_note(p_note_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  return array(
    select distinct p.id
      from public.hr_note_participants x
      join public.profiles p on p.id = x.profile_id
     where x.note_id = p_note_id
       and x.followup_id is not distinct from p_followup_id
       and p.status = 'approved'
       and p.id is distinct from v_worker.profile_id
       and (
         p.role in ('admin', 'owner')
         or (
           (not v_conf or p.id = v_author)
           and exists (select 1 from public.role_permissions rp where rp.role = p.role and rp.permission = 'hr.manage')
           -- A Production manager opens only the files of the areas they run.
           and (
             p.role <> 'production_manager'
             or p.team = v_worker.team
             or exists (select 1 from public.team_managers m where m.profile_id = p.id and m.team = v_worker.team)
           )
         )
       )
  );
end;
$$;
