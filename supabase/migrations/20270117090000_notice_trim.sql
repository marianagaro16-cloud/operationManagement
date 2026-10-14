-- ============================================================
-- Fewer notices (decided 2026-10-14).
--
-- 1. Inventories: "terminado, carga el Digital", "X diferencias por revisar"
--    and the short-expiry list go to the people kept here — Mariana — not
--    to everyone who manages inventories.
-- 2. The owners: what reaches them because of their role (HR, short expiry,
--    customer Actas, anything sent to a capability) no longer arrives one by
--    one. It is filed in their inbox already read, and once a day one
--    summary lists it. What is addressed to them personally — their
--    reminders, meetings, messages, absences to approve — still arrives at
--    once.
-- 3. The backlog: everything older than 7 days still unread is marked read,
--    so the badges start again from what is current.
-- ============================================================

insert into public.app_settings (key, value)
values (
  'inventory.notice_people',
  '["6249d52a-605a-4caa-a0bf-99cd1b083cf3"]'::jsonb
)
on conflict (key) do nothing;

alter table public.notification_inbox
  add column if not exists in_digest boolean not null default false,
  add column if not exists digested_at timestamptz;

comment on column public.notification_inbox.in_digest is
  'Filed for an owner instead of being pushed: listed in their next daily summary.';
comment on column public.notification_inbox.digested_at is
  'When the daily summary that listed it was sent.';

create index if not exists notification_inbox_digest_pending
  on public.notification_inbox (user_id)
  where in_digest and digested_at is null;

-- Like record_inbox_notification, but filed read and waiting for the summary.
create or replace function public.record_inbox_digest(
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
  insert into public.notification_inbox (user_id, tag, title, body, url, level, read_at, in_digest)
  select p.id, p_tag, left(p_title, 200), left(coalesce(p_body, ''), 1000), p_url, p_level, now(), true
    from public.profiles p
   where p.id = any (p_user_ids)
     and p.status = 'approved'
     and p.deleted_at is null
  on conflict (user_id, dedupe_key) do nothing;
end;
$$;

revoke all on function public.record_inbox_digest(uuid[], text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.record_inbox_digest(uuid[], text, text, text, text, text)
  to service_role;

update public.notification_inbox
   set read_at = now()
 where read_at is null
   and created_at < now() - interval '7 days';
