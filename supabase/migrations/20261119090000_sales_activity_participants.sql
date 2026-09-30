-- ============================================================
-- Sales: other people from the company on a call, a visit, an appointment…
--
--   sales_activity_participants   who else takes part: people in sales
--                                 (the Ventas team, Admin, Owners). The
--                                 activity shows in their Planning too.
--
-- The organiser — the activity's salesperson — records the result, once,
-- for everyone. The organiser and managers change or move it; a participant
-- sees it read-only and can take themselves off it.
-- ============================================================

create table public.sales_activity_participants (
  activity_id uuid not null references public.sales_activities (id) on delete cascade,
  profile_id  uuid not null references public.profiles (id) on delete cascade,
  added_by    uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  primary key (activity_id, profile_id)
);

create index sales_activity_participants_profile_idx on public.sales_activity_participants (profile_id);

/* The organiser, or a manager: Admin, Owners, Managers, Power Users. */
create or replace function public.sales_can_change(p_salesperson_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_sales()
     and (
       p_salesperson_id = (select auth.uid())
       or exists (
         select 1 from public.profiles p
          where p.id = (select auth.uid()) and p.status = 'approved'
            and p.role in ('admin', 'owner', 'manager', 'power_user')
       )
     );
$$;

revoke all on function public.sales_can_change(uuid) from public, anon;
grant execute on function public.sales_can_change(uuid) to authenticated;

/* A participant is someone in sales, and not the organiser. */
create or replace function public.guard_sales_participant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.profiles p
     where p.id = new.profile_id and p.status = 'approved'
       and (p.team = 'sales' or p.role in ('admin', 'owner'))
  ) then
    raise exception 'participant_not_sales' using errcode = '22023';
  end if;
  if exists (select 1 from public.sales_activities a where a.id = new.activity_id and a.salesperson_id = new.profile_id) then
    raise exception 'participant_is_organiser' using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger sales_activity_participants_guard
  before insert or update on public.sales_activity_participants
  for each row execute function public.guard_sales_participant();

alter table public.sales_activity_participants enable row level security;

create policy "sales_activity_participants: sales read" on public.sales_activity_participants
  for select to authenticated using ((select public.is_sales()));
create policy "sales_activity_participants: organiser adds" on public.sales_activity_participants
  for insert to authenticated
  with check (public.sales_can_change((select a.salesperson_id from public.sales_activities a where a.id = activity_id)));
-- The organiser or a manager takes someone off; anyone takes themselves off.
create policy "sales_activity_participants: remove" on public.sales_activity_participants
  for delete to authenticated
  using (
    ((select public.is_sales()) and profile_id = (select auth.uid()))
    or public.sales_can_change((select a.salesperson_id from public.sales_activities a where a.id = activity_id))
  );

-- ---------- only the organiser and managers change an activity ----------

drop policy "sales_activities: sales change" on public.sales_activities;
create policy "sales_activities: organiser changes" on public.sales_activities
  for update to authenticated
  using (public.sales_can_change(salesperson_id))
  with check ((select public.is_sales()));

drop policy "sales_activities: remove planned" on public.sales_activities;
create policy "sales_activities: organiser removes planned" on public.sales_activities
  for delete to authenticated
  using (public.sales_can_change(salesperson_id) and status = 'planned');
