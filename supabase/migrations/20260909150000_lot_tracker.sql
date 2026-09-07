-- ============================================================
-- Lot Nummer Tracker
--
-- The Tracker is a READ layer over the lot allocations that
-- Lotnummerkontrol already writes. It creates no table, no second copy and no
-- synchronisation job: `public.lot_allocations` remains the single source of
-- truth, and the Tracker queries it directly, so a correction made in
-- Lotnummerkontrol is visible in the Tracker with no step in between.
--
-- Only two things were missing to support it.
-- ============================================================


-- ============================================================
-- 1. partial lot-number search that stays fast
-- ============================================================
/*
 * Searching "260906" has to find "LOT-260906-A", which is `ilike '%260906%'`
 * — a leading wildcard, and a plain B-tree cannot serve it. The existing
 * lot_allocations_lot_idx answers equality and prefix only, so today's search
 * would degrade into a sequential scan of every allocation ever recorded.
 *
 * A trigram GIN index answers infix matching directly. pg_trgm ships with
 * Supabase on every tier, like pg_cron and pg_net already used here.
 *
 * gin_trgm_ops also serves the case-insensitive comparison, so no functional
 * lower() index is needed alongside it.
 */
create extension if not exists pg_trgm;

create index lot_allocations_lot_trgm_idx
  on public.lot_allocations
  using gin (lot_number gin_trgm_ops);

-- Default ordering is most-recent-first, which is what an operational search
-- wants and what an unindexed sort would make expensive as history grows.
create index lot_allocations_created_idx
  on public.lot_allocations (created_at desc);


-- ============================================================
-- 2. lot allocations join the audit trail they were missing from
-- ============================================================
/*
 * `orders` and `order_lines` have been audited since the module shipped;
 * lot_allocations never were. The row carries created_by/updated_by, so it
 * says who touched it LAST — but "User B changed the quantity 12 -> 15" was
 * not recorded anywhere, and that is precisely the history a traceability
 * tool exists to show.
 *
 * Written into the EXISTING public.order_audit_log rather than a new table:
 * it already has the right shape, it is already admin/manager readable, and
 * the operational_audit view already unions it, so lot events appear on
 * /admin/audit with no further work.
 *
 * order_id is resolved through the line because the log is keyed by order —
 * which is also what makes these events show up in an order's own history.
 *
 * NOTE: this records changes from now on. The five allocations that already
 * exist have their created_by and created_at, and no change history, because
 * none was ever kept. Backfilling would mean inventing events that nobody
 * observed.
 */
create or replace function public.log_lot_allocation_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order_id uuid;
  v_row      public.lot_allocations := coalesce(new, old);
begin
  select ol.order_id into v_order_id
    from public.order_lines ol
   where ol.id = v_row.order_line_id;

  -- The line is gone: this is a cascade from deleting an order or a line,
  -- and the deletion itself is already audited at that level.
  if v_order_id is null then
    return coalesce(new, old);
  end if;

  if tg_op = 'INSERT' then
    insert into public.order_audit_log (order_id, actor_id, action, detail)
    values (v_order_id, (select auth.uid()), 'lot_added', jsonb_build_object(
      'lot_allocation_id', new.id,
      'order_line_id', new.order_line_id,
      'lot_number', new.lot_number,
      'quantity', new.quantity));

  elsif tg_op = 'UPDATE' then
    -- Only a change to what the lot IS or how much of it was used. A note
    -- edit or a touched updated_at is not traceability information.
    if new.lot_number is distinct from old.lot_number
       or new.quantity is distinct from old.quantity then
      insert into public.order_audit_log (order_id, actor_id, action, detail)
      values (v_order_id, (select auth.uid()), 'lot_changed', jsonb_build_object(
        'lot_allocation_id', new.id,
        'order_line_id', new.order_line_id,
        'before', jsonb_build_object('lot_number', old.lot_number, 'quantity', old.quantity),
        'after',  jsonb_build_object('lot_number', new.lot_number, 'quantity', new.quantity)));
    end if;

  else
    insert into public.order_audit_log (order_id, actor_id, action, detail)
    values (v_order_id, (select auth.uid()), 'lot_removed', jsonb_build_object(
      'lot_allocation_id', old.id,
      'order_line_id', old.order_line_id,
      'lot_number', old.lot_number,
      'quantity', old.quantity));
  end if;

  return coalesce(new, old);
end;
$$;

create trigger lot_allocations_audit
  after insert or update or delete on public.lot_allocations
  for each row execute function public.log_lot_allocation_change();

comment on function public.log_lot_allocation_change() is
  'Records lot additions, changes and removals into order_audit_log, so the Lot Nummer Tracker can show who changed what and when.';


-- ============================================================
-- 3. one flat row per allocation, for searching
-- ============================================================
/*
 * A projection, not a table. No data lives here: it is
 * lot_allocations joined to the line, order, product and customer it already
 * belongs to, so it cannot drift from the source and needs no refresh.
 *
 * It exists because the Tracker sorts by columns that live three joins away —
 * customer name, product name, delivery date. PostgREST can FILTER through an
 * embedded resource but cannot ORDER the top-level rows by one, so without
 * this the sort would have to happen in the browser, over one page, which
 * would sort a page rather than the result.
 *
 * security_invoker = true so the view runs as the caller and every underlying
 * RLS policy still applies — the same choice operational_audit made. A view
 * that ran as its owner would be a way around RLS, which is precisely what
 * this must not become.
 */
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
    c.is_active              as customer_active
  from public.lot_allocations la
  join public.order_lines ol on ol.id = la.order_line_id
  join public.orders      o  on o.id  = ol.order_id
  join public.products    p  on p.id  = ol.product_id
  join public.customers   c  on c.id  = o.customer_id
  left join public.profiles entered  on entered.id  = la.created_by
  left join public.profiles modified on modified.id = la.updated_by;

comment on view public.lot_allocation_search is
  'Flat read model for the Lot Nummer Tracker. Projection only — lot_allocations remains the single source of truth, and security_invoker keeps every RLS policy in force.';


-- ============================================================
-- What is deliberately NOT here
-- ============================================================
/*
 * No lot table, no lot master, no expiry link, no remaining-quantity column.
 *
 * A lot number is not globally unique — the same number legitimately belongs
 * to different products — so there is nothing to promote into an entity, and
 * a uniqueness constraint would reject real data. The Tracker groups by lot
 * number at QUERY time and shows the product context of each allocation.
 *
 * RLS on lot_allocations is unchanged. It must stay readable by every
 * approved user because Lotnummerkontrol depends on it; the Tracker is
 * therefore gated in the route and the query layer, not by RLS. Narrowing the
 * policy to gate the Tracker would break the preparation workflow the data
 * exists for.
 */
