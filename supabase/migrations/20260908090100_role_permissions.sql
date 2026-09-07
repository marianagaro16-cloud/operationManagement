-- ============================================================
-- Four-role hierarchy, part 2 of 2: capabilities, policies, audit.
--
-- Requires 20260908090000_roles_enum.sql to have been applied FIRST, in its
-- own transaction. See the note at the top of that file.
--
-- THE LOAD-BEARING DECISION: is_admin() is not touched.
--
-- It keeps meaning exactly "role = 'admin' and status = 'approved'" at all of
-- its call sites, and becomes the SYSTEM-CONTROL predicate. Anything to do
-- with users, roles, permissions or configuration keeps calling it and is
-- therefore unreachable by any other role, permanently and structurally.
--
-- Operational access widens instead through has_permission(key), which
-- short-circuits on is_admin(). Consequence: until somebody is actually
-- promoted to manager or power_user, every policy in this file evaluates
-- exactly as it did before, for every existing account.
-- ============================================================


-- ============================================================
-- role rank
-- ============================================================
/*
 * The hierarchy as a number.
 *
 * A CASE, NOT the enum's ordinal position. `ALTER TYPE ... ADD VALUE` appends,
 * so the physical order of public.user_role is now
 * (admin, user, manager, power_user) — comparing enum values directly would
 * rank 'user' above 'manager', which is exactly backwards.
 */
create or replace function public.role_rank(r public.user_role)
returns int
language sql
immutable
as $$
  select case r
    when 'admin'      then 4
    when 'manager'    then 3
    when 'power_user' then 2
    when 'user'       then 1
  end;
$$;

comment on function public.role_rank(public.user_role) is
  'Hierarchy rank. Derived from the label, never from the enum ordinal, because ADD VALUE appends.';


-- ============================================================
-- permission catalog
-- ============================================================
/*
 * The vocabulary of operational capabilities. Seeded below and treated as
 * reference data — the app reads it to render the permission matrix, and the
 * FK from role_permissions makes a typo in a key impossible.
 *
 * is_configurable = false marks the ADMIN-ONLY capabilities. They are listed
 * here ONLY so the admin UI can show them as permanently locked. A row with
 * is_configurable = false can never appear in role_permissions — see the
 * trigger below — so cataloguing them cannot be used to grant them.
 */
create table public.permission_catalog (
  key             text primary key,
  module          text not null,
  is_configurable boolean not null default true,
  sort_order      int not null default 100
);

comment on table public.permission_catalog is
  'Reference list of capabilities. is_configurable = false means ADMIN-ONLY and ungrantable.';

insert into public.permission_catalog (key, module, is_configurable, sort_order) values
  -- ---- operational CONFIGURATION (the manager / power-user line) ----
  ('inventory.manage_templates',    'inventory', true,  10),
  ('tasks.manage_definitions',      'tasks',     true,  20),
  ('orders.manage_config',          'orders',    true,  30),
  ('products.change_code',          'products',  true,  40),

  -- ---- operational MANAGEMENT ----
  ('orders.manage',                 'orders',    true,  50),
  ('orders.correct_completed',      'orders',    true,  60),
  ('customers.manage',              'customers', true,  70),
  ('products.manage',               'products',  true,  80),
  ('inventory.manage_instances',    'inventory', true,  90),
  ('inventory.resolve_differences', 'inventory', true, 100),
  ('inventory.grant_temporary_edit','inventory', true, 110),
  ('tasks.manage_occurrences',      'tasks',     true, 120),
  ('reports.view',                  'reports',   true, 130),
  ('reports.export',                'reports',   true, 140),
  ('audit.view_operational',        'audit',     true, 150),

  -- ---- ADMIN-ONLY: catalogued so the UI can show them locked ----
  ('users.manage',                  'system',    false, 200),
  ('users.approve',                 'system',    false, 210),
  ('roles.assign',                  'system',    false, 220),
  ('permissions.configure',         'system',    false, 230),
  ('system.configure',              'system',    false, 240),
  ('audit.view_security',           'system',    false, 250);


