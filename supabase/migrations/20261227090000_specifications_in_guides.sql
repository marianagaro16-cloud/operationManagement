-- ============================================================
-- Customer specifications move from Gestión into the Guías (decided
-- 2026-10-06): the standing notes about a customer's invoicing and transport
-- are what whoever covers the office needs beside the daily guide.
--
-- Read: as before whoever manages customers, and now also whoever can read a
-- guide — which includes the covering person around their days. Written
-- exactly as before: customers.manage.
-- ============================================================

drop policy "customer_specification_types: manage read" on public.customer_specification_types;
create policy "customer_specification_types: read" on public.customer_specification_types
  for select to authenticated
  using ((select public.has_permission('customers.manage')) or (select public.guide_reader()));

drop policy "customer_specifications: manage read" on public.customer_specifications;
create policy "customer_specifications: read" on public.customer_specifications
  for select to authenticated
  using ((select public.has_permission('customers.manage')) or (select public.guide_reader()));
