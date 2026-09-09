-- ============================================================
-- An inventory template can name the brand it counts
--
-- The previous migration matched templates to brands by slug inside a CASE
-- expression. That was fine for a one-off correction and is the wrong thing
-- to leave behind: it lives in a file nobody reads again, it breaks silently
-- if a slug is edited, and the application cannot ask "which brand is this?"
-- without hardcoding the same four strings a second time.
--
-- So the relationship becomes what it actually is — a column.
--
-- NULLABLE on purpose. Materia Prima and Empaques count things that are not
-- products of a brand, and they must stay that way; a template with no brand
-- simply has no product list to refresh from, which the UI reads directly off
-- this column rather than off a list of names it keeps in step by hand.
-- ============================================================

alter table public.inventory_templates
  add column if not exists brand_id uuid references public.brands (id) on delete set null;

comment on column public.inventory_templates.brand_id is
  'The brand whose active products make up this inventory, or NULL for a template that counts something other than finished goods (raw material, packaging). Drives "refresh from products".';

create index if not exists inventory_templates_brand_idx
  on public.inventory_templates (brand_id) where brand_id is not null;

-- Backfill the four, by the same slugs the previous migration created.
update public.inventory_templates t
   set brand_id = b.id
  from public.brands b
 where t.brand_id is null
   and t.slug = case b.name
                  when 'Masamor'               then 'masamor'
                  when 'Del Barrio'            then 'del-barrio'
                  when 'Colectivo Comestibles' then 'colectivo-comestibles'
                  when 'Complementarios'       then 'complementarios'
                end;