-- ============================================================
-- the matrix
-- ============================================================
/*
 * Which non-admin role holds which capability. Presence of a row = granted.
 *
 * Two structural guarantees, deliberately not left to application code:
 *
 *   - the CHECK constrains the ROLE axis: only manager and power_user can
 *     appear. 'admin' is never a row because admin implies everything
 *     (has_permission short-circuits), and 'user' is never a row because user
 *     is the floor — a plain user keeps exactly the assignment-based access
 *     they have today and gains nothing configurable.
 *
 *   - the trigger constrains the PERMISSION axis: an admin-only capability
 *     cannot be inserted at all.
 *
 * Between them, "grant role-assignment to manager" is not a mistake an admin
 * can make through the UI, the API, or a hand-written SQL statement.
 */
create table public.role_permissions (
  role       public.user_role not null,
  permission text not null references public.permission_catalog (key) on delete cascade,
  granted_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now(),

  primary key (role, permission),

  constraint role_permissions_role_configurable
    check (role in ('manager', 'power_user'))
);

create index role_permissions_role_idx on public.role_permissions (role);

create or replace function public.role_permission_configurable()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1 from public.permission_catalog c
     where c.key = new.permission and c.is_configurable
  ) then
    raise exception 'permission_not_configurable' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger role_permissions_configurable
  before insert or update on public.role_permissions
  for each row execute function public.role_permission_configurable();


-- ---------- defaults ----------
-- MANAGER: operational configuration AND management — everything configurable.
insert into public.role_permissions (role, permission)
select 'manager', key from public.permission_catalog where is_configurable;

-- POWER USER: management only. The four configuration keys are withheld, and
-- that omission IS the Manager / Power User distinction.
insert into public.role_permissions (role, permission)
select 'power_user', key
  from public.permission_catalog
 where is_configurable
   and key not in (
     'inventory.manage_templates',
     'tasks.manage_definitions',
     'orders.manage_config',
     'products.change_code'
   );


-- ============================================================
-- the capability predicate
-- ============================================================
/*
 * The sibling of is_admin(), and the function every widened policy calls.
 *
 * SECURITY DEFINER for the same reason is_admin() is: it reads profiles and
 * role_permissions from inside the policies that protect those very tables.
 *
 * Admin short-circuits before the matrix is consulted, so an admin's access
 * can never be reduced by editing the matrix — including by an admin editing
 * their own role's rows, which the CHECK constraint already prevents.
 */
create or replace function public.has_permission(p_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin() or exists (
    select 1
      from public.profiles p
      join public.role_permissions rp on rp.role = p.role
     where p.id = (select auth.uid())
       and p.status = 'approved'
       and rp.permission = p_key
  );
$$;

comment on function public.has_permission(text) is
  'Operational capability check. True for any approved admin; otherwise looks the caller''s role up in role_permissions.';

create or replace function public.is_at_least(r public.user_role)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
     where p.id = (select auth.uid())
       and p.status = 'approved'
       and public.role_rank(p.role) >= public.role_rank(r)
  );
$$;

revoke all on function public.has_permission(text) from public;
revoke all on function public.is_at_least(public.user_role) from public;
grant execute on function public.has_permission(text) to authenticated;
grant execute on function public.is_at_least(public.user_role) to authenticated;


-- ============================================================
-- security audit log
-- ============================================================
/*
 * Role changes, status changes and permission-matrix edits.
 *
 * Kept separate from order_audit_log and inventory_audit_log on purpose: those
 * record OPERATIONAL history and the spec lets a manager read them. This one
 * records who was given power over the system, and stays admin-only.
 *
 * Shape copied from inventory_audit_log, which is the proven pattern here.
 */
create table public.security_audit_log (
  id             uuid primary key default gen_random_uuid(),
  actor_id       uuid references public.profiles (id) on delete set null,
  target_user_id uuid references public.profiles (id) on delete set null,
  action         text not null,
  previous_value jsonb,
  new_value      jsonb,
  created_at     timestamptz not null default now()
);

