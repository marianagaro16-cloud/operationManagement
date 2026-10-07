-- ============================================================
-- Log notes, more precise (decided 2026-10-07).
--
-- The sections made a note complete, but not yet exact: nothing said what it
-- was about, when and where it happened, or who had agreed to do what by when
-- — and a follow-up could not say whether an agreement was kept.
--
--   topic        one main topic per note, from a fixed list. Compulsory.
--   event_*      the moment it happened — day, time and area — for a
--                conversation and a warning. Compulsory there.
--   hr_note_agreements
--                what was agreed, one row each: what, who is responsible and
--                by when. Replaces the "agreements" text section.
--   hr_note_agreement_results
--                at a follow-up every agreement not yet met is marked met,
--                partly met or not met — with a comment unless it was met.
--
-- A note with agreements always has a follow-up: that is where they are
-- checked. Notes written before this stay exactly as they are.
-- Still permanent: nothing here is ever updated or deleted.
-- Mirrored in src/domain/hr/note-structure.ts.
-- ============================================================

-- ---------- the fixed lists ----------

create or replace function public.hr_note_topics()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['punctuality', 'quality', 'hygiene_safety', 'attitude', 'productivity', 'teamwork', 'rules', 'other'];
$$;

/* The sections a structure cannot be saved without. Agreements are rows now. */
create or replace function public.hr_note_required_sections(p_structure text)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select case p_structure
    when 'conversation' then array['reason', 'points']
    when 'recognition'  then array['what', 'impact', 'why', 'how']
    when 'warning'      then array['what', 'rule', 'response', 'consequence']
    when 'training'     then array['topic', 'reason', 'trainer', 'duration', 'result']
    else                     array['reason', 'detail']
  end;
$$;

