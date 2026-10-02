-- Who asks Marketing (decided 2026-10-02): Marketing, Sales, managers, power
-- users, Admin and Owners — not plain Users (the floor) nor the Production
-- manager.
create or replace function public.can_request_marketing()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
     where p.id = (select auth.uid()) and p.status = 'approved'
       and (p.team in ('marketing', 'sales') or p.role in ('admin', 'owner', 'manager', 'power_user'))
  );
$$;

revoke all on function public.can_request_marketing() from public, anon;
grant execute on function public.can_request_marketing() to authenticated;

drop policy "marketing_requests: ask" on public.marketing_requests;
create policy "marketing_requests: ask" on public.marketing_requests for insert to authenticated
  with check ((select public.can_request_marketing()) and requested_by = (select auth.uid()) and status = 'new' and post_id is null);