create index security_audit_created_idx on public.security_audit_log (created_at desc);
create index security_audit_target_idx  on public.security_audit_log (target_user_id, created_at desc);

create or replace function public.audit_profile_security()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.role is distinct from old.role then
    insert into public.security_audit_log
      (actor_id, target_user_id, action, previous_value, new_value)
    values (
      (select auth.uid()), new.id, 'role_changed',
      jsonb_build_object('role', old.role),
      jsonb_build_object('role', new.role)
    );
  end if;

  if new.status is distinct from old.status then
    insert into public.security_audit_log
      (actor_id, target_user_id, action, previous_value, new_value)
    values (
      (select auth.uid()), new.id, 'status_changed',
      jsonb_build_object('status', old.status),
      jsonb_build_object('status', new.status)
    );
  end if;

  return new;
end;
$$;

create trigger profiles_security_audit
  after update on public.profiles
  for each row execute function public.audit_profile_security();

create or replace function public.audit_role_permission()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.security_audit_log (actor_id, action, new_value)
    values ((select auth.uid()), 'permission_granted',
            jsonb_build_object('role', new.role, 'permission', new.permission));
  else
    insert into public.security_audit_log (actor_id, action, previous_value)
    values ((select auth.uid()), 'permission_revoked',
            jsonb_build_object('role', old.role, 'permission', old.permission));
  end if;
  return null;
end;
$$;

create trigger role_permissions_audit
  after insert or delete on public.role_permissions
  for each row execute function public.audit_role_permission();


-- ============================================================
-- RLS on the new tables
-- ============================================================
alter table public.permission_catalog enable row level security;
alter table public.role_permissions   enable row level security;
alter table public.security_audit_log enable row level security;

-- Every approved user may READ the catalogue and the matrix: the UI has to be
-- able to explain why an action is unavailable. Neither table contains
-- anything sensitive — it is the shape of the permission model, not its keys.
create policy "permission_catalog: approved read" on public.permission_catalog
  for select to authenticated using (public.is_approved());

create policy "role_permissions: approved read" on public.role_permissions
  for select to authenticated using (public.is_approved());

-- Configuring the matrix is ADMIN-ONLY and always will be.
create policy "role_permissions: admin writes" on public.role_permissions
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- No write policy on permission_catalog at all: the vocabulary ships with the
-- migration and is not user-editable.

create policy "security_audit_log: admin reads" on public.security_audit_log
  for select to authenticated using (public.is_admin());


-- ============================================================
-- widen: tasks and categories
-- ============================================================
drop policy if exists "categories: admin writes" on public.categories;
create policy "categories: config writes" on public.categories
  for all to authenticated
  using (public.has_permission('tasks.manage_definitions'))
  with check (public.has_permission('tasks.manage_definitions'));

drop policy if exists "tasks: admin writes" on public.tasks;
create policy "tasks: config writes" on public.tasks
  for all to authenticated
  using (public.has_permission('tasks.manage_definitions'))
  with check (public.has_permission('tasks.manage_definitions'));

drop policy if exists "occurrences: admin writes" on public.task_occurrences;
create policy "occurrences: manager writes" on public.task_occurrences
  for all to authenticated
  using (public.has_permission('tasks.manage_occurrences'))
  with check (public.has_permission('tasks.manage_occurrences'));

drop policy if exists "comments: author or admin deletes" on public.task_comments;
create policy "comments: author or manager deletes" on public.task_comments
  for delete to authenticated
  using (user_id = (select auth.uid()) or public.has_permission('tasks.manage_occurrences'));


-- ============================================================
-- widen: orders module
-- ============================================================
drop policy if exists "customers: admin writes" on public.customers;
create policy "customers: manage writes" on public.customers
  for all to authenticated
  using (public.has_permission('customers.manage'))
  with check (public.has_permission('customers.manage'));

