-- ============================================================
-- The inbox keeps every notification
--
-- The inbox exists so a person can see again what reached them, after the
-- notification itself is gone from the phone. Replacing an entry that shares
-- a tag — the phone tray's behaviour, which the first version copied — works
-- against that: an order escalating warning -> critical -> overdue kept only
-- the last text, and the earlier ones disappeared.
--
-- So each notification is now its own entry. The only thing still collapsed
-- is an exact repeat — same tag, same title, same body — which is what a
-- scheduler retry produces, and which must neither duplicate an entry nor
-- mark a read one unread again.
-- ============================================================

alter table public.notification_inbox
  add column if not exists dedupe_key text
  generated always as (md5(tag || chr(31) || title || chr(31) || body)) stored;

alter table public.notification_inbox
  drop constraint if exists notification_inbox_user_id_tag_key;

alter table public.notification_inbox
  drop constraint if exists notification_inbox_user_id_dedupe_key_key;
alter table public.notification_inbox
  add constraint notification_inbox_user_id_dedupe_key_key unique (user_id, dedupe_key);

comment on table public.notification_inbox is
  'Every notification sent, per recipient. Readable only by that recipient. Each notification is its own entry; only an exact repeat (same tag, title and body) is collapsed.';

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
  insert into public.notification_inbox (user_id, tag, title, body, url, level)
  select p.id, p_tag, left(p_title, 200), left(coalesce(p_body, ''), 1000), p_url, p_level
    from public.profiles p
   where p.id = any (p_user_ids)
     and p.status = 'approved'
     and p.deleted_at is null
  on conflict (user_id, dedupe_key) do nothing;

  delete from public.notification_inbox
   where user_id = any (p_user_ids)
     and created_at < now() - interval '60 days';
end;
$$;

revoke all on function public.record_inbox_notification(uuid[], text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.record_inbox_notification(uuid[], text, text, text, text, text)
  to service_role;
