-- ============================================================
-- Schedule the delivery notifier from inside Postgres.
--
-- Vercel's Hobby plan runs cron jobs at most once a day, which is useless for
-- a 2-hour urgency window. pg_cron + pg_net call /api/cron/notify on a real
-- cadence, at no cost, from the database we already pay nothing for.
--
-- This is an ALTERNATIVE to .github/workflows/notify.yml -- pick one. Running
-- both is harmless (each (order, level) is claimed before sending, so an
-- alert cannot fire twice) but it doubles the traffic for nothing.
--
-- The URL and the bearer token are deliberately NOT in this file. They live
-- in Supabase Vault, so the migration stays committable and the token never
-- appears in `cron.job.command`, which is readable by anyone with cron access.
--
-- After applying, create the two secrets once, in the SQL editor:
--
--   select vault.create_secret('https://your-app.vercel.app', 'app_url');
--   select vault.create_secret('<the CRON_SECRET set in Vercel>', 'cron_secret');
--
-- Until those exist the job runs and no-ops with a notice, rather than
-- failing every 15 minutes.
-- ============================================================

-- pg_cron owns the schedule; pg_net makes the outbound HTTP call. Both are
-- free on every Supabase tier. pg_net installs into `extensions` but exposes
-- its functions in the `net` namespace.
create extension if not exists pg_cron;
create extension if not exists pg_net with schema "extensions";

-- pg_cron creates its own `cron` schema. When the platform enabled the
-- extension rather than this role, the grants are already in place and
-- re-granting is refused -- not a reason to stop a migration.
do $$
begin
  grant usage on schema cron to postgres;
  grant all privileges on all tables in schema cron to postgres;
exception
  when insufficient_privilege then
    raise notice 'cron grants skipped: already managed by the platform';
end;
$$;

-- ---------- where the job's helper lives ----------
-- `private` is deliberately outside the schemas exposed by the Data API (see
-- supabase/config.toml), so none of this can be reached as an RPC by a logged
-- in user -- only by the scheduler.
create schema if not exists private;
revoke all on schema private from anon, authenticated;

-- ---------- what was dispatched ----------
-- pg_net is asynchronous: it returns a request id and the response arrives
-- later in net._http_response. Keeping the id makes "did the 08:15 run
-- actually reach the app?" an exact join instead of a guess by timestamp.
create table if not exists private.notification_dispatch (
  request_id    bigint primary key,
  dispatched_at timestamptz not null default now()
);

create or replace function private.notify_deliveries()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  base_url   text;
  secret     text;
  req_id     bigint;
begin
  select decrypted_secret into base_url
    from vault.decrypted_secrets where name = 'app_url';
  select decrypted_secret into secret
    from vault.decrypted_secrets where name = 'cron_secret';

  -- Skip quietly rather than raising: a missing secret is a setup step that
  -- has not happened yet, not a broken database. An exception here would
  -- fill cron.job_run_details with failures every 15 minutes and bury a real
  -- one when it appears.
  if base_url is null or secret is null then
    raise notice 'delivery notifier skipped: set the app_url and cron_secret vault secrets';
    return;
  end if;

  select net.http_get(
    url     => rtrim(base_url, '/') || '/api/cron/notify',
    headers => jsonb_build_object('Authorization', 'Bearer ' || secret),
    -- A cold serverless start takes several seconds; pg_net's 2s default
    -- would time out on exactly the runs that matter. The endpoint is
    -- idempotent, so a timed-out call is retried by the next tick for free.
    timeout_milliseconds => 30000
  ) into req_id;

  insert into private.notification_dispatch (request_id) values (req_id);

  -- pg_net drops its own responses after a few hours, so anything older than
  -- this can no longer be joined to and is only taking up space.
  delete from private.notification_dispatch
    where dispatched_at < now() - interval '3 days';
end;
$$;

revoke all on function private.notify_deliveries() from public;

-- ---------- seeing what happened ----------
-- `select * from private.notification_runs limit 20;` answers "is the
-- scheduler working?" without joining two extensions' internals by hand.
-- A null status_code means either the response has not arrived yet or pg_net
-- has already pruned it.
create or replace view private.notification_runs as
  select
    d.request_id,
    d.dispatched_at,
    r.status_code,
    r.error_msg,
    r.content as response
  from private.notification_dispatch d
  left join net._http_response r on r.id = d.request_id
  order by d.dispatched_at desc;

-- ---------- the schedule ----------
-- Every 15 minutes, 05:00-20:00 UTC -- roughly 06:00-22:00 in Zurich all year,
-- so a late-evening deadline still alerts while the job stays quiet overnight.
-- pg_cron on Supabase runs in UTC.
--
-- Unschedule first so re-applying this migration replaces the job instead of
-- erroring on the duplicate name.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'delivery-notifications') then
    perform cron.unschedule('delivery-notifications');
  end if;

  perform cron.schedule(
    'delivery-notifications',
    '*/15 5-20 * * *',
    $job$select private.notify_deliveries();$job$
  );
end;
$$;
