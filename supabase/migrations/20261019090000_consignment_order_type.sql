-- ============================================================
-- 'consignment' joins the order type.
--
-- Enum label ONLY, in a file of its own, for the same reason
-- 20260912090000_replacement_order_type and 20260927090000_sponsorship were
-- split: Postgres will not allow a new enum label to be REFERENCED in the
-- transaction that added it, and `supabase db push` runs each file as one
-- transaction. Nothing below references the label, and nothing needs to —
-- the application reads it, the database only stores it.
--
-- WHAT IT IS, AND WHY IT IS NOT A SALE
--
-- order_type answers one question: the COMMERCIAL nature of the delivery.
--
--   sale         billed.
--   consignment  delivered but NOT YET SOLD. The crates leave the factory and
--                sit on the customer's shelf as ours until they sell them;
--                what does not sell can come back. Goods moved, trade did
--                not — or has not yet.
--   sample       free, sent to be EVALUATED.
--   replacement  free, sent to MAKE GOOD.
--   sponsorship  free, given in EXCHANGE for visibility.
--
-- Filing a consignment as a sale books revenue that nobody has earned and
-- that may walk back through the door next month. Filing it as a sample says
-- it was given away, which it was not — it is still ours. It is a fifth
-- answer on the same axis, mutually exclusive with the other four.
--
-- DELIBERATELY JUST A LABEL. What the customer eventually sells, and what
-- comes back, is settled outside the app as it is today; this records which
-- deliveries those are. A screen for liquidating a consignment is a separate
-- decision, and building half of one here would invite people to trust
-- numbers the app never sees.
--
-- No existing row changes. Nothing is reclassified retroactively — a
-- consignment filed as a sale in August remains what August said it was.
-- The label is available from today forward; correcting an old order is a
-- person's decision, order by order, not a migration's.
-- ============================================================

alter type public.order_type add value if not exists 'consignment';

comment on type public.order_type is
  'Commercial nature of a delivery: sale = billed, consignment = delivered but not yet sold and returnable, sample = free for evaluation, replacement = free to make good, sponsorship = free in exchange for visibility. Independent of orders.replaces_incident_id, which records WHICH incident prompted it.';
