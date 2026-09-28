-- ============================================================
-- An Admin resets a password; the person chooses a new one.
--
-- There was no way back into a forgotten account. Now an Admin or an Owner
-- gives the person a temporary password the app generates, and until they
-- choose their own, the app shows them nothing else.
--
--   profiles.must_change_password  set by a reset, cleared when they choose.
--   request_password_reset()        who may reset whom — users.manage, never
--                                   their own account, and an Owner's only by
--                                   an Owner — marks the account and records
--                                   it. The password itself is set by the
--                                   server with the service role, after this
--                                   has said yes.
-- ============================================================

alter table public.profiles
  add column must_change_password boolean not null default false;

comment on column public.profiles.must_change_password is
  'Set when an admin reset the password; the app asks for a new one before anything else.';

create or replace function public.request_password_reset(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target public.profiles;
begin
  if not public.has_permission('users.manage') then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if p_user_id = (select auth.uid()) then
    raise exception 'cannot_reset_self' using errcode = '42501';
  end if;

  select * into v_target from public.profiles where id = p_user_id;
  if not found or v_target.deleted_at is not null then
    raise exception 'user_not_found' using errcode = 'P0002';
  end if;
  if v_target.role = 'owner' and not public.is_owner() then
    raise exception 'owner_protected' using errcode = '42501';
  end if;

  update public.profiles set must_change_password = true where id = p_user_id;

  insert into public.security_audit_log (actor_id, target_user_id, action)
  values ((select auth.uid()), p_user_id, 'password_reset');
end;
$$;

revoke all on function public.request_password_reset(uuid) from public, anon;
grant execute on function public.request_password_reset(uuid) to authenticated;
