-- ============================================================
-- THE ACTA OF A MEETING WITH A CUSTOMER (decided 2026-10-08)
--
-- A visit or an appointment with a customer or a prospect left one free note.
-- It now leaves an ACTA, as detailed as a team meeting's record:
--
--   sales_acta_topics             Admin's list of what a point is about, in
--                                 three languages.
--   sales_actas                   one per done visit or appointment: the
--                                 meeting as it was, whose file it is in, its
--                                 follow-up date. A draft until registered.
--   sales_acta_attendees          who was there: ours (accounts) and theirs
--                                 (names typed in, with what they do).
--   sales_acta_points             per point: its topic, a title, what was said.
--   sales_acta_agreements         per point: what, who of ours, by when.
--   sales_acta_entries            added after it was registered: an addendum,
--                                 or what came of the follow-up.
--   sales_acta_agreement_results  a follow-up marks every agreement not yet met.
--   sales_acta_notices            what was already told, once each.
--
-- sales_activities.acta_required: a visit or an appointment with a customer
-- or a prospect marked done from now on owes its Acta, and its salesperson is
-- chased until it is registered. What was done before owes nothing.
--
-- Registered, an Acta is permanent like a note. Read by sales (the Ventas
-- team, Admin and Owners), like the notes. A prospect's Actas move to the
-- customer when it is won.
-- ============================================================

-- ---------- the topics ----------

