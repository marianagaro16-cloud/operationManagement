-- ============================================================
-- Product brands
--
-- The catalogue sells under three names — Masamor, Del Barrio and Colectivo
-- Comestibles — and until now nothing recorded which. That made "how did Del
-- Barrio do this month" a question nobody could ask of the order reports, and
-- it made two products with similar names indistinguishable on a picking list
-- when they belong to different ranges.
--
-- A TABLE rather than an enum or a text column, for the reasons this codebase
-- has settled on elsewhere:
--
--   not an ENUM, because a brand is commercial rather than structural. A
--   fourth one is a business decision somebody makes on a Tuesday, and it
--   should not need a migration and a deployment — delivery_methods is a
--   table for exactly this reason.
--
--   not TEXT, because free text is how you end up with Masamor, MASAMOR and
--   "Masamor " as three brands in a report. The product master already
--   learned this lesson: `products.category` is free text and is therefore
--   not something the reports can group by with any confidence.
--
-- Brand names are PROPER NOUNS and are deliberately not translated. Masamor
-- is Masamor in Spanish, German and English, so there is no slug and no i18n
-- key here — unlike incident categories, whose names are descriptions.
-- ============================================================

create table public.brands (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (length(btrim(name)) > 0),
  sort_order int  not null default 100,
  -- Never deleted. A brand that is retired stops being offered on new
  -- products while every historical product keeps naming it, exactly as
  -- delivery methods and products themselves work.
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One brand per name, case- and space-insensitively: "Del Barrio" and
-- "del barrio " are the same brand however they were typed.
create unique index brands_name_key on public.brands (lower(btrim(name)));
create index brands_active_idx on public.brands (is_active);

create trigger brands_set_updated_at before update on public.brands
  for each row execute function public.set_updated_at();

insert into public.brands (name, sort_order) values
  ('Masamor', 10),
  ('Del Barrio', 20),
  ('Colectivo Comestibles', 30);


-- ============================================================
-- the link
-- ============================================================
/*
 * NULLABLE, and it stays nullable.
 *
 * Every product that exists today has no brand recorded, and guessing one
 * from the name would be exactly the kind of inference `products.name` is
 * documented never to be subjected to. An unbranded product is a product
 * nobody has classified yet, which is a true statement about the catalogue
 * and a useful one — the product screen can show how many are left.
 *
 * ON DELETE RESTRICT: a brand in use cannot be removed, which is what makes
 * "never deleted, only deactivated" enforceable rather than merely intended.
 */
alter table public.products
  add column brand_id uuid references public.brands (id) on delete restrict;

create index products_brand_idx on public.products (brand_id);

comment on column public.products.brand_id is
  'Which of our brands this product is sold under. NULL = not yet classified; never inferred from the product name.';


-- ============================================================
-- Row Level Security
--
-- A brand is product master data, so it answers to the capability that
-- already governs the product master. No new permission key: a Manager and a
-- Power User both hold products.manage, and both maintain the catalogue.
-- ============================================================
alter table public.brands enable row level security;

create policy "brands: approved read" on public.brands
  for select to authenticated using (public.is_approved());

create policy "brands: manage writes" on public.brands
  for all to authenticated
  using (public.has_permission('products.manage'))
  with check (public.has_permission('products.manage'));
