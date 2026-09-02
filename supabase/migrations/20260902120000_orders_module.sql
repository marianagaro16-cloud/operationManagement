-- ============================================================
-- Operation Manager :: Orders + Lotnummerkontrol module
--
-- Replaces the duplicate data entry between two workbooks:
--   Control de pedidos-Master.xlsx      (monthly order control)
--   Lotnummerkontrol_Master.xlsx        (weekly preparation/traceability)
--
-- Single source of truth:
--   customer -> order -> order_line -> lot_allocation
--
-- Order Control and Lotnummerkontrol are two VIEWS over this data, not two
-- copies. Order Control is driven by delivery_date; Lotnummerkontrol by
-- preparation_date.
--
-- QUANTITY SEMANTICS (verified by cross-referencing the same "Los Guapos"
-- order in both workbooks): a quantity is a COUNT OF PACKAGES of the
-- product's presentation — 9 packages of "1.75kg Fresco", not 9 kg. The
-- weight lives in the product's presentation, never in the quantity.
-- ============================================================

-- ---------- enums ----------
-- Minimum viable status model. The workbook only ever distinguishes a live
-- order from a cancelled one, so preparation progress is DERIVED from lot
-- allocations rather than stored as a status that could drift out of sync.
create type public.order_status as enum ('draft', 'confirmed', 'cancelled');

-- "Muestras" in the spreadsheet legend is an order TYPE, not a shipping
-- method: a sample can still travel by DHL or Planzer.
create type public.order_type as enum ('sale', 'sample');

-- ============================================================
-- master data
-- ============================================================
create table public.customers (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(trim(name)) > 0),
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index customers_name_key on public.customers (lower(btrim(name)));
create index customers_active_idx on public.customers (is_active);

