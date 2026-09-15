-- ============================================================
-- The confirmed-order edit lock guards the order, not its progress.
--
-- guard_confirmed_order_edit() refused ANY update to a confirmed order from
-- someone without orders.correct_completed. That was right while an order
-- had nothing but commercial fields. Marking an order Ready or Shipped is now
-- an update to that row too, made by the person preparing — who does not and
-- should not hold the right to correct the order itself — so the lock stopped
-- the floor from recording that an order was prepared.
--
-- It now fires only when something about the order changes: customer, dates,
-- delivery, type, status, note. The milestone columns (written only through
-- order_set_ready / order_set_shipped) and updated_at pass.
-- ============================================================

create or replace function public.guard_confirmed_order_edit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status = 'confirmed'
     and (select auth.uid()) is not null
     and not public.has_permission('orders.correct_completed')
     and (
          new.customer_id        is distinct from old.customer_id
       or new.order_date         is distinct from old.order_date
       or new.delivery_date      is distinct from old.delivery_date
       or new.delivery_time      is distinct from old.delivery_time
       or new.preparation_date   is distinct from old.preparation_date
       or new.delivery_method_id is distinct from old.delivery_method_id
       or new.status             is distinct from old.status
       or new.order_type         is distinct from old.order_type
       or new.note               is distinct from old.note
       or new.replaces_incident_id is distinct from old.replaces_incident_id
     ) then
    raise exception 'order_correction_denied' using errcode = '42501';
  end if;
  return new;
end;
$$;
