-- ============================================================
-- Order Request import: packaging, aliases, templates, idempotency
--
-- Four additive changes. No table is replaced, no row is rewritten, no
-- existing column changes meaning, and nothing here creates a second place
-- an order can live: the importer's only output is ordinary rows in
-- public.orders and public.order_lines, which is what makes an imported
-- order indistinguishable from a hand-entered one in Lotnummerkontrol and
-- the Lot Nummer Tracker.
--
-- THE LOAD-BEARING FACT, unchanged: ordered_quantity is a COUNT OF PACKAGES
-- of the product's presentation. Nine of "Tortillas 12cm BIO / 1.75kg" is
-- nine 1.75 kg packages, not nine kilograms. Everything below is built on
-- that definition rather than around it.
-- ============================================================


-- ============================================================
-- 1. packaging: how many order units fit in a shipping box
-- ============================================================
/*
 * A customer who writes "3 boxes" has not said how many order units that is.
 * Until now the Product Master held nothing that could answer, so the only
 * honest options were to refuse the expression or to invent a number. This
 * column is the third: a place for the real figure where one is known.
 *
 * NULL is the default and NULL is meaningful — it says "no reliable
 * conversion exists for this product", and the importer must then stop and
 * ask the user for the quantity in units. It must never fall back to a
 * guess, an average, or a house rule like "a box is twelve". A wrong
 * conversion here would ship the wrong quantity of real food to a real
 * restaurant, and would do it silently.
 *
 * Deliberately NOT derived from the product name. `products.name` is stored
 * verbatim and is never parsed — the reshape migration says so explicitly,
 * and "2kg" in a name is the presentation weight, not a box count.
 */
alter table public.products
  add column units_per_box numeric(12,3)
    check (units_per_box is null or units_per_box > 0);

comment on column public.products.units_per_box is
  'Order units (packages of the presentation) per shipping box. NULL means no reliable conversion exists; the importer must ask rather than assume.';


-- ============================================================
-- 2. product aliases: the names customers actually use
-- ============================================================
/*
 * "Panela Goya 454g" on a customer's order sheet and
 * "Panela Goya - Bloque - 454g" in the Product Master are the same product,
 * and no amount of string cleverness makes that deterministic. An alias is
 * the explicit statement that they are, entered once by someone who knows.
 *
 * customer_id NULL = the alias holds for everybody. A row with a customer
 * scopes it to that customer only, which is what makes two customers' clashing
 * shorthand — one writes "totopos" meaning the 6kg catering bag, another
 * meaning the 200g retail pack — expressible without either overriding the
 * other.
 *
 * Aliases only ever RESOLVE to an existing product. Nothing here can create
 * a product, and the importer has no path that does either.
 */