create table public.delivery_methods (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique,
  name        text not null,
  sort_order  int  not null default 100,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Products are VARIANTS: a sellable item is family + presentation.
-- "Tortillas 14cm BIO" alone is not orderable; "…/ 500gr" is.
create table public.products (
  id            uuid primary key default gen_random_uuid(),
  -- Codes come from Control de pedidos. They are NOT unique in the source
  -- (0107, 0026, 0287, 0219 and 0250 are each reused across different
  -- presentations, and 8 variants carry no code at all), so the code is a
  -- label for humans, never an identifier.
  code          text,
  family        text not null check (length(trim(family)) > 0),
  presentation  text not null check (length(trim(presentation)) > 0),
  category      text,
  notes         text,
  -- Set by the importer where the source data was contradictory, so an
  -- admin can resolve it instead of the conflict passing silently.
  needs_review  boolean not null default false,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index products_active_idx on public.products (is_active);
create index products_code_idx   on public.products (code);
create index products_family_idx on public.products (family);
create index products_review_idx on public.products (id) where needs_review;

-- ============================================================
-- orders
-- ============================================================
create table public.orders (
  id                 uuid primary key default gen_random_uuid(),
  -- Human-facing sequential reference (#1001…), so two orders from the same
  -- customer on the same day stay tellable apart.
  reference          bigint generated always as identity (start with 1001),
  customer_id        uuid not null references public.customers (id) on delete restrict,
  order_date         date not null default (now() at time zone 'Europe/Zurich')::date,
  -- Separate concepts. Defaulted to delivery_date by the application on
  -- creation; an admin may then move preparation earlier.
  delivery_date      date not null,
  preparation_date   date not null,
  delivery_method_id uuid references public.delivery_methods (id) on delete restrict,
  status             public.order_status not null default 'draft',
  order_type         public.order_type   not null default 'sale',
  -- Belongs to the whole order, never duplicated per product.
  note               text,
  created_by         uuid references public.profiles (id) on delete set null,
  updated_by         uuid references public.profiles (id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- An order carries exactly one delivery date. Products needed on different
-- days are separate orders; multiple orders per customer/date are kept
-- separate for traceability and are only grouped visually.
create index orders_delivery_idx    on public.orders (delivery_date);
create index orders_preparation_idx on public.orders (preparation_date);
create index orders_customer_idx    on public.orders (customer_id);
create index orders_status_idx      on public.orders (status);

create table public.order_lines (
  id               uuid primary key default gen_random_uuid(),
  order_id         uuid not null references public.orders (id) on delete cascade,
  product_id       uuid not null references public.products (id) on delete restrict,
  -- Count of packages of the product's presentation. Admin-only to change.
  ordered_quantity numeric(12,3) not null check (ordered_quantity > 0),
  note             text,
  -- Mandatory explanation when a line is finished with less than ordered.
  shortfall_reason text,
  position         int not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index order_lines_order_idx   on public.order_lines (order_id);
create index order_lines_product_idx on public.order_lines (product_id);

-- ============================================================
-- lot allocations  (the Lotnummerkontrol payload)
--
-- One line may be prepared from several lots — the workbook provides three
-- lot slots per row; this model allows any number.
-- ============================================================
create table public.lot_allocations (
  id             uuid primary key default gen_random_uuid(),
  order_line_id  uuid not null references public.order_lines (id) on delete cascade,
  -- Free text on purpose: lot numbers are operational values recorded during
  -- preparation and are NOT validated against a lot master.
  lot_number     text not null check (length(trim(lot_number)) > 0),
  quantity       numeric(12,3) not null check (quantity > 0),
  note           text,
  created_by     uuid references public.profiles (id) on delete set null,
  updated_by     uuid references public.profiles (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index lot_allocations_line_idx on public.lot_allocations (order_line_id);
create index lot_allocations_lot_idx  on public.lot_allocations (lot_number);

-- ============================================================
-- recurring order templates
--
-- Templates PROPOSE orders for admin review; they never create confirmed
-- orders directly. Deliberately independent of the task recurrence engine:
-- an order cadence (this customer every Wednesday) is a different concept
-- from an operational task cadence, and coupling them would make both worse.
-- ============================================================
create table public.recurring_order_templates (
  id                 uuid primary key default gen_random_uuid(),
  customer_id        uuid not null references public.customers (id) on delete cascade,
  name               text,
  -- ISO weekday, Monday = 1. The only cadence the source data supports.
  delivery_weekday   int not null check (delivery_weekday between 1 and 7),
  -- Days before delivery that preparation happens. 0 = same day.
  preparation_lead_days int not null default 0 check (preparation_lead_days >= 0),
  delivery_method_id uuid references public.delivery_methods (id) on delete set null,
  order_type         public.order_type not null default 'sale',
  note               text,
  is_active          boolean not null default false,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index rot_customer_idx on public.recurring_order_templates (customer_id);
create index rot_active_idx   on public.recurring_order_templates (is_active);

create table public.recurring_order_template_lines (
  id               uuid primary key default gen_random_uuid(),
  template_id      uuid not null references public.recurring_order_templates (id) on delete cascade,
  product_id       uuid not null references public.products (id) on delete restrict,
  default_quantity numeric(12,3) not null check (default_quantity > 0),
  position         int not null default 0
);
create index rotl_template_idx on public.recurring_order_template_lines (template_id);

-- ============================================================
-- audit log for admin changes to order definitions
-- ============================================================
create table public.order_audit_log (
  id         uuid primary key default gen_random_uuid(),
  order_id   uuid references public.orders (id) on delete cascade,
  actor_id   uuid references public.profiles (id) on delete set null,
  action     text not null,
  detail     jsonb,
  created_at timestamptz not null default now()
);
create index order_audit_order_idx on public.order_audit_log (order_id, created_at desc);

-- ---------- updated_at triggers ----------
create trigger customers_set_updated_at before update on public.customers
  for each row execute function public.set_updated_at();
create trigger delivery_methods_set_updated_at before update on public.delivery_methods
  for each row execute function public.set_updated_at();
create trigger products_set_updated_at before update on public.products
  for each row execute function public.set_updated_at();
create trigger orders_set_updated_at before update on public.orders
  for each row execute function public.set_updated_at();
create trigger order_lines_set_updated_at before update on public.order_lines
  for each row execute function public.set_updated_at();
create trigger lot_allocations_set_updated_at before update on public.lot_allocations
  for each row execute function public.set_updated_at();
create trigger rot_set_updated_at before update on public.recurring_order_templates
  for each row execute function public.set_updated_at();

-- ============================================================
-- integrity: over-allocation
--
-- A user may never allocate more than was ordered. An admin may, because
-- correcting a real-world miscount is an admin responsibility.
-- Enforced in the database so bypassing the UI does not bypass the rule.
-- ============================================================
create or replace function public.check_lot_over_allocation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ordered   numeric;
  v_allocated numeric;
begin
  select ol.ordered_quantity into v_ordered
    from public.order_lines ol where ol.id = new.order_line_id;

  select coalesce(sum(la.quantity), 0) into v_allocated
    from public.lot_allocations la
   where la.order_line_id = new.order_line_id
     and la.id <> new.id;

  if v_allocated + new.quantity > v_ordered and not public.is_admin() then
    raise exception 'over_allocation: ordered %, already allocated %, attempted %',
      v_ordered, v_allocated, new.quantity
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger lot_allocations_no_over_allocation
  before insert or update on public.lot_allocations
  for each row execute function public.check_lot_over_allocation();

-- ============================================================
-- Row Level Security
--
-- Admin owns every order DEFINITION field. A user may only touch execution
-- data: lot allocations and their notes.
-- ============================================================
alter table public.customers                     enable row level security;
alter table public.delivery_methods              enable row level security;
alter table public.products                      enable row level security;
alter table public.orders                        enable row level security;
alter table public.order_lines                   enable row level security;
alter table public.lot_allocations               enable row level security;
alter table public.recurring_order_templates     enable row level security;
alter table public.recurring_order_template_lines enable row level security;
alter table public.order_audit_log               enable row level security;

-- Master data + order definitions: approved users READ, admins WRITE.
create policy "customers: approved read" on public.customers
  for select to authenticated using (public.is_approved());
create policy "customers: admin writes" on public.customers
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "delivery_methods: approved read" on public.delivery_methods
  for select to authenticated using (public.is_approved());
create policy "delivery_methods: admin writes" on public.delivery_methods
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "products: approved read" on public.products
  for select to authenticated using (public.is_approved());
create policy "products: admin writes" on public.products
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "orders: approved read" on public.orders
  for select to authenticated using (public.is_approved());
create policy "orders: admin writes" on public.orders
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "order_lines: approved read" on public.order_lines
  for select to authenticated using (public.is_approved());
create policy "order_lines: admin writes" on public.order_lines
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "templates: approved read" on public.recurring_order_templates
  for select to authenticated using (public.is_approved());
create policy "templates: admin writes" on public.recurring_order_templates
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "template_lines: approved read" on public.recurring_order_template_lines
  for select to authenticated using (public.is_approved());
create policy "template_lines: admin writes" on public.recurring_order_template_lines
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "audit: admin reads" on public.order_audit_log
  for select to authenticated using (public.is_admin());

-- Lot allocations: this is the USER's workspace.
-- Writes are allowed directly (not only via RPC) because the over-allocation
-- trigger and the NOT NULL/CHECK constraints already enforce every rule, and
-- warehouse entry benefits from plain inserts.
create policy "lots: approved read" on public.lot_allocations
  for select to authenticated using (public.is_approved());

create policy "lots: approved insert" on public.lot_allocations
  for insert to authenticated
  with check (
    public.is_approved()
    and created_by = (select auth.uid())
    -- Never record preparation against a cancelled order.
    and exists (
      select 1 from public.order_lines ol
      join public.orders o on o.id = ol.order_id
      where ol.id = order_line_id and o.status <> 'cancelled'
    )
  );

-- A user may edit their own entries; an admin may correct anyone's.
create policy "lots: author or admin updates" on public.lot_allocations
  for update to authenticated
  using (created_by = (select auth.uid()) or public.is_admin())
  with check (created_by = (select auth.uid()) or public.is_admin());

create policy "lots: author or admin deletes" on public.lot_allocations
  for delete to authenticated
  using (created_by = (select auth.uid()) or public.is_admin());

-- ============================================================
-- RPCs
-- ============================================================

-- A user may record WHY a line was prepared short, but nothing else on the
-- line. Column-level permission is not expressible in RLS, so this is the
-- only path by which a non-admin writes to order_lines.
create or replace function public.set_line_shortfall_reason(
  p_order_line_id uuid,
  p_reason text
)
returns public.order_lines
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.order_lines;
begin
  if not public.is_approved() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'reason_required' using errcode = '22023';
  end if;

  update public.order_lines
     set shortfall_reason = trim(p_reason)
   where id = p_order_line_id
   returning * into v_row;

  if not found then
    raise exception 'order_line_not_found' using errcode = 'P0002';
  end if;
  return v_row;
end;
$$;

revoke all on function public.set_line_shortfall_reason(uuid, text) from public;
grant execute on function public.set_line_shortfall_reason(uuid, text) to authenticated;

-- Materialise a proposed DRAFT order from a template. Never confirms it:
-- an admin reviews and edits before the order becomes real.
create or replace function public.generate_order_from_template(
  p_template_id uuid,
  p_delivery_date date
)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tpl   public.recurring_order_templates;
  v_order public.orders;
begin
  if not public.is_admin() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  select * into v_tpl from public.recurring_order_templates where id = p_template_id;
  if not found then
    raise exception 'template_not_found' using errcode = 'P0002';
  end if;

  insert into public.orders (
    customer_id, delivery_date, preparation_date, delivery_method_id,
    status, order_type, note, created_by, updated_by
  ) values (
    v_tpl.customer_id,
    p_delivery_date,
    p_delivery_date - v_tpl.preparation_lead_days,
    v_tpl.delivery_method_id,
    'draft',
    v_tpl.order_type,
    v_tpl.note,
    (select auth.uid()),
    (select auth.uid())
  )
  returning * into v_order;

  insert into public.order_lines (order_id, product_id, ordered_quantity, position)
  select v_order.id, l.product_id, l.default_quantity, l.position
    from public.recurring_order_template_lines l
   where l.template_id = p_template_id;

  insert into public.order_audit_log (order_id, actor_id, action, detail)
  values (v_order.id, (select auth.uid()), 'generated_from_template',
          jsonb_build_object('template_id', p_template_id));

  return v_order;
end;
$$;

revoke all on function public.generate_order_from_template(uuid, date) from public;
grant execute on function public.generate_order_from_template(uuid, date) to authenticated;

-- ============================================================
-- audit trigger for admin changes to order definitions
-- ============================================================
create or replace function public.log_order_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    -- Only record meaningful definition changes, not every touch.
    if new.customer_id      is distinct from old.customer_id
       or new.delivery_date is distinct from old.delivery_date
       or new.preparation_date is distinct from old.preparation_date
       or new.delivery_method_id is distinct from old.delivery_method_id
       or new.status        is distinct from old.status
       or new.order_type    is distinct from old.order_type
       or new.note          is distinct from old.note then
      insert into public.order_audit_log (order_id, actor_id, action, detail)
      values (new.id, (select auth.uid()), 'order_updated', jsonb_build_object(
        'before', jsonb_build_object(
          'customer_id', old.customer_id, 'delivery_date', old.delivery_date,
          'preparation_date', old.preparation_date, 'delivery_method_id', old.delivery_method_id,
          'status', old.status, 'order_type', old.order_type, 'note', old.note),
        'after', jsonb_build_object(
          'customer_id', new.customer_id, 'delivery_date', new.delivery_date,
          'preparation_date', new.preparation_date, 'delivery_method_id', new.delivery_method_id,
          'status', new.status, 'order_type', new.order_type, 'note', new.note)
      ));
    end if;
  elsif tg_op = 'INSERT' then
    insert into public.order_audit_log (order_id, actor_id, action, detail)
    values (new.id, (select auth.uid()), 'order_created', null);
  end if;
  return new;
end;
$$;

create trigger orders_audit
  after insert or update on public.orders
  for each row execute function public.log_order_change();

create or replace function public.log_order_line_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.ordered_quantity is distinct from old.ordered_quantity then
    -- Quantity changes after preparation started must stay traceable; the
    -- lot allocations themselves are never touched.
    insert into public.order_audit_log (order_id, actor_id, action, detail)
    values (new.order_id, (select auth.uid()), 'quantity_changed', jsonb_build_object(
      'order_line_id', new.id,
      'product_id', new.product_id,
      'before', old.ordered_quantity,
      'after', new.ordered_quantity));
  end if;
  return new;
end;
$$;

create trigger order_lines_audit
  after update on public.order_lines
  for each row execute function public.log_order_line_change();
