-- ============================================================
-- Let a second person enable notifications on a shared device.
--
-- A push endpoint identifies the BROWSER, not the person. On a shared phone
-- or a warehouse tablet the endpoint is the same whoever is signed in, and
-- `endpoint` is UNIQUE — so the second user's upsert landed on the first
-- user's row and was refused by the UPDATE policy:
--
--   ERROR: new row violates row-level security policy (USING expression)
--          for table "push_subscriptions"
--
-- The person saw "nothing happened" and had no way to fix it. On a shared
-- device that is the normal case, not an edge case.
--
-- Ownership must therefore transfer to whoever is signed in now. RLS cannot
-- express that -- deleting another user's row is exactly what the policies
-- exist to prevent -- so it happens in one SECURITY DEFINER function instead
-- of by loosening the policies.
--
-- This does not widen what anyone can see. Reading endpoints is still
-- restricted to their owner, and claiming one requires already holding it:
-- the browser only hands its endpoint to the page it belongs to. A caller
-- who guessed someone else's endpoint could unsubscribe that device, but a
-- push endpoint is a long unguessable capability URL that RLS never
-- discloses in the first place.
-- ============================================================

create or replace function public.claim_push_subscription(
  p_endpoint   text,
  p_p256dh     text,
  p_auth       text,
  p_user_agent text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
begin
  if uid is null then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  -- Mirrors the INSERT policy: a pending or rejected account cannot register
  -- a device just by calling this directly.
  if not public.is_approved() then
    raise exception 'not_approved' using errcode = '42501';
  end if;

  -- Replace rather than update: the previous owner's encryption keys are
  -- meaningless for the new subscription, and a stale failure_count would
  -- carry a dead device's history onto a working one.
  delete from public.push_subscriptions where endpoint = p_endpoint;

  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent, failure_count)
  values (uid, p_endpoint, p_p256dh, p_auth, p_user_agent, 0);
end;
$$;

-- SECURITY DEFINER runs as the owner, so the grant is the entire boundary:
-- signed-in users only, never anon.
revoke all on function public.claim_push_subscription(text, text, text, text) from public, anon;
grant execute on function public.claim_push_subscription(text, text, text, text) to authenticated;

comment on function public.claim_push_subscription(text, text, text, text) is
  'Registers the calling user''s browser for push, taking the endpoint over from a previous user of the same device.';