/* required: at least one agreement. optional. none: the type has none. */
create or replace function public.hr_note_agreements_rule(p_structure text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_structure
    when 'conversation' then 'required'
    when 'warning'      then 'required'
    when 'general'      then 'optional'
    else                     'none'
  end;
$$;

-- ---------- topic and the moment it happened ----------

alter table public.hr_notes
  add column topic      text check (topic = any (public.hr_note_topics())),
  add column event_on   date,
  add column event_time time,
  add column event_area public.team;

-- A note from before the sections gets them through its completion entry.
alter table public.hr_note_followups
  add column topic      text check (topic = any (public.hr_note_topics())),
  add column event_on   date,
  add column event_time time,
  add column event_area public.team;

-- ---------- agreements ----------

create table public.hr_note_agreements (
  id                     uuid primary key default gen_random_uuid(),
  note_id                uuid not null references public.hr_notes (id) on delete cascade,
  -- Set when they came with the completion of an old note.
  followup_id            uuid references public.hr_note_followups (id) on delete cascade,
  sort_order             integer not null,
  body                   text not null check (length(btrim(body)) > 0),
  responsible_profile_id uuid references public.profiles (id) on delete set null,
  responsible_worker_id  uuid references public.hr_workers (id) on delete set null,
  -- As they were called then.
  responsible_name       text not null check (length(btrim(responsible_name)) > 0),
  due_on                 date not null
);

create index hr_note_agreements_note_idx on public.hr_note_agreements (note_id, sort_order);

create table public.hr_note_agreement_results (
  id           uuid primary key default gen_random_uuid(),
  agreement_id uuid not null references public.hr_note_agreements (id) on delete cascade,
  -- The follow-up entry that checked it.
  followup_id  uuid not null references public.hr_note_followups (id) on delete cascade,
  result       text not null check (result in ('met', 'partly', 'not_met')),
  comment      text,
  unique (agreement_id, followup_id),
  -- What is missing has to be said.
  check (result = 'met' or length(btrim(coalesce(comment, ''))) > 0)
);

create index hr_note_agreement_results_followup_idx on public.hr_note_agreement_results (followup_id);

alter table public.hr_note_agreements        enable row level security;
alter table public.hr_note_agreement_results enable row level security;

-- Read with the file. No write policy: the functions below are the only way in.
create policy "hr_note_agreements: read" on public.hr_note_agreements
  for select to authenticated using (public.hr_can_note(note_id));
create policy "hr_note_agreement_results: read" on public.hr_note_agreement_results
  for select to authenticated using (
    exists (select 1 from public.hr_note_agreements a where a.id = agreement_id and public.hr_can_note(a.note_id))
  );

-- ---------- the content check ----------

drop function public.hr_note_check_content(text, jsonb, text, text, date, text, date);

/* Raises unless the content is complete for its structure. */
create function public.hr_note_check_content(
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

  if p_topic is null or not (p_topic = any (public.hr_note_topics())) then
    raise exception 'topic_required';
  end if;

  -- A conversation and a warning are about one moment: when and where.
  if p_structure in ('conversation', 'warning') then
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

-- ---------- storing the agreements ----------

/*
 * Who a picked person is: an account and its file are the same person, and
 * anyone else is the name typed in. Same reading as hr_note_put_participants.
 */
create or replace function public.hr_note_person(
  p_person      jsonb,
  out o_profile uuid,
  out o_worker  uuid,
  out o_name    text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  o_profile := nullif(p_person ->> 'profile_id', '')::uuid;
  o_worker  := nullif(p_person ->> 'worker_id', '')::uuid;

  if o_worker is not null then
    select w.name, coalesce(o_profile, w.profile_id) into o_name, o_profile
      from public.hr_workers w where w.id = o_worker;
    if not found then raise exception 'participant_not_found'; end if;
  elsif o_profile is not null then
    select w.id, w.name into o_worker, o_name
      from public.hr_workers w where w.profile_id = o_profile;
  end if;
  if o_profile is not null and o_name is null then
    select coalesce(nullif(btrim(p.name), ''), p.email) into o_name
      from public.profiles p where p.id = o_profile;
    if not found then raise exception 'participant_not_found'; end if;
  end if;
  if o_name is null then
    o_name := nullif(btrim(coalesce(p_person ->> 'name', '')), '');
  end if;
  if o_name is null then raise exception 'participant_not_found'; end if;
  o_name := left(o_name, 200);
end;
$$;

create or replace function public.hr_note_put_agreements(
  p_note_id     uuid,
  p_followup_id uuid,
  p_agreements  jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_a      jsonb;
  v_n      bigint;
  v_person record;
begin
  for v_a, v_n in
    select e, i from jsonb_array_elements(coalesce(p_agreements, '[]'::jsonb)) with ordinality as x (e, i)
  loop
    select * into v_person from public.hr_note_person(v_a -> 'responsible');
    insert into public.hr_note_agreements (
      note_id, followup_id, sort_order, body,
      responsible_profile_id, responsible_worker_id, responsible_name, due_on
    ) values (
      p_note_id, p_followup_id, v_n, btrim(v_a ->> 'body'),
      v_person.o_profile, v_person.o_worker, v_person.o_name, (v_a ->> 'due_on')::date
    );
  end loop;
end;
$$;

-- ---------- writing a note ----------

drop function public.hr_note_add(uuid, uuid, date, jsonb, text, text, date, text, jsonb);

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
  p_agreements          jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid       uuid := (select auth.uid());
  v_structure text;
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

  perform public.hr_note_check_content(
    v_structure, p_sections, p_warning_level, p_follow_up_text, p_follow_up_on, p_no_follow_up_reason, p_note_date,
    p_topic, p_event_on, p_event_time, p_event_area, p_agreements);

  insert into public.hr_notes (
    worker_id, type_id, note_date, sections, warning_level,
    follow_up_text, follow_up_on, no_follow_up_reason,
    topic, event_on, event_time, event_area, created_by
  ) values (
    p_worker_id, p_type_id, p_note_date, jsonb_strip_nulls(p_sections), p_warning_level,
    nullif(btrim(coalesce(p_follow_up_text, '')), ''), p_follow_up_on,
    nullif(btrim(coalesce(p_no_follow_up_reason, '')), ''),
    p_topic, p_event_on, p_event_time, p_event_area, v_uid
  ) returning id into v_id;

  perform public.hr_note_put_agreements(v_id, null, p_agreements);
  perform public.hr_note_put_participants(v_id, null, p_participants, v_uid);
  return v_id;
end;
$$;

-- ---------- adding to a note later ----------

drop function public.hr_note_followup_add(uuid, text, date, text, jsonb, text, boolean, text, date, text, jsonb);

/*
 * By the note's author or an Admin. A follow-up says what happened, marks
 * every agreement not yet met, and either closes it or sets the next date; a
 * completion gives an old note the content of its type, once.
 */
create function public.hr_note_followup_add(
  p_note_id             uuid,
  p_kind                text,
  p_entry_date          date,
  p_body                text,
  p_sections            jsonb,
  p_warning_level       text,
  p_closes              boolean,
  p_next_text           text,
  p_next_on             date,
  p_no_follow_up_reason text,
  p_participants        jsonb,
  p_topic               text,
  p_event_on            date,
  p_event_time          time,
  p_event_area          public.team,
  p_agreements          jsonb,
  p_results             jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid       uuid := (select auth.uid());
  v_note      public.hr_notes;
  v_structure text;
  v_id        uuid;
  v_today     date := (now() at time zone 'Europe/Zurich')::date;
  v_agreement uuid;
  v_r         jsonb;
  v_open      integer := 0;
begin
  select * into v_note from public.hr_notes n where n.id = p_note_id;
  if not found or v_uid is null or not public.hr_can_worker(v_note.worker_id)
     or not (v_note.created_by = v_uid or public.is_admin()) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if p_entry_date is null or p_entry_date > v_today or p_entry_date < v_note.note_date then
    raise exception 'invalid_date';
  end if;
  if exists (select 1 from public.hr_note_follow_up_state s where s.note_id = p_note_id and s.closed) then
    raise exception 'follow_up_closed';
  end if;

  if p_kind = 'completion' then
    if v_note.sections is not null
       or exists (select 1 from public.hr_note_followups f where f.note_id = p_note_id and f.kind = 'completion') then
      raise exception 'already_complete';
    end if;
    select t.structure into v_structure from public.hr_note_types t where t.id = v_note.type_id;
    perform public.hr_note_check_content(
      v_structure, p_sections, p_warning_level, p_next_text, p_next_on, p_no_follow_up_reason, p_entry_date,
      p_topic, p_event_on, p_event_time, p_event_area, p_agreements);

    insert into public.hr_note_followups (
      note_id, kind, entry_date, sections, warning_level, next_text, next_on, no_follow_up_reason,
      topic, event_on, event_time, event_area, created_by
    ) values (
      p_note_id, 'completion', p_entry_date, jsonb_strip_nulls(p_sections), p_warning_level,
      nullif(btrim(coalesce(p_next_text, '')), ''), p_next_on,
      nullif(btrim(coalesce(p_no_follow_up_reason, '')), ''),
      p_topic, p_event_on, p_event_time, p_event_area, v_uid
    ) returning id into v_id;

    perform public.hr_note_put_agreements(p_note_id, v_id, p_agreements);
  elsif p_kind = 'followup' then
    if btrim(coalesce(p_body, '')) = '' then raise exception 'body_required'; end if;
    -- It ends here, or it says when it continues.
    if coalesce(p_closes, false) = (p_next_on is not null) then raise exception 'follow_up_required'; end if;
    if p_next_on is not null and p_next_on < p_entry_date then raise exception 'follow_up_date_invalid'; end if;

    -- Every agreement not yet met gets its result, and only those.
    if p_results is not null and jsonb_typeof(p_results) <> 'array' then raise exception 'invalid_note'; end if;
    for v_agreement in
      select a.id from public.hr_note_agreements a
       where a.note_id = p_note_id
         and not exists (
           select 1 from public.hr_note_agreement_results r where r.agreement_id = a.id and r.result = 'met')
    loop
      v_r := null;
      select e into v_r from jsonb_array_elements(coalesce(p_results, '[]'::jsonb)) e
       where e ->> 'agreement_id' = v_agreement::text limit 1;
      if v_r is null or coalesce(v_r ->> 'result', '') not in ('met', 'partly', 'not_met') then
        raise exception 'result_required';
      end if;
      if v_r ->> 'result' <> 'met' and btrim(coalesce(v_r ->> 'comment', '')) = '' then
        raise exception 'result_comment_required';
      end if;
      v_open := v_open + 1;
    end loop;
    if jsonb_array_length(coalesce(p_results, '[]'::jsonb)) <> v_open then raise exception 'invalid_note'; end if;

    insert into public.hr_note_followups (note_id, kind, entry_date, body, closes, next_text, next_on, created_by)
    values (
      p_note_id, 'followup', p_entry_date, btrim(p_body), coalesce(p_closes, false),
      nullif(btrim(coalesce(p_next_text, '')), ''), p_next_on, v_uid
    ) returning id into v_id;

    insert into public.hr_note_agreement_results (agreement_id, followup_id, result, comment)
    select (e ->> 'agreement_id')::uuid, v_id, e ->> 'result', nullif(btrim(coalesce(e ->> 'comment', '')), '')
      from jsonb_array_elements(coalesce(p_results, '[]'::jsonb)) e;
  else
    raise exception 'invalid_note';
  end if;

  perform public.hr_note_put_participants(p_note_id, v_id, p_participants, v_uid);
  return v_id;
end;
$$;

revoke all on function public.hr_note_topics() from public, anon;
revoke all on function public.hr_note_agreements_rule(text) from public, anon;
revoke all on function public.hr_note_check_content(text, jsonb, text, text, date, text, date, text, date, time, public.team, jsonb) from public, anon;
revoke all on function public.hr_note_person(jsonb) from public, anon, authenticated;
revoke all on function public.hr_note_put_agreements(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.hr_note_add(uuid, uuid, date, jsonb, text, text, date, text, jsonb, text, date, time, public.team, jsonb) from public, anon;
revoke all on function public.hr_note_followup_add(uuid, text, date, text, jsonb, text, boolean, text, date, text, jsonb, text, date, time, public.team, jsonb, jsonb) from public, anon;
grant execute on function public.hr_note_topics() to authenticated;
grant execute on function public.hr_note_agreements_rule(text) to authenticated;
grant execute on function public.hr_note_check_content(text, jsonb, text, text, date, text, date, text, date, time, public.team, jsonb) to authenticated;
grant execute on function public.hr_note_add(uuid, uuid, date, jsonb, text, text, date, text, jsonb, text, date, time, public.team, jsonb) to authenticated;
grant execute on function public.hr_note_followup_add(uuid, text, date, text, jsonb, text, boolean, text, date, text, jsonb, text, date, time, public.team, jsonb, jsonb) to authenticated;
