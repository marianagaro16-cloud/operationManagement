-- ============================================================
-- GOODS RECEPTION
--
-- One row per physical delivery that arrived from a supplier. It answers
-- "what arrived?", and deliberately nothing else.
--
-- THE THREE SEPARATIONS THIS MODULE IS BUILT ON, each of which is a rule
-- somebody will eventually be tempted to break:
--
--   1. RECEPTION IS NOT INVENTORY. Nothing here writes to inventory_*. No
--      trigger, no function, no view. A reception records that goods arrived
--      at the door; whether they are in stock is a question the inventory
--      count answers, and the two must be able to disagree — that
--      disagreement is exactly what a count is for.
--
--   2. RECEPTION IS NOT A PURCHASE ORDER. There is no ordered-quantity, no
--      expected-vs-received, no purchase document. A delivery is recorded
--      because a lorry turned up, not because a system predicted it.
--
--   3. A RECEPTION IS NOT THE DELIVERY NOTE. There is no product line table.
--      The supplier's note already lists every article; re-keying it would
--      cost the receiver ten minutes per pallet and buy nothing. Products
--      appear ONLY as exceptions — the two crushed boxes, the one carton with
--      a different MHD — because those are the facts the paper does not
--      already carry.
--
-- SUPPLIER vs TRANSPORTER. Two columns, never one. `delivery_methods` was
-- inspected and rejected for the transporter: its live rows are
-- "Entrega en Zürich", "Se recoge en la fábrica", "Envío por DHL" — that list
-- describes how goods leave us for a customer, and half of it is not a
-- carrier at all. Inbound carriage is a different axis and gets its own
-- master, so supplier performance and transporter performance can be reported
-- against each other without either being inferred from the other.
-- ============================================================


-- ============================================================
-- vocabulary
--
-- Enums, so a typo cannot become a fourth status, and so the labels shown to
-- a user live in the i18n dictionaries where they can be translated. The
-- database stores stable identifiers and never a translated string.
-- ============================================================

/*
 * DRAFT -> RECEIVED -> CHECKING -> COMPLETED.
 *
 * No 'issue' or 'problem' state, deliberately. A reception with problems is a
 * COMPLETED reception carrying linked incidents; giving it a status of its
 * own would fork the incident workflow in two and make "how many deliveries
 * had problems" a question with two different answers.
 */
create type public.goods_reception_status as enum (
  'draft',
  'received',
  'checking',
  'completed'
);

create type public.goods_reception_condition as enum (
  'good',
  'damaged',
  'partially_damaged',
  'other_issue'
);

/*
 * Exactly three states, and the middle one is not a boolean in disguise.
 *
 * 'not_checked' is a real answer — the pallet is in the cold store and nobody
 * has opened it yet — and it must be tellable apart from 'checked_ok'. A
 * nullable boolean would collapse "not yet" and "no discrepancy" into the
 * same shrug.
 */
create type public.goods_reception_quantity_check as enum (
  'not_checked',
  'checked_ok',
  'discrepancy'
);


