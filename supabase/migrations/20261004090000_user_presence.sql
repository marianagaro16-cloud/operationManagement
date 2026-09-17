-- ============================================================
-- Who is using the app right now
--
-- Every open app checks in while it is on screen: once when a screen opens,
-- and every 30 seconds after that while the tab is visible. A person whose
-- last check-in is recent is online; anyone else is shown with when they were
-- last seen.
--
-- A heartbeat row rather than Realtime Presence, because presence on a
-- channel is readable by whoever can join it, and here only an admin may see
-- who is working. RLS on a table says that in one policy.
--
-- One row per person, overwritten in place, so the table never grows past the
-- number of accounts. It is not an activity log.
-- ============================================================

create table if not exists public.user_presence (
  user_id      uuid primary key references public.profiles (id) on delete cascade,
  last_seen_at timestamptz not null default now(),
  -- When this stretch of use began: reset whenever a check-in arrives after a
  -- gap, so "online for 20 min" means 20 minutes of the app being open.
  started_at   timestamptz not null default now(),
  -- The route the person has open, e.g. /orders/<id>. The screen shows the
  -- section it belongs to, never the raw path.
  path         text
);

comment on table public.user_presence is
  'Last check-in from each person''s open app. Admin-only. One row per user, overwritten on every heartbeat.';

alter table public.user_presence enable row level security;

drop policy if exists user_presence_select_admin on public.user_presence;
create policy user_presence_select_admin on public.user_presence
  for select to authenticated
  using (public.has_permission('users.manage'));

-- No insert/update/delete policies: the only way in is touch_presence().
revoke all on public.user_presence from anon;
grant select on public.user_presence to authenticated;

create or replace function public.touch_presence(p_path text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  -- Only an account that can actually use the app is ever shown as using it.
  if not exists (
    select 1 from public.profiles
     where id = v_uid and status = 'approved' and deleted_at is null
  ) then
    return;
  end if;

  insert into public.user_presence as p (user_id, last_seen_at, started_at, path)
  values (v_uid, now(), now(), left(p_path, 200))
  on conflict (user_id) do update
    set last_seen_at = now(),
        path = left(excluded.path, 200),
        -- Two missed heartbeats and then some: the app was closed or hidden,
        -- so this check-in starts a new stretch.
        started_at = case
          when p.last_seen_at < now() - interval '2 minutes' then now()
          else p.started_at
        end;
end;
$$;

revoke all on function public.touch_presence(text) from public, anon;
grant execute on function public.touch_presence(text) to authenticated;
