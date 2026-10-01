-- ============================================================
-- A fourth team: Logística — orders, shipping and delivery.
-- Operaciones keeps the warehouse: goods in, labelling, inventory, cleaning.
--
-- In its own migration because Postgres will not let a new enum label be
-- used in the transaction that added it. DO NOT MERGE with the next file.
-- ============================================================

alter type public.team add value if not exists 'logistics';