-- ============================================================
-- master data
--
-- Both tables copy `customers` exactly, including the case-insensitive unique
-- index, which is what stops "Pacovis AG" and "PACOVIS AG" becoming two
-- suppliers. created_by / updated_by are added because §8 asks for them;
-- customers predates that requirement and is not retrofitted here.
-- ============================================================
create table public.suppliers (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (length(btrim(name)) > 0),
  -- Soft deactivation only. A supplier with receptions behind it is never
  -- deleted, and the FK below is RESTRICT so the database refuses even if
  -- somebody tries.
  is_active  boolean not null default true,
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index suppliers_name_key   on public.suppliers (lower(btrim(name)));
create index        suppliers_active_idx on public.suppliers (is_active);

create trigger suppliers_set_updated_at before update on public.suppliers
  for each row execute function public.set_updated_at();

comment on table public.suppliers is
  'Who goods came FROM. Master data for Goods Reception; not a purchasing system.';

create table public.transporters (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (length(btrim(name)) > 0),
  is_active  boolean not null default true,
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index transporters_name_key   on public.transporters (lower(btrim(name)));
create index        transporters_active_idx on public.transporters (is_active);

create trigger transporters_set_updated_at before update on public.transporters
  for each row execute function public.set_updated_at();

comment on table public.transporters is
  'Who CARRIED the goods to us. Inbound carriage only — distinct from delivery_methods, which is how goods leave us for a customer.';


-- ============================================================
-- who may perform a reception
--
-- A flat standing list, mirroring inventory_template_assignees.
--
-- WHY THIS IS NOT A PERMISSION MATRIX ROW: role_permissions carries a CHECK
-- constraint allowing only 'manager' and 'power_user'. The 'user' role is the
-- floor and structurally cannot be granted anything there — a plain user's
-- access comes from being assigned work, which is exactly the shape of this
-- requirement. Being an Admin, Manager or Power User does NOT put somebody on
-- this list; it lets them edit any reception, which is a different authority.
-- ============================================================
create table public.goods_reception_assignees (
  user_id     uuid primary key references public.profiles (id) on delete cascade,
  assigned_by uuid references public.profiles (id) on delete set null,
  assigned_at timestamptz not null default now()
);

comment on table public.goods_reception_assignees is
  'Users responsible for registering incoming deliveries. Presence of a row is the grant.';


-- ============================================================
-- receptions
-- ============================================================
create table public.goods_receptions (
  id uuid primary key default gen_random_uuid(),

  -- Human-facing sequential reference, the same device orders and incidents
  -- use. GR-2026-0001, written by the trigger below and never by the app.
  reference        bigint generated always as identity (start with 1),
  reception_number text not null unique,

  /*
   * Nullable so a DRAFT can be started with one hand while the driver waits.
   * Required at COMPLETED by the CHECK at the foot of this table — the
   * validation lives at the transition, not at insert, because §33 is
   * explicit that a receiver may save half a reception and finish it later.
   *
   * RESTRICT on both: a supplier or transporter with history behind it can be
   * deactivated but never deleted out from under it.
   */
  supplier_id    uuid references public.suppliers (id)    on delete restrict,
  transporter_id uuid references public.transporters (id) on delete restrict,

  -- The supplier's own document number. Free text: it is their reference, in
  -- their format, and validating it would only reject reality.
  delivery_note  text,

  /*
   * ONE instant, not a date column beside a time column.
   *
   * Date and time are two views of one fact, and storing them apart invites
   * the pair that says 10.09 at 23:50 in a Zurich winter while the row was
   * written on the 11th in UTC. Rendered as separate date and time fields in
   * the UI, pinned to Europe/Zurich exactly as every other timestamp is.
   */
  received_at timestamptz not null default now(),

  -- §15: never typed by hand. Set by the action from the session.
  received_by uuid not null references public.profiles (id) on delete restrict,

  condition      public.goods_reception_condition,
  quantity_check public.goods_reception_quantity_check not null default 'not_checked',

  -- Context, never a substitute for the structured fields above it.
  comments text,

  status public.goods_reception_status not null default 'draft',

  completed_at timestamptz,
  completed_by uuid references public.profiles (id) on delete set null,

  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint goods_receptions_completed_together check (
    (completed_at is null) = (completed_by is null)
  ),

  /*
   * §34, as a constraint rather than as a hope.
   *
   * A completed reception names its supplier, states the condition and has
   * had its quantities looked at. received_at and received_by are NOT NULL
   * already. The transporter is deliberately absent from this list: a
   * supplier van with no carrier is an ordinary Tuesday, and demanding one
   * would make somebody invent it.
   */
  constraint goods_receptions_complete_is_complete check (
    status <> 'completed'
    or (
      supplier_id is not null
      and condition is not null
      and quantity_check <> 'not_checked'
    )
  )
);

create index goods_receptions_received_idx    on public.goods_receptions (received_at desc);
create index goods_receptions_supplier_idx    on public.goods_receptions (supplier_id);
create index goods_receptions_transporter_idx on public.goods_receptions (transporter_id);
create index goods_receptions_status_idx      on public.goods_receptions (status);
create index goods_receptions_receiver_idx    on public.goods_receptions (received_by);
create index goods_receptions_condition_idx   on public.goods_receptions (condition);
create index goods_receptions_qty_idx         on public.goods_receptions (quantity_check);
-- The default list view: everything still open, newest first.
create index goods_receptions_open_idx on public.goods_receptions (received_at desc)
  where status <> 'completed';
-- §45 searches the delivery note; a supplier's own reference is the number a
-- person actually has in their hand when they come asking.
create index goods_receptions_note_idx on public.goods_receptions (lower(btrim(delivery_note)))
  where delivery_note is not null;

create trigger goods_receptions_set_updated_at before update on public.goods_receptions
  for each row execute function public.set_updated_at();

/*
 * GR-2026-0001.
 *
 * Lifted from set_incident_number(), including its two decisions: the year
 * comes from Europe/Zurich rather than the server clock, because for the
 * first two hours of a Zurich day UTC still says yesterday; and the counter
 * does NOT restart each year, because a restart needs a max() lookup that
 * races under concurrent inserts. Two deliveries arriving in the same second
 * would both read the same maximum and collide.
 */
create or replace function public.set_goods_reception_number()
returns trigger
language plpgsql
as $$
begin
  new.reception_number := 'GR-'
    || to_char((now() at time zone 'Europe/Zurich'), 'YYYY')
    || '-' || lpad(new.reference::text, 4, '0');
  return new;
end;
$$;

create trigger goods_receptions_number before insert on public.goods_receptions
  for each row execute function public.set_goods_reception_number();


-- ============================================================
-- exceptional product information
--
-- §7 and §22. NOT a delivery-note copy: zero rows is the normal case, and the
-- screen says so. A row exists because something about ONE product needed
-- writing down — a lot number, an MHD that differs from the rest, two boxes
-- crushed.
--
-- Lot and MHD live HERE and nowhere else. Recording them does not create an
-- inventory lot, does not touch the Lot Nummer Tracker and does not become
-- stock. They are notes about what arrived, on the record of what arrived.
-- ============================================================
create table public.goods_reception_exceptions (
  id           uuid primary key default gen_random_uuid(),
  reception_id uuid not null references public.goods_receptions (id) on delete cascade,

  -- RESTRICT: an exception names a product from the existing master, and that
  -- product can be deactivated but never deleted out from under the history.
  -- §22 forbids free text here — a typed product name cannot be reported on.
  product_id uuid not null references public.products (id) on delete restrict,

  lot_number  text,
  -- MHD / best-before. A date, not text, so "expiring within 30 days" is a
  -- query rather than a parsing exercise.
  best_before date,

  affected_quantity numeric(12,3) check (affected_quantity is null or affected_quantity > 0),

  -- The only required field besides the product: a row that says nothing is
  -- not an exception, it is noise.
  description text not null check (length(btrim(description)) > 0),

  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index goods_reception_exceptions_reception_idx on public.goods_reception_exceptions (reception_id, created_at);
create index goods_reception_exceptions_product_idx   on public.goods_reception_exceptions (product_id);
create index goods_reception_exceptions_lot_idx       on public.goods_reception_exceptions (lot_number)
  where lot_number is not null;

create trigger goods_reception_exceptions_set_updated_at before update on public.goods_reception_exceptions
  for each row execute function public.set_updated_at();


-- ============================================================
-- evidence
--
-- The row is the record; the bytes live in Supabase Storage under the
-- 'goods-reception-evidence' bucket, keyed by reception id. Copied from
-- incident_evidence, including the unique storage_path that stops two rows
-- claiming one object and making deletion ambiguous.
--
-- A separate bucket rather than a shared one, because the incident bucket's
-- object policy derives permission from the first path segment being an
-- INCIDENT id. One bucket serving two id spaces cannot express that.
-- ============================================================
create table public.goods_reception_evidence (
  id           uuid primary key default gen_random_uuid(),
  reception_id uuid not null references public.goods_receptions (id) on delete cascade,

  -- Optional narrowing: a photo of the crushed box belongs to the exception
  -- that describes it. SET NULL rather than CASCADE — deleting an exception
  -- row must not silently destroy the photograph that evidenced it.
  exception_id uuid references public.goods_reception_exceptions (id) on delete set null,

  storage_path text not null unique,
  file_name    text not null,
  mime_type    text not null,
  size_bytes   integer not null check (size_bytes > 0),
  uploaded_by  uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now()
);

create index goods_reception_evidence_reception_idx on public.goods_reception_evidence (reception_id, created_at);
create index goods_reception_evidence_exception_idx on public.goods_reception_evidence (exception_id)
  where exception_id is not null;


-- ============================================================
-- audit
--
-- A fifth module log, column-for-column the shape the other four share, so
-- the operational audit view keeps working with no change to how it reads.
-- ============================================================
create table public.goods_reception_audit_log (
  id             uuid primary key default gen_random_uuid(),
  reception_id   uuid references public.goods_receptions (id) on delete cascade,
  actor_id       uuid references public.profiles (id) on delete set null,
  action         text not null,
  previous_value jsonb,
  new_value      jsonb,
  created_at     timestamptz not null default now()
);

create index goods_reception_audit_reception_idx on public.goods_reception_audit_log (reception_id, created_at desc);
create index goods_reception_audit_created_idx   on public.goods_reception_audit_log (created_at desc);

/*
 * §36: what changed, not merely that something did.
 *
 * The field list is the one §35 enumerates. An updated_at touch on its own is
 * not an audit event — logging those would bury the six changes that matter
 * under a hundred that do not.
 */
create or replace function public.log_goods_reception_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_action text;
begin
  if TG_OP = 'INSERT' then
    insert into public.goods_reception_audit_log (reception_id, actor_id, action, new_value)
    values (new.id, (select auth.uid()), 'reception_created',
            jsonb_build_object(
              'reception_number', new.reception_number,
              'supplier_id',      new.supplier_id,
              'transporter_id',   new.transporter_id,
              'received_at',      new.received_at,
              'status',           new.status));
    return new;
  end if;

  if new.status is distinct from old.status then
    v_action := 'reception_status_changed';
  elsif new.supplier_id is distinct from old.supplier_id
     or new.transporter_id is distinct from old.transporter_id
     or new.delivery_note is distinct from old.delivery_note then
    v_action := 'reception_source_changed';
  elsif new.condition is distinct from old.condition
     or new.quantity_check is distinct from old.quantity_check then
    v_action := 'reception_checks_changed';
  elsif new.received_at is distinct from old.received_at
     or new.received_by is distinct from old.received_by then
    v_action := 'reception_receipt_changed';
  elsif new.comments is distinct from old.comments then
    v_action := 'reception_comments_changed';
  else
    return new;
  end if;

  insert into public.goods_reception_audit_log
    (reception_id, actor_id, action, previous_value, new_value)
  values (
    new.id,
    (select auth.uid()),
    v_action,
    jsonb_build_object(
      'status', old.status, 'supplier_id', old.supplier_id,
      'transporter_id', old.transporter_id, 'delivery_note', old.delivery_note,
      'condition', old.condition, 'quantity_check', old.quantity_check,
      'received_at', old.received_at, 'received_by', old.received_by,
      'comments', old.comments),
    jsonb_build_object(
      'status', new.status, 'supplier_id', new.supplier_id,
      'transporter_id', new.transporter_id, 'delivery_note', new.delivery_note,
      'condition', new.condition, 'quantity_check', new.quantity_check,
      'received_at', new.received_at, 'received_by', new.received_by,
      'comments', new.comments));

  return new;
end;
$$;

create trigger goods_receptions_audit
  after insert or update on public.goods_receptions
  for each row execute function public.log_goods_reception_change();

/*
 * Evidence and exceptions are audited too — §36 asks for uploads and removals
 * by name, and an exception appearing after completion is exactly the kind of
 * edit the trail exists to show.
 */
create or replace function public.log_goods_reception_child_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reception uuid;
  v_action    text;
  v_payload   jsonb;
begin
  if TG_OP = 'DELETE' then
    v_reception := old.reception_id;
  else
    v_reception := new.reception_id;
  end if;

  if TG_TABLE_NAME = 'goods_reception_evidence' then
    v_action  := case TG_OP when 'INSERT' then 'evidence_added' else 'evidence_removed' end;
    v_payload := case TG_OP
                   when 'INSERT' then jsonb_build_object('file_name', new.file_name)
                   else jsonb_build_object('file_name', old.file_name)
                 end;
  else
    v_action  := case TG_OP
                   when 'INSERT' then 'exception_added'
                   when 'UPDATE' then 'exception_changed'
                   else 'exception_removed'
                 end;
    v_payload := case TG_OP
                   when 'DELETE' then jsonb_build_object('product_id', old.product_id, 'description', old.description)
                   else jsonb_build_object('product_id', new.product_id, 'description', new.description)
                 end;
  end if;

  insert into public.goods_reception_audit_log (reception_id, actor_id, action, new_value)
  values (v_reception, (select auth.uid()), v_action, v_payload);

  if TG_OP = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger goods_reception_evidence_audit
  after insert or delete on public.goods_reception_evidence
  for each row execute function public.log_goods_reception_child_change();

create trigger goods_reception_exceptions_audit
  after insert or update or delete on public.goods_reception_exceptions
  for each row execute function public.log_goods_reception_child_change();


-- ============================================================
-- monthly report snapshots
--
-- Copied from incident_report_snapshots, for the reason §42 gives: a
-- historical report must not silently change because somebody edited a
-- reception months later. The snapshot is a frozen document — the aggregate
-- as it stood, plus the ids it was computed from — and the live receptions
-- stay fully queryable beside it.
--
-- Versioned rather than unique per month: a month legitimately gets reported
-- twice, once at the start of the following month and again after a late
-- correction. Both are kept and neither overwrites the other.
-- ============================================================
create table public.goods_reception_report_snapshots (
  id           uuid primary key default gen_random_uuid(),
  period_month date not null,
  version      int  not null check (version >= 1),

  payload       jsonb not null,
  reception_ids uuid[] not null default '{}',

  generated_by uuid references public.profiles (id) on delete set null,
  generated_at timestamptz not null default now(),
  note         text,

  constraint goods_reception_report_period_is_month
    check (period_month = date_trunc('month', period_month)::date),
  constraint goods_reception_report_month_version_key unique (period_month, version)
);

create index goods_reception_reports_period_idx
  on public.goods_reception_report_snapshots (period_month desc, version desc);

/*
 * Next version for this month, assigned by the database rather than the app,
 * because two people pressing Generate at once would otherwise both read
 * version 1 and one of them would meet a constraint violation instead of a
 * report.
 */
create or replace function public.next_goods_reception_report_version(p_month date)
returns int
language sql
stable
as $$
  select coalesce(max(version), 0) + 1
    from public.goods_reception_report_snapshots
   where period_month = date_trunc('month', p_month)::date;
$$;


-- ============================================================
-- capabilities
--
-- Two keys in the EXISTING catalogue. No new role, and nothing here grants a
-- plain user anything — that is the assignment table's job, above.
--
--   goods_reception.manage_config  suppliers, transporters, assignments
--                                  (manager: it is operational CONFIGURATION)
--   goods_reception.manage_all     edit any reception, including a completed
--                                  one (manager + power_user: operational
--                                  management, the same line every other
--                                  module draws)
--
-- Reporting and export deliberately reuse reports.view / reports.export
-- rather than minting a third and fourth key. A person trusted to read the
-- order reports is trusted to read this one, and two keys meaning "may read
-- reports" is how a permission matrix becomes unreadable.
-- ============================================================
insert into public.permission_catalog (key, module, is_configurable, sort_order) values
  ('goods_reception.manage_config', 'goods_reception', true, 120),
  ('goods_reception.manage_all',    'goods_reception', true, 130);

insert into public.role_permissions (role, permission) values
  ('manager',    'goods_reception.manage_config'),
  ('manager',    'goods_reception.manage_all'),
  ('power_user', 'goods_reception.manage_all');


-- ============================================================
-- predicates
-- ============================================================

/*
 * Is the caller on the standing reception list?
 *
 * SECURITY DEFINER for the same reason is_admin() is: it reads a table that
 * is itself protected by the policies this predicate appears in.
 */
create or replace function public.is_goods_reception_assignee()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.goods_reception_assignees a
      join public.profiles p on p.id = a.user_id
     where a.user_id = (select auth.uid())
       and p.status = 'approved'
  );
$$;

comment on function public.is_goods_reception_assignee() is
  'Standing responsibility for registering deliveries. Independent of role: an Admin is not on this list unless somebody put them on it.';

/*
 * May the caller write to a reception in this state?
 *
 * The rule §35 asks for, in one place:
 *   - a holder of goods_reception.manage_all may edit anything, completed
 *     included, and every such edit lands in the audit log;
 *   - an assignee may work on a reception until it is completed, and then
 *     stops. Completion is the point at which the record becomes history.
 *
 * Takes the status as an argument rather than looking it up, so it can be
 * used in a WITH CHECK where the row is not yet in the table.
 */
create or replace function public.can_write_goods_reception(p_status public.goods_reception_status)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_permission('goods_reception.manage_all')
      or (public.is_goods_reception_assignee() and p_status <> 'completed');
$$;

/*
 * The same question for a child row, which carries no status of its own.
 */
create or replace function public.can_write_goods_reception_child(p_reception_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.goods_receptions r
     where r.id = p_reception_id
       and public.can_write_goods_reception(r.status)
  );
$$;


-- ============================================================
-- Row Level Security
--
-- §11 is the unusual one and is deliberate: EVERY approved user may read
-- EVERY reception. A delivery is shared operational fact — the person who
-- will open the pallet tomorrow needs to know what the person who signed for
-- it wrote down. Writing is a different question entirely and is answered by
-- the predicates above.
-- ============================================================
alter table public.suppliers                        enable row level security;
alter table public.transporters                     enable row level security;
alter table public.goods_reception_assignees        enable row level security;
alter table public.goods_receptions                 enable row level security;
alter table public.goods_reception_exceptions       enable row level security;
alter table public.goods_reception_evidence         enable row level security;
alter table public.goods_reception_audit_log        enable row level security;
alter table public.goods_reception_report_snapshots enable row level security;

-- ---------- master data ----------
-- Readable by everyone approved: the reception form has to offer the list.
create policy "suppliers: approved read" on public.suppliers
  for select to authenticated using (public.is_approved());
create policy "suppliers: config writes" on public.suppliers
  for all to authenticated
  using (public.has_permission('goods_reception.manage_config'))
  with check (public.has_permission('goods_reception.manage_config'));

create policy "transporters: approved read" on public.transporters
  for select to authenticated using (public.is_approved());
create policy "transporters: config writes" on public.transporters
  for all to authenticated
  using (public.has_permission('goods_reception.manage_config'))
  with check (public.has_permission('goods_reception.manage_config'));

-- ---------- assignment ----------
-- Readable by everyone, so the screen can say who is responsible rather than
-- leaving a user to guess why the New button is missing.
create policy "gr_assignees: approved read" on public.goods_reception_assignees
  for select to authenticated using (public.is_approved());
create policy "gr_assignees: config writes" on public.goods_reception_assignees
  for all to authenticated
  using (public.has_permission('goods_reception.manage_config'))
  with check (public.has_permission('goods_reception.manage_config'));

-- ---------- receptions ----------
create policy "goods_receptions: approved read" on public.goods_receptions
  for select to authenticated using (public.is_approved());

/*
 * Creation. The receiver is the caller, and the row starts life owned by
 * them — received_by is not free for the client to choose, which is §15
 * enforced rather than merely intended.
 */
create policy "goods_receptions: assignee insert" on public.goods_receptions
  for insert to authenticated
  with check (
    public.can_write_goods_reception(status)
    and created_by  = (select auth.uid())
    and received_by = (select auth.uid())
  );

create policy "goods_receptions: scoped update" on public.goods_receptions
  for update to authenticated
  -- USING reads the row as it stands: an assignee may open a draft, and may
  -- not open a completed one.
  using (public.can_write_goods_reception(status))
  -- WITH CHECK reads the row as it will be. Deliberately permissive about the
  -- NEW status so an assignee can complete a reception — the transition they
  -- are being denied is editing something already completed, not completing
  -- something.
  with check (
    public.has_permission('goods_reception.manage_all')
    or public.is_goods_reception_assignee()
  );

-- No delete policy anywhere in this module. §52: history is not deleted. A
-- reception entered in error is completed with a comment saying so.

-- ---------- exceptions and evidence ----------
create policy "gr_exceptions: approved read" on public.goods_reception_exceptions
  for select to authenticated using (public.is_approved());
create policy "gr_exceptions: scoped writes" on public.goods_reception_exceptions
  for all to authenticated
  using (public.can_write_goods_reception_child(reception_id))
  with check (public.can_write_goods_reception_child(reception_id));

create policy "gr_evidence: approved read" on public.goods_reception_evidence
  for select to authenticated using (public.is_approved());
create policy "gr_evidence: scoped insert" on public.goods_reception_evidence
  for insert to authenticated
  with check (
    public.can_write_goods_reception_child(reception_id)
    and uploaded_by = (select auth.uid())
  );
-- The uploader may remove their own; a manage_all holder may remove anyone's.
create policy "gr_evidence: uploader or manager deletes" on public.goods_reception_evidence
  for delete to authenticated
  using (
    public.has_permission('goods_reception.manage_all')
    or (uploaded_by = (select auth.uid()) and public.can_write_goods_reception_child(reception_id))
  );

-- ---------- audit and reports ----------
create policy "gr_audit_log: operational reads" on public.goods_reception_audit_log
  for select to authenticated using (public.has_permission('audit.view_operational'));
-- No insert policy: rows come from the SECURITY DEFINER triggers only.

/*
 * A snapshot is readable by anyone who may read reports, and writable by the
 * same. It is never UPDATED and never DELETED — the absence of those policies
 * is what enforces §42, not a convention.
 */
create policy "gr_reports: read" on public.goods_reception_report_snapshots
  for select to authenticated using (public.has_permission('reports.view'));
create policy "gr_reports: generate" on public.goods_reception_report_snapshots
  for insert to authenticated
  with check (
    public.has_permission('reports.view')
    and generated_by = (select auth.uid())
  );


-- ============================================================
-- evidence storage
-- ============================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'goods-reception-evidence',
  'goods-reception-evidence',
  false,
  10485760, -- 10 MB: a phone photo of a crushed pallet, not a video
  -- Images only. §20 is explicit that document upload is out of scope, so
  -- application/pdf is absent here even though the incident bucket allows it.
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
)
on conflict (id) do nothing;

/*
 * Object policies mirror the table's.
 *
 * The first path segment is the reception id, so a signed URL cannot be
 * minted for something the caller may not read. The uuid cast is guarded: an
 * object uploaded under a non-uuid folder by any route would otherwise raise
 * instead of being denied.
 */
create policy "gr evidence: approved read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'goods-reception-evidence'
    and public.is_approved()
  );