drop policy if exists "products: admin writes" on public.products;
create policy "products: manage writes" on public.products
  for all to authenticated
  using (public.has_permission('products.manage'))
  with check (public.has_permission('products.manage'));

drop policy if exists "delivery_methods: admin writes" on public.delivery_methods;
create policy "delivery_methods: config writes" on public.delivery_methods
  for all to authenticated
  using (public.has_permission('orders.manage_config'))
  with check (public.has_permission('orders.manage_config'));

drop policy if exists "orders: admin writes" on public.orders;
create policy "orders: manage writes" on public.orders
  for all to authenticated
  using (public.has_permission('orders.manage'))
  with check (public.has_permission('orders.manage'));

drop policy if exists "order_lines: admin writes" on public.order_lines;
create policy "order_lines: manage writes" on public.order_lines
  for all to authenticated
  using (public.has_permission('orders.manage'))
  with check (public.has_permission('orders.manage'));

drop policy if exists "templates: admin writes" on public.recurring_order_templates;
create policy "templates: config writes" on public.recurring_order_templates
  for all to authenticated
  using (public.has_permission('orders.manage_config'))
  with check (public.has_permission('orders.manage_config'));

drop policy if exists "template_lines: admin writes" on public.recurring_order_template_lines;
create policy "template_lines: config writes" on public.recurring_order_template_lines
  for all to authenticated
  using (public.has_permission('orders.manage_config'))
  with check (public.has_permission('orders.manage_config'));

drop policy if exists "audit: admin reads" on public.order_audit_log;
create policy "audit: operational reads" on public.order_audit_log
  for select to authenticated using (public.has_permission('audit.view_operational'));

-- Lot allocations: a correction to someone else's entry now follows the
-- orders capability rather than being admin-only.
drop policy if exists "lots: author or admin updates" on public.lot_allocations;
create policy "lots: author or manager updates" on public.lot_allocations
  for update to authenticated
  using (created_by = (select auth.uid()) or public.has_permission('orders.manage'))
  with check (created_by = (select auth.uid()) or public.has_permission('orders.manage'));

drop policy if exists "lots: author or admin deletes" on public.lot_allocations;
create policy "lots: author or manager deletes" on public.lot_allocations
  for delete to authenticated
  using (created_by = (select auth.uid()) or public.has_permission('orders.manage'));


-- ============================================================
-- widen: inventory module
-- ============================================================
drop policy if exists "inventory_locations: admin writes" on public.inventory_locations;
create policy "inventory_locations: config writes" on public.inventory_locations
  for all to authenticated
  using (public.has_permission('inventory.manage_templates'))
  with check (public.has_permission('inventory.manage_templates'));

drop policy if exists "inventory_templates: admin writes" on public.inventory_templates;
create policy "inventory_templates: config writes" on public.inventory_templates
  for all to authenticated
  using (public.has_permission('inventory.manage_templates'))
  with check (public.has_permission('inventory.manage_templates'));

drop policy if exists "inventory_template_items: admin writes" on public.inventory_template_items;
create policy "inventory_template_items: config writes" on public.inventory_template_items
  for all to authenticated
  using (public.has_permission('inventory.manage_templates'))
  with check (public.has_permission('inventory.manage_templates'));

drop policy if exists "inventory_template_assignees: admin writes" on public.inventory_template_assignees;
create policy "inventory_template_assignees: config writes" on public.inventory_template_assignees
  for all to authenticated
  using (public.has_permission('inventory.manage_templates'))
  with check (public.has_permission('inventory.manage_templates'));

drop policy if exists "inventory_instances: admin writes" on public.inventory_instances;
create policy "inventory_instances: manage writes" on public.inventory_instances
  for all to authenticated
  using (public.has_permission('inventory.manage_instances'))
  with check (public.has_permission('inventory.manage_instances'));

