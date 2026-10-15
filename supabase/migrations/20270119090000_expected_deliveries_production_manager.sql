-- ============================================================
-- Expected deliveries: the Production manager announces them too.
-- Until now only the office (Admin, Owners, Power User) entered, changed
-- and cancelled them; the Production manager only read them as a
-- receiver. Still by role, not by goods_reception.manage_all.
-- ============================================================

create or replace function public.can_manage_expected_deliveries()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin()
      or exists (
        select 1 from public.profiles p
         where p.id = (select auth.uid())
           and p.status = 'approved'
           and p.deleted_at is null
           and p.role in ('power_user', 'production_manager')
      );
$$;
