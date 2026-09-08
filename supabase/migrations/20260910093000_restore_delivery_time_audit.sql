-- ============================================================
-- Restore delivery_time to the order audit trigger.
--
-- 20260910090000 widened log_order_change() so an INSERT records HOW an order
-- arrived. It did so by rewriting the whole function from the body in
-- 20260902120000_orders_module.sql — which is one revision out of date. The
-- current body comes from 20260902160000_order_delivery_time.sql, which had
-- added delivery_time to both the change test and the recorded detail.
--
-- So the widening silently reverted that: moving a delivery from 14:00 to
-- 09:00 stopped being audited at all, and stayed unaudited on any order where
-- nothing else changed with it.
--
-- This file is the union of the two: delivery_time back in the UPDATE branch,
-- import_source kept in the INSERT branch. Nothing else about the function
-- changes, and no audit row already written is touched. The gap covers only
-- the window between the two migrations.
--
-- `create or replace function` rebinds the existing trigger, so the trigger
-- itself is not recreated and nothing is dropped.
-- ============================================================

create or replace function public.log_order_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    -- Only record meaningful definition changes, not every touch.
    if new.customer_id      is distinct from old.customer_id
       or new.delivery_date is distinct from old.delivery_date
       or new.delivery_time is distinct from old.delivery_time
       or new.preparation_date is distinct from old.preparation_date
       or new.delivery_method_id is distinct from old.delivery_method_id
       or new.status        is distinct from old.status
       or new.order_type    is distinct from old.order_type
       or new.note          is distinct from old.note then
      insert into public.order_audit_log (order_id, actor_id, action, detail)
      values (new.id, (select auth.uid()), 'order_updated', jsonb_build_object(
        'before', jsonb_build_object(
          'customer_id', old.customer_id, 'delivery_date', old.delivery_date,
          'delivery_time', old.delivery_time,
          'preparation_date', old.preparation_date, 'delivery_method_id', old.delivery_method_id,
          'status', old.status, 'order_type', old.order_type, 'note', old.note),
        'after', jsonb_build_object(
          'customer_id', new.customer_id, 'delivery_date', new.delivery_date,
          'delivery_time', new.delivery_time,
          'preparation_date', new.preparation_date, 'delivery_method_id', new.delivery_method_id,
          'status', new.status, 'order_type', new.order_type, 'note', new.note)
      ));
    end if;
  elsif tg_op = 'INSERT' then
    insert into public.order_audit_log (order_id, actor_id, action, detail)
    values (
      new.id, (select auth.uid()), 'order_created',
      -- NULL detail for a hand-entered order, exactly as it has always been.
      case when new.import_source is null then null
           else jsonb_build_object('import_source', new.import_source)
      end
    );
  end if;
  return new;
end;
$$;
