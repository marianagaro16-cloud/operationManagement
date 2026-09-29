-- ============================================================
-- Sales: the planning — calls, appointments, emails, visits, WhatsApp
-- messages and whatever else Admin adds, in one agenda. It replaces the
-- visit plan: a visit is one kind of planned activity, and the day's visits
-- still make the route.
--
--   sales_activity_kinds   Admin's list, three languages, shared with the
--                          customer and prospect notes. Two kinds behave:
--                          'visit' goes on the route, 'appointment' has a
--                          place. Those can be renamed, not removed or
--                          changed; kinds Admin adds are 'plain'.
--   sales_activities       a planned activity: whose, which kind, which day
--                          and optionally which time, about a customer, a
--                          prospect, or nobody; for an appointment, where.
--                          Then done or not done; what happened is a note on
--                          the customer or prospect, and the next activity
--                          can be planned from it (follows_id).
--
-- Notes: customer_notes and prospect_notes take their kind from the list
-- instead of four fixed codes. Prospects: the next-step text and date give
-- way to planned activities — every open prospect has at least one.
--
-- Nothing to carry over: no visit, prospect or sales note existed yet.
-- For sales (is_sales()): the Ventas team, Admin and Owners.
-- ============================================================

-- ---------- the kinds ----------

create table public.sales_activity_kinds (
  id           uuid primary key default gen_random_uuid(),
  slug         text not null unique,
  name         text not null check (length(btrim(name)) > 0),
  translations jsonb not null default '{}'::jsonb,
  icon         text not null default 'circle'
               check (icon in ('phone', 'calendar', 'mail', 'map-pin', 'message-circle', 'tag', 'star', 'file-text', 'circle')),
  behavior     text not null default 'plain' check (behavior in ('plain', 'visit', 'appointment')),
  sort_order   int not null default 100,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create trigger sales_activity_kinds_set_updated_at before update on public.sales_activity_kinds
  for each row execute function public.set_updated_at();

insert into public.sales_activity_kinds (slug, name, translations, icon, behavior, sort_order) values
  ('call',        'Llamada',  '{"de": {"name": "Anruf"}, "en": {"name": "Call"}}', 'phone', 'plain', 10),
  ('appointment', 'Cita',     '{"de": {"name": "Termin"}, "en": {"name": "Appointment"}}', 'calendar', 'appointment', 20),
  ('email',       'Correo',   '{"de": {"name": "E-Mail"}, "en": {"name": "Email"}}', 'mail', 'plain', 30),
  ('visit',       'Visita',   '{"de": {"name": "Besuch"}, "en": {"name": "Visit"}}', 'map-pin', 'visit', 40),
  ('whatsapp',    'WhatsApp', '{"de": {"name": "WhatsApp"}, "en": {"name": "WhatsApp"}}', 'message-circle', 'plain', 50),
  ('offer',       'Oferta',   '{"de": {"name": "Angebot"}, "en": {"name": "Offer"}}', 'tag', 'plain', 60);

/* The two kinds that behave are kept: renamed, translated, reordered — never switched off or changed. */
create or replace function public.guard_activity_kind()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' and new.behavior <> 'plain' then
    raise exception 'kind_behavior_fixed' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and (new.behavior is distinct from old.behavior
                           or (old.behavior <> 'plain' and not new.is_active)) then
    raise exception 'kind_behavior_fixed' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger sales_activity_kinds_guard
  before insert or update on public.sales_activity_kinds
  for each row execute function public.guard_activity_kind();

alter table public.sales_activity_kinds enable row level security;
create policy "sales_activity_kinds: sales read" on public.sales_activity_kinds
  for select to authenticated using ((select public.is_sales()));
create policy "sales_activity_kinds: admin writes" on public.sales_activity_kinds
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

-- ---------- notes take their kind from the list ----------

alter table public.customer_notes drop column kind;
alter table public.customer_notes add column kind_id uuid not null references public.sales_activity_kinds (id) on delete restrict;
alter table public.prospect_notes drop column kind;
alter table public.prospect_notes add column kind_id uuid not null references public.sales_activity_kinds (id) on delete restrict;

-- ---------- the planned activities ----------

create table public.sales_activities (
  id             uuid primary key default gen_random_uuid(),
  salesperson_id uuid not null references public.profiles (id) on delete cascade,
  kind_id        uuid not null references public.sales_activity_kinds (id) on delete restrict,
  activity_date  date not null,
  activity_time  time,
  customer_id    uuid references public.customers (id) on delete cascade,
  prospect_id    uuid references public.prospects (id) on delete cascade,
  -- What it is about, for a free one ("prepare the fair"); a note for the others.
  title          text,
  -- An appointment's place: at theirs, the office, online, or another address.
  place          text check (place in ('theirs', 'office', 'online', 'other')),
  place_detail   text,
  -- Route order among the day's visits.
  position       int not null default 0,
  status         text not null default 'planned' check (status in ('planned', 'done', 'not_done')),
  done_at        timestamptz,
  -- The activity this one was planned from, after its result.
  follows_id     uuid references public.sales_activities (id) on delete set null,
  -- When the 15-minutes-before notice went out.
  reminded_at    timestamptz,
  created_by     uuid references public.profiles (id) on delete set null,
  created_at     timestamptz not null default now(),
  -- About a customer, a prospect, or nobody — never both.
  constraint sales_activities_one_target check (customer_id is null or prospect_id is null),
  -- A free one says what it is.
  constraint sales_activities_free_has_title check (
    customer_id is not null or prospect_id is not null or (title is not null and length(btrim(title)) > 0)
  )
);

create index sales_activities_day_idx on public.sales_activities (salesperson_id, activity_date, activity_time, position);
create index sales_activities_prospect_idx on public.sales_activities (prospect_id) where status = 'planned';
create index sales_activities_customer_idx on public.sales_activities (customer_id) where status = 'planned';

alter table public.sales_activities enable row level security;
create policy "sales_activities: sales read" on public.sales_activities
  for select to authenticated using ((select public.is_sales()));
create policy "sales_activities: sales add" on public.sales_activities
  for insert to authenticated
  with check ((select public.is_sales()) and created_by = (select auth.uid()) and status = 'planned');
create policy "sales_activities: sales change" on public.sales_activities
  for update to authenticated using ((select public.is_sales())) with check ((select public.is_sales()));
create policy "sales_activities: remove planned" on public.sales_activities
  for delete to authenticated using ((select public.is_sales()) and status = 'planned');

/* The salesperson is someone in sales; a result, once set, stays. */
create or replace function public.guard_sales_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (tg_op = 'INSERT' or new.salesperson_id is distinct from old.salesperson_id)
     and not exists (
       select 1 from public.profiles p
        where p.id = new.salesperson_id and p.status = 'approved'
          and (p.team = 'sales' or p.role in ('admin', 'owner'))
     ) then
    raise exception 'salesperson_not_sales' using errcode = '22023';
  end if;
  if tg_op = 'UPDATE' and old.status <> 'planned'
     and (new.status is distinct from old.status or new.customer_id is distinct from old.customer_id
          or new.prospect_id is distinct from old.prospect_id or new.activity_date is distinct from old.activity_date
          or new.kind_id is distinct from old.kind_id) then
    raise exception 'activity_recorded' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger sales_activities_guard
  before insert or update on public.sales_activities
  for each row execute function public.guard_sales_activity();

-- ---------- the visit plan gives way ----------

drop table public.sales_visits;
-- sales_visit_days (start/end: home or office) and sales_start_points (home) stay.

-- ---------- prospects: planned activities instead of a next step ----------

alter table public.prospects drop constraint prospects_open_has_next_step;
drop index if exists public.prospects_open_idx;
alter table public.prospects drop column next_step;
alter table public.prospects drop column next_step_on;
alter table public.prospects drop column next_step_notified_on;

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

create or replace function public.sales_prospect_lose(p_prospect_id uuid, p_reason_id uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_stage text;
begin
  if not public.is_sales() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  select stage into v_stage from public.prospects where id = p_prospect_id for update;
  if not found then
    raise exception 'prospect_not_found' using errcode = 'P0002';
  end if;
  if v_stage in ('won', 'lost') then
    raise exception 'prospect_closed' using errcode = '42501';
  end if;
  if p_reason_id is null or not exists (
    select 1 from public.prospect_lost_reasons r where r.id = p_reason_id and r.is_active
  ) then
    raise exception 'lost_reason_required' using errcode = '22023';
  end if;

  -- Nothing more is planned with a lost prospect.
  delete from public.sales_activities where prospect_id = p_prospect_id and status = 'planned';

  perform set_config('app.prospect_closing', 'on', true);
  update public.prospects
     set stage = 'lost', lost_reason_id = p_reason_id, lost_note = nullif(btrim(coalesce(p_note, '')), ''),
         closed_at = now()
   where id = p_prospect_id;
  perform set_config('app.prospect_closing', 'off', true);
end;
$$;

-- ---------- notices ----------

/* One morning summary per salesperson and day. */
create table public.sales_plan_notices (
  user_id  uuid not null references public.profiles (id) on delete cascade,
  day      date not null,
  sent_at  timestamptz not null default now(),
  primary key (user_id, day)
);
alter table public.sales_plan_notices enable row level security;
