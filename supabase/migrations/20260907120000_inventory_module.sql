-- ============================================================
-- Operation Manager :: Inventory (Bestandkontrolle) module
--
-- Replaces the Bestandkontrolle_Master.xlsx workbook, whose ten sheets are
-- all BLANK TEMPLATES (verified: not one literal quantity, expiry or KW in
-- the file). Nothing historical is imported, because nothing historical
-- exists there; the workbook contributes template configuration and item
-- lists only. From here the application is the source of truth.
--
-- Central invariant, and the reason this is not modelled on task
-- occurrences: an INVENTORY INSTANCE IS PERMANENT AND UNIQUE PER DATE.
--   Masamor/Del Barrio KW 37, KW 38 and KW 39 are three separate rows,
--   enforced by UNIQUE(template_id, inventory_date). No generation run, no
--   template edit and no item deactivation can ever overwrite or remove one.
--
-- Second invariant: Physical Stock is NEVER typed in. It is the trigger-
-- maintained sum of the underlying quantity records, and Difference is a
-- generated column over it. A client cannot write either.
--
-- The workbook column "Bexio" is called INVENTORY DIGITAL everywhere in this
-- schema and in the UI. There is no Bexio integration and none is implied:
-- the value is entered by an admin, by hand.
-- ============================================================

-- ---------- enums ----------

-- What a single physical count record consists of. The one decision that
-- shapes the entry form, the validation and the meaning of a record.
create type public.inventory_kind as enum (
  'expiry',    -- quantity + optional expiry date   (Masamor/Del Barrio, Colectivo)
  'lot',       -- quantity + lot number + expiry    (Materia Prima)
  'location'   -- quantity per configured location  (Empaques)
);

-- Four statuses, exactly four. "Inventory Digital: Pending" is deliberately
-- NOT one of them: it is an orthogonal condition (no digital value entered
-- yet) that coexists with a status, and making it a fifth would render
-- "in progress AND pending" inexpressible.
create type public.inventory_status as enum (
  'in_progress', 'completed', 'to_review', 'resolved'
);

-- No 'daily': a physical stock count is never a daily activity, and offering
-- it would only invite a mis-configuration.
create type public.inventory_frequency as enum (
  'weekly', 'biweekly', 'monthly', 'semiannual'
);

-- Scope of a temporary edit permission.
create type public.inventory_grant_scope as enum ('instance', 'all');

