-- ============================================================
-- Product description
--
-- The product's own description, as on the bexio article (e.g. "Nixtamalisierte
-- Bio Mais Tortillas / 06 cm Durchmesser / CH-BIO-006"). Plain text, line
-- breaks kept. Separate from notes, which stay internal remarks.
--
-- Filled once from the bexio product export (scripts/import-bexio-products.mjs,
-- which only fills empty ones: the app wins). Edited in Administrar → Productos
-- through the existing "products: manage writes" policy; read wherever products
-- are, the Catálogo included.
-- ============================================================

alter table public.products
  add column if not exists description text
    check (description is null or length(description) <= 4000);

comment on column public.products.description is
  'The product description (from bexio, then kept here). Plain text with line breaks. Null = none.';
