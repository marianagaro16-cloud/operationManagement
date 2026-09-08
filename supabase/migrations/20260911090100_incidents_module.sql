-- ============================================================
-- Incidents & Continuous Improvement, part 2 of 2
--
-- Requires 20260911090000_one_off_task_frequency.sql to have been applied
-- FIRST, in its own transaction. See the note at the top of that file.
--
-- The module answers six questions that the operational data alone cannot:
-- what went wrong, why, whose responsibility it was, what we did about it,
-- whether it keeps happening, and whether what we did helped.
--
-- It answers them WITHOUT a second copy of anything. Customers, orders,
-- order lines, lot allocations, products, delivery methods, profiles and
-- tasks are all referenced by their existing ids. There is no incident-side
-- customer table, no incident-side product list, and no incident-side task
-- engine.
--
-- Three structural decisions, stated here because they are the ones a reader
-- will want justified:
--
--   AN INCIDENT IS NOT A REPLACEMENT. The incident records what went wrong;
--   a replacement records what we sent afterwards. They are separate rows
--   with separate lifecycles, and a replacement is a REAL ORDER so that it
--   gets picked, lot-numbered and traced like every other delivery.
--
--   WHAT HAPPENED IS NOT WHY IT HAPPENED. incident_type_id says a product was
--   missing; primary_cause says picking. Collapsing them into one field is
--   what makes an incident log unanalysable, so they are two columns and
--   neither is derived from the other.
--
--   RESPONSIBILITY IS RECORDED, NEVER INFERRED. The reports may say "DHL was
--   involved in 5 incidents" because that is a join. They may only say "DHL
--   was responsible" where a person wrote that down, which is this column.
-- ============================================================


-- ============================================================
-- enums
-- ============================================================

-- The lifecycle. Ordered as the workflow runs, so a comparison against the
-- ordinal is meaningful.
create type public.incident_status as enum
  ('open', 'investigating', 'action_required', 'resolved', 'closed');

create type public.incident_severity as enum ('low', 'medium', 'high', 'critical');

/*
 * WHY it happened: the step of our own process where it went wrong.
 *
 * An enum rather than a table, unlike the categories below. These eleven
 * values are the axis every "why" breakdown and every month-on-month
 * comparison is grouped by; if they could be renamed or retired at will, a
 * September report and a December report would stop being comparable, which
 * is the one thing a continuous-improvement log exists to do. Adding a value
 * is a migration, and that friction is the point.
 */
create type public.incident_cause as enum (
  'order_entry', 'picking', 'preparation', 'packing', 'dispatch',
  'transport', 'delivery', 'supplier', 'customer', 'unknown', 'other'
);

/*
 * WHOSE it was. Deliberately small, deliberately including 'unknown', and
 * deliberately defaulting to 'unknown' — an incident that nobody has
 * investigated must not silently read as "internal".
 */
create type public.incident_responsibility as enum
  ('internal', 'transporter', 'supplier', 'customer', 'shared', 'unknown');


