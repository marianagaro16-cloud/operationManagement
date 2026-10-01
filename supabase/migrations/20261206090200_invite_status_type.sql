-- The status is an enum: the invited/pending choice must be cast to it.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invite public.account_invites%rowtype;
begin
  select * into v_invite from public.account_invites
   where email = lower(btrim(new.email)) and used_at is null;

  insert into public.profiles (id, email, name, status, role, team)
  values (
    new.id,
    new.email,
    coalesce(nullif(trim(coalesce(new.raw_user_meta_data ->> 'name', '')), ''), v_invite.name),
    (case when v_invite.email is null then 'pending' else 'approved' end)::public.user_status,
    coalesce(v_invite.role, 'user'::public.user_role),
    coalesce(v_invite.team, 'operations'::public.team)
  )
  on conflict (id) do nothing;

  if v_invite.email is not null then
    update public.account_invites set used_at = now() where email = v_invite.email;
  end if;
  return new;
end;
$$;