create policy "gr evidence: scoped upload" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'goods-reception-evidence'
    and (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$'
    and public.can_write_goods_reception_child(((storage.foldername(name))[1])::uuid)
  );

create policy "gr evidence: scoped delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'goods-reception-evidence'
    and (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$'
    and (
      public.has_permission('goods_reception.manage_all')
      or public.can_write_goods_reception_child(((storage.foldername(name))[1])::uuid)
    )
  );


-- ============================================================
-- INCIDENT INTEGRATION
--
-- Three changes to the incidents module and no more. §57 asks for restraint
-- here, and each of these is load-bearing for a requirement that cannot be
-- met without it.
-- ============================================================

/*
 * 1. The link itself. §43: the incident report has to be able to say where an
 *    incident came from, and a reception is a fourth origin beside the
 *    customer, the order and the delivery method.
 *
 * Nullable like every other link on that table, and for the same reason its
 * comment gives: forcing a link makes somebody invent one.
 */
alter table public.incidents
  add column goods_reception_id uuid references public.goods_receptions (id) on delete set null;

create index incidents_goods_reception_idx on public.incidents (goods_reception_id)
  where goods_reception_id is not null;

comment on column public.incidents.goods_reception_id is
  'The delivery this incident came out of, when it came out of one. Reception is an incident ORIGIN, never a replacement for the incident workflow.';

