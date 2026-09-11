-- ============================================================
-- 'sponsorship' joins the order type.
--
-- Enum label ONLY, in a file of its own, for the same reason
-- 20260912090000_replacement_order_type was split: Postgres will not allow a
-- new enum label to be REFERENCED in the transaction that added it, and
-- `supabase db push` runs each file as one transaction. Nothing below
-- references the label, and nothing needs to — the application reads it, the
-- database only stores it.
--
-- WHAT IT IS, AND WHY IT IS NOT A SAMPLE
--
-- order_type answers one question: the COMMERCIAL nature of the delivery.
--
--   sale         billed.
--   sample       free, sent to be EVALUATED — it is a bet on a future order,
--                and the question asked of it later is "did they buy".
--   replacement  free, sent to MAKE GOOD.
--   sponsorship  free, given in EXCHANGE for visibility — an event, a team,
--                a fair. No future order is expected from the recipient and
--                none is the point; what we got back was the name on the
--                banner.
--
-- Filing a sponsorship as a sample would answer that "did they buy" question
-- with a permanent no and quietly make every sample cohort look worse than it
-- was. Filing it as a sale would overstate trade by every crate we gave away.
-- It is a fourth answer on the same axis, mutually exclusive with the other
-- three.
--
-- No existing row changes. Nothing is reclassified retroactively — a crate
-- that went to the neighbourhood fair in August and was filed as a sale
-- remains what August said it was. The label is available from today
-- forward; correcting an old order is a person's decision, order by order,
-- not a migration's.
-- ============================================================

alter type public.order_type add value if not exists 'sponsorship';

comment on type public.order_type is
  'Commercial nature of a delivery: sale = billed, sample = free for evaluation, replacement = free to make good, sponsorship = free in exchange for visibility. Independent of orders.replaces_incident_id, which records WHICH incident prompted it.';
