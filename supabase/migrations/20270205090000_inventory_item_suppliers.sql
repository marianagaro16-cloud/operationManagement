-- ============================================================
-- Who supplies raw materials and packaging (2026-10-23).
--
-- Those aren't catalogue products: they are the items on the Materia Prima
-- and Empaques inventory lists. Same rules as product_suppliers: several
-- suppliers, at most one main, their article code, the office only.
-- ============================================================

create table public.inventory_item_suppliers (
  item_id       uuid not null references public.inventory_template_items (id) on delete cascade,
  supplier_id   uuid not null references public.suppliers (id) on delete cascade,
  is_main       boolean not null default false,
  supplier_code text check (length(supplier_code) <= 60),
  created_at    timestamptz not null default now(),
  primary key (item_id, supplier_id)
);
create unique index inventory_item_suppliers_one_main on public.inventory_item_suppliers (item_id) where is_main;
create index inventory_item_suppliers_supplier_idx on public.inventory_item_suppliers (supplier_id);

alter table public.inventory_item_suppliers enable row level security;
create policy "inventory_item_suppliers: office" on public.inventory_item_suppliers for all to authenticated
  using ((select public.is_office())) with check ((select public.is_office()));
grant select, insert, update, delete on public.inventory_item_suppliers to authenticated;
