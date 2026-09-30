-- ============================================================
-- Internal meetings.
--
--   meetings                 one meeting: when (a day, from–until), where
--                            (office / online with a link / other), what
--                            (title and agenda), who organises it, and —
--                            afterwards — the minutes. Cancelled, never
--                            deleted, once it has happened or been planned
--                            alone; a series' future ones give way when the
--                            series changes.
--   meeting_invitees         who is invited, and their answer: pending /
--                            attending / can't.
--   meeting_series           a meeting that repeats: weekly or every two
--                            weeks, on a weekday, from a date, maybe until
--                            one. Its meetings are made ahead (12 weeks) and
--                            topped up nightly.
--   meeting_series_invitees  who is invited to every one of them.
--   meeting_notices          ledger of "starts in 15 minutes" notices.
--
-- Anyone with an account can be invited. Sales, managers (manager, power
-- user, production manager), Admin and Owners organise. A meeting is seen by
-- its organiser, its invitees, and Admin.
-- ============================================================

create or replace function public.can_organize_meetings()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_sales() or exists (
    select 1 from public.profiles p
     where p.id = (select auth.uid()) and p.status = 'approved'
       and p.role in ('admin', 'owner', 'manager', 'power_user', 'production_manager')
  );
$$;

revoke all on function public.can_organize_meetings() from public, anon;
grant execute on function public.can_organize_meetings() to authenticated;

-- ---------- series ----------

