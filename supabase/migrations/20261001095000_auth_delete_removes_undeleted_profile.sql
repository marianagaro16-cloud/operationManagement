-- ============================================================
-- A login removed outside admin_delete_user still takes its profile with it
--
-- The previous migration dropped profiles -> auth.users ON DELETE CASCADE so a
-- deleted user's profile can stay behind for history. But logins are also
-- removed elsewhere — the verify scripts' throwaway accounts, the Supabase
-- dashboard — and those would now leave an approved profile with no login in
-- the user list.
--
-- So the cascade comes back for exactly those: a profile NOT marked deleted
-- goes with its login, as before. admin_delete_user marks the profile first,
-- which is what lets it survive.
-- ============================================================

create or replace function public.handle_deleted_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.profiles where id = old.id and deleted_at is null;
  return old;
end;
$$;

drop trigger if exists on_auth_user_deleted on auth.users;
create trigger on_auth_user_deleted
  after delete on auth.users
  for each row execute function public.handle_deleted_auth_user();
