-- ============================================================
-- A meeting's record for the workers' files (decided 2026-10-07).
--
-- A team meeting — "Limpieza, Calidad y Puntualidad" — left nothing in the
-- files of the people it was held with: its minutes were six names, and four
-- of the six have no account, so the app did not even know who was there.
--
-- A meeting can now carry a RECORD, as detailed as a log note:
--
--   meeting_records            who registered it and when, its follow-up
--                              date, and the meeting's own data as it was
--                              then — a file is read without the meeting.
--   meeting_attendees          who was there: a worker file, an account or a
--                              name typed in.
--   meeting_record_points      per agenda point: its topic (the log's list),
--                              the situation that led to it, what was said.
--   meeting_record_agreements  per point: what, who — one attendee or all of
--                              them — and by when. Or the reason there is none.
--   meeting_record_entries     added after it was registered: an addendum,
--                              or what came of the follow-up.
--   meeting_agreement_results  a follow-up marks every agreement not yet met.
--
-- The record is a draft its organiser (or Admin) rewrites freely. Registered,
-- it is permanent like a note, and appears in the log of every attendee with
-- a file. Registering takes someone who may open those files.
--
--   meetings.hr_record         "this one goes into the files": such a meeting
--                              is chased until its record is registered.
-- ============================================================

alter table public.meetings add column hr_record boolean not null default false;

create table public.meeting_records (
  meeting_id     uuid primary key references public.meetings (id) on delete restrict,
  -- The meeting as it was, kept with the record.
  title          text not null,
  meeting_date   date not null,
  start_time     time not null,
  end_time       time not null,
  place          text,
  place_detail   text,
  organizer_id   uuid references public.profiles (id) on delete set null,
  organizer_name text not null,
  follow_up_on   date,
  -- NULL: still a draft.
  registered_at  timestamptz,
  registered_by  uuid references public.profiles (id) on delete set null,
  written_by     uuid references public.profiles (id) on delete set null,
  updated_at     timestamptz not null default now()
);

create table public.meeting_attendees (
  id         uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.meeting_records (meeting_id) on delete cascade,
  profile_id uuid references public.profiles (id) on delete set null,
  worker_id  uuid references public.hr_workers (id) on delete set null,
  -- As they were called then; the whole of it for someone typed in.
  name       text not null check (length(btrim(name)) > 0)
);

create index meeting_attendees_meeting_idx on public.meeting_attendees (meeting_id);
create index meeting_attendees_worker_idx on public.meeting_attendees (worker_id) where worker_id is not null;

create table public.meeting_record_points (
  id                   uuid primary key default gen_random_uuid(),
  meeting_id           uuid not null references public.meeting_records (meeting_id) on delete cascade,
  sort_order           integer not null,
  title                text not null default '',
  topic                text check (topic = any (public.hr_note_topics())),
  situation            text,
  discussed            text,
  no_agreements_reason text
);

create index meeting_record_points_meeting_idx on public.meeting_record_points (meeting_id, sort_order);

create table public.meeting_record_agreements (
  id                     uuid primary key default gen_random_uuid(),
  meeting_id             uuid not null references public.meeting_records (meeting_id) on delete cascade,
  point_id               uuid not null references public.meeting_record_points (id) on delete cascade,
  sort_order             integer not null,
  body                   text not null default '',
  -- Everyone who was there, rather than one of them.
  responsible_all        boolean not null default false,
  responsible_profile_id uuid references public.profiles (id) on delete set null,
  responsible_worker_id  uuid references public.hr_workers (id) on delete set null,
  responsible_name       text,
  due_on                 date
);

create index meeting_record_agreements_point_idx on public.meeting_record_agreements (point_id, sort_order);

create table public.meeting_record_entries (
  id         uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.meeting_records (meeting_id) on delete cascade,
  -- addendum: something to add. followup: what came of the agreements.
  kind       text not null check (kind in ('addendum', 'followup')),
  entry_date date not null,
  body       text not null check (length(btrim(body)) > 0),
  closes     boolean not null default false,
  next_on    date,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create index meeting_record_entries_meeting_idx on public.meeting_record_entries (meeting_id, created_at);

create table public.meeting_agreement_results (
  id           uuid primary key default gen_random_uuid(),
  agreement_id uuid not null references public.meeting_record_agreements (id) on delete cascade,
  entry_id     uuid not null references public.meeting_record_entries (id) on delete cascade,
  result       text not null check (result in ('met', 'partly', 'not_met')),
  comment      text,
  unique (agreement_id, entry_id),
  check (result = 'met' or length(btrim(coalesce(comment, ''))) > 0)
);

-- ---------- who reads ----------

/*
 * Whoever sees the meeting sees its record. Once registered, so does whoever
 * may open the file of one of its attendees — that is where it is read from.
 */
create or replace function public.meeting_record_can_see(p_meeting_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.can_see_meeting(p_meeting_id)
      or exists (
        select 1
          from public.meeting_records r
          join public.meeting_attendees a on a.meeting_id = r.meeting_id
         where r.meeting_id = p_meeting_id
           and r.registered_at is not null
           and a.worker_id is not null
           and public.hr_can_worker(a.worker_id)
      );
$$;

revoke all on function public.meeting_record_can_see(uuid) from public, anon;
grant execute on function public.meeting_record_can_see(uuid) to authenticated;

alter table public.meeting_records           enable row level security;
alter table public.meeting_attendees         enable row level security;
alter table public.meeting_record_points     enable row level security;
alter table public.meeting_record_agreements enable row level security;
alter table public.meeting_record_entries    enable row level security;
alter table public.meeting_agreement_results enable row level security;

-- Read only. Everything is written through the functions below.
create policy "meeting_records: read" on public.meeting_records for select to authenticated
  using (public.meeting_record_can_see(meeting_id));
create policy "meeting_attendees: read" on public.meeting_attendees for select to authenticated
  using (public.meeting_record_can_see(meeting_id));
create policy "meeting_record_points: read" on public.meeting_record_points for select to authenticated
  using (public.meeting_record_can_see(meeting_id));
create policy "meeting_record_agreements: read" on public.meeting_record_agreements for select to authenticated
  using (public.meeting_record_can_see(meeting_id));
create policy "meeting_record_entries: read" on public.meeting_record_entries for select to authenticated
  using (public.meeting_record_can_see(meeting_id));
create policy "meeting_agreement_results: read" on public.meeting_agreement_results for select to authenticated
  using (exists (
    select 1 from public.meeting_record_agreements a
     where a.id = agreement_id and public.meeting_record_can_see(a.meeting_id)
  ));

-- ---------- writing the record ----------

/*
 * Saves the record of a meeting that has started, by its organiser or an
 * Admin. p_content:
 *   { attendees: [{profile_id, worker_id, name}],
 *     points: [{title, topic, situation, discussed, no_agreements_reason,
 *               agreements: [{body, all, responsible: {…}|null, due_on}]}],
 *     follow_up_on }
 *
 * A draft is rewritten whole and may be incomplete. With p_register it must
 * be complete, the caller must be allowed the files of every attendee who
 * has one, and from then on it cannot be saved again.
 */
create or replace function public.meeting_record_save(p_meeting_id uuid, p_content jsonb, p_register boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid       uuid := (select auth.uid());
  v_today     date := (now() at time zone 'Europe/Zurich')::date;
  v_meeting   public.meetings;
  v_organizer text;
  v_person    record;
  v_rp        uuid;
  v_rw        uuid;
  v_rn        text;
  v_item      jsonb;
  v_point     jsonb;
  v_a         jsonb;
  v_n         bigint;
  v_m         bigint;
  v_point_id  uuid;
  v_follow    date := nullif(p_content ->> 'follow_up_on', '')::date;
  v_files     integer := 0;
  v_agreed    integer := 0;
  v_count     integer;
  v_team      public.team;
  v_owner     uuid;
  v_seen      text[] := '{}';
  v_key       text;
begin
  select * into v_meeting from public.meetings m where m.id = p_meeting_id;
  if not found or v_uid is null or not public.can_change_meeting(p_meeting_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if v_meeting.status <> 'scheduled' or v_meeting.meeting_date > v_today then
    raise exception 'meeting_not_held';
  end if;
  if exists (select 1 from public.meeting_records r where r.meeting_id = p_meeting_id and r.registered_at is not null) then
    raise exception 'record_registered';
  end if;
  if jsonb_typeof(coalesce(p_content -> 'attendees', '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_content -> 'points', '[]'::jsonb)) <> 'array' then
    raise exception 'invalid_record';
  end if;

  select coalesce(nullif(btrim(p.name), ''), p.email) into v_organizer
    from public.profiles p where p.id = v_meeting.organizer_id;

  -- The draft is rewritten whole.
  delete from public.meeting_records r where r.meeting_id = p_meeting_id;
  insert into public.meeting_records (
    meeting_id, title, meeting_date, start_time, end_time, place, place_detail,
    organizer_id, organizer_name, follow_up_on, written_by
  ) values (
    p_meeting_id, v_meeting.title, v_meeting.meeting_date, v_meeting.start_time, v_meeting.end_time,
    v_meeting.place, v_meeting.place_detail, v_meeting.organizer_id, coalesce(v_organizer, '—'), v_follow, v_uid
  );

  for v_item in select e from jsonb_array_elements(coalesce(p_content -> 'attendees', '[]'::jsonb)) e loop
    select * into v_person from public.hr_note_person(v_item);
    v_key := coalesce(v_person.o_worker::text, v_person.o_profile::text, lower(v_person.o_name));
    if v_key = any (v_seen) then continue; end if;
    v_seen := v_seen || v_key;
    insert into public.meeting_attendees (meeting_id, profile_id, worker_id, name)
    values (p_meeting_id, v_person.o_profile, v_person.o_worker, v_person.o_name);

    if v_person.o_worker is not null then
      v_files := v_files + 1;
      if p_register then
        -- The files of everyone who was there: theirs to open, or their own.
        select w.team, w.profile_id into v_team, v_owner from public.hr_workers w where w.id = v_person.o_worker;
        if not public.hr_can(v_team) or public.is_owner_account(v_owner) then
          raise exception 'files_not_allowed' using errcode = '42501';
        end if;
      end if;
    end if;
  end loop;

  for v_point, v_n in
    select e, i from jsonb_array_elements(coalesce(p_content -> 'points', '[]'::jsonb)) with ordinality as x (e, i)
  loop
    v_count := jsonb_array_length(coalesce(v_point -> 'agreements', '[]'::jsonb));
    if p_register then
      if btrim(coalesce(v_point ->> 'title', '')) = ''
         or btrim(coalesce(v_point ->> 'situation', '')) = ''
         or btrim(coalesce(v_point ->> 'discussed', '')) = '' then
        raise exception 'point_incomplete';
      end if;
      if coalesce(v_point ->> 'topic', '') = '' or not ((v_point ->> 'topic') = any (public.hr_note_topics())) then
        raise exception 'topic_required';
      end if;
      -- Agreements, or why there are none — not both.
      if (v_count > 0) = (btrim(coalesce(v_point ->> 'no_agreements_reason', '')) <> '') then
        raise exception 'agreement_required';
      end if;
    end if;

    insert into public.meeting_record_points (meeting_id, sort_order, title, topic, situation, discussed, no_agreements_reason)
    values (
      p_meeting_id, v_n, btrim(coalesce(v_point ->> 'title', '')), nullif(v_point ->> 'topic', ''),
      nullif(btrim(coalesce(v_point ->> 'situation', '')), ''), nullif(btrim(coalesce(v_point ->> 'discussed', '')), ''),
      case when v_count = 0 then nullif(btrim(coalesce(v_point ->> 'no_agreements_reason', '')), '') end
    ) returning id into v_point_id;

    for v_a, v_m in
      select e, i from jsonb_array_elements(coalesce(v_point -> 'agreements', '[]'::jsonb)) with ordinality as x (e, i)
    loop
      v_agreed := v_agreed + 1;
      v_rp := null; v_rw := null; v_rn := null;
      if not coalesce((v_a ->> 'all')::boolean, false) and jsonb_typeof(v_a -> 'responsible') = 'object' then
        select x.o_profile, x.o_worker, x.o_name into v_rp, v_rw, v_rn from public.hr_note_person(v_a -> 'responsible') x;
      end if;
      if p_register then
        if btrim(coalesce(v_a ->> 'body', '')) = '' or nullif(v_a ->> 'due_on', '') is null
           or (not coalesce((v_a ->> 'all')::boolean, false) and v_rn is null)
           or (v_a ->> 'due_on')::date < v_meeting.meeting_date then
          raise exception 'agreement_incomplete';
        end if;
      end if;
      insert into public.meeting_record_agreements (
        meeting_id, point_id, sort_order, body, responsible_all,
        responsible_profile_id, responsible_worker_id, responsible_name, due_on
      ) values (
        p_meeting_id, v_point_id, v_m, btrim(coalesce(v_a ->> 'body', '')), coalesce((v_a ->> 'all')::boolean, false),
        v_rp, v_rw, v_rn, nullif(v_a ->> 'due_on', '')::date
      );
    end loop;
  end loop;

  if not p_register then
    -- Someone is writing it: the meeting is one for the files.
    update public.meetings set hr_record = true where id = p_meeting_id and not hr_record;
    return;
  end if;

  if not public.has_permission('hr.manage') then
    raise exception 'files_not_allowed' using errcode = '42501';
  end if;
  if v_files = 0 then raise exception 'attendee_required'; end if;
  if not exists (select 1 from public.meeting_record_points p where p.meeting_id = p_meeting_id) then
    raise exception 'point_incomplete';
  end if;
  -- Agreements are checked at the follow-up, so there has to be one.
  if v_agreed > 0 and v_follow is null then raise exception 'follow_up_required'; end if;
  if v_follow is not null and v_follow < v_meeting.meeting_date then raise exception 'follow_up_date_invalid'; end if;

  update public.meeting_records
     set registered_at = now(), registered_by = v_uid
   where meeting_id = p_meeting_id;
  update public.meetings set hr_record = true where id = p_meeting_id and not hr_record;
end;
$$;

-- ---------- where its follow-up stands ----------

/* The latest follow-up entry decides: it closed it, or set the next date. */
create view public.meeting_record_follow_up_state with (security_invoker = true) as
select r.meeting_id,
       r.organizer_id,
       r.title,
       case when l.id is null then r.follow_up_on else l.next_on end as due_on,
       coalesce(l.closes, false) as closed
  from public.meeting_records r
  left join lateral (
    select e.id, e.closes, e.next_on
      from public.meeting_record_entries e
     where e.meeting_id = r.meeting_id and e.kind = 'followup'
     order by e.created_at desc, e.id
     limit 1
  ) l on true
 where r.registered_at is not null;

grant select on public.meeting_record_follow_up_state to authenticated;

-- ---------- adding to a registered record ----------

/*
 * By the organiser or an Admin. An addendum says what is to be added. A
 * follow-up says what happened, marks every agreement not yet met, and either
 * closes it or sets the next date.
 */
create or replace function public.meeting_record_entry_add(
  p_meeting_id uuid,
  p_kind       text,
  p_entry_date date,
  p_body       text,
  p_closes     boolean,
  p_next_on    date,
  p_results    jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid       uuid := (select auth.uid());
  v_today     date := (now() at time zone 'Europe/Zurich')::date;
  v_record    public.meeting_records;
  v_id        uuid;
  v_agreement uuid;
  v_r         jsonb;
  v_open      integer := 0;
begin
  select * into v_record from public.meeting_records r where r.meeting_id = p_meeting_id;
  if not found or v_uid is null or not public.can_change_meeting(p_meeting_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if v_record.registered_at is null then raise exception 'record_not_registered'; end if;
  if p_entry_date is null or p_entry_date > v_today or p_entry_date < v_record.meeting_date then
    raise exception 'invalid_date';
  end if;
  if btrim(coalesce(p_body, '')) = '' then raise exception 'body_required'; end if;

  if p_kind = 'addendum' then
    insert into public.meeting_record_entries (meeting_id, kind, entry_date, body, created_by)
    values (p_meeting_id, 'addendum', p_entry_date, btrim(p_body), v_uid) returning id into v_id;
    return v_id;
  elsif p_kind <> 'followup' then
    raise exception 'invalid_record';
  end if;

  if exists (select 1 from public.meeting_record_follow_up_state s where s.meeting_id = p_meeting_id and s.closed) then
    raise exception 'follow_up_closed';
  end if;
  -- It ends here, or it says when it continues.
  if coalesce(p_closes, false) = (p_next_on is not null) then raise exception 'follow_up_required'; end if;
  if p_next_on is not null and p_next_on < p_entry_date then raise exception 'follow_up_date_invalid'; end if;

  -- Every agreement not yet met gets its result, and only those.
  if p_results is not null and jsonb_typeof(p_results) <> 'array' then raise exception 'invalid_record'; end if;
  for v_agreement in
    select a.id from public.meeting_record_agreements a
     where a.meeting_id = p_meeting_id
       and not exists (
         select 1 from public.meeting_agreement_results r where r.agreement_id = a.id and r.result = 'met')
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
  if jsonb_array_length(coalesce(p_results, '[]'::jsonb)) <> v_open then raise exception 'invalid_record'; end if;

  insert into public.meeting_record_entries (meeting_id, kind, entry_date, body, closes, next_on, created_by)
  values (p_meeting_id, 'followup', p_entry_date, btrim(p_body), coalesce(p_closes, false), p_next_on, v_uid)
  returning id into v_id;

  insert into public.meeting_agreement_results (agreement_id, entry_id, result, comment)
  select (e ->> 'agreement_id')::uuid, v_id, e ->> 'result', nullif(btrim(coalesce(e ->> 'comment', '')), '')
    from jsonb_array_elements(coalesce(p_results, '[]'::jsonb)) e;
  return v_id;
end;
$$;

/* Marks a meeting as one for the files, or not — while it has no record. */
create or replace function public.meeting_set_hr_record(p_meeting_id uuid, p_on boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.can_change_meeting(p_meeting_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if not p_on and exists (select 1 from public.meeting_records r where r.meeting_id = p_meeting_id) then
    raise exception 'record_registered';
  end if;
  update public.meetings set hr_record = p_on where id = p_meeting_id;
end;
$$;

revoke all on function public.meeting_record_save(uuid, jsonb, boolean) from public, anon;
revoke all on function public.meeting_record_entry_add(uuid, text, date, text, boolean, date, jsonb) from public, anon;
revoke all on function public.meeting_set_hr_record(uuid, boolean) from public, anon;
grant execute on function public.meeting_record_save(uuid, jsonb, boolean) to authenticated;
grant execute on function public.meeting_record_entry_add(uuid, text, date, text, boolean, date, jsonb) to authenticated;
grant execute on function public.meeting_set_hr_record(uuid, boolean) to authenticated;
