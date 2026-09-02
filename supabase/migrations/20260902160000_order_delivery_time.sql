-- ============================================================
-- Delivery time on orders.
--
-- delivery_date answers "which day"; delivery_time answers "by when on that
-- day". Stored as a wall-clock TIME rather than a timestamptz for the same
-- reason due dates are DATEs: it is a business time in Europe/Zurich, and
-- "deliver by 14:00" must stay 14:00 across a DST change rather than drifting
-- to 13:00 or 15:00.
--
-- Nullable on purpose. Many orders have no committed hour, and inventing one
-- would produce false urgency — the countdown simply does not apply to them.
-- ============================================================

alter table public.orders
  add column delivery_time time;

comment on column public.orders.delivery_time is
  'Wall-clock delivery deadline in Europe/Zurich. NULL = no committed hour.';

-- Orders with a committed hour are the ones the urgency view scans.
create index orders_delivery_time_idx
  on public.orders (delivery_date, delivery_time)
  where delivery_time is not null;

-- Record the new field in the audit log alongside the other definition fields.
create or replace function public.log_order_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
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
    values (new.id, (select auth.uid()), 'order_created', null);
  end if;
  return new;
end;
$$;
