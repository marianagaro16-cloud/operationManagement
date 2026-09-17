-- ============================================================
-- Net weight per product, so an order can have a total weight
--
-- net_weight_kg is the NET weight of one unit AS ORDERED: a package of
-- "1.75kg Fresco" is 1.75; a product sold as "Caja 6kg" is 6. Volumes are
-- entered at 1 L = 1 kg. Null means nobody knows yet, and an order total then
-- says how many of its lines it could not weigh rather than pretending.
--
-- net_weight_suggested marks a weight that was read out of the product's name
-- by scripts/prefill-product-weights.ts and not yet confirmed by a person.
-- Saving the product in Manage -> Products confirms it.
--
-- Written by whoever holds products.manage, through the existing
-- "products: manage writes" policy — no new rule.
-- ============================================================

alter table public.products
  add column if not exists net_weight_kg numeric(12,3)
    check (net_weight_kg is null or net_weight_kg > 0),
  add column if not exists net_weight_suggested boolean not null default false;

-- A suggestion needs something to suggest.
alter table public.products
  drop constraint if exists products_weight_suggestion_has_weight;
alter table public.products
  add constraint products_weight_suggestion_has_weight
  check (not net_weight_suggested or net_weight_kg is not null);

comment on column public.products.net_weight_kg is
  'Net weight in kg of one unit as ordered. Volumes at 1 L = 1 kg. Null = unknown.';
comment on column public.products.net_weight_suggested is
  'True while net_weight_kg is a suggestion read from the product name that nobody has confirmed yet.';
