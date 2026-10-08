-- ============================================================
-- A REQUEST TO MARKETING ASKED BY SEVERAL PEOPLE
--
-- The short-expiry request made after an inventory is asked by Daniela,
-- Mariana and Carlos together (decided 2026-10-08): each of them sees it, is
-- named on it and hears Marketing's replies. requested_by stays the first;
-- the others are kept here, and count as having asked everywhere a rule says
-- "whoever asked".
-- ============================================================

create table public.marketing_request_requesters (
  request_id uuid not null references public.marketing_requests (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  added_at   timestamptz not null default now(),
  primary key (request_id, profile_id)
);
create index marketing_request_requesters_profile_idx on public.marketing_request_requesters (profile_id);

/* Did the caller ask for this request — alone or with others? */
create or replace function public.asked_marketing_request(p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.marketing_requests r where r.id = p_id and r.requested_by = (select auth.uid()))
      or exists (select 1 from public.marketing_request_requesters c where c.request_id = p_id and c.profile_id = (select auth.uid()));
$$;

revoke all on function public.asked_marketing_request(uuid) from public, anon;
grant execute on function public.asked_marketing_request(uuid) to authenticated;

create or replace function public.can_see_marketing_request(p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_approved() and (public.can_edit_marketing() or public.asked_marketing_request(p_id));
$$;

-- requested_by first, on the row itself, so a new request can still be read back as it is added.
drop policy "marketing_requests: read" on public.marketing_requests;
create policy "marketing_requests: read" on public.marketing_requests for select to authenticated
  using ((select public.is_approved()) and (requested_by = (select auth.uid()) or (select public.can_edit_marketing()) or public.asked_marketing_request(id)));

drop policy "marketing_requests: change" on public.marketing_requests;
create policy "marketing_requests: change" on public.marketing_requests for update to authenticated
  using ((select public.is_approved()) and (requested_by = (select auth.uid()) or (select public.can_edit_marketing()) or public.asked_marketing_request(id)))
  with check ((select public.is_approved()));

alter table public.marketing_request_requesters enable row level security;
-- Read by whoever sees the request. Written by the system only: no insert, update or delete policy.
create policy "marketing_request_requesters: read" on public.marketing_request_requesters for select to authenticated
  using (public.can_see_marketing_request(request_id));
grant select on public.marketing_request_requesters to authenticated;

-- The short-expiry request: asked by Daniela, Mariana and Carlos, in that order.
update public.app_settings
   set value = '["59538c6a-4a6f-48d3-bde3-5481d98ccc47", "6249d52a-605a-4caa-a0bf-99cd1b083cf3", "ff082990-c327-4e55-bb6e-6a2237ce55a2"]'::jsonb
 where key = 'inventory.short_expiry_requester';

-- …and the one already made today.
insert into public.marketing_request_requesters (request_id, profile_id)
select r.id, p.id
  from public.marketing_requests r
  cross join public.profiles p
 where r.id = 'df7caed1-707f-484c-b202-088fec8f1cb2'
   and p.id in ('6249d52a-605a-4caa-a0bf-99cd1b083cf3', 'ff082990-c327-4e55-bb6e-6a2237ce55a2')
on conflict do nothing;
