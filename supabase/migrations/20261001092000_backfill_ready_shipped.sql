-- ============================================================
-- Mark the orders that already went out as Ready and Shipped.
--
-- Ready and Shipped arrived in 20261001090000 with every existing order at
-- neither. Left that way, every order already delivered would read as still
-- being prepared: carried over on the preparation screen, overdue in Order
-- Control, and eligible for delivery alerts.
--
-- Agreed with the operations lead on 2026-09-15: every confirmed order
-- delivering today or earlier — 23 before today and 13 today, all fully
-- prepared — is marked both Ready and Shipped. Future orders are untouched.
--
-- No person is named (ready_by / shipped_by stay null): nobody pressed a
-- button, and inventing an author would be worse than none. The moments are
-- the best evidence there is — Ready when the order's last lot was recorded,
-- Shipped at the start of its delivery day, or at Ready if that was later —
-- and each order gets an audit row saying this was the initial backfill.
--
-- Only orders that order_is_prepared() confirms are touched, so the filter
-- cannot sweep up something unfinished.
-- ============================================================

with candidates as (
  select o.id,
         coalesce(
           (select max(a.created_at)
              from public.order_lines l
              join public.lot_allocations a on a.order_line_id = l.id
             where l.order_id = o.id),
           (o.preparation_date::timestamp at time zone 'Europe/Zurich')
         ) as ready_moment,
         (o.delivery_date::timestamp at time zone 'Europe/Zurich') as delivery_moment
    from public.orders o
   where o.status = 'confirmed'
     and o.ready_at is null
     and o.delivery_date <= (now() at time zone 'Europe/Zurich')::date
     and public.order_is_prepared(o.id)
),
marked as (
  update public.orders o
     set ready_at   = c.ready_moment,
         shipped_at = greatest(c.ready_moment, c.delivery_moment)
    from candidates c
   where o.id = c.id
  returning o.id, o.ready_at, o.shipped_at
)
insert into public.order_audit_log (order_id, actor_id, action, detail)
select m.id, null, 'order_backfilled_shipped',
       jsonb_build_object('ready_at', m.ready_at, 'shipped_at', m.shipped_at, 'reason', 'initial backfill when Ready/Shipped were introduced')
  from marked m;
