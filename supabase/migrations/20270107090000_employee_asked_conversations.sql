-- ============================================================
-- A conversation the worker asked for (decided 2026-10-08).
--
-- "Conversación / Feedback" was made for when the company calls the worker in:
-- its topics are punctuality, quality, attitude…, and it cannot be saved
-- without an agreement. When the worker is the one who asks to talk, none of
-- that fits. A conversation now says who asked for it:
--
--   hr_notes.asked_by   'company' or 'employee'; NULL for every other type
--                       and for conversations written before this.
--
-- Asked by the employee, it has its own content — what they raised and what
-- was answered — its own topics (pay, hours, workload, a conflict, something
-- personal…), agreements only if there are any, and always a next step with
-- its date, or the reason there is none.
--
-- Such a note is RESTRICTED: read only by whoever wrote it, Admin and the
-- Owners — not by everyone who may open the file. The same goes for its
-- attachments, agreements, follow-ups and reminders.
--
-- Still permanent. Mirrored in src/domain/hr/note-structure.ts.
-- ============================================================

alter table public.hr_notes
  add column asked_by text check (asked_by in ('company', 'employee'));

-- ---------- its own topics ----------

create or replace function public.hr_note_employee_topics()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['pay_conditions', 'schedule_leave', 'workload', 'conflict', 'growth', 'complaint', 'idea', 'personal', 'other'];
$$;

alter table public.hr_notes drop constraint hr_notes_topic_check;
alter table public.hr_notes add constraint hr_notes_topic_check
  check (topic = any (public.hr_note_topics()) or topic = any (public.hr_note_employee_topics()));

-- ---------- what it must say ----------
-- 'employee_talk' is not a type's structure: it is the form a conversation
-- takes when the employee asked for it.

create or replace function public.hr_note_required_sections(p_structure text)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select case p_structure
    when 'conversation'  then array['reason', 'points']
    when 'employee_talk' then array['raised', 'answered']
    when 'recognition'   then array['what', 'impact', 'why', 'how']
    when 'warning'       then array['what', 'rule', 'response', 'consequence']
    when 'training'      then array['topic', 'reason', 'trainer', 'duration', 'result']
    else                      array['reason', 'detail']
  end;
$$;

