-- ============================================================
-- 'event' joins the order type: what goes to one of our events.
--
-- Enum label ONLY, in a file of its own (see 20261019090000_consignment):
-- a new label cannot be referenced in the transaction that added it.
--
-- Prepared like any order, with lots — but not a sale: it is not counted in
-- the sales report nor in customers going quiet (20261117090100).
-- ============================================================

alter type public.order_type add value if not exists 'event';

comment on type public.order_type is
  'Commercial nature of a delivery: sale = billed, consignment = delivered but not yet sold and returnable, sample = free for evaluation, replacement = free to make good, sponsorship = free in exchange for visibility, event = taken to one of our events. Independent of orders.replaces_incident_id, which records WHICH incident prompted it.';