create table public.meeting_series (
  id             uuid primary key default gen_random_uuid(),
  organizer_id   uuid not null references public.profiles (id) on delete cascade,
  title          text not null check (length(btrim(title)) > 0),
  agenda         text,
  place          text check (place in ('office', 'online', 'other')),
  place_detail   text,
  weekday        int not null check (weekday between 1 and 7),
  start_time     time not null,
  end_time       time not null,
  interval_weeks int not null default 1 check (interval_weeks in (1, 2)),
  starts_on      date not null,
  until          date,
  ended_at       timestamptz,
  created_by     uuid references public.profiles (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint meeting_series_times check (end_time > start_time),
  constraint meeting_series_until check (until is null or until >= starts_on)
);

create trigger meeting_series_set_updated_at before update on public.meeting_series
  for each row execute function public.set_updated_at();

create table public.meeting_series_invitees (
  series_id  uuid not null references public.meeting_series (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  primary key (series_id, profile_id)
);

-- ---------- meetings ----------

create table public.meetings (
  id           uuid primary key default gen_random_uuid(),
  series_id    uuid references public.meeting_series (id) on delete set null,
  -- Changed on its own: the series no longer rewrites it.
  detached     boolean not null default false,
  organizer_id uuid not null references public.profiles (id) on delete cascade,
  title        text not null check (length(btrim(title)) > 0),
  agenda       text,
  place        text check (place in ('office', 'online', 'other')),
  place_detail text,
  meeting_date date not null,
  start_time   time not null,
  end_time     time not null,
  status       text not null default 'scheduled' check (status in ('scheduled', 'cancelled')),
  cancelled_at timestamptz,
  cancelled_by uuid references public.profiles (id) on delete set null,
  minutes      text,
  minutes_at   timestamptz,
  minutes_by   uuid references public.profiles (id) on delete set null,
  created_by   uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint meetings_times check (end_time > start_time)
);

create index meetings_date_idx on public.meetings (meeting_date, start_time);
create index meetings_organizer_idx on public.meetings (organizer_id, meeting_date);
create index meetings_series_idx on public.meetings (series_id, meeting_date) where series_id is not null;
create unique index meetings_series_day on public.meetings (series_id, meeting_date) where series_id is not null;

create trigger meetings_set_updated_at before update on public.meetings
  for each row execute function public.set_updated_at();

create table public.meeting_invitees (
  meeting_id   uuid not null references public.meetings (id) on delete cascade,
  profile_id   uuid not null references public.profiles (id) on delete cascade,
  response     text not null default 'pending' check (response in ('pending', 'yes', 'no')),
  responded_at timestamptz,
  note         text,
  primary key (meeting_id, profile_id)
);

create index meeting_invitees_profile_idx on public.meeting_invitees (profile_id);

create table public.meeting_notices (
  meeting_id uuid not null references public.meetings (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  kind       text not null,
  sent_at    timestamptz not null default now(),
  primary key (meeting_id, profile_id, kind)
);

-- ---------- who sees what ----------

create or replace function public.can_see_meeting(p_meeting_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_approved() and (
    public.is_admin()
    or exists (select 1 from public.meetings m where m.id = p_meeting_id and m.organizer_id = (select auth.uid()))
    or exists (select 1 from public.meeting_invitees i where i.meeting_id = p_meeting_id and i.profile_id = (select auth.uid()))
  );
$$;

create or replace function public.can_change_meeting(p_meeting_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_approved() and (
    public.is_admin()
    or exists (select 1 from public.meetings m where m.id = p_meeting_id and m.organizer_id = (select auth.uid()))
  );
$$;

create or replace function public.can_see_series(p_series_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_approved() and (
    public.is_admin()
    or exists (select 1 from public.meeting_series s where s.id = p_series_id and s.organizer_id = (select auth.uid()))
    or exists (select 1 from public.meeting_series_invitees i where i.series_id = p_series_id and i.profile_id = (select auth.uid()))
  );
$$;

create or replace function public.can_change_series(p_series_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_approved() and (
    public.is_admin()
    or exists (select 1 from public.meeting_series s where s.id = p_series_id and s.organizer_id = (select auth.uid()))
  );
$$;

revoke all on function public.can_see_meeting(uuid) from public, anon;
revoke all on function public.can_change_meeting(uuid) from public, anon;
revoke all on function public.can_see_series(uuid) from public, anon;
revoke all on function public.can_change_series(uuid) from public, anon;
grant execute on function public.can_see_meeting(uuid) to authenticated;
grant execute on function public.can_change_meeting(uuid) to authenticated;
grant execute on function public.can_see_series(uuid) to authenticated;
grant execute on function public.can_change_series(uuid) to authenticated;

alter table public.meeting_series          enable row level security;
alter table public.meeting_series_invitees enable row level security;
alter table public.meetings                enable row level security;
alter table public.meeting_invitees        enable row level security;
-- The notifier's alone (service role).
alter table public.meeting_notices         enable row level security;

create policy "meeting_series: involved read" on public.meeting_series for select to authenticated
  using (public.can_see_series(id));
create policy "meeting_series: organisers add" on public.meeting_series for insert to authenticated
  with check ((select public.can_organize_meetings()) and organizer_id = (select auth.uid()) and created_by = (select auth.uid()));
create policy "meeting_series: organiser changes" on public.meeting_series for update to authenticated
  using (public.can_change_series(id)) with check (public.can_change_series(id));

create policy "meeting_series_invitees: involved read" on public.meeting_series_invitees for select to authenticated
  using (public.can_see_series(series_id));
create policy "meeting_series_invitees: organiser writes" on public.meeting_series_invitees for all to authenticated
  using (public.can_change_series(series_id)) with check (public.can_change_series(series_id));

create policy "meetings: involved read" on public.meetings for select to authenticated
  using (public.can_see_meeting(id));
create policy "meetings: organisers add" on public.meetings for insert to authenticated
  with check ((select public.can_organize_meetings()) and organizer_id = (select auth.uid()) and created_by = (select auth.uid()));
create policy "meetings: organiser changes" on public.meetings for update to authenticated
  using (public.can_change_meeting(id)) with check (public.can_change_meeting(id));
-- Only a series' meetings still ahead, untouched and without minutes, give way when the series changes.
create policy "meetings: series gives way" on public.meetings for delete to authenticated
  using (
    public.can_change_meeting(id) and series_id is not null and not detached and minutes is null
    and meeting_date >= (now() at time zone 'Europe/Zurich')::date
  );

create policy "meeting_invitees: involved read" on public.meeting_invitees for select to authenticated
  using (public.can_see_meeting(meeting_id));
create policy "meeting_invitees: organiser invites" on public.meeting_invitees for insert to authenticated
  with check (public.can_change_meeting(meeting_id));
create policy "meeting_invitees: organiser uninvites" on public.meeting_invitees for delete to authenticated
  using (public.can_change_meeting(meeting_id));
-- One's own answer; the organiser does not answer for anyone.
create policy "meeting_invitees: own answer" on public.meeting_invitees for update to authenticated
  using (profile_id = (select auth.uid())) with check (profile_id = (select auth.uid()));

/* An invitee changes only their answer. */
create or replace function public.guard_meeting_invitee()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.meeting_id is distinct from old.meeting_id or new.profile_id is distinct from old.profile_id then
    raise exception 'meeting_invitee_locked' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger meeting_invitees_guard
  before update on public.meeting_invitees
  for each row execute function public.guard_meeting_invitee();

/* Invitees are people with an account; the organiser is not their own invitee. */
create or replace function public.guard_meeting_invite()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.profiles p where p.id = new.profile_id and p.status = 'approved' and p.deleted_at is null) then
    raise exception 'meeting_invitee_inactive' using errcode = '22023';
  end if;
  if exists (select 1 from public.meetings m where m.id = new.meeting_id and m.organizer_id = new.profile_id) then
    raise exception 'meeting_invitee_is_organizer' using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger meeting_invitees_invite_guard
  before insert on public.meeting_invitees
  for each row execute function public.guard_meeting_invite();