drop policy if exists "inventory_assignments: admin writes" on public.inventory_assignments;
create policy "inventory_assignments: manage writes" on public.inventory_assignments
  for all to authenticated
  using (public.has_permission('inventory.manage_instances'))
  with check (public.has_permission('inventory.manage_instances'));

drop policy if exists "inventory_instance_items: admin writes" on public.inventory_instance_items;
create policy "inventory_instance_items: manage writes" on public.inventory_instance_items
  for all to authenticated
  using (public.has_permission('inventory.manage_instances'))
  with check (public.has_permission('inventory.manage_instances'));

drop policy if exists "inventory_audit_log: admin reads" on public.inventory_audit_log;
create policy "inventory_audit_log: operational reads" on public.inventory_audit_log
  for select to authenticated using (public.has_permission('audit.view_operational'));

drop policy if exists "inventory_grants: own or admin read" on public.inventory_edit_grants;
create policy "inventory_grants: own or manager read" on public.inventory_edit_grants
  for select to authenticated
  using (user_id = (select auth.uid()) or public.has_permission('inventory.grant_temporary_edit'));

drop policy if exists "inventory_grants: admin writes" on public.inventory_edit_grants;
create policy "inventory_grants: manager writes" on public.inventory_edit_grants
  for all to authenticated
  using (public.has_permission('inventory.grant_temporary_edit'))
  with check (public.has_permission('inventory.grant_temporary_edit'));


-- ============================================================
-- the inventory write gate
-- ============================================================
/*
 * Unchanged except for one added clause: a role holding
 * inventory.manage_instances edits a count without needing an assignment or a
 * temporary grant, exactly as an admin does.
 *
 * The order still matters and is preserved: approved -> privileged bypass ->
 * time-boxed grant -> assigned + open + before 18:00.
 */