create or replace function public.hr_note_agreements_rule(p_structure text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_structure
    when 'conversation'  then 'required'
    when 'warning'       then 'required'
    when 'employee_talk' then 'optional'
    when 'general'       then 'optional'
    else                      'none'
  end;
$$;

/* Raises unless the content is complete for its structure. */
create or replace function public.hr_note_check_content(
  p_structure           text,
  p_sections            jsonb,
  p_warning_level       text,
  p_follow_up_text      text,
  p_follow_up_on        date,
  p_no_follow_up_reason text,
  p_from                date,
  p_topic               text,
  p_event_on            date,
  p_event_time          time,
  p_event_area          public.team,
  p_agreements          jsonb
)
returns void
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_key   text;
  v_rule  text := public.hr_note_follow_up_rule(p_structure);
  v_agr   text := public.hr_note_agreements_rule(p_structure);
  v_text  boolean := btrim(coalesce(p_follow_up_text, '')) <> '';
  v_none  boolean := btrim(coalesce(p_no_follow_up_reason, '')) <> '';
  v_a     jsonb;
  v_count integer;
begin
  if p_sections is null or jsonb_typeof(p_sections) <> 'object' then
    raise exception 'sections_required';
  end if;
  foreach v_key in array public.hr_note_required_sections(p_structure) loop
    if btrim(coalesce(p_sections ->> v_key, '')) = '' then
      raise exception 'section_required';
    end if;
  end loop;

  -- What the employee comes to talk about is not what the company calls them in for.
  if p_topic is null
     or not (p_topic = any (case when p_structure = 'employee_talk'
                                 then public.hr_note_employee_topics() else public.hr_note_topics() end)) then
    raise exception 'topic_required';
  end if;

  -- A conversation and a warning are about one moment: when and where.
  if p_structure in ('conversation', 'employee_talk', 'warning') then
    if p_event_on is null or p_event_time is null or p_event_area is null then
      raise exception 'event_required';
    end if;
    if p_event_on > p_from then raise exception 'event_date_invalid'; end if;
  elsif p_event_on is not null or p_event_time is not null or p_event_area is not null then
    raise exception 'invalid_note';
  end if;

  if p_structure = 'warning' and p_warning_level is null then
    raise exception 'level_required';
  end if;
  if p_structure <> 'warning' and p_warning_level is not null then
    raise exception 'invalid_note';
  end if;

  if p_agreements is not null and jsonb_typeof(p_agreements) <> 'array' then
    raise exception 'invalid_note';
  end if;
  v_count := jsonb_array_length(coalesce(p_agreements, '[]'::jsonb));
  if v_agr = 'none' and v_count > 0 then raise exception 'invalid_note'; end if;
  if v_agr = 'required' and v_count = 0 then raise exception 'agreement_required'; end if;
  -- Each one: what, who and by when.
  for v_a in select e from jsonb_array_elements(coalesce(p_agreements, '[]'::jsonb)) e loop
    if btrim(coalesce(v_a ->> 'body', '')) = ''
       or (v_a ->> 'due_on') is null
       or jsonb_typeof(v_a -> 'responsible') is distinct from 'object' then
      raise exception 'agreement_incomplete';
    end if;
    if (v_a ->> 'due_on')::date < p_from then raise exception 'agreement_incomplete'; end if;
  end loop;

  if v_rule = 'none' then
    if v_text or p_follow_up_on is not null or v_none then raise exception 'invalid_note'; end if;
    return;
  end if;
  -- What and when go together, and exclude "nothing to follow up".
  if v_text <> (p_follow_up_on is not null) or (v_text and v_none) then
    raise exception 'follow_up_required';
  end if;
  if v_rule = 'required' and not v_text and not v_none then
    raise exception 'follow_up_required';
  end if;
  -- Agreements are checked at the follow-up, so there has to be one.
  if v_count > 0 and not v_text then
    raise exception 'follow_up_required';
  end if;
  if p_follow_up_on is not null and p_follow_up_on < p_from then
    raise exception 'follow_up_date_invalid';
  end if;
end;
$$;

-- ---------- writing a note ----------

drop function public.hr_note_add(uuid, uuid, date, jsonb, text, text, date, text, jsonb, text, date, time, public.team, jsonb);

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
  p_asked_by            text default null
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

  perform public.hr_note_check_content(
    case when v_asked = 'employee' then 'employee_talk' else v_structure end,
    p_sections, p_warning_level, p_follow_up_text, p_follow_up_on, p_no_follow_up_reason, p_note_date,
    p_topic, p_event_on, p_event_time, p_event_area, p_agreements);

  insert into public.hr_notes (
    worker_id, type_id, note_date, sections, warning_level,
    follow_up_text, follow_up_on, no_follow_up_reason,
    topic, event_on, event_time, event_area, asked_by, created_by
  ) values (
    p_worker_id, p_type_id, p_note_date, jsonb_strip_nulls(p_sections), p_warning_level,
    nullif(btrim(coalesce(p_follow_up_text, '')), ''), p_follow_up_on,
    nullif(btrim(coalesce(p_no_follow_up_reason, '')), ''),
    p_topic, p_event_on, p_event_time, p_event_area, v_asked, v_uid
  ) returning id into v_id;

  perform public.hr_note_put_agreements(v_id, null, p_agreements);
  perform public.hr_note_put_participants(v_id, null, p_participants, v_uid);
  return v_id;
end;
$$;

revoke all on function public.hr_note_employee_topics() from public, anon;
revoke all on function public.hr_note_add(uuid, uuid, date, jsonb, text, text, date, text, jsonb, text, date, time, public.team, jsonb, text) from public, anon;
grant execute on function public.hr_note_employee_topics() to authenticated;
grant execute on function public.hr_note_add(uuid, uuid, date, jsonb, text, text, date, text, jsonb, text, date, time, public.team, jsonb, text) to authenticated;

-- ---------- who reads it ----------

/*
 * A note is read with the file — except a conversation the employee asked
 * for, which only whoever wrote it, Admin and the Owners read. Everything
 * hanging from a note (attachments, participants, agreements, follow-ups,
 * the stored files) is read through this.
 */
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
       and (n.asked_by is distinct from 'employee' or n.created_by = (select auth.uid()) or public.is_admin())
  );
$$;

drop policy "hr_notes: read" on public.hr_notes;
create policy "hr_notes: read" on public.hr_notes
  for select to authenticated
  using (
    public.hr_can_worker(worker_id)
    and (asked_by is distinct from 'employee' or created_by = (select auth.uid()) or (select public.is_admin()))
  );

drop policy "hr_note_attachments: read" on public.hr_note_attachments;
create policy "hr_note_attachments: read" on public.hr_note_attachments
  for select to authenticated using (public.hr_can_note(note_id));

/*
 * The participants of a note (or of one later entry) who have an account and
 * may read the note themselves — never the worker the note is about. The
 * reminder names the worker, so nobody else may receive it. Of a conversation
 * the employee asked for, that is whoever wrote it, Admin and the Owners.
 */
create or replace function public.hr_note_reminder_audience(p_note_id uuid, p_followup_id uuid default null)
returns uuid[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_worker  public.hr_workers;
  v_asked   text;
  v_author  uuid;
begin
  select n.asked_by, n.created_by into v_asked, v_author from public.hr_notes n where n.id = p_note_id;
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
           (v_asked is distinct from 'employee' or p.id = v_author)
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
