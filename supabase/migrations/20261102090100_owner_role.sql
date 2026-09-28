-- ============================================================
-- What an Owner is.
--
-- Everything an Admin is — is_admin() is true for them, so every policy,
-- permission check and admin-only action already includes them — plus:
--
--   * Only an Owner changes an Owner: their role, status, team or account,
--     deleting them, or making someone an Owner. An Admin cannot touch them.
--   * An Owner's Human Resources file is seen by nobody.
-- ============================================================

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid())
      and p.role in ('admin', 'owner')
      and p.status = 'approved'
  );
$$;

create or replace function public.is_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid())
      and p.role = 'owner'
      and p.status = 'approved'
  );
$$;

revoke all on function public.is_owner() from public, anon;
grant execute on function public.is_owner() to authenticated;

create or replace function public.role_rank(r public.user_role)
returns integer
language sql
immutable
as $$
  select case r
    when 'owner'              then 5
    when 'admin'              then 4
    when 'manager'            then 3
    -- Beside the Power User: both run the day without changing its setup.
    -- The rank only opens the Gestión area; what is inside is permissions.
    when 'power_user'         then 2
    when 'production_manager' then 2
    when 'user'               then 1
  end;
$$;

-- ---------- only an Owner changes an Owner ----------

create or replace function public.guard_owner_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- The system (no signed-in caller) and Owners themselves pass.
  if (select auth.uid()) is null or public.is_owner() then
    return new;
  end if;
  if old.role = 'owner' or new.role = 'owner' then
    raise exception 'owner_protected' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger profiles_guard_owner
  before update on public.profiles
  for each row execute function public.guard_owner_profile();

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

  if v_target.role = 'owner' and not public.is_owner() then
    raise exception 'owner_protected';
  end if;

  -- Somebody must still be able to run the system: an Admin or an Owner.
  if v_target.role in ('admin', 'owner') and v_target.status = 'approved'
     and (select count(*) from public.profiles
           where role in ('admin', 'owner') and status = 'approved' and deleted_at is null) <= 1 then
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

-- ---------- an Owner's file is seen by nobody ----------

/* Is this account an Owner's? Files linked to one are hidden from everyone. */
create or replace function public.is_owner_account(p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.profiles p where p.id = p_profile_id and p.role = 'owner');
$$;

revoke all on function public.is_owner_account(uuid) from public, anon;
grant execute on function public.is_owner_account(uuid) to authenticated;

create or replace function public.hr_can_worker(p_worker_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.hr_workers w
     where w.id = p_worker_id
       and public.hr_can(w.team)
       and w.profile_id is distinct from (select auth.uid())
       and not public.is_owner_account(w.profile_id)
  );
$$;

drop policy if exists "hr_workers: read" on public.hr_workers;
create policy "hr_workers: read" on public.hr_workers
  for select to authenticated
  using (public.hr_can(team) and profile_id is distinct from (select auth.uid())
         and not public.is_owner_account(profile_id));

drop policy if exists "hr_workers: insert" on public.hr_workers;
create policy "hr_workers: insert" on public.hr_workers
  for insert to authenticated
  with check (public.hr_can(team) and profile_id is distinct from (select auth.uid())
              and not public.is_owner_account(profile_id));

drop policy if exists "hr_workers: update" on public.hr_workers;
create policy "hr_workers: update" on public.hr_workers
  for update to authenticated
  using (public.hr_can(team) and profile_id is distinct from (select auth.uid())
         and not public.is_owner_account(profile_id))
  with check (public.hr_can(team) and profile_id is distinct from (select auth.uid())
              and not public.is_owner_account(profile_id));

/* Sending or managing an evaluation of an Owner is refused too: their file is nobody's. */
create or replace function public.hr_is_self(p_worker_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.hr_workers w
     where w.id = p_worker_id
       and (w.profile_id = (select auth.uid()) or public.is_owner_account(w.profile_id))
  );
$$;
