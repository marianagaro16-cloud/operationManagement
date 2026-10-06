-- ============================================================
-- A log note with a structure (decided 2026-10-06).
--
-- A note used to be one free text box, and "se habló de tiempos muertos" is
-- what came out of it: nothing about why, what was agreed, what happens next
-- or who was there. Now each type has its sections, and they are compulsory.
--
--   hr_note_types.structure  which set of sections a type asks for. The four
--                            built-in types have their own; 'Otro' and any
--                            type Admin adds use the general one.
--   hr_notes.sections        the answers, by section key. NULL = a note from
--                            before this, kept exactly as it was written.
--   hr_notes.follow_up_*     what will be followed up and when — or why
--                            nothing needs to be.
--   hr_note_participants     who was there: an app account, a worker file or
--                            a name typed in. The name is kept as written.
--   hr_note_followups        entries added to a note later: what came of the
--                            follow-up (closing it or setting a new date),
--                            or — once — the sections an old note lacks.
--
-- Still permanent: nothing here is ever updated or deleted. Notes and entries
-- are written through functions only, which is where the structure is checked.
-- The sections themselves are fixed in the app (src/domain/hr/note-structure.ts)
-- and mirrored in hr_note_required_sections().
-- ============================================================

-- ---------- types: which structure ----------

alter table public.hr_note_types
  add column structure text not null default 'general'
    check (structure in ('conversation', 'recognition', 'warning', 'training', 'general'));

update public.hr_note_types set structure = slug
 where slug in ('conversation', 'recognition', 'warning', 'training');

-- ---------- notes: the sections ----------

alter table public.hr_notes
  alter column body drop not null,
  add column sections            jsonb,
  add column warning_level       text check (warning_level in ('verbal', 'written', 'final')),
  add column follow_up_text      text,
  add column follow_up_on        date,
  add column no_follow_up_reason text;

alter table public.hr_notes drop constraint if exists hr_notes_body_check;
alter table public.hr_notes add constraint hr_notes_content_check
  check (sections is not null or length(btrim(coalesce(body, ''))) > 0);

-- ---------- entries added later ----------

create table public.hr_note_followups (
  id                  uuid primary key default gen_random_uuid(),
  note_id             uuid not null references public.hr_notes (id) on delete cascade,
  -- followup: what came of it. completion: the sections an old note lacks.
  kind                text not null check (kind in ('followup', 'completion')),
  entry_date          date not null,
  body                text,
  sections            jsonb,
  warning_level       text check (warning_level in ('verbal', 'written', 'final')),
  -- Nothing more to follow up.
  closes              boolean not null default false,
  next_text           text,
  next_on             date,
  no_follow_up_reason text,
  created_by          uuid references public.profiles (id) on delete set null,
  created_at          timestamptz not null default now()
);

create index hr_note_followups_note_idx on public.hr_note_followups (note_id, created_at);
-- An old note is completed once.
create unique index hr_note_followups_one_completion
  on public.hr_note_followups (note_id) where kind = 'completion';

-- ---------- who was there ----------

create table public.hr_note_participants (
  id          uuid primary key default gen_random_uuid(),
  note_id     uuid not null references public.hr_notes (id) on delete cascade,
  -- Set when they belong to an entry added later rather than to the note.
  followup_id uuid references public.hr_note_followups (id) on delete cascade,
  profile_id  uuid references public.profiles (id) on delete set null,
  worker_id   uuid references public.hr_workers (id) on delete set null,
  -- As they were called then; also the whole of it for someone typed in.
  name        text not null check (length(btrim(name)) > 0)
);

create index hr_note_participants_note_idx on public.hr_note_participants (note_id);

alter table public.hr_note_followups    enable row level security;
alter table public.hr_note_participants enable row level security;

-- Read with the file. No write policy: the functions below are the only way in.
create policy "hr_note_followups: read" on public.hr_note_followups
  for select to authenticated using (public.hr_can_note(note_id));
create policy "hr_note_participants: read" on public.hr_note_participants
  for select to authenticated using (public.hr_can_note(note_id));

-- A note is written through hr_note_add(), which checks its sections.
drop policy "hr_notes: add" on public.hr_notes;

-- ---------- the structure, as the database knows it ----------

/* The sections a structure cannot be saved without. */
create or replace function public.hr_note_required_sections(p_structure text)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select case p_structure
    when 'conversation' then array['reason', 'points', 'agreements']
    when 'recognition'  then array['what', 'impact', 'why', 'how']
    when 'warning'      then array['what', 'rule', 'response', 'agreements', 'consequence']
    when 'training'     then array['topic', 'reason', 'trainer', 'duration', 'result']
    else                     array['reason', 'detail']
  end;