/*
 * 2. Visibility. can_view_incident(order_id) grants sight only to a
 *    view_all holder or to whoever personally picked the order — and a
 *    reception incident has no order, so it would be invisible to the very
 *    people who can already read the reception it describes.
 *
 * A second function by ARITY rather than a default parameter: a default would
 * make the existing one-argument calls ambiguous and every one of them would
 * start failing. The one-argument version is left exactly as it was.
 */
create or replace function public.can_view_incident(p_order_id uuid, p_goods_reception_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.can_view_incident(p_order_id)
      or (p_goods_reception_id is not null and public.is_approved());
$$;

comment on function public.can_view_incident(uuid, uuid) is
  'Incident visibility including reception origin: everyone approved may read an incident raised from a delivery, because everyone approved may already read the delivery.';

-- The six policies that decide who sees an incident and its children.
drop policy if exists "incidents: scoped read"            on public.incidents;
drop policy if exists "incident_items: scoped read"       on public.incident_affected_items;
drop policy if exists "incident_causes: scoped read"      on public.incident_secondary_causes;
drop policy if exists "incident_evidence: scoped read"    on public.incident_evidence;
drop policy if exists "incident_replacements: scoped read" on public.incident_replacements;
drop policy if exists "incident evidence: scoped read"    on storage.objects;

create policy "incidents: scoped read" on public.incidents
  for select to authenticated
  using (public.can_view_incident(order_id, goods_reception_id));

create policy "incident_items: scoped read" on public.incident_affected_items
  for select to authenticated using (
    exists (select 1 from public.incidents i
             where i.id = incident_id
               and public.can_view_incident(i.order_id, i.goods_reception_id))
  );

create policy "incident_causes: scoped read" on public.incident_secondary_causes
  for select to authenticated using (
    exists (select 1 from public.incidents i
             where i.id = incident_id
               and public.can_view_incident(i.order_id, i.goods_reception_id))
  );

create policy "incident_evidence: scoped read" on public.incident_evidence
  for select to authenticated using (
    exists (select 1 from public.incidents i
             where i.id = incident_id
               and public.can_view_incident(i.order_id, i.goods_reception_id))
  );

create policy "incident_replacements: scoped read" on public.incident_replacements
  for select to authenticated using (
    exists (select 1 from public.incidents i
             where i.id = incident_id
               and public.can_view_incident(i.order_id, i.goods_reception_id))
  );

create policy "incident evidence: scoped read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'incident-evidence'
    and (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$'
    and exists (
      select 1 from public.incidents i
       where i.id = ((storage.foldername(name))[1])::uuid
         and public.can_view_incident(i.order_id, i.goods_reception_id)
    )
  );

/*
 * 3. Creation. §24 wants a Report Incident button on the reception, and the
 *    person standing at the pallet is a plain USER who — by the original
 *    module's explicit design — may not create an incident at all.
 *
 * Widened by ONE clause, as narrowly as the requirement allows: an assignee
 * may create an incident ONLY if it names a reception. Everything afterwards
 * — investigating, changing severity, resolving, closing — still demands
 * incidents.manage, because the update policy is untouched. The receiver
 * reports what they saw; they do not gain the investigation.
 */
drop policy if exists "incidents: manage insert" on public.incidents;

create policy "incidents: manage insert" on public.incidents
  for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and (
      public.has_permission('incidents.manage')
      or (
        goods_reception_id is not null
        and public.is_goods_reception_assignee()
      )
    )
  );

