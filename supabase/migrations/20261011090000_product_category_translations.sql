-- ============================================================
-- Product categories in three languages
--
-- Unlike brand names, category names are descriptions ("Blue tortilla"), so
-- each viewer should read them in their own language.
--
-- `name` stays the English name: required, unique, and the fallback for a
-- translation nobody has entered. name_es and name_de are optional.
-- Columns rather than i18n keys because the business creates these rows
-- itself, and a dictionary entry would need a deployment.
-- ============================================================

alter table public.product_categories
  add column name_es text check (name_es is null or length(btrim(name_es)) > 0),
  add column name_de text check (name_de is null or length(btrim(name_de)) > 0);

alter table public.product_subcategories
  add column name_es text check (name_es is null or length(btrim(name_es)) > 0),
  add column name_de text check (name_de is null or length(btrim(name_de)) > 0);

comment on column public.product_categories.name is 'English name. Fallback when name_es / name_de is empty.';
comment on column public.product_subcategories.name is 'English name. Fallback when name_es / name_de is empty.';
