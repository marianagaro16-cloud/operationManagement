-- ============================================================
-- An admin can delete a user
--
-- Deleting the login is the point: the person can no longer sign in, and the
-- account disappears from the user list and from every picker.
--
-- Deleting the PROFILE is not. Their name is on lots they prepared, orders
-- they shipped, inventories they counted, incidents they closed — the
-- traceability the operation keeps for inspections. Most of those columns are
-- ON DELETE SET NULL, so a cascading delete would quietly turn "prepared by
-- Carlos" into "prepared by —", and task/inventory comments would vanish
-- outright. So the profile stays behind, marked deleted, and keeps its name.
--
-- That needs the profile to outlive its auth.users row, hence the dropped FK.
-- ============================================================

alter table public.profiles
  add column if not exists deleted_at timestamptz;

comment on column public.profiles.deleted_at is
  'Set when an admin deleted the user. The login is gone; the profile stays so history keeps showing who did what.';

alter table public.profiles
  drop constraint if exists profiles_id_fkey;

create or replace function public.admin_delete_user(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target public.profiles;
begin
  if not public.has_permission('users.manage') then
    raise exception 'not_authorized';
  end if;
  if p_user_id = (select auth.uid()) then
    raise exception 'cannot_delete_self';
  end if;

  select * into v_target from public.profiles where id = p_user_id for update;
  if not found or v_target.deleted_at is not null then
    raise exception 'user_not_found';
  end if;

  if v_target.role = 'admin' and v_target.status = 'approved'
     and (select count(*) from public.profiles
           where role = 'admin' and status = 'approved' and deleted_at is null) <= 1 then
    raise exception 'last_admin';
  end if;

  -- Nothing may keep reaching a person who is gone: no pushes, no standing
  -- assignments, no private lists nobody else can see.
  delete from public.push_subscriptions          where user_id = p_user_id;
  delete from public.inventory_template_assignees where user_id = p_user_id;
  delete from public.goods_reception_assignees    where user_id = p_user_id;
  delete from public.personal_tasks              where owner_id = p_user_id;
  delete from public.inventory_assignments a
   using public.inventory_instances i
   where a.instance_id = i.id and a.user_id = p_user_id and i.completed_at is null;

  update public.profiles
     set status = 'deactivated',
         deleted_at = now()
   where id = p_user_id;

  insert into public.security_audit_log (actor_id, target_user_id, action, previous_value, new_value)
  values ((select auth.uid()), p_user_id, 'user_deleted',
          jsonb_build_object('email', v_target.email, 'role', v_target.role, 'status', v_target.status),
          null);

  -- The login itself: sessions, identities and factors cascade from here.
  delete from auth.users where id = p_user_id;
end;
$$;

revoke all on function public.admin_delete_user(uuid) from public, anon;
grant execute on function public.admin_delete_user(uuid) to authenticated;