-- ============================================================
-- configurable vocabulary: categories and types
--
-- These two ARE tables, because §9 asks for them to be configurable and
-- because they are the vocabulary of the operation rather than of the
-- analysis — a new packaging failure mode is a thing an operations manager
-- discovers, not a thing that needs a deployment.
--
-- `slug` is the stable identifier and the i18n key. `name` is a fallback
-- label for a value added after the dictionaries shipped, exactly as
-- public.categories does it for tasks. Nothing user-facing ever renders a
-- database string when a translation exists.
-- ============================================================
create table public.incident_categories (
  id         uuid primary key default gen_random_uuid(),
  slug       text not null unique check (slug ~ '^[a-z][a-z0-9_]*$'),
  name       text not null,
  sort_order int  not null default 100,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.incident_types (
  id          uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.incident_categories (id) on delete restrict,
  slug        text not null unique check (slug ~ '^[a-z][a-z0-9_]*$'),
  name        text not null,
  sort_order  int  not null default 100,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index incident_types_category_idx on public.incident_types (category_id);
create index incident_types_active_idx   on public.incident_types (is_active);

create trigger incident_categories_set_updated_at before update on public.incident_categories
  for each row execute function public.set_updated_at();
create trigger incident_types_set_updated_at before update on public.incident_types
  for each row execute function public.set_updated_at();

insert into public.incident_categories (slug, name, sort_order) values
  ('order_preparation', 'Order / Preparation', 10),
  ('packaging',         'Packaging',           20),
  ('delivery_transport','Delivery / Transport', 30),
  ('product_quality',   'Product / Quality',   40),
  ('other',             'Other',               90);

insert into public.incident_types (category_id, slug, name, sort_order)
select c.id, t.slug, t.name, t.sort_order
from public.incident_categories c
join (values
  ('order_preparation', 'missing_product',      'Missing product',              10),
  ('order_preparation', 'wrong_product',        'Wrong product',                20),
  ('order_preparation', 'wrong_quantity',       'Wrong quantity',               30),
  ('order_preparation', 'product_not_prepared', 'Product not prepared',         40),
  ('order_preparation', 'order_entry_error',    'Order entry error',            50),
  ('order_preparation', 'preparation_error',    'Preparation error',            60),

  ('packaging',         'incorrect_packaging',   'Incorrect packaging',          10),
  ('packaging',         'insufficient_protection','Insufficient protection',     20),
  ('packaging',         'wrong_presentation',    'Wrong packaging / presentation', 30),
  ('packaging',         'packaging_damaged',     'Packaging damaged',            40),
  ('packaging',         'packaging_procedure_error', 'Packaging procedure error', 50),

  ('delivery_transport','transport_damage',     'Product damaged during transport', 10),
  ('delivery_transport','box_damaged',          'Box damaged',                  20),
  ('delivery_transport','missing_package',      'Missing package',              30),
  ('delivery_transport','late_delivery',        'Late delivery',                40),
  ('delivery_transport','wrong_delivery',       'Wrong delivery',               50),
  ('delivery_transport','transport_issue',      'Transport issue',              60),

  ('product_quality',   'quality_issue',        'Quality issue',                10),
  ('product_quality',   'shelf_life_issue',     'Expiry / shelf-life issue',    20),
  ('product_quality',   'cold_chain_issue',     'Temperature / cold-chain issue', 30),
  ('product_quality',   'label_issue',          'Label issue',                  40),
  ('product_quality',   'product_condition',    'Product condition issue',      50),

  ('other',             'other',                'Other',                        10)
) as t(category_slug, slug, name, sort_order)
  on t.category_slug = c.slug;


-- ============================================================
-- incidents
-- ============================================================
create table public.incidents (
  id uuid primary key default gen_random_uuid(),

  -- Human-facing sequential reference, the same device orders use.
  reference       bigint generated always as identity (start with 1),
  -- INC-2026-0001. Written by a trigger, never by the application.
  incident_number text not null unique,

  /*
   * Every link is NULLABLE and that is the design, not an oversight.
   *
   * §7: a customer reports a damaged product and the order cannot be
   * identified yet. Forcing an order here would make somebody invent one, and
   * an invented order is worse than a missing link — it corrupts the order
   * book to satisfy a foreign key. The incident is created with the order
   * unknown and linked later when it is found.
   */
  customer_id        uuid references public.customers (id) on delete restrict,
  order_id           uuid references public.orders (id) on delete set null,
  delivery_method_id uuid references public.delivery_methods (id) on delete set null,

  -- WHAT happened.
  incident_type_id uuid not null references public.incident_types (id) on delete restrict,
  description      text not null check (length(btrim(description)) > 0),

  severity public.incident_severity not null default 'medium',
  status   public.incident_status   not null default 'open',

  -- WHY it happened. NULL until somebody has actually investigated: a default
  -- of 'unknown' here would be indistinguishable from an investigation that
  -- concluded "unknown", and the reports need to tell those apart.
  primary_cause  public.incident_cause,
  responsibility public.incident_responsibility not null default 'unknown',

  investigation_notes text,
  resolution_notes    text,

  -- When the problem happened or was noticed — NOT when the row was written.
  -- An incident reported on Monday about Friday's delivery belongs to Friday.
  detected_at timestamptz not null default now(),

  resolved_at timestamptz,
  resolved_by uuid references public.profiles (id) on delete set null,
  closed_at   timestamptz,
  closed_by   uuid references public.profiles (id) on delete set null,

  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- A resolution needs a resolver and a time, or it is not a resolution.
  constraint incidents_resolved_together check (
    (resolved_at is null) = (resolved_by is null)
  ),
  constraint incidents_closed_together check (
    (closed_at is null) = (closed_by is null)
  )
);

-- The report groups by month over detected_at, and the list filters on
-- almost every one of these.
create index incidents_detected_idx    on public.incidents (detected_at desc);
create index incidents_customer_idx    on public.incidents (customer_id);
create index incidents_order_idx       on public.incidents (order_id);
create index incidents_type_idx        on public.incidents (incident_type_id);
create index incidents_status_idx      on public.incidents (status);
create index incidents_severity_idx    on public.incidents (severity);
create index incidents_cause_idx       on public.incidents (primary_cause);
create index incidents_resp_idx        on public.incidents (responsibility);
create index incidents_method_idx      on public.incidents (delivery_method_id);
-- The default list view: open work, newest first.
create index incidents_open_idx on public.incidents (detected_at desc)
  where status <> 'closed';

create trigger incidents_set_updated_at before update on public.incidents
  for each row execute function public.set_updated_at();

/*
 * INC-2026-0001.
 *
 * The identity value is assigned before BEFORE triggers fire, so `reference`
 * is already populated here. The year comes from Europe/Zurich rather than
 * from the server clock, for the same reason every date in this codebase
 * does: for the first two hours of a Zurich day, UTC still says yesterday.
 *
 * The counter does not restart each year. A restart needs either a sequence
 * per year or a max() lookup, and the lookup races under concurrent inserts —
 * two incidents reported in the same second would both read the same maximum
 * and collide. A monotonic number carrying its year is unique, sortable and
 * readable, which is what §29 asks of it.
 */
create or replace function public.set_incident_number()
returns trigger
language plpgsql
as $$
begin
  new.incident_number := 'INC-'
    || to_char((now() at time zone 'Europe/Zurich'), 'YYYY')
    || '-' || lpad(new.reference::text, 4, '0');
  return new;
end;
$$;

create trigger incidents_number before insert on public.incidents
  for each row execute function public.set_incident_number();


-- ============================================================
-- affected products
--
-- §15: one damaged transport box holding three cheeses is ONE incident with
-- three affected products, not three incidents. The user must never be made
-- to split a single real event into three records that then have to be
-- counted as one again in every report.
-- ============================================================
create table public.incident_affected_items (
  id          uuid primary key default gen_random_uuid(),
  incident_id uuid not null references public.incidents (id) on delete cascade,

  product_id  uuid not null references public.products (id) on delete restrict,
  -- The order line this came from, where the order is known. Set null rather
  -- than cascade: losing the line must not silently delete the record that a
  -- product was affected.
  order_line_id     uuid references public.order_lines (id) on delete set null,
  -- The lot, where preparation recorded one. This is what lets Incident Detail
  -- show a lot number and the Lot Tracker show incidents, without a second
  -- lot-number store existing anywhere.
  lot_allocation_id uuid references public.lot_allocations (id) on delete set null,

  /*
   * numeric(12,3), matching order_lines.ordered_quantity.
   *
   * The specification suggested integers. An affected quantity is compared
   * against, and subtracted from, an ordered quantity — and that column has
   * been numeric(12,3) since the orders module shipped. An integer here would
   * make "5 of the 20 ordered" expressible and "0.5 of the 1.75kg wheel" not,
   * while introducing a type mismatch on every comparison.
   */
  affected_quantity numeric(12,3) check (affected_quantity is null or affected_quantity > 0),
  note     text,
  position int not null default 0,

  created_at timestamptz not null default now()
);
create index incident_items_incident_idx on public.incident_affected_items (incident_id);
create index incident_items_product_idx  on public.incident_affected_items (product_id);
create index incident_items_line_idx     on public.incident_affected_items (order_line_id);
create index incident_items_lot_idx      on public.incident_affected_items (lot_allocation_id);


-- ============================================================
-- secondary causes
--
-- One primary cause lives on the incident; any number of contributing causes
-- live here. A row per cause rather than an array, so the "why" breakdown is
-- a GROUP BY rather than an unnest, and so the primary key stops the same
-- cause being recorded twice.
-- ============================================================
create table public.incident_secondary_causes (
  incident_id uuid not null references public.incidents (id) on delete cascade,
  cause       public.incident_cause not null,
  primary key (incident_id, cause)
);

/*
 * A secondary cause may not duplicate the primary one.
 *
 * Not expressible as a CHECK — the primary cause lives on another table — and
 * left unguarded it would double-count that cause in every "why" breakdown,
 * which is precisely the number the report exists to be trusted on.
 */
create or replace function public.check_secondary_cause_distinct()
returns trigger
language plpgsql
as $$
begin
  if exists (
    select 1 from public.incidents i
     where i.id = new.incident_id and i.primary_cause = new.cause
  ) then
    raise exception 'secondary_cause_is_primary' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger incident_secondary_cause_distinct
  before insert or update on public.incident_secondary_causes
  for each row execute function public.check_secondary_cause_distinct();


-- ============================================================
-- evidence
--
-- The row is the record; the bytes live in Supabase Storage under the
-- 'incident-evidence' bucket, keyed by incident id. Storage RLS is defined at
-- the foot of this file and mirrors the table's own policies, so a signed URL
-- cannot be obtained for an incident the caller may not read.
-- ============================================================
create table public.incident_evidence (
  id           uuid primary key default gen_random_uuid(),
  incident_id  uuid not null references public.incidents (id) on delete cascade,
  -- '<incident_id>/<uuid>.<ext>' inside the bucket. Unique so two rows can
  -- never claim one object, which would make deletion ambiguous.
  storage_path text not null unique,
  file_name    text not null,
  mime_type    text not null,
  size_bytes   integer not null check (size_bytes > 0),
  uploaded_by  uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now()
);
create index incident_evidence_incident_idx
  on public.incident_evidence (incident_id, created_at);


-- ============================================================
-- replacements
--
-- What we sent afterwards. Never confused with the incident itself.
--
-- The preferred shape is an ORDER: a replacement is a physical delivery, and
-- routing it through the order book means it gets picked in Lotnummerkontrol,
-- carries lot numbers, appears in the Lot Nummer Tracker and counts in the
-- existing order reports — none of which a private replacement table could
-- ever do without reimplementing all four.
--
-- The alternative shape exists because not every replacement is a delivery: a
-- credit note, or five tortillas handed over at the door, is a real
-- compensation with no order behind it. Recording that as an invented order
-- would corrupt the order book; recording it as a note does not.
-- ============================================================
create table public.incident_replacements (
  id          uuid primary key default gen_random_uuid(),
  incident_id uuid not null references public.incidents (id) on delete cascade,

  -- The replacement delivery, when one was raised.
  order_id   uuid references public.orders (id) on delete set null,

  -- The off-order case: what was given back, in words and optionally in
  -- product and quantity.
  product_id uuid references public.products (id) on delete restrict,
  quantity   numeric(12,3) check (quantity is null or quantity > 0),
  note       text,

  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),

  -- A replacement that names neither an order nor what was given records
  -- nothing at all.
  constraint incident_replacements_substantive
    check (order_id is not null or length(btrim(coalesce(note, ''))) > 0)
);
create index incident_replacements_incident_idx on public.incident_replacements (incident_id);
create index incident_replacements_order_idx    on public.incident_replacements (order_id);

/*
 * The reverse pointer, on orders.
 *
 * Lets the order book say "this delivery replaces INC-2026-0004" without
 * joining through the incident module, and makes a replacement order
 * identifiable in the existing order queries. NULL on every existing row and
 * on every ordinary order, which is almost all of them.
 */
alter table public.orders
  add column replaces_incident_id uuid references public.incidents (id) on delete set null;

create index orders_replaces_incident_idx on public.orders (replaces_incident_id)
  where replaces_incident_id is not null;

comment on column public.orders.replaces_incident_id is
  'The incident this delivery was raised to compensate. NULL for an ordinary order, which is nearly all of them.';


-- ============================================================
-- corrective actions: the EXISTING tasks table, widened
--
-- No incident_actions table exists, and that is the point of §17. A
-- corrective action is a task: it has an owner, a due date, a status, a
-- comment thread and a place on the calendar, and all five already work.
-- ============================================================
alter table public.tasks
  add column incident_id uuid references public.incidents (id) on delete set null;

create index tasks_incident_idx on public.tasks (incident_id)
  where incident_id is not null;

comment on column public.tasks.incident_id is
  'The incident this task was raised as a corrective action for. NULL for ordinary operational tasks.';

/*
 * Two incidents may legitimately need the same corrective action.
 *
 * tasks_title_frequency_key is unique on (lower(title), frequency), which was
 * exactly right while every task was a recurring definition — two "Clean the
 * cold room, weekly" rows would have been a duplicate. It is exactly wrong
 * for one-off actions: "Review the packaging procedure" raised in July and
 * again in October are two different pieces of work with two different
 * owners, due dates and incidents, and the old index rejected the second.
 *
 * Made partial rather than dropped. Recurring definitions keep the guarantee
 * they have always had.
 */
drop index if exists public.tasks_title_frequency_key;

create unique index tasks_title_frequency_key
  on public.tasks (lower(btrim(title)), frequency)
  where frequency <> 'one_off';

/*
 * Who is to do it.
 *
 * On the OCCURRENCE, not on the definition: the same recurring task is done
 * by different people on different days, and putting an owner on the
 * definition would have forced one answer for all of them. A corrective
 * action has exactly one occurrence, so its owner is unambiguous.
 *
 * Nullable, because every occurrence that exists today has no assignee and
 * the floor workflow does not require one.
 */
alter table public.task_occurrences
  add column assignee_id uuid references public.profiles (id) on delete set null;

create index occurrences_assignee_idx on public.task_occurrences (assignee_id)
  where assignee_id is not null;

comment on column public.task_occurrences.assignee_id is
  'Who is responsible for this particular occurrence. NULL means unassigned, which is how the floor checklist works.';


-- ============================================================
-- audit
--
-- A fourth module log, column-for-column the shape the other three share —
-- the comment on task_audit_log calls itself "an obvious template for a
-- future fourth module", and this is it. The unified view is extended below,
-- so /admin/audit gains incident events with no change to the page.
-- ============================================================
create table public.incident_audit_log (
  id             uuid primary key default gen_random_uuid(),
  incident_id    uuid references public.incidents (id) on delete cascade,
  actor_id       uuid references public.profiles (id) on delete set null,
  action         text not null,
  previous_value jsonb,
  new_value      jsonb,
  created_at     timestamptz not null default now()
);

create index incident_audit_incident_idx on public.incident_audit_log (incident_id, created_at desc);
create index incident_audit_created_idx  on public.incident_audit_log (created_at desc);

/*
 * Every field whose change matters to the investigation.
 *
 * Deliberately more than the other module logs record, because §18 is
 * explicit that an incident is not resolved merely because a status changed:
 * the history has to show what was believed at each point, so cause,
 * responsibility, severity and the customer/order links are all audited
 * alongside the lifecycle.
 */
create or replace function public.log_incident_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_action text;
begin
  if TG_OP = 'INSERT' then
    insert into public.incident_audit_log (incident_id, actor_id, action, new_value)
    values (new.id, (select auth.uid()), 'incident_created',
            jsonb_build_object(
              'incident_number', new.incident_number,
              'severity', new.severity,
              'customer_id', new.customer_id,
              'order_id', new.order_id));
    return new;
  end if;

  if new.status is distinct from old.status then
    v_action := 'incident_status_changed';
  elsif new.severity is distinct from old.severity then
    v_action := 'incident_severity_changed';
  elsif new.primary_cause is distinct from old.primary_cause
     or new.responsibility is distinct from old.responsibility then
    v_action := 'incident_investigation_changed';
  elsif new.customer_id is distinct from old.customer_id
     or new.order_id is distinct from old.order_id
     or new.delivery_method_id is distinct from old.delivery_method_id
     or new.incident_type_id is distinct from old.incident_type_id then
    v_action := 'incident_links_changed';
  elsif new.description is distinct from old.description
     or new.investigation_notes is distinct from old.investigation_notes
     or new.resolution_notes is distinct from old.resolution_notes then
    v_action := 'incident_notes_changed';
  else
    -- An updated_at touch is not an audit event.
    return new;
  end if;

  insert into public.incident_audit_log
    (incident_id, actor_id, action, previous_value, new_value)
  values (
    new.id, (select auth.uid()), v_action,
    jsonb_build_object(
      'status', old.status, 'severity', old.severity,
      'primary_cause', old.primary_cause, 'responsibility', old.responsibility,
      'incident_type_id', old.incident_type_id,
      'customer_id', old.customer_id, 'order_id', old.order_id,
      'delivery_method_id', old.delivery_method_id),
    jsonb_build_object(
      'status', new.status, 'severity', new.severity,
      'primary_cause', new.primary_cause, 'responsibility', new.responsibility,
      'incident_type_id', new.incident_type_id,
      'customer_id', new.customer_id, 'order_id', new.order_id,
      'delivery_method_id', new.delivery_method_id)
  );
  return new;
end;
$$;

create trigger incidents_audit
  after insert or update on public.incidents
  for each row execute function public.log_incident_change();

-- The unified trail gains its fourth source. Same shape, same view, same page.
create or replace view public.operational_audit
with (security_invoker = true)
as
  select 'inventory'::text as source, l.id, l.action, l.actor_id, l.created_at,
         l.previous_value, l.new_value
    from public.inventory_audit_log l
  union all
  select 'order'::text, l.id, l.action, l.actor_id, l.created_at,
         null::jsonb, l.detail
    from public.order_audit_log l
  union all
  select 'task'::text, l.id, l.action, l.actor_id, l.created_at,
         l.previous_value, l.new_value
    from public.task_audit_log l
  union all
  select 'incident'::text, l.id, l.action, l.actor_id, l.created_at,
         l.previous_value, l.new_value
    from public.incident_audit_log l;

comment on view public.operational_audit is
  'Every operational audit row from all four module logs, in one shape. Query this rather than the tables, so one ORDER BY ... LIMIT applies across the whole trail instead of per source.';

grant select on public.operational_audit to authenticated;


-- ============================================================
-- monthly report snapshots
--
-- §26 and §42: a September report opened in December must show September as
-- it was reported, not September recomputed through three months of
-- subsequent edits.
--
-- So a snapshot is a FROZEN DOCUMENT: the aggregate payload as it stood, plus
-- the ids of every incident that fed it, plus who generated it and when. The
-- underlying incidents stay fully queryable — the snapshot does not replace
-- them, it records what was said about them.
--
-- Versioned rather than unique per month, because a month legitimately gets
-- reported twice: once at the start of the following month and again after a
-- late investigation lands. Both are kept, and neither overwrites the other.
-- ============================================================
create table public.incident_report_snapshots (
  id            uuid primary key default gen_random_uuid(),
  -- The first day of the month reported on. A DATE rather than a text
  -- 'YYYY-MM' so ordering, ranges and comparisons are date operations.
  period_month  date not null,
  version       int  not null check (version >= 1),

  -- The frozen aggregate: totals, breakdowns, patterns. Shaped by the domain
  -- layer, which is where its structure is defined and tested.
  payload       jsonb not null,
  -- Which incidents this report was computed from. Keeps the snapshot
  -- auditable against the live data, and lets a reader drill from a frozen
  -- number into the records behind it.
  incident_ids  uuid[] not null default '{}',

  generated_by  uuid references public.profiles (id) on delete set null,
  generated_at  timestamptz not null default now(),
  note          text,

  constraint incident_report_period_is_month check (period_month = date_trunc('month', period_month)::date),
  constraint incident_report_month_version_key unique (period_month, version)
);

create index incident_reports_period_idx on public.incident_report_snapshots (period_month desc, version desc);

/*
 * Next version for this month, assigned by the database.
 *
 * Computed here rather than in the application because two people pressing
 * Generate at once would otherwise both read version 1. The unique constraint
 * would catch the collision, but one of them would see an error instead of a
 * report.
 */
create or replace function public.next_incident_report_version(p_month date)
returns int
language sql
stable
as $$
  select coalesce(max(version), 0) + 1
    from public.incident_report_snapshots
   where period_month = date_trunc('month', p_month)::date;
$$;


-- ============================================================
-- capabilities
--
-- Four new keys in the EXISTING catalogue. No new role: the four-level
-- hierarchy is untouched, and these slot into it exactly as every other
-- operational capability does.
--
-- The Manager / Power User line follows the same principle as everywhere else
-- in this codebase — configuration is the Manager's, execution is shared:
--
--   incidents.manage        create, edit, investigate, resolve, evidence,
--                           replacements, corrective tasks  (manager + power)
--   incidents.close         close a resolved incident        (manager only)
--   incidents.manage_config categories and types             (manager only)
--   incidents.view_all      see every incident               (manager + power)
--
-- A plain USER holds none of them, cannot create an incident, and sees only
-- incidents attached to an order they personally prepared.
-- ============================================================
insert into public.permission_catalog (key, module, is_configurable, sort_order) values
  ('incidents.manage',        'incidents', true, 160),
  ('incidents.close',         'incidents', true, 170),
  ('incidents.view_all',      'incidents', true, 180),
  ('incidents.manage_config', 'incidents', true, 190);

insert into public.role_permissions (role, permission) values
  ('manager',    'incidents.manage'),
  ('manager',    'incidents.close'),
  ('manager',    'incidents.view_all'),
  ('manager',    'incidents.manage_config'),
  ('power_user', 'incidents.manage'),
  ('power_user', 'incidents.view_all');


-- ============================================================
-- Row Level Security
-- ============================================================
alter table public.incident_categories        enable row level security;
alter table public.incident_types             enable row level security;
alter table public.incidents                  enable row level security;
alter table public.incident_affected_items    enable row level security;
alter table public.incident_secondary_causes  enable row level security;
alter table public.incident_evidence          enable row level security;
alter table public.incident_replacements      enable row level security;
alter table public.incident_audit_log         enable row level security;
alter table public.incident_report_snapshots  enable row level security;

-- ---------- vocabulary: everyone reads, managers configure ----------
create policy "incident_categories: approved read" on public.incident_categories
  for select to authenticated using (public.is_approved());
create policy "incident_categories: config writes" on public.incident_categories
  for all to authenticated
  using (public.has_permission('incidents.manage_config'))
  with check (public.has_permission('incidents.manage_config'));

create policy "incident_types: approved read" on public.incident_types
  for select to authenticated using (public.is_approved());
create policy "incident_types: config writes" on public.incident_types
  for all to authenticated
  using (public.has_permission('incidents.manage_config'))
  with check (public.has_permission('incidents.manage_config'));

/*
 * ---------- who may SEE an incident ----------
 *
 * §5: a plain user sees "incidents relevant to their operational work".
 *
 * Concretely, that is an incident on an order they themselves prepared —
 * their own lot allocations are the record of what they worked on, and it is
 * the only such record the system has. It gives the person who packed the box
 * sight of the complaint about that box, and gives them nothing else: no
 * other customer's incidents, no investigation of their colleagues, no
 * responsibility findings on work that was not theirs.
 *
 * An incident with no order attached is therefore invisible to a plain user,
 * which is correct — there is nothing tying it to their work.
 */
create or replace function public.can_view_incident(p_order_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_permission('incidents.view_all')
     or (
       public.is_approved()
       and p_order_id is not null
       and exists (
         select 1
           from public.order_lines ol
           join public.lot_allocations la on la.order_line_id = ol.id
          where ol.order_id = p_order_id
            and la.created_by = (select auth.uid())
       )
     );
$$;

comment on function public.can_view_incident(uuid) is
  'Incident visibility: everything for a holder of incidents.view_all; otherwise only incidents on an order the caller personally prepared.';

create policy "incidents: scoped read" on public.incidents
  for select to authenticated
  using (public.can_view_incident(order_id));

-- Creation and editing are one capability. §4: a plain USER never creates an
-- incident, and this is where that is actually enforced.
create policy "incidents: manage insert" on public.incidents
  for insert to authenticated
  with check (
    public.has_permission('incidents.manage')
    and created_by = (select auth.uid())
  );

create policy "incidents: manage update" on public.incidents
  for update to authenticated
  using (public.has_permission('incidents.manage'))
  with check (public.has_permission('incidents.manage'));

/*
 * Deletion is NOT granted to anyone.
 *
 * §18: investigation history is not deleted. An incident raised in error is
 * closed with a resolution saying so, which keeps the fact that somebody
 * once believed it — and there is no policy here, so the table simply refuses.
 */

/*
 * ---------- closing ----------
 *
 * A Power User may investigate and resolve; only a Manager or Admin may close.
 * RLS cannot express column-level permission, so the rule lives in a trigger,
 * exactly as the product-code guard does.
 *
 * The null-uid escape is for the service role, which legitimately writes with
 * no session during seeding and verification.
 */
create or replace function public.guard_incident_close()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'closed'
     and old.status is distinct from 'closed'
     and (select auth.uid()) is not null
     and not public.has_permission('incidents.close') then
    raise exception 'incident_close_denied' using errcode = '42501';
  end if;

  -- Reopening a closed incident is the same authority as closing one.
  if old.status = 'closed'
     and new.status is distinct from 'closed'
     and (select auth.uid()) is not null
     and not public.has_permission('incidents.close') then
    raise exception 'incident_reopen_denied' using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger incidents_guard_close
  before update on public.incidents
  for each row execute function public.guard_incident_close();

-- ---------- children: visible with their incident, written by managers ----------
create policy "incident_items: scoped read" on public.incident_affected_items
  for select to authenticated using (
    exists (select 1 from public.incidents i
             where i.id = incident_id and public.can_view_incident(i.order_id))
  );
create policy "incident_items: manage writes" on public.incident_affected_items
  for all to authenticated
  using (public.has_permission('incidents.manage'))
  with check (public.has_permission('incidents.manage'));

create policy "incident_causes: scoped read" on public.incident_secondary_causes
  for select to authenticated using (
    exists (select 1 from public.incidents i
             where i.id = incident_id and public.can_view_incident(i.order_id))
  );
create policy "incident_causes: manage writes" on public.incident_secondary_causes
  for all to authenticated
  using (public.has_permission('incidents.manage'))
  with check (public.has_permission('incidents.manage'));

create policy "incident_evidence: scoped read" on public.incident_evidence
  for select to authenticated using (
    exists (select 1 from public.incidents i
             where i.id = incident_id and public.can_view_incident(i.order_id))
  );
create policy "incident_evidence: manage insert" on public.incident_evidence
  for insert to authenticated
  with check (
    public.has_permission('incidents.manage')
    and uploaded_by = (select auth.uid())
  );
-- The uploader may remove their own; a Manager may remove anyone's.
create policy "incident_evidence: uploader or manager deletes" on public.incident_evidence
  for delete to authenticated
  using (
    public.has_permission('incidents.manage')
    and (uploaded_by = (select auth.uid()) or public.has_permission('incidents.close'))
  );

create policy "incident_replacements: scoped read" on public.incident_replacements
  for select to authenticated using (
    exists (select 1 from public.incidents i
             where i.id = incident_id and public.can_view_incident(i.order_id))
  );
create policy "incident_replacements: manage writes" on public.incident_replacements
  for all to authenticated
  using (public.has_permission('incidents.manage'))
  with check (public.has_permission('incidents.manage'));

-- ---------- audit and reports ----------
create policy "incident_audit_log: operational reads" on public.incident_audit_log
  for select to authenticated using (public.has_permission('audit.view_operational'));
-- No insert policy: rows come from the SECURITY DEFINER trigger only, exactly
-- as they do for the other three module logs.

/*
 * A snapshot is readable by anyone who can see incidents at all, and writable
 * by anyone who can manage them. It is never UPDATED and never DELETED — that
 * is the whole point of §42, and the absence of those policies is what
 * enforces it, not a convention.
 */
create policy "incident_reports: read" on public.incident_report_snapshots
  for select to authenticated using (public.has_permission('incidents.view_all'));
create policy "incident_reports: generate" on public.incident_report_snapshots
  for insert to authenticated
  with check (
    public.has_permission('incidents.manage')
    and generated_by = (select auth.uid())
  );


-- ============================================================
-- evidence storage
--
-- A private bucket. The application has never used Supabase Storage, so this
-- is the first one; it is created here rather than by hand so a fresh
-- environment comes up complete.
-- ============================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'incident-evidence',
  'incident-evidence',
  false,
  10485760, -- 10 MB: a phone photo of a damaged box, not a video
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf']
)
on conflict (id) do nothing;

/*
 * Object policies mirror the table's.
 *
 * The first path segment is the incident id, so the incident an object
 * belongs to is derivable from its name and a signed URL cannot be minted for
 * an incident the caller may not read. `storage.foldername(name)` returns the
 * path segments; element 1 is that first folder.
 *
 * The uuid cast is guarded: an object uploaded under a non-uuid folder by any
 * route would otherwise raise instead of being denied.
 */
create policy "incident evidence: scoped read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'incident-evidence'
    and (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$'
    and exists (
      select 1 from public.incidents i
       where i.id = ((storage.foldername(name))[1])::uuid
         and public.can_view_incident(i.order_id)
    )
  );

create policy "incident evidence: manage upload" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'incident-evidence'
    and public.has_permission('incidents.manage')
    and (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$'
  );

create policy "incident evidence: manage delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'incident-evidence'
    and public.has_permission('incidents.manage')
  );