$$;

/* required: a follow-up, or the reason there is none. optional. none: not asked. */
create or replace function public.hr_note_follow_up_rule(p_structure text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_structure
    when 'recognition' then 'none'
    when 'general'     then 'optional'
    else                    'required'
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
  p_from                date
)
returns void
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_key  text;
  v_rule text := public.hr_note_follow_up_rule(p_structure);
  v_text boolean := btrim(coalesce(p_follow_up_text, '')) <> '';
  v_none boolean := btrim(coalesce(p_no_follow_up_reason, '')) <> '';
begin
  if p_sections is null or jsonb_typeof(p_sections) <> 'object' then
    raise exception 'sections_required';
  end if;
  foreach v_key in array public.hr_note_required_sections(p_structure) loop
    if btrim(coalesce(p_sections ->> v_key, '')) = '' then
      raise exception 'section_required';
    end if;
  end loop;

  if p_structure = 'warning' and p_warning_level is null then
    raise exception 'level_required';
  end if;
  if p_structure <> 'warning' and p_warning_level is not null then
    raise exception 'invalid_note';
  end if;

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
  if p_follow_up_on is not null and p_follow_up_on < p_from then
    raise exception 'follow_up_date_invalid';
  end if;
end;
$$;

/*
 * Stores who was there. The writer always is; anyone picked from an account
 * or a file gets that record's name, and its other half when the two are
 * linked; anyone else is the name typed in.
 */