create table public.sales_acta_topics (
  id           uuid primary key default gen_random_uuid(),
  slug         text not null unique,
  name         text not null check (length(btrim(name)) > 0),
  translations jsonb not null default '{}'::jsonb,
  sort_order   int not null default 100,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create trigger sales_acta_topics_set_updated_at before update on public.sales_acta_topics
  for each row execute function public.set_updated_at();

insert into public.sales_acta_topics (slug, name, translations, sort_order) values
  ('products',   'Productos y surtido',   '{"de": {"name": "Produkte und Sortiment"}, "en": {"name": "Products and range"}}', 10),
  ('prices',     'Precios y condiciones', '{"de": {"name": "Preise und Konditionen"}, "en": {"name": "Prices and terms"}}', 20),
  ('orders',     'Pedidos y cantidades',  '{"de": {"name": "Bestellungen und Mengen"}, "en": {"name": "Orders and quantities"}}', 30),
  ('delivery',   'Entregas y logística',  '{"de": {"name": "Lieferung und Logistik"}, "en": {"name": "Delivery and logistics"}}', 40),
  ('quality',    'Calidad',               '{"de": {"name": "Qualität"}, "en": {"name": "Quality"}}', 50),
  ('complaint',  'Reclamo',               '{"de": {"name": "Reklamation"}, "en": {"name": "Complaint"}}', 60),
  ('payments',   'Pagos y facturas',      '{"de": {"name": "Zahlungen und Rechnungen"}, "en": {"name": "Payments and invoices"}}', 70),
  ('promotions', 'Promociones y marketing', '{"de": {"name": "Aktionen und Marketing"}, "en": {"name": "Promotions and marketing"}}', 80),
  ('new',        'Novedades y proyectos', '{"de": {"name": "Neuheiten und Projekte"}, "en": {"name": "News and projects"}}', 90),
  ('other',      'Otro',                  '{"de": {"name": "Anderes"}, "en": {"name": "Other"}}', 200);

alter table public.sales_acta_topics enable row level security;
create policy "sales_acta_topics: sales read" on public.sales_acta_topics
  for select to authenticated using ((select public.is_sales()));
create policy "sales_acta_topics: admin writes" on public.sales_acta_topics
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
grant select, insert, update on public.sales_acta_topics to authenticated;

-- ---------- which activities owe one ----------

alter table public.sales_activities add column acta_required boolean not null default false;

/* A visit or an appointment with someone, marked done: its Acta is owed. */
create or replace function public.sales_activity_owes_acta()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'done' and old.status = 'planned'
     and (new.customer_id is not null or new.prospect_id is not null)
     and exists (select 1 from public.sales_activity_kinds k where k.id = new.kind_id and k.behavior in ('visit', 'appointment')) then
    new.acta_required := true;
  end if;
  return new;
end;
$$;

create trigger sales_activities_acta before update on public.sales_activities
  for each row execute function public.sales_activity_owes_acta();

create index sales_activities_acta_idx on public.sales_activities (salesperson_id, activity_date) where acta_required;

-- ---------- the Acta ----------

create table public.sales_actas (
  activity_id      uuid primary key references public.sales_activities (id) on delete cascade,
  -- Whose file it is in: the activity's customer or prospect; the customer once a prospect is won.
  customer_id      uuid references public.customers (id) on delete cascade,
  prospect_id      uuid references public.prospects (id) on delete cascade,
  -- The meeting as it was, kept with the Acta.
  kind_id          uuid not null references public.sales_activity_kinds (id) on delete restrict,
  meeting_date     date not null,
  start_time       time,
  end_time         time,
  place            text,
  place_detail     text,
  salesperson_id   uuid not null references public.profiles (id) on delete cascade,
  salesperson_name text not null,
  follow_up_on     date,
  -- NULL: still a draft.
  registered_at    timestamptz,
  registered_by    uuid references public.profiles (id) on delete set null,
  written_by       uuid references public.profiles (id) on delete set null,
  updated_at       timestamptz not null default now(),
  constraint sales_actas_one_target check ((customer_id is null) <> (prospect_id is null))
);

create index sales_actas_customer_idx on public.sales_actas (customer_id, meeting_date desc) where customer_id is not null;
create index sales_actas_prospect_idx on public.sales_actas (prospect_id, meeting_date desc) where prospect_id is not null;
create index sales_actas_date_idx on public.sales_actas (meeting_date desc);

create table public.sales_acta_attendees (
  id          uuid primary key default gen_random_uuid(),
  activity_id uuid not null references public.sales_actas (activity_id) on delete cascade,
  side        text not null check (side in ('ours', 'theirs')),
  profile_id  uuid references public.profiles (id) on delete set null,
  -- As they were called then; the whole of it for someone of theirs.
  name        text not null check (length(btrim(name)) > 0),
  -- What they do there: owner, chef, buyer…
  role        text
);

create index sales_acta_attendees_acta_idx on public.sales_acta_attendees (activity_id);

create table public.sales_acta_points (
  id          uuid primary key default gen_random_uuid(),
  activity_id uuid not null references public.sales_actas (activity_id) on delete cascade,
  sort_order  integer not null,
  topic_id    uuid references public.sales_acta_topics (id) on delete restrict,
  title       text not null default '',
  discussed   text
);

create index sales_acta_points_acta_idx on public.sales_acta_points (activity_id, sort_order);
create index sales_acta_points_topic_idx on public.sales_acta_points (topic_id);

create table public.sales_acta_agreements (
  id                     uuid primary key default gen_random_uuid(),
  activity_id            uuid not null references public.sales_actas (activity_id) on delete cascade,
  point_id               uuid not null references public.sales_acta_points (id) on delete cascade,
  sort_order             integer not null,
  body                   text not null default '',
  -- One of ours: someone in sales.
  responsible_profile_id uuid references public.profiles (id) on delete set null,
  responsible_name       text,
  due_on                 date
);

create index sales_acta_agreements_point_idx on public.sales_acta_agreements (point_id, sort_order);

create table public.sales_acta_entries (
  id          uuid primary key default gen_random_uuid(),
  activity_id uuid not null references public.sales_actas (activity_id) on delete cascade,
  -- addendum: something to add. followup: what came of the agreements.
  kind        text not null check (kind in ('addendum', 'followup')),
  entry_date  date not null,
  body        text not null check (length(btrim(body)) > 0),
  closes      boolean not null default false,
  next_on     date,
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now()
);

create index sales_acta_entries_acta_idx on public.sales_acta_entries (activity_id, created_at);

create table public.sales_acta_agreement_results (
  id           uuid primary key default gen_random_uuid(),
  agreement_id uuid not null references public.sales_acta_agreements (id) on delete cascade,
  entry_id     uuid not null references public.sales_acta_entries (id) on delete cascade,
  result       text not null check (result in ('met', 'partly', 'not_met')),
  comment      text,
  unique (agreement_id, entry_id),
  check (result = 'met' or length(btrim(coalesce(comment, ''))) > 0)
);

/* What was already told about an activity's Acta: once per person and kind. */
create table public.sales_acta_notices (
  activity_id uuid not null references public.sales_activities (id) on delete cascade,
  profile_id  uuid not null references public.profiles (id) on delete cascade,
  kind        text not null,
  sent_at     timestamptz not null default now(),
  primary key (activity_id, profile_id, kind)
);

alter table public.sales_actas                  enable row level security;
alter table public.sales_acta_attendees         enable row level security;
alter table public.sales_acta_points            enable row level security;
alter table public.sales_acta_agreements        enable row level security;
alter table public.sales_acta_entries           enable row level security;
alter table public.sales_acta_agreement_results enable row level security;
alter table public.sales_acta_notices           enable row level security;

-- Read by sales, like the notes. Everything is written through the functions below.
create policy "sales_actas: sales read" on public.sales_actas
  for select to authenticated using ((select public.is_sales()));
create policy "sales_acta_attendees: sales read" on public.sales_acta_attendees
  for select to authenticated using ((select public.is_sales()));
create policy "sales_acta_points: sales read" on public.sales_acta_points
  for select to authenticated using ((select public.is_sales()));
create policy "sales_acta_agreements: sales read" on public.sales_acta_agreements
  for select to authenticated using ((select public.is_sales()));
create policy "sales_acta_entries: sales read" on public.sales_acta_entries
  for select to authenticated using ((select public.is_sales()));
create policy "sales_acta_agreement_results: sales read" on public.sales_acta_agreement_results
  for select to authenticated using ((select public.is_sales()));

grant select on public.sales_actas, public.sales_acta_attendees, public.sales_acta_points,
  public.sales_acta_agreements, public.sales_acta_entries, public.sales_acta_agreement_results to authenticated;

-- ---------- writing it ----------

/*
 * Saves the Acta of a done visit or appointment, by its salesperson or a
 * manager. p_content:
 *   { attendees: [{side, profile_id, name, role}],
 *     points: [{topic_id, title, discussed,
 *               agreements: [{body, responsible_id, due_on}]}],
 *     follow_up_on }
 *
 * A draft is rewritten whole and may be incomplete. With p_register it must
 * be complete, and from then on it cannot be saved again.
 */
create or replace function public.sales_acta_save(p_activity_id uuid, p_content jsonb, p_register boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid      uuid := (select auth.uid());
  v_a        public.sales_activities;
  v_customer uuid;
  v_prospect uuid;
  v_name     text;
  v_item     jsonb;
  v_point    jsonb;
  v_ag       jsonb;
  v_n        bigint;
  v_m        bigint;
  v_point_id uuid;
  v_profile  uuid;
  v_person   text;
  v_follow   date := nullif(p_content ->> 'follow_up_on', '')::date;
  v_ours     integer := 0;
  v_theirs   integer := 0;
  v_points   integer := 0;
  v_agreed   integer := 0;
  v_seen     text[] := '{}';
  v_key      text;
begin
  select * into v_a from public.sales_activities a where a.id = p_activity_id;
  if not found or v_uid is null or not public.sales_can_change(v_a.salesperson_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if v_a.status <> 'done' or (v_a.customer_id is null and v_a.prospect_id is null)
     or not exists (select 1 from public.sales_activity_kinds k where k.id = v_a.kind_id and k.behavior in ('visit', 'appointment')) then
    raise exception 'acta_not_for_this';
  end if;
  if exists (select 1 from public.sales_actas r where r.activity_id = p_activity_id and r.registered_at is not null) then
    raise exception 'acta_registered';
  end if;
  if jsonb_typeof(coalesce(p_content -> 'attendees', '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_content -> 'points', '[]'::jsonb)) <> 'array' then
    raise exception 'invalid_acta';
  end if;

  -- A prospect won since the meeting: the Acta belongs in the customer's file.
  v_customer := v_a.customer_id;
  if v_customer is null then
    select p.customer_id into v_customer from public.prospects p where p.id = v_a.prospect_id;
  end if;
  if v_customer is null then v_prospect := v_a.prospect_id; end if;

  select coalesce(nullif(btrim(p.name), ''), p.email) into v_name from public.profiles p where p.id = v_a.salesperson_id;

  -- The draft is rewritten whole.
  delete from public.sales_actas r where r.activity_id = p_activity_id;
  insert into public.sales_actas (
    activity_id, customer_id, prospect_id, kind_id, meeting_date, start_time, end_time, place, place_detail,
    salesperson_id, salesperson_name, follow_up_on, written_by
  ) values (
    p_activity_id, v_customer, v_prospect, v_a.kind_id, v_a.activity_date, v_a.activity_time, v_a.activity_end,
    v_a.place, v_a.place_detail, v_a.salesperson_id, coalesce(v_name, '—'), v_follow, v_uid
  );

  for v_item in select e from jsonb_array_elements(coalesce(p_content -> 'attendees', '[]'::jsonb)) e loop
    if v_item ->> 'side' = 'ours' then
      v_profile := nullif(v_item ->> 'profile_id', '')::uuid;
      select coalesce(nullif(btrim(p.name), ''), p.email) into v_person from public.profiles p where p.id = v_profile;
      if v_person is null then raise exception 'attendee_not_found'; end if;
      v_key := v_profile::text;
    elsif v_item ->> 'side' = 'theirs' then
      v_profile := null;
      v_person := btrim(coalesce(v_item ->> 'name', ''));
      if v_person = '' then continue; end if;
      v_key := 't:' || lower(v_person);
    else
      raise exception 'invalid_acta';
    end if;
    if v_key = any (v_seen) then continue; end if;
    v_seen := v_seen || v_key;
    if v_profile is null then v_theirs := v_theirs + 1; else v_ours := v_ours + 1; end if;
    insert into public.sales_acta_attendees (activity_id, side, profile_id, name, role)
    values (
      p_activity_id, v_item ->> 'side', v_profile, v_person,
      case when v_profile is null then nullif(btrim(coalesce(v_item ->> 'role', '')), '') end
    );
  end loop;

  for v_point, v_n in
    select e, i from jsonb_array_elements(coalesce(p_content -> 'points', '[]'::jsonb)) with ordinality as x (e, i)
  loop
    v_points := v_points + 1;
    if nullif(v_point ->> 'topic_id', '') is not null
       and not exists (select 1 from public.sales_acta_topics t where t.id = (v_point ->> 'topic_id')::uuid) then
      raise exception 'topic_required';
    end if;
    if p_register then
      if nullif(v_point ->> 'topic_id', '') is null then raise exception 'topic_required'; end if;
      if btrim(coalesce(v_point ->> 'discussed', '')) = '' then raise exception 'point_incomplete'; end if;
    end if;

    insert into public.sales_acta_points (activity_id, sort_order, topic_id, title, discussed)
    values (
      p_activity_id, v_n, nullif(v_point ->> 'topic_id', '')::uuid, btrim(coalesce(v_point ->> 'title', '')),
      nullif(btrim(coalesce(v_point ->> 'discussed', '')), '')
    ) returning id into v_point_id;

    for v_ag, v_m in
      select e, i from jsonb_array_elements(coalesce(v_point -> 'agreements', '[]'::jsonb)) with ordinality as x (e, i)
    loop
      v_agreed := v_agreed + 1;
      v_profile := nullif(v_ag ->> 'responsible_id', '')::uuid;
      v_person := null;
      if v_profile is not null then
        -- One of ours: the Ventas team, Admin or an Owner.
        select coalesce(nullif(btrim(p.name), ''), p.email) into v_person
          from public.profiles p
         where p.id = v_profile and p.status = 'approved' and (p.team = 'sales' or p.role in ('admin', 'owner'));
        if v_person is null then raise exception 'responsible_not_sales'; end if;
      end if;
      if p_register then
        if btrim(coalesce(v_ag ->> 'body', '')) = '' or v_profile is null
           or nullif(v_ag ->> 'due_on', '') is null or (v_ag ->> 'due_on')::date < v_a.activity_date then
          raise exception 'agreement_incomplete';
        end if;
      end if;
      insert into public.sales_acta_agreements (activity_id, point_id, sort_order, body, responsible_profile_id, responsible_name, due_on)
      values (p_activity_id, v_point_id, v_m, btrim(coalesce(v_ag ->> 'body', '')), v_profile, v_person, nullif(v_ag ->> 'due_on', '')::date);
    end loop;
  end loop;

  if not p_register then return; end if;

  if v_ours = 0 or v_theirs = 0 then raise exception 'attendee_required'; end if;
  if v_points = 0 then raise exception 'point_incomplete'; end if;
  -- Agreements are checked at the follow-up, so there has to be one.
  if v_agreed > 0 and v_follow is null then raise exception 'follow_up_required'; end if;
  if v_follow is not null and v_follow < v_a.activity_date then raise exception 'follow_up_date_invalid'; end if;

  update public.sales_actas set registered_at = now(), registered_by = v_uid where activity_id = p_activity_id;
end;
$$;

-- ---------- where its follow-up stands ----------

/* The latest follow-up entry decides: it closed it, or set the next date. */
create view public.sales_acta_follow_up_state with (security_invoker = true) as
select r.activity_id,
       r.salesperson_id,
       r.customer_id,
       r.prospect_id,
       r.meeting_date,
       case when l.id is null then r.follow_up_on else l.next_on end as due_on,
       coalesce(l.closes, false) as closed
  from public.sales_actas r
  left join lateral (
    select e.id, e.closes, e.next_on
      from public.sales_acta_entries e
     where e.activity_id = r.activity_id and e.kind = 'followup'
     order by e.created_at desc, e.id
     limit 1
  ) l on true
 where r.registered_at is not null;

grant select on public.sales_acta_follow_up_state to authenticated;

-- ---------- adding to a registered Acta ----------

/*
 * By its salesperson or a manager. An addendum says what is to be added. A
 * follow-up says what happened, marks every agreement not yet met, and either
 * closes it or sets the next date.
 */
create or replace function public.sales_acta_entry_add(
  p_activity_id uuid,
  p_kind        text,
  p_entry_date  date,
  p_body        text,
  p_closes      boolean,
  p_next_on     date,
  p_results     jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid       uuid := (select auth.uid());
  v_today     date := (now() at time zone 'Europe/Zurich')::date;
  v_acta      public.sales_actas;
  v_id        uuid;
  v_agreement uuid;
  v_r         jsonb;
  v_open      integer := 0;
begin
  select * into v_acta from public.sales_actas r where r.activity_id = p_activity_id;
  if not found or v_uid is null or not public.sales_can_change(v_acta.salesperson_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if v_acta.registered_at is null then raise exception 'acta_not_registered'; end if;
  if p_entry_date is null or p_entry_date > v_today or p_entry_date < v_acta.meeting_date then
    raise exception 'invalid_date';
  end if;
  if btrim(coalesce(p_body, '')) = '' then raise exception 'body_required'; end if;

  if p_kind = 'addendum' then
    insert into public.sales_acta_entries (activity_id, kind, entry_date, body, created_by)
    values (p_activity_id, 'addendum', p_entry_date, btrim(p_body), v_uid) returning id into v_id;
    return v_id;
  elsif p_kind <> 'followup' then
    raise exception 'invalid_acta';
  end if;

  if exists (select 1 from public.sales_acta_follow_up_state s where s.activity_id = p_activity_id and (s.closed or s.due_on is null)) then
    raise exception 'follow_up_closed';
  end if;
  -- It ends here, or it says when it continues.
  if coalesce(p_closes, false) = (p_next_on is not null) then raise exception 'follow_up_required'; end if;
  if p_next_on is not null and p_next_on < p_entry_date then raise exception 'follow_up_date_invalid'; end if;

  -- Every agreement not yet met gets its result, and only those.
  if p_results is not null and jsonb_typeof(p_results) <> 'array' then raise exception 'invalid_acta'; end if;
  for v_agreement in
    select a.id from public.sales_acta_agreements a
     where a.activity_id = p_activity_id
       and not exists (
         select 1 from public.sales_acta_agreement_results r where r.agreement_id = a.id and r.result = 'met')
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
  if jsonb_array_length(coalesce(p_results, '[]'::jsonb)) <> v_open then raise exception 'invalid_acta'; end if;

  insert into public.sales_acta_entries (activity_id, kind, entry_date, body, closes, next_on, created_by)
  values (p_activity_id, 'followup', p_entry_date, btrim(p_body), coalesce(p_closes, false), p_next_on, v_uid)
  returning id into v_id;

  insert into public.sales_acta_agreement_results (agreement_id, entry_id, result, comment)
  select (e ->> 'agreement_id')::uuid, v_id, e ->> 'result', nullif(btrim(coalesce(e ->> 'comment', '')), '')
    from jsonb_array_elements(coalesce(p_results, '[]'::jsonb)) e;
  return v_id;
end;
$$;

revoke all on function public.sales_acta_save(uuid, jsonb, boolean) from public, anon;
revoke all on function public.sales_acta_entry_add(uuid, text, date, text, boolean, date, jsonb) from public, anon;
grant execute on function public.sales_acta_save(uuid, jsonb, boolean) to authenticated;
grant execute on function public.sales_acta_entry_add(uuid, text, date, text, boolean, date, jsonb) to authenticated;

-- ---------- a prospect won: its Actas go to the customer's file ----------

create or replace function public.sales_prospect_win(p_prospect_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p        public.prospects%rowtype;
  v_customer uuid;
begin
  if not public.is_sales() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  select * into v_p from public.prospects where id = p_prospect_id for update;
  if not found then
    raise exception 'prospect_not_found' using errcode = 'P0002';
  end if;
  if v_p.stage in ('won', 'lost') then
    raise exception 'prospect_closed' using errcode = '42501';
  end if;

  insert into public.customers (company_name, street, postal_code, city, customer_type_id)
  values (v_p.company_name, v_p.street, v_p.postal_code, v_p.city, v_p.customer_type_id)
  returning id into v_customer;

  insert into public.customer_notes (customer_id, kind_id, note_date, body, created_by, created_at)
  select v_customer, n.kind_id, n.note_date, n.body, n.created_by, n.created_at
    from public.prospect_notes n where n.prospect_id = p_prospect_id;

  -- The Actas of the meetings held with them, drafts included.
  update public.sales_actas
     set customer_id = v_customer, prospect_id = null
   where prospect_id = p_prospect_id;

  -- What was still planned with the prospect is planned with the customer now.
  update public.sales_activities
     set customer_id = v_customer, prospect_id = null
   where prospect_id = p_prospect_id and status = 'planned';

  perform set_config('app.prospect_closing', 'on', true);
  update public.prospects
     set stage = 'won', customer_id = v_customer, closed_at = now()
   where id = p_prospect_id;
  perform set_config('app.prospect_closing', 'off', true);

  return v_customer;
end;
$$;