create table public.product_aliases (
  id          uuid primary key default gen_random_uuid(),
  product_id  uuid not null references public.products (id) on delete cascade,
  -- NULL = applies to every customer.
  customer_id uuid references public.customers (id) on delete cascade,
  alias       text not null check (length(btrim(alias)) > 0),
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Within one scope an alias must name exactly ONE product, or it is not an
-- alias, it is another ambiguity. Two partial indexes rather than one over
-- (customer_id, alias), because NULLs compare as distinct in a unique index
-- and two identical global aliases would both be accepted.
create unique index product_aliases_customer_key
  on public.product_aliases (customer_id, lower(btrim(alias)))
  where customer_id is not null;

create unique index product_aliases_global_key
  on public.product_aliases (lower(btrim(alias)))
  where customer_id is null;

create index product_aliases_product_idx  on public.product_aliases (product_id);
create index product_aliases_customer_idx on public.product_aliases (customer_id);
create index product_aliases_lookup_idx   on public.product_aliases (lower(btrim(alias)));

create trigger product_aliases_set_updated_at before update on public.product_aliases
  for each row execute function public.set_updated_at();


-- ============================================================
-- 3. order request templates: one importer, many customer formats
-- ============================================================
/*
 * Customers send their own Order Request workbooks and are not going to
 * change them. The alternative to this table is a hardcoded reader per
 * customer, which is a new deployment every time somebody adds a column.
 *
 * A template is a MAPPING, not a parser: which sheet, which row the data
 * starts on, and which columns hold the product, the quantity, the unit and
 * the customer's note. Columns are addressed either by spreadsheet letter
 * ("B") or by header label ("Producto"), because a customer who inserts a
 * column breaks the first and not the second, and neither is right for every
 * file.
 *
 * header_signature is how a file is IDENTIFIED rather than guessed at.
 * Filenames are not used: customers rename files, and a renamed file must not
 * silently import as somebody else's format.
 */
create table public.order_request_templates (
  id             uuid primary key default gen_random_uuid(),
  customer_id    uuid not null references public.customers (id) on delete cascade,
  name           text not null check (length(btrim(name)) > 0),

  -- NULL = the first worksheet in the workbook.
  sheet_name     text,
  -- 1-based, as a spreadsheet numbers its rows. NULL = the file has no header
  -- row, in which case columns must be addressed by letter.
  header_row     int check (header_row is null or header_row >= 1),
  -- 1-based row where the product rows begin.
  first_data_row int not null default 2 check (first_data_row >= 1),

  -- Either a column letter ("B") or a header label ("Producto").
  product_column  text not null check (length(btrim(product_column)) > 0),
  quantity_column text not null check (length(btrim(quantity_column)) > 0),
  notes_column    text,
  unit_column     text,

  /*
   * What the quantity column means when the file carries no unit column.
   * 'unit' — already a count of presentation packages, used as-is.
   * 'box'  — shipping boxes; convertible only where units_per_box is known.
   * Never assumed from the header text.
   */
  default_unit   text not null default 'unit'
    check (default_unit in ('unit', 'box')),

  -- Header labels that must all be present for this template to claim a file.
  header_signature text[] not null default '{}',

  is_active      boolean not null default true,
  created_by     uuid references public.profiles (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index ort_customer_idx on public.order_request_templates (customer_id);
create index ort_active_idx   on public.order_request_templates (is_active);

create trigger order_request_templates_set_updated_at
  before update on public.order_request_templates
  for each row execute function public.set_updated_at();


-- ============================================================
-- 4. import provenance and idempotency
-- ============================================================
/*
 * import_source records HOW an order arrived. NULL means what it has always
 * meant for every existing row — entered by hand — so no historical order is
 * touched or reinterpreted by this migration.
 *
 * import_key is the double-click guard. The client mints one key per import
 * session; a second submission of the same import collides with the unique
 * index instead of producing a second real order for a real customer. Partial,
 * so the millions of manual orders that will never have a key do not have to
 * be distinct from each other.
 */
alter table public.orders
  add column import_source text
    check (import_source is null or import_source in ('excel', 'email')),
  add column import_key text;

create unique index orders_import_key_key
  on public.orders (import_key)
  where import_key is not null;

comment on column public.orders.import_source is
  'How the order was created: NULL = entered by hand, ''excel'' = Order Request file, ''email'' = pasted order text.';
comment on column public.orders.import_key is
  'Idempotency key for one import session. A repeated submission collides here rather than creating a duplicate order.';

/*
 * What the customer actually wrote for this line.
 *
 * The preview shows it before the order exists; this keeps it afterwards, so
 * a line that turns out to be matched to the wrong product can be traced back
 * to the text it came from instead of to nothing. Never authoritative:
 * product_id and ordered_quantity are what ships.
 */
alter table public.order_lines add column source_text text;

comment on column public.order_lines.source_text is
  'Verbatim customer text this line was imported from. Traceability only — never used for matching or fulfilment.';


-- ============================================================
-- Row Level Security
--
-- Both new tables follow the pattern the orders module already established:
-- every approved user READS master data, and writing is a capability.
-- No new permission key is introduced — the two capabilities that already
-- describe this work are used as they stand.
-- ============================================================
alter table public.product_aliases          enable row level security;
alter table public.order_request_templates  enable row level security;

-- An alias is product master data, so it is governed by products.manage.
create policy "product_aliases: approved read" on public.product_aliases
  for select to authenticated using (public.is_approved());
create policy "product_aliases: manage writes" on public.product_aliases
  for all to authenticated
  using (public.has_permission('products.manage'))
  with check (public.has_permission('products.manage'));

-- A template is order CONFIGURATION, so it sits with delivery methods and
-- recurring templates under orders.manage_config — which is exactly the key
-- a Power User does not hold and a Manager does.
create policy "order_request_templates: approved read" on public.order_request_templates
  for select to authenticated using (public.is_approved());
create policy "order_request_templates: config writes" on public.order_request_templates
  for all to authenticated
  using (public.has_permission('orders.manage_config'))
  with check (public.has_permission('orders.manage_config'));


-- ============================================================
-- audit
--
-- Imported orders already log 'order_created' through the existing
-- orders_audit trigger, and quantity corrections already log
-- 'quantity_changed'. Nothing new is needed for them.
--
-- What the existing trigger cannot see is HOW the order arrived, so the
-- insert branch is widened to record it. Same table, same view, same admin
-- screen — /admin/audit gains the detail with no further work.
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
    values (
      new.id, (select auth.uid()), 'order_created',
      -- NULL detail for a hand-entered order, exactly as before.
      case when new.import_source is null then null
           else jsonb_build_object('import_source', new.import_source)
      end
    );
  end if;
  return new;
end;
$$;
