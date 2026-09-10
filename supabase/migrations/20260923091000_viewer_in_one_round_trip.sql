-- ============================================================
-- The viewer, in one round trip instead of two
--
-- MEASURED. Every authenticated page resolves the caller before it fetches
-- anything, and that resolution is strictly sequential:
--
--   middleware auth.getUser()   ~70 ms   (verifies the JWT with Supabase Auth)
--   getProfile  auth.getUser()  ~70 ms   (again — a different runtime, so
--                                          React cache() cannot span it)
--   getProfile  select profiles ~64 ms
--   getViewer   select role_permissions ~67 ms
--                               -------
--                               ~270 ms before the page's own data starts
--
-- The last two are one question — "who is this and what may they do" — asked
-- as two round trips. This function answers it in one, halving that half of
-- the waterfall.
--
-- SECURITY INVOKER, deliberately. It reads the caller's own profile and the
-- permissions of the caller's own role, both of which RLS already lets them
-- read; making it DEFINER would hand it privileges it does not need to do
-- exactly the same work. The rule stays where it was.
--
-- The two auth.getUser() calls are NOT touched. Each verifies the JWT against
-- the auth server, and collapsing them would mean trusting a token this
-- process has not verified — a performance change is not worth becoming the
-- one place the session is taken on faith.
-- ============================================================

create or replace function public.get_viewer()
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'profile', to_jsonb(p),
    -- Empty for an admin: has_permission() short-circuits on is_admin(), so
    -- an admin's access never depended on these rows and the UI mirror says
    -- the same by treating 'admin' as holding everything.
    'permissions', coalesce(
      (select jsonb_agg(rp.permission)
         from public.role_permissions rp
        where rp.role = p.role),
      '[]'::jsonb
    )
  )
  from public.profiles p
  where p.id = (select auth.uid());
$$;

comment on function public.get_viewer() is
  'The caller profile plus the permissions of their role, in one round trip. Invoker rights: reads only what RLS already permits.';

revoke all on function public.get_viewer() from public, anon;
grant execute on function public.get_viewer() to authenticated;
