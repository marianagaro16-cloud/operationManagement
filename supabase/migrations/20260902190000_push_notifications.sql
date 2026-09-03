-- ============================================================
-- Web Push notifications.
--
-- Lets the app reach the floor team when nobody has it open. Two tables:
-- one for the browser subscriptions, one recording what has already been
-- sent so an alert cannot fire on every cron tick.
-- ============================================================

-- ---------- subscriptions ----------
-- One row per browser/device, not per user: the same person may have the
-- PWA installed on a phone and a warehouse tablet and should be reached on
-- both.
create table public.push_subscriptions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles (id) on delete cascade,
  -- The push service URL. Unique because re-subscribing the same browser
  -- returns the same endpoint, and duplicates would send twice.
  endpoint      text not null unique,
  -- Encryption material from PushSubscription.getKey().
  p256dh        text not null,
  auth          text not null,
  user_agent    text,
  -- Consecutive delivery failures. A subscription that keeps failing has
  -- been revoked by the browser and is pruned.
  failure_count int not null default 0,
  last_used_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index push_subscriptions_user_idx on public.push_subscriptions (user_id);

create trigger push_subscriptions_set_updated_at before update on public.push_subscriptions
  for each row execute function public.set_updated_at();

-- ---------- what has already been sent ----------
-- An order escalates overdue <- critical <- warning. Recording the level
-- means each escalation notifies once, rather than every time the scheduler
-- runs. A NEW level for the same order is a genuine escalation and does
-- notify again.
create table public.order_notifications (
  id         uuid primary key default gen_random_uuid(),
  order_id   uuid not null references public.orders (id) on delete cascade,
  level      text not null check (level in ('warning', 'critical', 'overdue')),
  sent_at    timestamptz not null default now(),
  recipients int not null default 0,

  constraint order_notifications_once_per_level unique (order_id, level)
);

create index order_notifications_order_idx on public.order_notifications (order_id);

-- ============================================================
-- Row Level Security
-- ============================================================
alter table public.push_subscriptions   enable row level security;
alter table public.order_notifications  enable row level security;

-- A subscription is personal: you manage your own devices, nobody else's.
-- Admins deliberately get no read access — an endpoint is a capability URL
-- for pushing to someone's device, not team data.
create policy "push: read own" on public.push_subscriptions
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy "push: insert own" on public.push_subscriptions
  for insert to authenticated
  with check (public.is_approved() and user_id = (select auth.uid()));

create policy "push: update own" on public.push_subscriptions
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "push: delete own" on public.push_subscriptions
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- The send log is operational history; admins can inspect it.
create policy "order_notifications: admin reads" on public.order_notifications
  for select to authenticated
  using (public.is_admin());

comment on table public.push_subscriptions is
  'Browser push endpoints, one per device. Written by the owning user only; read server-side with the service role when sending.';
comment on table public.order_notifications is
  'Dedupe log: one row per (order, urgency level) so an escalation notifies once.';
