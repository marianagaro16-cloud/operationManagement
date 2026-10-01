-- ============================================================
-- Marketing, and an external account (decided 2026-10-01).
--
-- Tona runs the company's marketing from outside it. As a plain User of the
-- Marketing team he sees his own day, every event (adding notes and photos),
-- and products and customers — and none of the operation: orders, inventory,
-- goods reception, incidents, lots, absences and cover, sales notes, event
-- budgets. Those are refused here, by RESTRICTIVE policies that sit on top of
-- every existing rule, so no screen or query can reach them.
--
-- Accounts can be invited by email: whoever signs up with an invited address
-- is approved straight away with the role and team of the invitation.
-- ============================================================

-- ---------- who ----------

create or replace function public.is_marketing()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
     where p.id = (select auth.uid()) and p.status = 'approved' and p.team = 'marketing'
  );
$$;

/* A Marketing User: the external account. Admin and Owners are never external. */
create or replace function public.is_external()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
     where p.id = (select auth.uid()) and p.status = 'approved' and p.team = 'marketing' and p.role = 'user'
  );
$$;

revoke all on function public.is_marketing() from public, anon;
revoke all on function public.is_external() from public, anon;
grant execute on function public.is_marketing() to authenticated;
grant execute on function public.is_external() to authenticated;

-- ---------- the operation, closed to the external account ----------

do $$
declare
  t text;
begin
  foreach t in array array[
    'absence_approvers', 'absence_events', 'absence_needs_cover', 'absences',
    'coverage_assignments', 'coverage_events', 'coverage_notices', 'coverage_permission_grants',
    'customer_notes', 'customer_specifications',
    'goods_reception_assignees', 'goods_reception_audit_log', 'goods_reception_evidence',
    'goods_reception_exceptions', 'goods_reception_report_snapshots', 'goods_receptions',
    'handover_events', 'handover_items', 'handover_sends',
    'incident_affected_items', 'incident_audit_log', 'incident_evidence', 'incident_replacements',
    'incident_report_snapshots', 'incident_secondary_causes', 'incidents',
    'inventory_assignments', 'inventory_audit_log', 'inventory_comments', 'inventory_digital_history',
    'inventory_edit_grants', 'inventory_entries', 'inventory_instance_items', 'inventory_instances',
    'inventory_notifications', 'inventory_resolutions', 'inventory_template_assignees',
    'inventory_template_items', 'inventory_templates',
    'lot_allocations',
    'order_audit_log', 'order_boxes', 'order_lines', 'order_notifications', 'order_request_templates', 'orders',
    'recurring_order_template_lines', 'recurring_order_templates',
    'suppliers', 'transporters',
    'event_costs',
    'user_presence'
  ]
  loop
    execute format(
      'create policy "not for external accounts" on public.%I as restrictive for all to authenticated
         using (not (select public.is_external())) with check (not (select public.is_external()))',
      t
    );
  end loop;
end;
$$;

-- ---------- events: Marketing reads them all, adds notes and photos ----------

create policy "event_kinds: marketing read" on public.event_kinds for select to authenticated using ((select public.is_marketing()));
create policy "event_kind_tasks: marketing read" on public.event_kind_tasks for select to authenticated using ((select public.is_marketing()));
create policy "events: marketing read" on public.events for select to authenticated using ((select public.is_marketing()));
create policy "event_shifts: marketing read" on public.event_shifts for select to authenticated using ((select public.is_marketing()));
create policy "event_products: marketing read" on public.event_products for select to authenticated using ((select public.is_marketing()));
create policy "event_returns: marketing read" on public.event_returns for select to authenticated using ((select public.is_marketing()));

create policy "event_notes: marketing read" on public.event_notes for select to authenticated using ((select public.is_marketing()));
create policy "event_notes: marketing add" on public.event_notes for insert to authenticated
  with check ((select public.is_marketing()) and created_by = (select auth.uid()));

create policy "event_files: marketing read" on public.event_files for select to authenticated using ((select public.is_marketing()));
create policy "event_files: marketing add" on public.event_files for insert to authenticated
  with check ((select public.is_marketing()) and uploaded_by = (select auth.uid()));
create policy "event_files: marketing removes own" on public.event_files for delete to authenticated
  using ((select public.is_marketing()) and uploaded_by = (select auth.uid()));

create policy "event files: marketing read" on storage.objects for select to authenticated
  using (bucket_id = 'event-files' and (select public.is_marketing()));
create policy "event files: marketing upload" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'event-files'
    and (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$'
    and (select public.is_marketing())
  );
create policy "event files: marketing removes own" on storage.objects for delete to authenticated
  using (bucket_id = 'event-files' and (select public.is_marketing()) and owner = (select auth.uid()));

-- ---------- invitations ----------

create table public.account_invites (
  email      text primary key check (email = lower(btrim(email)) and email like '%@%'),
  role       public.user_role not null default 'user',
  team       public.team not null,
  name       text,
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  used_at    timestamptz
);

alter table public.account_invites enable row level security;
create policy "account_invites: admin all" on public.account_invites for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
grant select, insert, update, delete on public.account_invites to authenticated;

/* A new account: pending — unless its address was invited, then approved as invited. */
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
    case when v_invite.email is null then 'pending' else 'approved' end,
    coalesce(v_invite.role, 'user'),
    coalesce(v_invite.team, 'operations')
  )
  on conflict (id) do nothing;

  if v_invite.email is not null then
    update public.account_invites set used_at = now() where email = v_invite.email;
  end if;
  return new;
end;
$$;

-- Tona: marketing, from outside the company. Signs up himself.
insert into public.account_invites (email, role, team, name)
values ('tona@colectivoanonimo.ch', 'user', 'marketing', 'Tona')
on conflict (email) do nothing;
