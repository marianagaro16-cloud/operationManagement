-- ============================================================
-- A third team: Ventas (sales).
--
-- In its own migration because Postgres will not let a new enum label be
-- used in the transaction that added it. What it means is in
-- 20261105090100_sales_customer_file.sql. DO NOT MERGE THESE TWO FILES.
-- ============================================================

alter type public.team add value if not exists 'sales';
