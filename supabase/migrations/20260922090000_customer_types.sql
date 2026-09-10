-- ============================================================
-- Customer types
--
-- The operation sells to three quite different kinds of buyer — a restaurant
-- kitchen, a distributor moving pallets, and a shop reselling on a shelf —
-- and nothing recorded which. That made "how much of this month was Gastro"
-- a question nobody could ask, and it hid the fact that a distributor's order
-- and a restaurant's order are not comparable quantities of the same thing.
--
-- A TABLE rather than an enum or a text column, following `brands` exactly
-- and for the same three reasons:
--
--   not an ENUM, because a fourth segment is a commercial decision somebody
--   makes on a Tuesday and should not need a migration, a deployment and —
--   as 20260908090000_roles_enum documents at length — a SECOND migration,
--   because Postgres refuses to reference a new enum label in the transaction
--   that added it.
--
--   not TEXT, because free text is how "Gastro", "gastro" and "Gastro "
--   become three segments in a report. products.category already taught this
--   lesson and is consequently something no report can group by.
--
--   a TABLE, so a fourth type is one INSERT.
--
-- UNLIKE BRANDS, these names are DESCRIPTIONS rather than proper nouns.
-- "Masamor" is Masamor in every language; a distributor is a Distribuidor, a
-- Händler and a distributor. So each row carries a stable `slug` for the i18n
-- dictionary to key on, with `name` as the fallback for a type somebody adds
-- later that no dictionary knows about — the same arrangement
-- incident_categories uses, and for the same reason.
-- ============================================================

create table public.customer_types (
  id         uuid primary key default gen_random_uuid(),
  -- The i18n key. Stable, lowercase, never shown to anybody.
  slug       text not null unique check (slug ~ '^[a-z][a-z0-9_]*$'),
  -- What to show when the dictionary has no translation for the slug.
  name       text not null check (length(btrim(name)) > 0),
  sort_order int  not null default 100,
  -- Never deleted. A retired segment stops being offered on new customers
  -- while every historical customer keeps naming it, exactly as brands,
  -- delivery methods and products themselves work.
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index customer_types_name_key on public.customer_types (lower(btrim(name)));
create index customer_types_active_idx on public.customer_types (is_active);

create trigger customer_types_set_updated_at before update on public.customer_types
  for each row execute function public.set_updated_at();

comment on table public.customer_types is
  'Commercial segment a customer belongs to. Descriptions, so the slug is the i18n key and name is the fallback.';

/*
 * The three the operation actually has.
 *
 * `distributor` is spelled the English way as a SLUG because a slug is an
 * identifier and this codebase keeps identifiers in English throughout
 * (order_entry, partially_damaged, checked_ok). The Spanish word the team
 * uses lives in the dictionary, where it can be changed without touching a
 * single row.
 */
insert into public.customer_types (slug, name, sort_order) values
  ('gastro',      'Gastro',       10),
  ('distributor', 'Distribuidor', 20),
  ('reseller',    'Reseller',     30);


-- ============================================================
-- the link
-- ============================================================
/*
 * NULLABLE, and it stays nullable.
 *
 * Every customer that exists today has no type recorded, and guessing one
 * from a name would put invented commercial data into the master file — a
 * "5 Almas AG" is not obviously any of the three, and a wrong classification
 * is worse than a missing one because it silently skews every figure grouped
 * by segment.
 *
 * So an unclassified customer is a real and permanent state. The screens say
 * "Sin tipo" rather than hiding it, and the reports count it as its own
 * bucket rather than dropping the rows — which is what makes the backlog
 * visible enough to work through.
 *
 * RESTRICT on delete: a type with customers behind it can be deactivated but
 * never removed out from under them.
 */
alter table public.customers
  add column customer_type_id uuid references public.customer_types (id) on delete restrict;

create index customers_type_idx on public.customers (customer_type_id);

comment on column public.customers.customer_type_id is
  'Commercial segment. NULL means unclassified, which is a real state and not a placeholder to be filled by guessing.';


-- ============================================================
-- Row Level Security
--
-- Readable by everyone approved, because the customer picker and the order
-- screens have to show the type. Writable by whoever manages customers, since
-- classifying a customer IS managing that customer — there is no separate
-- authority here and inventing one would mean a new key nobody asked for.
-- ============================================================
alter table public.customer_types enable row level security;

create policy "customer_types: approved read" on public.customer_types
  for select to authenticated using (public.is_approved());

create policy "customer_types: manage writes" on public.customer_types
  for all to authenticated
  using (public.has_permission('customers.manage'))
  with check (public.has_permission('customers.manage'));
