-- Marketing organises meetings too (decided 2026-10-01): Sales, managers
-- (manager, power user, production manager), Admin, Owners — and Marketing.
create or replace function public.can_organize_meetings()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_sales() or public.is_marketing() or exists (
    select 1 from public.profiles p
     where p.id = (select auth.uid()) and p.status = 'approved'
       and p.role in ('admin', 'owner', 'manager', 'power_user', 'production_manager')
  );
$$;