create or replace function public.inventory_can_edit(p_instance_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := (select auth.uid());
  v_date date;
  v_completed timestamptz;
begin
  if v_uid is null or not public.is_approved() then
    return false;
  end if;
  -- is_admin() is implied by has_permission(), which short-circuits on it.
  if public.has_permission('inventory.manage_instances') then
    return true;
  end if;

  select i.inventory_date, i.completed_at
    into v_date, v_completed
    from public.inventory_instances i
   where i.id = p_instance_id;

  if not found then
    return false;
  end if;

  -- An explicit, time-boxed, attributed grant. Overrides both the assignment
  -- requirement and the deadline, which is the entire purpose of granting one.
  -- It expires by ceasing to match, never by a cleanup job.
  if exists (
    select 1
      from public.inventory_edit_grants g
     where g.user_id = v_uid
       and g.revoked_at is null
       and now() >= g.starts_at
       and now() <= g.ends_at
       and (g.scope = 'all' or g.instance_id = p_instance_id)
  ) then
    return true;
  end if;

  -- Otherwise: assigned, still open, still before the deadline. All three.
  return v_completed is null
     and now() <= public.inventory_edit_deadline(v_date)
     and exists (
       select 1 from public.inventory_assignments a
        where a.instance_id = p_instance_id
          and a.user_id = v_uid
     );
end;
$$;


-- ============================================================
-- widen: the RPC guards
-- ============================================================
/*
 * Each of these opened with
 *   if not public.is_admin() then raise exception 'not_authorized' ...
 * and now consults the matching capability instead. Bodies are otherwise
 * byte-for-byte what they were.
 */

/*
 * Each RPC is recreated from its CURRENT definition with only the predicate
 * swapped, rather than being restated here in full. Restating would fork ~200
 * lines of carefully-commented logic and let the two copies drift.
 *
 * The catch with a textual rewrite is that a near-miss silently does nothing
 * and the guard quietly stays admin-only — a security change that looks
 * applied and is not. So the helper ASSERTS the old predicate was present and
 * the new one is present afterwards, and aborts the migration otherwise.
 */
create or replace function pg_temp.reguard(p_fn regprocedure, p_old text, p_new text)
returns void
language plpgsql
as $$
declare
  v_src text := pg_get_functiondef(p_fn);
  v_out text;
begin
  if position(p_old in v_src) = 0 then
    raise exception 'reguard: % does not contain the expected guard %', p_fn, p_old;
  end if;

  v_out := replace(v_src, p_old, p_new);

  if position(p_new in v_out) = 0 then
    raise exception 'reguard: rewriting % produced no new guard', p_fn;
  end if;

  execute v_out;
end;
$$;

select pg_temp.reguard(
  'public.inventory_reopen(uuid)'::regprocedure,
  'if not public.is_admin() then',
  'if not public.has_permission(''inventory.manage_instances'') then'
);

select pg_temp.reguard(
  'public.inventory_set_digital(uuid, int)'::regprocedure,
  'if not public.is_admin() then',
  'if not public.has_permission(''inventory.manage_instances'') then'
);

select pg_temp.reguard(
  'public.inventory_resolve_item(uuid, text)'::regprocedure,
  'if not public.is_admin() then',
  'if not public.has_permission(''inventory.resolve_differences'') then'
);

select pg_temp.reguard(
  'public.inventory_grant_edit(uuid, public.inventory_grant_scope, uuid, timestamptz, timestamptz, text)'::regprocedure,
  'if not public.is_admin() then',
  'if not public.has_permission(''inventory.grant_temporary_edit'') then'
);

select pg_temp.reguard(
  'public.inventory_revoke_grant(uuid)'::regprocedure,
  'if not public.is_admin() then',
  'if not public.has_permission(''inventory.grant_temporary_edit'') then'
);

select pg_temp.reguard(
  'public.generate_order_from_template(uuid, date)'::regprocedure,
  'if not public.is_admin() then',
  'if not public.has_permission(''orders.manage_config'') then'
);

-- The over-allocation cap: a privileged operational role may exceed the
-- ordered quantity to record what physically happened, as an admin could.
select pg_temp.reguard(
  'public.check_lot_over_allocation()'::regprocedure,
  'not public.is_admin()',
  'not public.has_permission(''orders.manage'')'
);


-- ============================================================
-- Product Code: a column-level rule, so a trigger
-- ============================================================
/*
 * RLS cannot express "may update this row but not this column". The module
 * already hit that wall once and solved it with an RPC
 * (set_line_shortfall_reason); a trigger is the right shape here because the
 * rule guards one column of an otherwise ordinary update.
 *
 * The null-uid escape is for the SERVICE ROLE: the importer
 * (npm run master:seed) legitimately writes codes with no session, and
 * has_permission() would return false for it. Triggers still fire for the
 * service role even though RLS does not apply to it, so without this the
 * importer would break.
 */
create or replace function public.guard_product_code()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.code is distinct from old.code
     and (select auth.uid()) is not null
     and not public.has_permission('products.change_code') then
    raise exception 'product_code_change_denied' using errcode = '42501';
  end if;

  if new.code is distinct from old.code then
    insert into public.security_audit_log
      (actor_id, action, previous_value, new_value)
    values (
      (select auth.uid()), 'product_code_changed',
      jsonb_build_object('product_id', old.id, 'code', old.code),
      jsonb_build_object('product_id', new.id, 'code', new.code)
    );
  end if;

  return new;
end;
$$;

create trigger products_guard_code
  before update on public.products
  for each row execute function public.guard_product_code();


-- ============================================================
-- Correcting a confirmed order
-- ============================================================
/*
 * "Correct completed/prepared orders" is a distinct capability in the role
 * spec, so it is a distinct permission rather than being folded into
 * orders.manage. Draft orders are ordinary editing and are not gated here.
 */
create or replace function public.guard_confirmed_order_edit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status = 'confirmed'
     and (select auth.uid()) is not null
     and not public.has_permission('orders.correct_completed') then
    raise exception 'order_correction_denied' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger orders_guard_confirmed_edit
  before update on public.orders
  for each row execute function public.guard_confirmed_order_edit();
