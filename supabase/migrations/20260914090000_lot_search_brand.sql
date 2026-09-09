-- ============================================================
-- Brand joins the lot search view
--
-- A recall is scoped by what was affected, and "everything of Del Barrio in
-- September" is a question the Tracker could not answer: the view carried the
-- product but not the brand it sells under, so the export had no column to
-- filter on once the file was open in Excel.
--
-- A left join, not an inner one. A product with no brand recorded must still
-- appear in a traceability search — dropping a row from a recall because
-- somebody had not classified it would be the worst possible failure of this
-- screen.
--
-- The new columns are appended. `create or replace view` keeps existing
-- columns in place and in order, so every caller that named the old ones is
-- untouched.
-- ============================================================

create or replace view public.lot_allocation_search
with (security_invoker = true)
as
  select
    la.id,
    la.lot_number,
    la.quantity,
    la.note,
    la.created_at,
    la.updated_at,
    la.created_by,
    la.updated_by,
    coalesce(entered.name,  entered.email)  as entered_by,
    coalesce(modified.name, modified.email) as modified_by,
    ol.id            as order_line_id,
    o.id             as order_id,
    o.reference      as order_reference,
    o.status::text   as order_status,
    o.preparation_date,
    o.delivery_date,
    p.id             as product_id,
    p.name           as product_name,
    p.code           as product_code,
    c.id             as customer_id,
    c.company_name           as customer_name,
    c.company_name_addition  as customer_addition,
    c.is_active              as customer_active,
    p.brand_id,
    b.name           as brand_name
  from public.lot_allocations la
  join public.order_lines ol on ol.id = la.order_line_id
  join public.orders      o  on o.id  = ol.order_id
  join public.products    p  on p.id  = ol.product_id
  join public.customers   c  on c.id  = o.customer_id
  left join public.brands   b on b.id = p.brand_id
  left join public.profiles entered  on entered.id  = la.created_by
  left join public.profiles modified on modified.id = la.updated_by;

comment on view public.lot_allocation_search is
  'Flat read model for the Lot Nummer Tracker. Projection only — lot_allocations remains the single source of truth, and security_invoker keeps every RLS policy in force. Brand is left-joined so an unclassified product is never dropped from a traceability search.';
