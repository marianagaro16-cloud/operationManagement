-- ============================================================
-- Master data reshape for the new customer and product sources.
--
-- Structural only. It creates no data and deletes no rows; the import
-- script (scripts/import-master.ts) is what loads contacts_clients.xlsx
-- and productos.xlsx.
--
-- The one exception is the duplicate-code repair below, which is a data
-- fix that MUST happen before a unique index can exist at all.
-- ============================================================

-- ============================================================
-- CUSTOMERS: company name and its addition become separate fields
--
-- The source distinguishes the legal entity ("5 Almas AG") from the
-- trading name ("La Catedral"), and both must stay queryable — the old
-- data used trading names, the new data uses legal names, so collapsing
-- them into one string would lose the only reliable way to reconcile.
-- ============================================================
alter table public.customers add column company_name text;
alter table public.customers add column company_name_addition text;

-- Existing rows keep their name as the company name so nothing is lost
-- if this runs against a populated table.
update public.customers set company_name = name where company_name is null;
alter table public.customers alter column company_name set not null;
alter table public.customers
  add constraint customers_company_name_not_blank check (length(btrim(company_name)) > 0);

-- `name` becomes a derived display value. Keeping the column means every
-- existing query, sort and component that reads `customers.name` keeps
-- working unchanged, while the two source fields remain authoritative.
drop index if exists public.customers_name_key;
alter table public.customers drop column name;
alter table public.customers add column name text
  generated always as (
    case
      when company_name_addition is null or btrim(company_name_addition) = ''
        then company_name
      else company_name || ' — ' || company_name_addition
    end
  ) stored;

-- Identity is the PAIR. Two rows legitimately share a company name when
-- the addition differs — "Damn Delicious GmbH" trades as both
-- "Restaurant Weisses Rössli" and "Restaurant Casi Casa".
create unique index customers_identity_key
  on public.customers (lower(btrim(company_name)), lower(btrim(coalesce(company_name_addition, ''))));

-- Admin search covers both fields.
create index customers_company_name_idx on public.customers (lower(btrim(company_name)));
create index customers_addition_idx
  on public.customers (lower(btrim(company_name_addition)))
  where company_name_addition is not null;

-- ============================================================
-- PRODUCTS: the imported product name, stored verbatim
--
-- Deliberately NOT parsed. Nothing is inferred from the name into
-- category, family, presentation, weight or unit — those stay as they
-- are, and stay empty for newly imported products, until someone
-- populates them from a reliable source.
-- ============================================================
alter table public.products add column name text;

comment on column public.products.name is
  'Product name exactly as imported. Never parsed into structured fields.';
comment on column public.products.family is
  'Legacy structured field from the Control de pedidos import. Not derived from name.';
comment on column public.products.presentation is
  'Legacy structured field from the Control de pedidos import. Not derived from name.';

-- ---------- duplicate code repair ----------
-- Four codes are attached to two genuinely different products each
-- (0107, 0219, 0287, 0250) — a data-entry error in the source workbook.
-- A code cannot identify a product while that is true.
--
-- Deterministic rule: the earliest-created row of each group keeps the
-- code and stays active; its siblings are deactivated and flagged for
-- review. Nothing is deleted, and no row referenced by an order is
-- affected (none of these are referenced).
with ranked as (
  select id, row_number() over (partition by code order by created_at, id) as rn
    from public.products
   where code is not null
)
update public.products p
   set is_active = false,
       needs_review = true,
       notes = coalesce(nullif(p.notes, '') || ' | ', '') ||
               'Deactivated by master-data reshape: product code was shared with another product.'
  from ranked r
 where p.id = r.id
   and r.rn > 1;

-- Uniqueness applies to ACTIVE products: a code must identify exactly one
-- sellable product. Deactivated history keeps its code for the record.
create unique index products_code_active_key
  on public.products (code)
  where is_active and code is not null;

create index products_name_idx
  on public.products (lower(btrim(name)))
  where name is not null;
