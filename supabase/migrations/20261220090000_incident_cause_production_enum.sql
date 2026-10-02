-- ============================================================
-- A cause "Producción": the product itself — quality, weight, packaging
-- (decided 2026-10-02). In its own migration because Postgres will not let a
-- new enum label be used in the transaction that added it.
-- DO NOT MERGE with the next file.
-- ============================================================

alter type public.incident_cause add value if not exists 'production' before 'order_entry';
