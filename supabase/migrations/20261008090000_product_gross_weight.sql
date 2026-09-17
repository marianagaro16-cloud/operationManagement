-- ============================================================
-- Gross weight per product: what the order screens total
--
-- gross_weight_kg is the weight of one unit as ordered WITH its packaging.
-- It is never below the net weight (equal means no packaging worth counting).
--
-- Where it comes from: whenever a product has a net weight and no gross
-- weight, the net weight is copied in and marked gross_weight_suggested, so it
-- shows as "to review" until a person confirms it. That covers the backfill
-- below, new products, and the name pre-fill script alike.
--
-- Written by whoever holds products.manage, through the existing
-- "products: manage writes" policy — no new rule.
-- ============================================================

alter table public.products
  add column if not exists gross_weight_kg numeric(12,3)
    check (gross_weight_kg is null or gross_weight_kg > 0),
  add column if not exists gross_weight_suggested boolean not null default false;

alter table public.products
  drop constraint if exists products_gross_suggestion_has_weight;
alter table public.products
  add constraint products_gross_suggestion_has_weight
  check (not gross_weight_suggested or gross_weight_kg is not null);

comment on column public.products.gross_weight_kg is
  'Gross weight in kg of one unit as ordered, packaging included. Never below net_weight_kg. Null = unknown.';
comment on column public.products.gross_weight_suggested is
  'True while gross_weight_kg is a copy of the net weight that nobody has confirmed yet.';

-- An empty gross weight next to a known net weight starts as a copy of it.
create or replace function public.products_copy_net_to_gross()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.gross_weight_kg is null and new.net_weight_kg is not null then
    new.gross_weight_kg := new.net_weight_kg;
    new.gross_weight_suggested := true;
  end if;
  return new;
end;
$$;

drop trigger if exists products_copy_net_to_gross on public.products;
create trigger products_copy_net_to_gross
  before insert or update of net_weight_kg, gross_weight_kg on public.products
  for each row execute function public.products_copy_net_to_gross();

-- Backfill, before the check below needs it: every product with a net weight.
update public.products
   set gross_weight_kg = net_weight_kg,
       gross_weight_suggested = true
 where gross_weight_kg is null
   and net_weight_kg is not null;

alter table public.products
  drop constraint if exists products_gross_not_below_net;
alter table public.products
  add constraint products_gross_not_below_net
  check (gross_weight_kg is null or net_weight_kg is null or gross_weight_kg >= net_weight_kg);