create or replace function public.hr_note_put_participants(
  p_note_id     uuid,
  p_followup_id uuid,
  p_people      jsonb,
  p_uid         uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_person  jsonb;
  v_profile uuid;
  v_worker  uuid;
  v_name    text;
  v_seen    text[] := '{}';
  v_key     text;
begin
  for v_person in
    select jsonb_build_object('profile_id', p_uid)
    union all
    select e from jsonb_array_elements(coalesce(p_people, '[]'::jsonb)) e
  loop
    v_profile := nullif(v_person ->> 'profile_id', '')::uuid;
    v_worker  := nullif(v_person ->> 'worker_id', '')::uuid;
    v_name    := null;

    -- An account and its file are the same person.
    if v_worker is not null then
      select w.name, coalesce(v_profile, w.profile_id) into v_name, v_profile
        from public.hr_workers w where w.id = v_worker;
      if not found then raise exception 'participant_not_found'; end if;
    elsif v_profile is not null then
      select w.id, w.name into v_worker, v_name
        from public.hr_workers w where w.profile_id = v_profile;
    end if;
    if v_profile is not null and v_name is null then
      select coalesce(nullif(btrim(p.name), ''), p.email) into v_name
        from public.profiles p where p.id = v_profile;
      if not found then raise exception 'participant_not_found'; end if;
    end if;
    if v_name is null then
      v_name := nullif(btrim(coalesce(v_person ->> 'name', '')), '');
    end if;
    if v_name is null then raise exception 'participant_not_found'; end if;

    v_key := coalesce(v_profile::text, v_worker::text, lower(v_name));
    if v_key = any (v_seen) then continue; end if;
    v_seen := v_seen || v_key;

    insert into public.hr_note_participants (note_id, followup_id, profile_id, worker_id, name)
    values (p_note_id, p_followup_id, v_profile, v_worker, left(v_name, 200));
  end loop;
end;
$$;

-- ---------- writing a note ----------

create or replace function public.hr_note_add(
  p_worker_id           uuid,
  p_type_id             uuid,
  p_note_date           date,
  p_sections            jsonb,
  p_warning_level       text,
  p_follow_up_text      text,
  p_follow_up_on        date,
  p_no_follow_up_reason text,
  p_participants        jsonb
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
    v_structure, p_sections, p_warning_level, p_follow_up_text, p_follow_up_on, p_no_follow_up_reason, p_note_date);

  insert into public.hr_notes (
    worker_id, type_id, note_date, sections, warning_level,
    follow_up_text, follow_up_on, no_follow_up_reason, created_by
  ) values (
    p_worker_id, p_type_id, p_note_date, jsonb_strip_nulls(p_sections), p_warning_level,
    nullif(btrim(coalesce(p_follow_up_text, '')), ''), p_follow_up_on,
    nullif(btrim(coalesce(p_no_follow_up_reason, '')), ''), v_uid
  ) returning id into v_id;

  perform public.hr_note_put_participants(v_id, null, p_participants, v_uid);
  return v_id;
end;
$$;

-- ---------- where a note's follow-up stands ----------

/*
 * The latest entry decides: it closed the follow-up, or set the next date.
 * Without entries, the date the note itself was written with.
 */
create view public.hr_note_follow_up_state with (security_invoker = true) as
select n.id as note_id,
       n.worker_id,
       n.created_by,
       case when l.id is null then n.follow_up_on else l.next_on end as due_on,
       coalesce(l.closes, false) as closed
  from public.hr_notes n
  left join lateral (
    select f.id, f.closes, f.next_on
      from public.hr_note_followups f
     where f.note_id = n.id
     order by f.created_at desc, f.id
     limit 1
  ) l on true;

grant select on public.hr_note_follow_up_state to authenticated;

-- ---------- adding to a note later ----------

/*
 * By the note's author or an Admin. A follow-up says what happened and either
 * closes it or sets the next date; a completion gives an old note the
 * sections of its type, once.
 */
create or replace function public.hr_note_followup_add(
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
  p_participants        jsonb
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
      v_structure, p_sections, p_warning_level, p_next_text, p_next_on, p_no_follow_up_reason, p_entry_date);

    insert into public.hr_note_followups (
      note_id, kind, entry_date, sections, warning_level, next_text, next_on, no_follow_up_reason, created_by
    ) values (
      p_note_id, 'completion', p_entry_date, jsonb_strip_nulls(p_sections), p_warning_level,
      nullif(btrim(coalesce(p_next_text, '')), ''), p_next_on,
      nullif(btrim(coalesce(p_no_follow_up_reason, '')), ''), v_uid
    ) returning id into v_id;
  elsif p_kind = 'followup' then
    if btrim(coalesce(p_body, '')) = '' then raise exception 'body_required'; end if;
    -- It ends here, or it says when it continues.
    if coalesce(p_closes, false) = (p_next_on is not null) then raise exception 'follow_up_required'; end if;
    if p_next_on is not null and p_next_on < p_entry_date then raise exception 'follow_up_date_invalid'; end if;

    insert into public.hr_note_followups (note_id, kind, entry_date, body, closes, next_text, next_on, created_by)
    values (
      p_note_id, 'followup', p_entry_date, btrim(p_body), coalesce(p_closes, false),
      nullif(btrim(coalesce(p_next_text, '')), ''), p_next_on, v_uid
    ) returning id into v_id;
  else
    raise exception 'invalid_note';
  end if;

  perform public.hr_note_put_participants(p_note_id, v_id, p_participants, v_uid);
  return v_id;
end;
$$;

-- ---------- who is reminded of a follow-up ----------

/*
 * The participants of a note (or of one later entry) who have an account and
 * may open this worker's file themselves — never the worker the note is
 * about. The reminder names the worker, so nobody else may receive it.
 */
create or replace function public.hr_note_reminder_audience(p_note_id uuid, p_followup_id uuid default null)
returns uuid[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_worker public.hr_workers;
begin
  select w.* into v_worker
    from public.hr_notes n join public.hr_workers w on w.id = n.worker_id
   where n.id = p_note_id;
  if not found or not public.hr_can_worker(v_worker.id) then
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
           exists (select 1 from public.role_permissions rp where rp.role = p.role and rp.permission = 'hr.manage')
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

revoke all on function public.hr_note_required_sections(text) from public, anon;
revoke all on function public.hr_note_follow_up_rule(text) from public, anon;
revoke all on function public.hr_note_check_content(text, jsonb, text, text, date, text, date) from public, anon;
revoke all on function public.hr_note_put_participants(uuid, uuid, jsonb, uuid) from public, anon, authenticated;
revoke all on function public.hr_note_add(uuid, uuid, date, jsonb, text, text, date, text, jsonb) from public, anon;
revoke all on function public.hr_note_followup_add(uuid, text, date, text, jsonb, text, boolean, text, date, text, jsonb) from public, anon;
revoke all on function public.hr_note_reminder_audience(uuid, uuid) from public, anon;
grant execute on function public.hr_note_required_sections(text) to authenticated;
grant execute on function public.hr_note_follow_up_rule(text) to authenticated;
grant execute on function public.hr_note_check_content(text, jsonb, text, text, date, text, date) to authenticated;
grant execute on function public.hr_note_add(uuid, uuid, date, jsonb, text, text, date, text, jsonb) to authenticated;
grant execute on function public.hr_note_followup_add(uuid, text, date, text, jsonb, text, boolean, text, date, text, jsonb) to authenticated;
grant execute on function public.hr_note_reminder_audience(uuid, uuid) to authenticated;
