-- ============================================================
-- Product categories and subcategories
--
-- The order report lists quantities product by product, and nothing let it
-- add them up by kind: all Ø14 yellow tortillas, all blue totopos. The
-- diameter and the colour are in the product NAME, but names are stored
-- verbatim and never parsed — and they are not consistent anyway (Ø14cm,
-- 19cmØ, Ø06cm, Corazón).
--
-- So a product is classified by a person, on two levels:
--
--   category     — Tortilla, Totopos, Salsa …
--   subcategory  — within one category: Ø14 Gelb, Ø14 Blau, Blau …
--
-- Tables rather than text, for the reason brands are a table:
-- `products.category` is free text and is therefore not something a report
-- can group by with any confidence. That legacy column is left untouched.
--
-- Names are typed by the business and not translated, like brand names.
-- ============================================================

create table public.product_categories (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (length(btrim(name)) > 0),
  sort_order int  not null default 100,
  -- Never deleted: retiring one stops it being offered while every product
  -- that names it goes on naming it.
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index product_categories_name_key on public.product_categories (lower(btrim(name)));

create trigger product_categories_set_updated_at before update on public.product_categories
  for each row execute function public.set_updated_at();

create table public.product_subcategories (
  id          uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.product_categories (id) on delete restrict,
  name        text not null check (length(btrim(name)) > 0),
  sort_order  int  not null default 100,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- Target of the products composite key below.
  unique (id, category_id)
);

-- Unique within its category: "Ø14" may exist under Tortilla and under
-- something else, but not twice under Tortilla.
create unique index product_subcategories_name_key
  on public.product_subcategories (category_id, lower(btrim(name)));

create trigger product_subcategories_set_updated_at before update on public.product_subcategories
  for each row execute function public.set_updated_at();


-- ============================================================
-- the link
-- ============================================================
/*
 * Both NULLABLE: every product that exists today is unclassified, and that is
 * a true statement the report shows as its own group.
 *
 * The composite key makes it impossible for a product to carry a subcategory
 * of a different category. With MATCH SIMPLE it is not checked while
 * category_id is null, so the CHECK closes that gap: no subcategory without
 * its category.
 */
alter table public.products
  add column category_id    uuid references public.product_categories (id) on delete restrict,
  add column subcategory_id uuid,
  add constraint products_subcategory_fkey
    foreign key (subcategory_id, category_id)
    references public.product_subcategories (id, category_id) on delete restrict,
  add constraint products_subcategory_needs_category
    check (subcategory_id is null or category_id is not null);

create index products_category_idx    on public.products (category_id);
create index products_subcategory_idx on public.products (subcategory_id);

comment on column public.products.category_id is
  'What kind of product this is (Tortilla, Totopos …). NULL = not yet classified; never inferred from the name.';
comment on column public.products.subcategory_id is
  'A group within the category (Ø14 Gelb …). Must belong to category_id.';


-- ============================================================
-- Row Level Security — product master data, so products.manage.
-- ============================================================
alter table public.product_categories    enable row level security;
alter table public.product_subcategories enable row level security;

create policy "product_categories: approved read" on public.product_categories
  for select to authenticated using (public.is_approved());

create policy "product_categories: manage writes" on public.product_categories
  for all to authenticated
  using (public.has_permission('products.manage'))
  with check (public.has_permission('products.manage'));

create policy "product_subcategories: approved read" on public.product_subcategories
  for select to authenticated using (public.is_approved());

create policy "product_subcategories: manage writes" on public.product_subcategories
  for all to authenticated
  using (public.has_permission('products.manage'))
  with check (public.has_permission('products.manage'));
