-- ============================================================
-- Production orders belong to Operaciones (decided 2026-10-07).
--
-- A production order is an activity with a product and a quantity. Packing
-- every brand's products is Operaciones' work; Producción's and
-- Mantenimiento's activities — and Logística's — are never production
-- orders. All fourteen that exist are Operaciones' already.
-- ============================================================

alter table public.tasks add constraint tasks_production_orders_operations
  check (product_id is null or team = 'operations');