-- ============================================================
-- locations  (Empaques counts stock per place, not per expiry)
--
-- Configurable, never hard-coded. "Lager 4to Piso" and "Fábrica" are the
-- current two; an admin adds or deactivates others without a migration.
-- ============================================================
create table public.inventory_locations (
  id         uuid primary key default gen_random_uuid(),
  slug       text not null unique,
  name       text not null check (length(btrim(name)) > 0),
  sort_order int  not null default 100,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index inventory_locations_active_idx on public.inventory_locations (is_active, sort_order);

-- ============================================================
-- templates  (the recurring KIND of inventory)
-- ============================================================
create table public.inventory_templates (
  id              uuid primary key default gen_random_uuid(),
  slug            text not null unique,
  name            text not null check (length(btrim(name)) > 0),
  description     text,
  -- Per-locale name/description overrides. Spanish lives in the base fields
  -- and is the fallback, matching how task titles are translated.
  translations    jsonb not null default '{}'::jsonb,
  kind            public.inventory_kind not null,
  frequency       public.inventory_frequency not null,
  -- Validated against a zod discriminated union before it is written. NULL
  -- means "not configured yet" and is surfaced to the admin rather than
  -- silently guessed into a date.
  schedule_config jsonb,

  -- Per-template, never hard-coded. When false the UI hides Inventory
  -- Digital entirely, calculates no Difference, and runs no pending workflow.
  digital_enabled boolean not null default false,

  -- Soft deactivation only. Historical instances survive untouched.
  is_active       boolean not null default true,
  created_by      uuid references public.profiles (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint inventory_templates_translations_shape check (
    jsonb_typeof(translations) = 'object'
    and translations - ARRAY['de', 'en'] = '{}'::jsonb
  )
);

create index inventory_templates_active_idx on public.inventory_templates (is_active);
create index inventory_templates_unconfigured_idx
  on public.inventory_templates (id) where schedule_config is null;

-- ============================================================
-- template items  (what gets counted, and in what order)
--
-- product_id is OPTIONAL and that is the point: raw materials, packaging and
-- internal materials are legitimately not commercial products, and forcing
-- them into the product master would corrupt it. Where an item IS a product,
-- it references the existing row — no duplicate product records are created.
-- ============================================================
create table public.inventory_template_items (
  id           uuid primary key default gen_random_uuid(),
  template_id  uuid not null references public.inventory_templates (id) on delete cascade,
  name         text not null check (length(btrim(name)) > 0),
  -- The workbook's left-hand grouping column (MASAMOR, Del Barrio, Fritura,
  -- El Mini Super, ...). A label for sectioning the entry screen, not an FK.
  item_group   text,
  translations jsonb not null default '{}'::jsonb,
  -- Links to the commercial product master when the item is a product.
  -- ON DELETE SET NULL: unlinking must never destroy the inventory item.
  product_id   uuid references public.products (id) on delete set null,
  sort_order   int  not null default 100,
  -- Deactivating keeps the item out of NEWLY generated inventories while
  -- leaving it fully visible in every historical one.
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint inventory_template_items_name_key unique (template_id, name)
);

create index inventory_template_items_template_idx
  on public.inventory_template_items (template_id, sort_order);
create index inventory_template_items_active_idx
  on public.inventory_template_items (template_id) where is_active;
create index inventory_template_items_product_idx
  on public.inventory_template_items (product_id) where product_id is not null;

-- ---------- default assignees ----------
-- Who normally performs this inventory. Copied onto each generated instance,
-- which is what stops every scheduled count from arriving unassigned.
create table public.inventory_template_assignees (
  template_id uuid not null references public.inventory_templates (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  primary key (template_id, user_id)
);

-- ============================================================
-- instances  (ONE actual inventory, performed on ONE date)
-- ============================================================
create table public.inventory_instances (
  id             uuid primary key default gen_random_uuid(),
  template_id    uuid not null references public.inventory_templates (id) on delete restrict,
  inventory_date date not null,

  -- The calendar week the operation names inventories by ("KW 37"). Stored,
  -- not derived at read time, so reports and filters index it directly and a
  -- year-boundary week cannot be miscomputed by a client.
  iso_week       int not null check (iso_week between 1 and 53),
  iso_year       int not null,
  -- Reporting label only (2026-W37 | 2026-09#2 | 2026-H2). NOT an identity:
  -- a template legitimately produces two instances in one month.
  period_key     text not null,

  -- ---- snapshots taken at generation ----
  -- A historical inventory must stay understandable after the template that
  -- produced it is renamed, re-typed, or has Inventory Digital switched off.
  name_snapshot    text not null,
  kind             public.inventory_kind not null,
  digital_enabled  boolean not null,

  status         public.inventory_status not null default 'in_progress',
  completed_at   timestamptz,
  completed_by   uuid references public.profiles (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  -- THE core invariant. One inventory per template per date, forever.
  constraint inventory_instances_template_date_key unique (template_id, inventory_date),
  constraint inventory_completion_attributed check (
    completed_at is null or completed_by is not null
  )
);

create index inventory_instances_date_idx     on public.inventory_instances (inventory_date desc);
create index inventory_instances_status_idx   on public.inventory_instances (status);
create index inventory_instances_template_idx on public.inventory_instances (template_id, inventory_date desc);
create index inventory_instances_week_idx     on public.inventory_instances (iso_year, iso_week);
create index inventory_instances_open_idx     on public.inventory_instances (inventory_date)
  where status <> 'completed';

-- ============================================================
-- assignments
--
-- Only an assigned user may modify an inventory. Enforced in RLS below, not
-- by hiding buttons.
-- ============================================================
create table public.inventory_assignments (
  id          uuid primary key default gen_random_uuid(),
  instance_id uuid not null references public.inventory_instances (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  assigned_by uuid references public.profiles (id) on delete set null,
  assigned_at timestamptz not null default now(),

  constraint inventory_assignments_once unique (instance_id, user_id)
);

create index inventory_assignments_user_idx on public.inventory_assignments (user_id);

-- ============================================================
-- instance items  (one counted line of one inventory)
-- ============================================================
create table public.inventory_instance_items (
  id               uuid primary key default gen_random_uuid(),
  instance_id      uuid not null references public.inventory_instances (id) on delete cascade,
  -- RESTRICT, not CASCADE: a template item can be deactivated but never
  -- deleted out from under the history that references it.
  template_item_id uuid not null references public.inventory_template_items (id) on delete restrict,

  -- ---- snapshots taken at generation ----
  -- What was counted, as it was named at the time. A later rename of the
  -- template item does not rewrite what an old count says it counted.
  item_name        text not null,
  item_group       text,
  item_sort_order  int not null default 100,
  product_id       uuid references public.products (id) on delete set null,

  -- Trigger-maintained sum of inventory_entries. Never written by a client:
  -- no role has a policy permitting it, and the trigger overwrites anything
  -- that somehow got in.
  physical_stock   int not null default 0,

  -- Inventory Digital. Admin-only, via RPC. NULL means "Pending".
  digital_quantity int check (digital_quantity is null or digital_quantity >= 0),

  -- Difference = Physical Stock - Inventory Digital, or NULL when there is
  -- nothing to compare against. A generated column so it can never disagree
  -- with its inputs, and so it is indexable for the "needs review" report.
  difference       int generated always as (
    case when digital_quantity is null then null
         else physical_stock - digital_quantity end
  ) stored,

  status           public.inventory_status not null default 'in_progress',

  -- An admin has accepted the difference. Cleared automatically if Inventory
  -- Digital changes afterwards, because the numbers signed off on are gone.
  -- The resolution ROWS are never cleared — see inventory_resolutions.
  is_resolved      boolean not null default false,
  resolved_at      timestamptz,
  resolved_by      uuid references public.profiles (id) on delete set null,

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint inventory_instance_items_once unique (instance_id, template_item_id),
  -- Lets child entries reference the (item, instance) pair, so an entry can
  -- never be attached to an item belonging to a different inventory.
  constraint inventory_instance_items_instance_key unique (id, instance_id),
  constraint inventory_resolution_attributed check (
    not is_resolved or (resolved_at is not null and resolved_by is not null)
  )
);

create index inventory_items_instance_idx on public.inventory_instance_items (instance_id, item_sort_order);
create index inventory_items_status_idx   on public.inventory_instance_items (status);
create index inventory_items_product_idx  on public.inventory_instance_items (product_id)
  where product_id is not null;
-- Powers "differences requiring review" without scanning history.
create index inventory_items_review_idx on public.inventory_instance_items (instance_id)
  where status = 'to_review';
-- Powers "Inventory Digital pending".
create index inventory_items_digital_pending_idx on public.inventory_instance_items (instance_id)
  where digital_quantity is null;

-- ============================================================
-- entries  (the physical quantity records)
--
-- Unlimited per item. Duplicate expiry dates are allowed and are NEVER
-- merged: "10 -> 15.09" and "5 -> 15.09" are two things somebody counted in
-- two places, and collapsing them would destroy that.
-- ============================================================
create table public.inventory_entries (
  id               uuid primary key default gen_random_uuid(),
  instance_item_id uuid not null,
  -- Denormalised so RLS can authorise an entry without joining two levels up
  -- on every row. The composite FK below guarantees it stays truthful.
  instance_id      uuid not null,

  -- Whole units only. Decimals are rejected rather than rounded: a "0.5" in
  -- a count of boxes means the counter meant something this system cannot
  -- represent, and quietly turning it into 0 or 1 would put a wrong number
  -- into an audited record. NULL = not counted, which is not the same as 0.
  quantity         int check (quantity is null or quantity >= 0),

  expiry_date      date,
  lot_number       text,
  location_id      uuid references public.inventory_locations (id) on delete restrict,
  -- Snapshot, so a renamed location does not rewrite historical counts.
  location_name    text,

  note             text,
  position         int not null default 0,

  created_by       uuid references public.profiles (id) on delete set null,
  updated_by       uuid references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint inventory_entries_item_fk
    foreign key (instance_item_id, instance_id)
    references public.inventory_instance_items (id, instance_id) on delete cascade
);

create index inventory_entries_item_idx     on public.inventory_entries (instance_item_id, position);
create index inventory_entries_instance_idx on public.inventory_entries (instance_id);
create index inventory_entries_expiry_idx   on public.inventory_entries (expiry_date)
  where expiry_date is not null;
create index inventory_entries_lot_idx      on public.inventory_entries (lot_number)
  where lot_number is not null;

-- ============================================================
-- resolutions  (append-only)
--
-- An admin may mark an item Resolved even though the difference is still
-- non-zero — that is intentional and is the whole point of the state. What
-- is NOT optional is the reason, and the numbers it was given for.
-- ============================================================
create table public.inventory_resolutions (
  id                    uuid primary key default gen_random_uuid(),
  instance_item_id      uuid not null references public.inventory_instance_items (id) on delete cascade,
  instance_id           uuid not null references public.inventory_instances (id) on delete cascade,
  note                  text not null check (length(btrim(note)) > 0),
  -- The state at the moment of the decision, frozen. If Inventory Digital is
  -- edited later, this row still says what was actually signed off on.
  physical_stock_at     int not null,
  digital_at            int,
  difference_at         int,
  resolved_by           uuid references public.profiles (id) on delete set null,
  resolved_at           timestamptz not null default now(),
  -- Set when a later Inventory Digital change invalidated this resolution.
  superseded_at         timestamptz
);

create index inventory_resolutions_item_idx on public.inventory_resolutions (instance_item_id, resolved_at desc);
create index inventory_resolutions_instance_idx on public.inventory_resolutions (instance_id);

-- ============================================================
-- Inventory Digital history
--
-- An admin changing the digital value later must not silently rewrite what
-- the difference used to be. Every value ever entered is kept, with who and
-- when, and the difference each one produced.
-- ============================================================
create table public.inventory_digital_history (
  id                uuid primary key default gen_random_uuid(),
  instance_item_id  uuid not null references public.inventory_instance_items (id) on delete cascade,
  instance_id       uuid not null references public.inventory_instances (id) on delete cascade,
  previous_digital  int,
  new_digital       int,
  physical_stock_at int not null,
  previous_difference int,
  new_difference      int,
  changed_by        uuid references public.profiles (id) on delete set null,
  changed_at        timestamptz not null default now()
);

create index inventory_digital_history_item_idx
  on public.inventory_digital_history (instance_item_id, changed_at desc);

-- ============================================================
-- comments  (two levels: whole inventory, and single item)
--
-- Deliberately no DELETE policy anywhere below. A comment is part of the
-- audit record of a count.
-- ============================================================
create table public.inventory_comments (
  id               uuid primary key default gen_random_uuid(),
  instance_id      uuid not null references public.inventory_instances (id) on delete cascade,
  -- NULL = a general comment on the whole inventory
  -- ("Inventory performed one day earlier because of the holiday.")
  instance_item_id uuid references public.inventory_instance_items (id) on delete cascade,
  user_id          uuid not null references public.profiles (id) on delete cascade,
  body             text not null check (length(btrim(body)) > 0),
  created_at       timestamptz not null default now()
);

create index inventory_comments_instance_idx on public.inventory_comments (instance_id, created_at);
create index inventory_comments_item_idx on public.inventory_comments (instance_item_id, created_at)
  where instance_item_id is not null;

-- ============================================================
-- temporary edit permissions
--
-- An admin can hand a user a time-boxed window to edit after 18:00, or to
-- edit an inventory they were not assigned to. There is no expiry job: the
-- permission simply stops matching the predicate, so it cannot fail to
-- expire because a cron run was missed.
-- ============================================================
create table public.inventory_edit_grants (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  scope       public.inventory_grant_scope not null,
  -- Required for scope 'instance', forbidden for scope 'all'.
  instance_id uuid references public.inventory_instances (id) on delete cascade,
  starts_at   timestamptz not null,
  ends_at     timestamptz not null,
  reason      text,
  granted_by  uuid references public.profiles (id) on delete set null,
  revoked_at  timestamptz,
  revoked_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),

  constraint inventory_grant_scope_target check (
    (scope = 'instance' and instance_id is not null)
    or (scope = 'all' and instance_id is null)
  ),
  constraint inventory_grant_window check (ends_at > starts_at)
  -- The "may not span multiple days" rule is enforced by a trigger rather
  -- than a CHECK: it has to be evaluated in the business zone, and
  -- `AT TIME ZONE <name>` is STABLE (it depends on the timezone database),
  -- which Postgres will not accept inside a CHECK constraint.
);

-- The single-day rule, unbypassable regardless of write path.
create or replace function public.inventory_grant_single_day()
returns trigger
language plpgsql
as $$
begin
  if (new.starts_at at time zone 'Europe/Zurich')::date
     <> (new.ends_at at time zone 'Europe/Zurich')::date then
    raise exception 'grant_spans_multiple_days' using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger inventory_grants_single_day
  before insert or update on public.inventory_edit_grants
  for each row execute function public.inventory_grant_single_day();

create index inventory_grants_user_idx on public.inventory_edit_grants (user_id, starts_at desc);
create index inventory_grants_active_idx on public.inventory_edit_grants (user_id, ends_at)
  where revoked_at is null;

-- ============================================================
-- audit log
--
-- One place to answer "who changed this number, from what, to what, when".
-- Written by triggers so it cannot be bypassed by writing to a table
-- directly, and admin-readable only.
-- ============================================================
create table public.inventory_audit_log (
  id               uuid primary key default gen_random_uuid(),
  instance_id      uuid references public.inventory_instances (id) on delete cascade,
  instance_item_id uuid references public.inventory_instance_items (id) on delete cascade,
  template_id      uuid references public.inventory_templates (id) on delete cascade,
  entry_id         uuid,
  actor_id         uuid references public.profiles (id) on delete set null,
  action           text not null,
  previous_value   jsonb,
  new_value        jsonb,
  created_at       timestamptz not null default now()
);

create index inventory_audit_instance_idx on public.inventory_audit_log (instance_id, created_at desc);
create index inventory_audit_item_idx on public.inventory_audit_log (instance_item_id, created_at desc);
create index inventory_audit_template_idx on public.inventory_audit_log (template_id, created_at desc);

-- ---------- updated_at triggers ----------
create trigger inventory_locations_set_updated_at before update on public.inventory_locations
  for each row execute function public.set_updated_at();
create trigger inventory_templates_set_updated_at before update on public.inventory_templates
  for each row execute function public.set_updated_at();
create trigger inventory_template_items_set_updated_at before update on public.inventory_template_items
  for each row execute function public.set_updated_at();
create trigger inventory_instances_set_updated_at before update on public.inventory_instances
  for each row execute function public.set_updated_at();
create trigger inventory_instance_items_set_updated_at before update on public.inventory_instance_items
  for each row execute function public.set_updated_at();
create trigger inventory_entries_set_updated_at before update on public.inventory_entries
  for each row execute function public.set_updated_at();

-- ============================================================
-- authorization helpers
-- ============================================================

-- The instant an assigned user loses write access: 18:00 on the day of the
-- inventory, in the business zone (so it is 18:00 local on both sides of a
-- daylight-saving change, not a fixed UTC offset).
-- STABLE, not IMMUTABLE: converting a local wall-clock time to an instant
-- depends on the timezone database, so claiming immutability here would be a
-- lie the planner is entitled to act on.
create or replace function public.inventory_edit_deadline(p_date date)
returns timestamptz
language sql
stable
as $$
  select (p_date + time '18:00') at time zone 'Europe/Zurich';
$$;

comment on function public.inventory_edit_deadline(date) is
  'End of the assigned-user editing window: 18:00 Europe/Zurich on the inventory date.';

/*
 * THE write gate. Every inventory write policy and RPC funnels through this,
 * so the rules exist once:
 *
 *   admin                          -> always
 *   active temporary grant         -> yes, overriding assignment AND deadline
 *   assigned + open + before 18:00 -> yes
 *   anything else                  -> no
 *
 * SECURITY DEFINER so it can read the assignment and grant tables without
 * recursing through the very policies that call it.
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
  if public.is_admin() then
    return true;
  end if;

  select i.inventory_date, i.completed_at
    into v_date, v_completed
    from public.inventory_instances i
   where i.id = p_instance_id;

  if not found then
    return false;
  end if;

  -- An explicit, time-boxed, attributed admin grant. Overrides both the
  -- assignment requirement and the deadline, which is the entire purpose of
  -- granting one. It expires by ceasing to match, never by a cleanup job.
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

revoke all on function public.inventory_can_edit(uuid) from public;
grant execute on function public.inventory_can_edit(uuid) to authenticated;

-- ============================================================
-- generation: materialise an instance's items from its template
--
-- Runs on INSERT of an instance, so it happens identically whether the row
-- came from the cron route, an admin action or the seed script.
-- ============================================================

-- Fill the snapshot columns from the template before the row is stored, so a
-- caller cannot record an instance whose snapshot contradicts its template.
create or replace function public.inventory_instance_snapshot()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tpl public.inventory_templates;
begin
  select * into v_tpl from public.inventory_templates where id = new.template_id;
  if not found then
    raise exception 'inventory_template_not_found' using errcode = 'P0002';
  end if;

  new.name_snapshot   := v_tpl.name;
  new.kind            := v_tpl.kind;
  new.digital_enabled := v_tpl.digital_enabled;

  -- The KW is derived here rather than trusted from the client, so a
  -- year-boundary week cannot be filed under the wrong year.
  new.iso_week := extract(week from new.inventory_date)::int;
  new.iso_year := extract(isoyear from new.inventory_date)::int;

  return new;
end;
$$;

create trigger inventory_instances_snapshot
  before insert on public.inventory_instances
  for each row execute function public.inventory_instance_snapshot();

-- Copy the template's ACTIVE items onto the new instance, with their names
-- frozen. A deactivated item does not appear here (it stays fully visible in
-- the instances that already reference it).
create or replace function public.inventory_materialise_items()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.inventory_instance_items (
    instance_id, template_item_id, item_name, item_group, item_sort_order, product_id
  )
  select new.id, ti.id, ti.name, ti.item_group, ti.sort_order, ti.product_id
    from public.inventory_template_items ti
   where ti.template_id = new.template_id
     and ti.is_active
   order by ti.sort_order, ti.name;

  -- Carry the template's usual counters onto the instance so a scheduled
  -- inventory does not arrive with nobody able to touch it.
  insert into public.inventory_assignments (instance_id, user_id)
  select new.id, ta.user_id
    from public.inventory_template_assignees ta
   where ta.template_id = new.template_id
  on conflict do nothing;

  insert into public.inventory_audit_log (instance_id, template_id, actor_id, action, new_value)
  values (
    new.id, new.template_id, (select auth.uid()), 'inventory_created',
    jsonb_build_object(
      'inventory_date', new.inventory_date,
      'iso_week', new.iso_week,
      'period_key', new.period_key
    )
  );

  return new;
end;
$$;

create trigger inventory_instances_materialise
  after insert on public.inventory_instances
  for each row execute function public.inventory_materialise_items();

-- ============================================================
-- entry shape validation
--
-- Each inventory kind uses a different set of fields, and a field that is
-- meaningless for a kind must not silently hold a value that no screen will
-- ever show again.
-- ============================================================
create or replace function public.inventory_entry_shape()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind public.inventory_kind;
  v_loc  public.inventory_locations;
begin
  select i.kind into v_kind
    from public.inventory_instances i
   where i.id = new.instance_id;

  if v_kind is null then
    raise exception 'inventory_instance_not_found' using errcode = 'P0002';
  end if;

  -- Blank strings are not lot numbers.
  new.lot_number := nullif(btrim(coalesce(new.lot_number, '')), '');
  new.note       := nullif(btrim(coalesce(new.note, '')), '');

  if v_kind = 'location' then
    -- Packaging is counted per place, and has no expiry or lot dimension.
    if new.location_id is null then
      raise exception 'location_required' using errcode = '22023';
    end if;
    if new.expiry_date is not null or new.lot_number is not null then
      raise exception 'unexpected_field_for_kind' using errcode = '22023';
    end if;

    select * into v_loc from public.inventory_locations where id = new.location_id;
    if not found then
      raise exception 'location_not_found' using errcode = 'P0002';
    end if;
    -- Frozen, so renaming a location later does not rewrite old counts.
    new.location_name := v_loc.name;

  else
    -- expiry and lot kinds are counted per record, not per place.
    if new.location_id is not null then
      raise exception 'unexpected_field_for_kind' using errcode = '22023';
    end if;
    new.location_name := null;

    -- Only Materia Prima carries lot numbers.
    if v_kind = 'expiry' and new.lot_number is not null then
      raise exception 'unexpected_field_for_kind' using errcode = '22023';
    end if;
  end if;

  return new;
end;
$$;

create trigger inventory_entries_shape
  before insert or update on public.inventory_entries
  for each row execute function public.inventory_entry_shape();

-- ============================================================
-- Physical Stock and status
--
-- Physical Stock is recomputed from the entries, never accepted from a
-- writer. The BEFORE trigger on the item row derives status from the values
-- about to be stored, so status can never disagree with the numbers beside
-- it, whatever path the write came in through.
-- ============================================================
create or replace function public.inventory_item_state()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_digital_enabled boolean;
  v_completed       timestamptz;
begin
  select i.digital_enabled, i.completed_at
    into v_digital_enabled, v_completed
    from public.inventory_instances i
   where i.id = new.instance_id;

  -- Inventory Digital cannot hold a value on a template that does not use it.
  if not coalesce(v_digital_enabled, false) then
    new.digital_quantity := null;
  end if;

  if new.is_resolved then
    -- An attributed admin decision outranks the arithmetic. It is cleared
    -- only by a change to Inventory Digital (see inventory_set_digital).
    new.status := 'resolved';
  elsif not coalesce(v_digital_enabled, false) then
    -- No reconciliation step: counting it is finishing it.
    new.status := case when v_completed is null then 'in_progress' else 'completed' end;
  elsif new.digital_quantity is null then
    -- "Inventory Digital: Pending". Still open, and never shown a difference.
    new.status := 'in_progress';
  elsif new.physical_stock - new.digital_quantity = 0 then
    new.status := 'completed';
  else
    new.status := 'to_review';
  end if;

  return new;
end;
$$;

create trigger inventory_instance_items_state
  before insert or update on public.inventory_instance_items
  for each row execute function public.inventory_item_state();

-- Roll the item statuses up to the inventory. An inventory is only as
-- finished as its least finished item, which is what makes the overview
-- lists actionable.
create or replace function public.inventory_sync_instance_status(p_instance_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_completed timestamptz;
  v_status    public.inventory_status;
begin
  select completed_at into v_completed
    from public.inventory_instances where id = p_instance_id;

  if v_completed is null then
    v_status := 'in_progress';
  elsif exists (
    select 1 from public.inventory_instance_items
     where instance_id = p_instance_id and status = 'to_review'
  ) then
    v_status := 'to_review';
  elsif exists (
    select 1 from public.inventory_instance_items
     where instance_id = p_instance_id and status = 'resolved'
  ) then
    v_status := 'resolved';
  else
    v_status := 'completed';
  end if;

  update public.inventory_instances
     set status = v_status
   where id = p_instance_id
     and status is distinct from v_status;
end;
$$;

create or replace function public.inventory_item_after_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Only when the roll-up input actually moved, so a bulk quantity edit does
  -- not rewrite the instance row once per item.
  if TG_OP = 'UPDATE' and new.status is not distinct from old.status then
    return null;
  end if;
  perform public.inventory_sync_instance_status(new.instance_id);
  return null;
end;
$$;

create trigger inventory_instance_items_rollup
  after insert or update on public.inventory_instance_items
  for each row execute function public.inventory_item_after_change();

-- Recompute the owning item whenever its entries change. This is the only
-- writer of physical_stock.
create or replace function public.inventory_recalc_stock()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item uuid;
begin
  if TG_OP = 'DELETE' then
    v_item := old.instance_item_id;
  else
    v_item := new.instance_item_id;
  end if;

  update public.inventory_instance_items it
     set physical_stock = (
           -- An uncounted record contributes nothing; it is not a zero.
           select coalesce(sum(coalesce(e.quantity, 0)), 0)
             from public.inventory_entries e
            where e.instance_item_id = v_item
         )
   where it.id = v_item;

  -- An entry moved between items leaves the item it came from stale, so that
  -- one is recomputed too rather than keeping a total it no longer has.
  if TG_OP = 'UPDATE' and old.instance_item_id is distinct from new.instance_item_id then
    update public.inventory_instance_items it
       set physical_stock = (
             select coalesce(sum(coalesce(e.quantity, 0)), 0)
               from public.inventory_entries e
              where e.instance_item_id = old.instance_item_id
           )
     where it.id = old.instance_item_id;
  end if;

  return null;
end;
$$;

create trigger inventory_entries_recalc
  after insert or update or delete on public.inventory_entries
  for each row execute function public.inventory_recalc_stock();

-- ============================================================
-- audit triggers
-- ============================================================
create or replace function public.inventory_audit_entry()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row  public.inventory_entries;
  v_prev jsonb;
  v_next jsonb;
begin
  -- Explicit branches rather than coalesce(new, old): OLD and NEW are only
  -- populated for the operations that have them, and reaching for the wrong
  -- one must not be able to break an insert the operator is depending on.
  if TG_OP = 'DELETE' then
    v_row  := old;
    v_prev := jsonb_build_object('quantity', old.quantity, 'expiry_date', old.expiry_date,
                                 'lot_number', old.lot_number, 'location_name', old.location_name,
                                 'note', old.note);
    v_next := null;
  elsif TG_OP = 'UPDATE' then
    v_row  := new;
    v_prev := jsonb_build_object('quantity', old.quantity, 'expiry_date', old.expiry_date,
                                 'lot_number', old.lot_number, 'location_name', old.location_name,
                                 'note', old.note);
    v_next := jsonb_build_object('quantity', new.quantity, 'expiry_date', new.expiry_date,
                                 'lot_number', new.lot_number, 'location_name', new.location_name,
                                 'note', new.note);
  else
    v_row  := new;
    v_prev := null;
    v_next := jsonb_build_object('quantity', new.quantity, 'expiry_date', new.expiry_date,
                                 'lot_number', new.lot_number, 'location_name', new.location_name,
                                 'note', new.note);
  end if;

  insert into public.inventory_audit_log (
    instance_id, instance_item_id, entry_id, actor_id, action, previous_value, new_value
  )
  values (
    v_row.instance_id, v_row.instance_item_id, v_row.id,
    (select auth.uid()), 'entry_' || lower(TG_OP), v_prev, v_next
  );
  return null;
end;
$$;

create trigger inventory_entries_audit
  after insert or update or delete on public.inventory_entries
  for each row execute function public.inventory_audit_entry();

create or replace function public.inventory_audit_item()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status is distinct from old.status then
    insert into public.inventory_audit_log (
      instance_id, instance_item_id, actor_id, action, previous_value, new_value
    ) values (
      new.instance_id, new.id, (select auth.uid()), 'item_status_changed',
      to_jsonb(old.status), to_jsonb(new.status)
    );
  end if;
  return null;
end;
$$;

create trigger inventory_instance_items_audit
  after update on public.inventory_instance_items
  for each row execute function public.inventory_audit_item();

create or replace function public.inventory_audit_instance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status is distinct from old.status then
    insert into public.inventory_audit_log (instance_id, template_id, actor_id, action, previous_value, new_value)
    values (new.id, new.template_id, (select auth.uid()), 'inventory_status_changed',
            to_jsonb(old.status), to_jsonb(new.status));
  end if;
  if new.completed_at is distinct from old.completed_at then
    insert into public.inventory_audit_log (instance_id, template_id, actor_id, action, previous_value, new_value)
    values (new.id, new.template_id, (select auth.uid()),
            case when new.completed_at is null then 'inventory_reopened' else 'inventory_completed' end,
            jsonb_build_object('completed_at', old.completed_at, 'completed_by', old.completed_by),
            jsonb_build_object('completed_at', new.completed_at, 'completed_by', new.completed_by));
  end if;
  return null;
end;
$$;

create trigger inventory_instances_audit
  after update on public.inventory_instances
  for each row execute function public.inventory_audit_instance();

create or replace function public.inventory_audit_assignment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.inventory_assignments;
begin
  if TG_OP = 'DELETE' then v_row := old; else v_row := new; end if;

  insert into public.inventory_audit_log (instance_id, actor_id, action, new_value)
  values (
    v_row.instance_id, (select auth.uid()),
    case when TG_OP = 'DELETE' then 'assignment_removed' else 'inventory_assigned' end,
    jsonb_build_object('user_id', v_row.user_id)
  );
  return null;
end;
$$;

create trigger inventory_assignments_audit
  after insert or delete on public.inventory_assignments
  for each row execute function public.inventory_audit_assignment();

create or replace function public.inventory_audit_grant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.inventory_audit_log (instance_id, actor_id, action, new_value)
  values (
    new.instance_id, (select auth.uid()),
    case when TG_OP = 'INSERT' then 'edit_permission_granted' else 'edit_permission_revoked' end,
    jsonb_build_object(
      'user_id', new.user_id, 'scope', new.scope,
      'starts_at', new.starts_at, 'ends_at', new.ends_at,
      'granted_by', new.granted_by, 'revoked_at', new.revoked_at
    )
  );
  return null;
end;
$$;

create trigger inventory_grants_audit
  after insert or update on public.inventory_edit_grants
  for each row execute function public.inventory_audit_grant();

-- ============================================================
-- Row Level Security
--
-- Frontend checks are cosmetic. These policies plus the SECURITY DEFINER
-- RPCs are the real boundary. Note that NOBODY has a direct UPDATE policy on
-- inventory_instance_items: Inventory Digital is admin-only and physical
-- stock is trigger-derived, so every write there goes through an RPC that
-- re-checks the rule it enforces.
-- ============================================================
alter table public.inventory_locations           enable row level security;
alter table public.inventory_templates           enable row level security;
alter table public.inventory_template_items      enable row level security;
alter table public.inventory_template_assignees  enable row level security;
alter table public.inventory_instances           enable row level security;
alter table public.inventory_assignments         enable row level security;
alter table public.inventory_instance_items      enable row level security;
alter table public.inventory_entries             enable row level security;
alter table public.inventory_resolutions         enable row level security;
alter table public.inventory_digital_history     enable row level security;
alter table public.inventory_comments            enable row level security;
alter table public.inventory_edit_grants         enable row level security;
alter table public.inventory_audit_log           enable row level security;

-- ---------- configuration: approved read, admin write ----------
create policy "inventory_locations: approved read" on public.inventory_locations
  for select to authenticated using (public.is_approved());
create policy "inventory_locations: admin writes" on public.inventory_locations
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "inventory_templates: approved read" on public.inventory_templates
  for select to authenticated using (public.is_approved());
create policy "inventory_templates: admin writes" on public.inventory_templates
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "inventory_template_items: approved read" on public.inventory_template_items
  for select to authenticated using (public.is_approved());
create policy "inventory_template_items: admin writes" on public.inventory_template_items
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "inventory_template_assignees: approved read" on public.inventory_template_assignees
  for select to authenticated using (public.is_approved());
create policy "inventory_template_assignees: admin writes" on public.inventory_template_assignees
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---------- instances ----------
-- Users may VIEW inventories under the app's existing access rule (any
-- approved user reads operational data); only assigned users may MODIFY, and
-- modification never happens on this table directly.
create policy "inventory_instances: approved read" on public.inventory_instances
  for select to authenticated using (public.is_approved());
create policy "inventory_instances: admin writes" on public.inventory_instances
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "inventory_assignments: approved read" on public.inventory_assignments
  for select to authenticated using (public.is_approved());
create policy "inventory_assignments: admin writes" on public.inventory_assignments
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "inventory_instance_items: approved read" on public.inventory_instance_items
  for select to authenticated using (public.is_approved());
-- Admin-only, and even an admin sets Inventory Digital through the RPC so the
-- change is recorded in the history table.
create policy "inventory_instance_items: admin writes" on public.inventory_instance_items
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---------- entries: the counting user's workspace ----------
-- Written directly rather than through an RPC because every rule that applies
-- is already unbypassable here: inventory_can_edit() gates who and when, the
-- shape trigger gates which fields, the CHECK constraints gate the values,
-- and physical_stock is derived by trigger regardless of what is sent.
create policy "inventory_entries: approved read" on public.inventory_entries
  for select to authenticated using (public.is_approved());

create policy "inventory_entries: editor inserts" on public.inventory_entries
  for insert to authenticated
  with check (
    public.inventory_can_edit(instance_id)
    -- Attribution is not optional: every change identifies its author.
    and created_by = (select auth.uid())
  );

create policy "inventory_entries: editor updates" on public.inventory_entries
  for update to authenticated
  using (public.inventory_can_edit(instance_id))
  with check (public.inventory_can_edit(instance_id));

create policy "inventory_entries: editor deletes" on public.inventory_entries
  for delete to authenticated
  using (public.inventory_can_edit(instance_id));

-- ---------- history: readable, never rewritten ----------
create policy "inventory_resolutions: approved read" on public.inventory_resolutions
  for select to authenticated using (public.is_approved());
-- Insert only via the RPC, which requires the note.

create policy "inventory_digital_history: approved read" on public.inventory_digital_history
  for select to authenticated using (public.is_approved());

create policy "inventory_audit_log: admin reads" on public.inventory_audit_log
  for select to authenticated using (public.is_admin());

-- ---------- comments ----------
-- No DELETE policy, deliberately: a comment is part of the audit record of a
-- count and is preserved permanently.
create policy "inventory_comments: approved read" on public.inventory_comments
  for select to authenticated using (public.is_approved());

create policy "inventory_comments: approved insert own" on public.inventory_comments
  for insert to authenticated
  with check (public.is_approved() and user_id = (select auth.uid()));

-- ---------- grants ----------
-- A user can see the permission they hold (so the UI can explain why they can
-- suddenly edit), but only an admin can create or revoke one.
create policy "inventory_grants: own or admin read" on public.inventory_edit_grants
  for select to authenticated
  using (user_id = (select auth.uid()) or public.is_admin());

create policy "inventory_grants: admin writes" on public.inventory_edit_grants
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ============================================================
-- Mutation RPCs
--
-- The only path by which the rules below can be applied, for any role.
-- ============================================================

-- ---------- user completes the count ----------
create or replace function public.inventory_complete(p_instance_id uuid)
returns public.inventory_instances
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.inventory_instances;
begin
  if not public.inventory_can_edit(p_instance_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  update public.inventory_instances
     set completed_at = now(),
         completed_by = (select auth.uid())
   where id = p_instance_id
     and completed_at is null
   returning * into v_row;

  if not found then
    raise exception 'inventory_already_completed' using errcode = '23505';
  end if;

  -- Re-derive every item now that the instance is closed: on a template with
  -- Inventory Digital disabled, completion is what moves items to Completed.
  update public.inventory_instance_items
     set updated_at = now()
   where instance_id = p_instance_id;

  perform public.inventory_sync_instance_status(p_instance_id);

  select * into v_row from public.inventory_instances where id = p_instance_id;
  return v_row;
end;
$$;

-- ---------- admin reopens a completed count ----------
create or replace function public.inventory_reopen(p_instance_id uuid)
returns public.inventory_instances
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.inventory_instances;
begin
  if not public.is_admin() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  update public.inventory_instances
     set completed_at = null, completed_by = null
   where id = p_instance_id
   returning * into v_row;

  if not found then
    raise exception 'inventory_not_found' using errcode = 'P0002';
  end if;

  update public.inventory_instance_items set updated_at = now() where instance_id = p_instance_id;
  perform public.inventory_sync_instance_status(p_instance_id);

  select * into v_row from public.inventory_instances where id = p_instance_id;
  return v_row;
end;
$$;

-- ---------- admin enters or changes Inventory Digital ----------
/*
 * Admin-only, and the ONLY writer of digital_quantity.
 *
 * Changing the value later never overwrites the record of what it used to be:
 * every change appends to inventory_digital_history with both values, both
 * differences, the physical stock at the time, and who did it.
 *
 * A change also invalidates any standing resolution — the admin signed off on
 * numbers that no longer exist — but the resolution ROW survives, marked
 * superseded, so the reasoning stays readable.
 */
create or replace function public.inventory_set_digital(
  p_item_id uuid,
  p_value   int
)
returns public.inventory_instance_items
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.inventory_instance_items;
  v_enabled boolean;
  -- Captured BEFORE the update, because `returning * into v_item` replaces
  -- the row and the history entry has to record what the value used to be.
  v_prev_digital int;
  v_prev_diff int;
  v_new_diff  int;
  v_stock     int;
begin
  if not public.is_admin() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  if p_value is not null and p_value < 0 then
    raise exception 'negative_quantity' using errcode = '22023';
  end if;

  select * into v_item from public.inventory_instance_items where id = p_item_id;
  if not found then
    raise exception 'inventory_item_not_found' using errcode = 'P0002';
  end if;

  select digital_enabled into v_enabled
    from public.inventory_instances where id = v_item.instance_id;

  if not v_enabled then
    raise exception 'digital_disabled_for_template' using errcode = '42501';
  end if;

  v_prev_digital := v_item.digital_quantity;
  v_prev_diff    := v_item.difference;
  v_stock        := v_item.physical_stock;
  v_new_diff     := case when p_value is null then null else v_stock - p_value end;

  update public.inventory_instance_items
     set digital_quantity = p_value,
         -- The signed-off numbers changed, so the sign-off no longer applies.
         is_resolved = false,
         resolved_at = null,
         resolved_by = null
   where id = p_item_id
   returning * into v_item;

  update public.inventory_resolutions
     set superseded_at = now()
   where instance_item_id = p_item_id and superseded_at is null;

  insert into public.inventory_digital_history (
    instance_item_id, instance_id, previous_digital, new_digital,
    physical_stock_at, previous_difference, new_difference, changed_by
  ) values (
    p_item_id, v_item.instance_id, v_prev_digital, p_value,
    v_stock, v_prev_diff, v_new_diff, (select auth.uid())
  );

  insert into public.inventory_audit_log (
    instance_id, instance_item_id, actor_id, action, previous_value, new_value
  ) values (
    v_item.instance_id, p_item_id, (select auth.uid()), 'digital_set',
    jsonb_build_object('digital', v_prev_digital, 'difference', v_prev_diff),
    jsonb_build_object('digital', p_value, 'difference', v_new_diff)
  );

  perform public.inventory_sync_instance_status(v_item.instance_id);
  return v_item;
end;
$$;

-- ---------- admin resolves a difference ----------
/*
 * An admin may resolve an item even though the difference is still non-zero.
 * That is intentional: "checked with Freddy, physical count confirmed, the
 * digital inventory needs adjusting" is a legitimate outcome.
 *
 * What is not optional is the reason, and the numbers it was given for.
 */
create or replace function public.inventory_resolve_item(
  p_item_id uuid,
  p_note    text
)
returns public.inventory_instance_items
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.inventory_instance_items;
begin
  if not public.is_admin() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  if p_note is null or length(btrim(p_note)) = 0 then
    raise exception 'resolution_note_required' using errcode = '22023';
  end if;

  select * into v_item from public.inventory_instance_items where id = p_item_id;
  if not found then
    raise exception 'inventory_item_not_found' using errcode = 'P0002';
  end if;

  -- Resolution answers a difference. There is nothing to resolve on an item
  -- that reconciles, or that is still waiting for its Inventory Digital
  -- value — resolving those would put an unexplainable state in the record.
  -- Re-resolving an already-resolved item IS allowed: it appends a new note.
  if v_item.status not in ('to_review', 'resolved') then
    raise exception 'nothing_to_resolve' using errcode = '22023';
  end if;

  -- Freeze what was decided, and on what basis.
  insert into public.inventory_resolutions (
    instance_item_id, instance_id, note,
    physical_stock_at, digital_at, difference_at, resolved_by
  ) values (
    p_item_id, v_item.instance_id, btrim(p_note),
    v_item.physical_stock, v_item.digital_quantity, v_item.difference, (select auth.uid())
  );

  update public.inventory_instance_items
     set is_resolved = true,
         resolved_at = now(),
         resolved_by = (select auth.uid())
   where id = p_item_id
   returning * into v_item;

  insert into public.inventory_audit_log (
    instance_id, instance_item_id, actor_id, action, new_value
  ) values (
    v_item.instance_id, p_item_id, (select auth.uid()), 'item_resolved',
    jsonb_build_object(
      'note', btrim(p_note),
      'physical_stock', v_item.physical_stock,
      'digital', v_item.digital_quantity,
      'difference', v_item.difference
    )
  );

  perform public.inventory_sync_instance_status(v_item.instance_id);
  return v_item;
end;
$$;

-- ---------- admin grants a temporary edit window ----------
create or replace function public.inventory_grant_edit(
  p_user_id     uuid,
  p_scope       public.inventory_grant_scope,
  p_instance_id uuid,
  p_starts_at   timestamptz,
  p_ends_at     timestamptz,
  p_reason      text default null
)
returns public.inventory_edit_grants
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.inventory_edit_grants;
begin
  if not public.is_admin() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  if p_ends_at <= p_starts_at then
    raise exception 'invalid_window' using errcode = '22023';
  end if;

  -- Checked here as well as in the table constraint so the caller gets a
  -- specific, translatable error rather than a constraint name.
  if (p_starts_at at time zone 'Europe/Zurich')::date
     <> (p_ends_at at time zone 'Europe/Zurich')::date then
    raise exception 'grant_spans_multiple_days' using errcode = '22023';
  end if;

  insert into public.inventory_edit_grants (
    user_id, scope, instance_id, starts_at, ends_at, reason, granted_by
  ) values (
    p_user_id, p_scope,
    case when p_scope = 'instance' then p_instance_id else null end,
    p_starts_at, p_ends_at, nullif(btrim(coalesce(p_reason, '')), ''), (select auth.uid())
  )
  returning * into v_row;

  return v_row;
end;
$$;

create or replace function public.inventory_revoke_grant(p_grant_id uuid)
returns public.inventory_edit_grants
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.inventory_edit_grants;
begin
  if not public.is_admin() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  update public.inventory_edit_grants
     set revoked_at = now(), revoked_by = (select auth.uid())
   where id = p_grant_id and revoked_at is null
   returning * into v_row;

  if not found then
    raise exception 'grant_not_found' using errcode = 'P0002';
  end if;
  return v_row;
end;
$$;

-- ---------- grants ----------
revoke all on function public.inventory_complete(uuid) from public;
revoke all on function public.inventory_reopen(uuid) from public;
revoke all on function public.inventory_set_digital(uuid, int) from public;
revoke all on function public.inventory_resolve_item(uuid, text) from public;
revoke all on function public.inventory_grant_edit(uuid, public.inventory_grant_scope, uuid, timestamptz, timestamptz, text) from public;
revoke all on function public.inventory_revoke_grant(uuid) from public;
revoke all on function public.inventory_sync_instance_status(uuid) from public;

grant execute on function public.inventory_complete(uuid) to authenticated;
grant execute on function public.inventory_reopen(uuid) to authenticated;
grant execute on function public.inventory_set_digital(uuid, int) to authenticated;
grant execute on function public.inventory_resolve_item(uuid, text) to authenticated;
grant execute on function public.inventory_grant_edit(uuid, public.inventory_grant_scope, uuid, timestamptz, timestamptz, text) to authenticated;
grant execute on function public.inventory_revoke_grant(uuid) to authenticated;

-- ============================================================
-- notification dedupe
--
-- Reuses the existing push infrastructure; this table only records what has
-- already been sent so an alert cannot re-fire on every scheduler tick.
-- ============================================================
create table public.inventory_notifications (
  id          uuid primary key default gen_random_uuid(),
  instance_id uuid not null references public.inventory_instances (id) on delete cascade,
  kind        text not null check (kind in (
    'assigned', 'due_today', 'deadline_soon', 'completed', 'digital_pending', 'review_required'
  )),
  sent_at     timestamptz not null default now(),
  recipients  int not null default 0,

  constraint inventory_notifications_once unique (instance_id, kind)
);

alter table public.inventory_notifications enable row level security;

create policy "inventory_notifications: admin reads" on public.inventory_notifications
  for select to authenticated using (public.is_admin());

comment on table public.inventory_notifications is
  'Dedupe log: one row per (inventory, notification kind) so an alert fires once.';

-- ============================================================
-- seed: the two counting locations Empaques uses today
--
-- Data, not structure, so an admin can rename, deactivate or add to them
-- without a migration.
-- ============================================================
insert into public.inventory_locations (slug, name, sort_order) values
  ('lager-4to-piso', 'Lager 4to Piso', 10),
  ('fabrica',        'Fábrica',        20)
on conflict (slug) do nothing;
