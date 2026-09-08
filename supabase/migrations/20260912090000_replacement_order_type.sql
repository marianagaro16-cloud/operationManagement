-- ============================================================
-- 'replacement' joins the order type.
--
-- Enum label ONLY, in a file of its own, for the same reason the roles and
-- one_off migrations were split: Postgres will not allow a new enum label to
-- be REFERENCED in the transaction that added it, and `supabase db push` runs
-- each file as one transaction. Nothing below references the label, and
-- nothing needs to — the application reads it, the database only stores it.
--
-- WHY IT IS NOT REDUNDANT WITH orders.replaces_incident_id
--
-- Those two columns look like they say the same thing and do not:
--
--   order_type            the COMMERCIAL nature of the delivery.
--                         'sale' is billed. 'sample' is free, sent to be
--                         evaluated. 'replacement' is free, sent to make
--                         good. Three answers on one axis, mutually
--                         exclusive, and until now the third one had to be
--                         filed as a sale — which overstated sales by every
--                         box we sent to apologise.
--
--   replaces_incident_id  the PROVENANCE. Which incident caused this
--                         delivery to exist at all.
--
-- They come apart in a case that really happens: a redelivery the customer
-- still pays for is a SALE with an incident attached. So there is no CHECK
-- tying them together, and there deliberately will not be — a constraint
-- saying "replacement if and only if incident" would forbid the billed
-- redelivery and force somebody to lie in one column or the other.
--
-- The reverse gap is equally real and equally allowed: a free replacement for
-- a complaint nobody logged as an incident is 'replacement' with a null
-- incident. Recording what we sent is not conditional on having recorded why.
--
-- No existing row changes. Every order in the book stays exactly the type it
-- already is, and nothing is reclassified retroactively — an order that was
-- filed as a sale in October remains what October said it was.
-- ============================================================

alter type public.order_type add value if not exists 'replacement';

comment on type public.order_type is
  'Commercial nature of a delivery: sale = billed, sample = free for evaluation, replacement = free to make good. Independent of orders.replaces_incident_id, which records WHICH incident prompted it.';
