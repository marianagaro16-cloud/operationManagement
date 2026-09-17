-- ============================================================
-- Notification inbox
--
-- Every notification the app sends is also kept here for each person it was
-- addressed to, whether or not a push reached one of their devices. A push is
-- gone the moment it is swiped away; the inbox is where it can be read again,
-- and where somebody who never enabled notifications finds it at all.
--
-- One row per (person, tag), mirroring the phone's own tray: a notification
-- sharing a tag with an earlier one REPLACES it rather than stacking. An order
-- escalating warning -> critical -> overdue is one entry that moves back to
-- the top unread, not three. Direct messages carry a unique tag, so each one
-- is its own entry.
--
-- A replacement with the SAME text changes nothing. The schedulers release
-- and retry a claim that reached no device, and a retry must neither duplicate
-- an entry nor mark an already-read one unread again.
--
-- Entries older than 60 days are pruned whenever that person receives a new
-- one, so the table stays bounded without a job of its own.
-- ============================================================

create table if not exists public.notification_inbox (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  tag        text not null,
  title      text not null,
  body       text not null default '',
  url        text,
  level      text,
  created_at timestamptz not null default now(),
  read_at    timestamptz,
  unique (user_id, tag)
);

create index if not exists notification_inbox_user_created
  on public.notification_inbox (user_id, created_at desc);

comment on table public.notification_inbox is
  'Every notification sent, per recipient. Readable only by that recipient. One row per (user, tag): a later notification with the same tag replaces the earlier one.';

alter table public.notification_inbox enable row level security;

-- Your own notifications and nobody else's, admins included: a direct message
-- or a personal reminder is addressed to one person.
drop policy if exists notification_inbox_select_own on public.notification_inbox;
create policy notification_inbox_select_own on public.notification_inbox
  for select to authenticated
  using (user_id = (select auth.uid()));

revoke all on public.notification_inbox from anon;
grant select on public.notification_inbox to authenticated;

-- ------------------------------------------------------------
-- Writing: the server, as the service role, when it sends.
-- ------------------------------------------------------------
create or replace function public.record_inbox_notification(
  p_user_ids uuid[],
  p_tag      text,
  p_title    text,
  p_body     text,
  p_url      text,
  p_level    text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.notification_inbox as n (user_id, tag, title, body, url, level)
  select p.id, p_tag, left(p_title, 200), left(coalesce(p_body, ''), 1000), p_url, p_level
    from public.profiles p
   where p.id = any (p_user_ids)
     and p.status = 'approved'
     and p.deleted_at is null
  on conflict (user_id, tag) do update
    set title      = excluded.title,
        body       = excluded.body,
        url        = excluded.url,
        level      = excluded.level,
        created_at = now(),
        read_at    = null
  where (n.title, n.body) is distinct from (excluded.title, excluded.body);

  delete from public.notification_inbox
   where user_id = any (p_user_ids)
     and created_at < now() - interval '60 days';
end;
$$;

revoke all on function public.record_inbox_notification(uuid[], text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.record_inbox_notification(uuid[], text, text, text, text, text)
  to service_role;

-- ------------------------------------------------------------
-- Reading: mark your own entries read. Null marks them all.
-- ------------------------------------------------------------
create or replace function public.mark_inbox_read(p_ids uuid[] default null)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.notification_inbox
     set read_at = now()
   where user_id = (select auth.uid())
     and read_at is null
     and (p_ids is null or id = any (p_ids));
$$;

revoke all on function public.mark_inbox_read(uuid[]) from public, anon;
grant execute on function public.mark_inbox_read(uuid[]) to authenticated;
