-- ============================================================
-- Absences, step 1 of Absence & Coverage: who is away, and approval.
--
--   absence_types      Admin's list, three languages.
--   absence_approvers  who approves — a list Admin keeps. Nobody approves
--                      their own absence.
--   absences           someone with an account is away: from–to dates, the
--                      first day may start in the afternoon and the last
--                      may end at noon. pending → approved | rejected; a
--                      pending or approved one can be cancelled. Never
--                      deleted.
--   absence_events     its history: requested, changed, approved, rejected,
--                      cancelled — who and when.
--
-- Who sees what: everyone sees who is away and when (absence_calendar());
-- the type and the note only the person and the approvers.
-- ============================================================

-- ---------- types ----------

create table public.absence_types (
  id           uuid primary key default gen_random_uuid(),
  name         text not null check (length(btrim(name)) > 0),
  translations jsonb not null default '{}'::jsonb,
  sort_order   int not null default 100,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create trigger absence_types_set_updated_at before update on public.absence_types
  for each row execute function public.set_updated_at();

insert into public.absence_types (name, translations, sort_order) values
  ('Vacaciones', '{"de": {"name": "Ferien"}, "en": {"name": "Vacation"}}', 10),
  ('Enfermedad', '{"de": {"name": "Krankheit"}, "en": {"name": "Sick leave"}}', 20),
  ('Personal', '{"de": {"name": "Persönlich"}, "en": {"name": "Personal"}}', 30),
  ('Viaje de trabajo', '{"de": {"name": "Geschäftsreise"}, "en": {"name": "Business trip"}}', 40),
  ('Formación', '{"de": {"name": "Weiterbildung"}, "en": {"name": "Training"}}', 50),
  ('Otro', '{"de": {"name": "Anderes"}, "en": {"name": "Other"}}', 90);

-- ---------- approvers ----------

create table public.absence_approvers (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  added_by   uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

-- Mariana and the three owners, to start with.
insert into public.absence_approvers (profile_id)
select id from public.profiles
 where id in ('6249d52a-605a-4caa-a0bf-99cd1b083cf3', '59538c6a-4a6f-48d3-bde3-5481d98ccc47',
              '70326d83-f0d3-498c-803a-ba24898dc07d', '17493830-6316-4a71-9451-b707e978bd6a')
on conflict do nothing;

create or replace function public.is_absence_approver()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.absence_approvers a
      join public.profiles p on p.id = a.profile_id
     where a.profile_id = (select auth.uid()) and p.status = 'approved' and p.deleted_at is null
  );
$$;

revoke all on function public.is_absence_approver() from public, anon;
grant execute on function public.is_absence_approver() to authenticated;

-- ---------- absences ----------

create table public.absences (
  id               uuid primary key default gen_random_uuid(),
  profile_id       uuid not null references public.profiles (id) on delete cascade,
  type_id          uuid not null references public.absence_types (id) on delete restrict,
  start_date       date not null,
  end_date         date not null,
  -- The first day may start in the afternoon; the last may end at noon.
  first_day        text not null default 'full' check (first_day in ('full', 'afternoon')),
  last_day         text not null default 'full' check (last_day in ('full', 'morning')),
  note             text,
  status           text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  decided_at       timestamptz,
  decided_by       uuid references public.profiles (id) on delete set null,
  rejection_reason text,
  cancelled_at     timestamptz,
  cancelled_by     uuid references public.profiles (id) on delete set null,
  created_by       uuid references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint absences_dates check (end_date >= start_date),
  -- One day cannot start in the afternoon and end at noon.
  constraint absences_halves check (not (start_date = end_date and first_day = 'afternoon' and last_day = 'morning')),
  constraint absences_rejection_reason check (status <> 'rejected' or nullif(btrim(coalesce(rejection_reason, '')), '') is not null)
);

create index absences_profile_idx on public.absences (profile_id, start_date);
create index absences_dates_idx on public.absences (start_date, end_date) where status in ('pending', 'approved');
create index absences_pending_idx on public.absences (created_at) where status = 'pending';

create trigger absences_set_updated_at before update on public.absences
  for each row execute function public.set_updated_at();

/*
 * Only the RPCs below decide and cancel (they set app.absence_rpc). A direct
 * change is the person editing their own pending request: dates, type, note.
 * No two pending or approved absences of one person overlap.
 */
create or replace function public.guard_absence()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(current_setting('app.absence_rpc', true), '') <> 'on' then
    if tg_op = 'INSERT' then
      if new.status <> 'pending' or new.decided_by is not null or new.cancelled_by is not null then
        raise exception 'absence_status_by_rpc' using errcode = '42501';
      end if;
    elsif new.status is distinct from old.status
       or new.profile_id is distinct from old.profile_id
       or new.decided_at is distinct from old.decided_at or new.decided_by is distinct from old.decided_by
       or new.rejection_reason is distinct from old.rejection_reason
       or new.cancelled_at is distinct from old.cancelled_at or new.cancelled_by is distinct from old.cancelled_by then
      raise exception 'absence_status_by_rpc' using errcode = '42501';
    end if;
  end if;

  if new.status in ('pending', 'approved') and exists (
    select 1 from public.absences o
     where o.profile_id = new.profile_id and o.id <> new.id
       and o.status in ('pending', 'approved')
       and o.start_date <= new.end_date and o.end_date >= new.start_date
  ) then
    raise exception 'absence_overlaps' using errcode = '23P01';
  end if;
  return new;
end;
$$;

create trigger absences_guard
  before insert or update on public.absences
  for each row execute function public.guard_absence();

-- ---------- history ----------

create table public.absence_events (
  id         bigserial primary key,
  absence_id uuid not null references public.absences (id) on delete cascade,
  actor_id   uuid references public.profiles (id) on delete set null,
  action     text not null,
  detail     jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index absence_events_absence_idx on public.absence_events (absence_id, created_at);

create or replace function public.log_absence()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_action text;
begin
  if tg_op = 'INSERT' then
    v_action := 'requested';
  elsif new.status is distinct from old.status then
    v_action := new.status; -- approved | rejected | cancelled
  elsif (new.start_date, new.end_date, new.first_day, new.last_day, new.type_id, coalesce(new.note, ''))
        is distinct from (old.start_date, old.end_date, old.first_day, old.last_day, old.type_id, coalesce(old.note, '')) then
    v_action := 'changed';
  else
    return new;
  end if;
  insert into public.absence_events (absence_id, actor_id, action, detail)
  values (new.id, (select auth.uid()), v_action, jsonb_build_object(
    'start_date', new.start_date, 'end_date', new.end_date, 'first_day', new.first_day, 'last_day', new.last_day,
    'type_id', new.type_id, 'reason', coalesce(new.rejection_reason, '')));
  return new;
end;
$$;

create trigger absences_log
  after insert or update on public.absences
  for each row execute function public.log_absence();

-- ---------- RLS ----------

alter table public.absence_types     enable row level security;
alter table public.absence_approvers enable row level security;
alter table public.absences          enable row level security;
alter table public.absence_events    enable row level security;

create policy "absence_types: approved read" on public.absence_types for select to authenticated
  using ((select public.is_approved()));
create policy "absence_types: admin writes" on public.absence_types for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

create policy "absence_approvers: approved read" on public.absence_approvers for select to authenticated
  using ((select public.is_approved()));
create policy "absence_approvers: admin writes" on public.absence_approvers for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- The whole row — type and note included — for the person and the approvers.
create policy "absences: own and approvers read" on public.absences for select to authenticated
  using (profile_id = (select auth.uid()) or (select public.is_absence_approver()));
create policy "absences: request own" on public.absences for insert to authenticated
  with check ((select public.is_approved()) and profile_id = (select auth.uid()) and created_by = (select auth.uid()));
create policy "absences: change own pending" on public.absences for update to authenticated
  using (profile_id = (select auth.uid()) and status = 'pending')
  with check (profile_id = (select auth.uid()) and status = 'pending');

create policy "absence_events: own and approvers read" on public.absence_events for select to authenticated
  using (exists (select 1 from public.absences a where a.id = absence_id
                  and (a.profile_id = (select auth.uid()) or (select public.is_absence_approver()))));

-- ---------- deciding and cancelling ----------

create or replace function public.absence_decide(p_absence_id uuid, p_approve boolean, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_a public.absences%rowtype;
begin
  if not public.is_absence_approver() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  select * into v_a from public.absences where id = p_absence_id for update;
  if not found then
    raise exception 'absence_not_found' using errcode = 'P0002';
  end if;
  if v_a.profile_id = (select auth.uid()) then
    raise exception 'absence_own' using errcode = '42501';
  end if;
  if v_a.status <> 'pending' then
    raise exception 'absence_not_pending' using errcode = '22023';
  end if;
  if not p_approve and nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'absences_rejection_reason' using errcode = '22023';
  end if;
  perform set_config('app.absence_rpc', 'on', true);
  update public.absences
     set status = case when p_approve then 'approved' else 'rejected' end,
         decided_at = now(), decided_by = (select auth.uid()),
         rejection_reason = case when p_approve then null else btrim(p_reason) end
   where id = p_absence_id;
  perform set_config('app.absence_rpc', '', true);
end;
$$;

revoke all on function public.absence_decide(uuid, boolean, text) from public, anon;
grant execute on function public.absence_decide(uuid, boolean, text) to authenticated;

/* The person, or an approver, calls off a pending or approved absence that has not ended. */
create or replace function public.absence_cancel(p_absence_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_a public.absences%rowtype;
begin
  select * into v_a from public.absences where id = p_absence_id for update;
  if not found then
    raise exception 'absence_not_found' using errcode = 'P0002';
  end if;
  if v_a.profile_id <> (select auth.uid()) and not public.is_absence_approver() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if v_a.status not in ('pending', 'approved') then
    raise exception 'absence_closed' using errcode = '22023';
  end if;
  if v_a.end_date < (now() at time zone 'Europe/Zurich')::date then
    raise exception 'absence_past' using errcode = '22023';
  end if;
  perform set_config('app.absence_rpc', 'on', true);
  update public.absences set status = 'cancelled', cancelled_at = now(), cancelled_by = (select auth.uid())
   where id = p_absence_id;
  perform set_config('app.absence_rpc', '', true);
end;
$$;

revoke all on function public.absence_cancel(uuid) from public, anon;
grant execute on function public.absence_cancel(uuid) to authenticated;

-- ---------- who is away: for everyone ----------

/*
 * Approved absences overlapping a range: who and when, never the type or
 * the note — those only the person and the approvers read, from the table.
 */
create or replace function public.absence_calendar(p_from date, p_to date)
returns table (
  id uuid, profile_id uuid, person_name text,
  start_date date, end_date date, first_day text, last_day text
)
language sql
stable
security definer
set search_path = ''
as $$
  select a.id, a.profile_id, coalesce(nullif(p.name, ''), p.email), a.start_date, a.end_date, a.first_day, a.last_day
    from public.absences a
    join public.profiles p on p.id = a.profile_id
   where public.is_approved()
     and a.status = 'approved'
     and a.start_date <= p_to and a.end_date >= p_from
   order by a.start_date, 3;
$$;

revoke all on function public.absence_calendar(date, date) from public, anon;
grant execute on function public.absence_calendar(date, date) to authenticated;