/*
 * The audit trail follows the link, so "which reception did this come from"
 * survives in the history even if the link is later cleared.
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
              'order_id', new.order_id,
              'goods_reception_id', new.goods_reception_id));
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
     or new.goods_reception_id is distinct from old.goods_reception_id
     or new.incident_type_id is distinct from old.incident_type_id then
    v_action := 'incident_links_changed';
  elsif new.description is distinct from old.description
     or new.investigation_notes is distinct from old.investigation_notes
     or new.resolution_notes is distinct from old.resolution_notes then
    v_action := 'incident_notes_changed';
  else
    return new;
  end if;

  insert into public.incident_audit_log
    (incident_id, actor_id, action, previous_value, new_value)
  values (
    new.id,
    (select auth.uid()),
    v_action,
    jsonb_build_object(
      'status', old.status, 'severity', old.severity,
      'primary_cause', old.primary_cause, 'responsibility', old.responsibility,
      'customer_id', old.customer_id, 'order_id', old.order_id,
      'delivery_method_id', old.delivery_method_id,
      'goods_reception_id', old.goods_reception_id,
      'incident_type_id', old.incident_type_id, 'description', old.description,
      'investigation_notes', old.investigation_notes,
      'resolution_notes', old.resolution_notes),
    jsonb_build_object(
      'status', new.status, 'severity', new.severity,
      'primary_cause', new.primary_cause, 'responsibility', new.responsibility,
      'customer_id', new.customer_id, 'order_id', new.order_id,
      'delivery_method_id', new.delivery_method_id,
      'goods_reception_id', new.goods_reception_id,
      'incident_type_id', new.incident_type_id, 'description', new.description,
      'investigation_notes', new.investigation_notes,
      'resolution_notes', new.resolution_notes));

  return new;
end;
$$;


-- ============================================================
-- completion guard
--
-- §34's second half, which no CHECK constraint can express because it looks
-- at another table: a discrepancy may not be completed in silence. Either
-- somebody wrote down what was missing, or an incident was raised about it.
-- ============================================================
create or replace function public.guard_goods_reception_complete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status <> 'completed' or old.status = 'completed' then
    return new;
  end if;

  if new.quantity_check = 'discrepancy'
     and length(btrim(coalesce(new.comments, ''))) = 0
     and not exists (
       select 1 from public.incidents i where i.goods_reception_id = new.id
     )
  then
    raise exception 'discrepancy_needs_explanation' using errcode = '23514';
  end if;

  -- Stamped here rather than by the application, so it is true even if a
  -- future caller forgets.
  new.completed_at := coalesce(new.completed_at, now());
  new.completed_by := coalesce(new.completed_by, (select auth.uid()));

  return new;
end;
$$;

create trigger goods_receptions_guard_complete
  before update on public.goods_receptions
  for each row execute function public.guard_goods_reception_complete();
