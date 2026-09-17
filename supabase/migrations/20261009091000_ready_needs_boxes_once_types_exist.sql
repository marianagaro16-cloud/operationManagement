-- ============================================================
-- Ready needs boxes — once there are boxes to choose from
--
-- With no active box type nobody can record a box, so requiring one would
-- stop every order from being marked Ready. The rule starts applying as soon
-- as the first active box type exists in Gestión.
-- ============================================================

create or replace function public.order_set_ready(p_order_id uuid, p_ready boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_row public.orders;
begin
  if v_uid is null or not public.is_approved() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  select * into v_row from public.orders where id = p_order_id for update;
  if not found then raise exception 'order_not_found'; end if;

  if p_ready then
    if v_row.status <> 'confirmed' then raise exception 'order_not_confirmed'; end if;
    if v_row.ready_at is not null then return; end if;
    if not public.order_is_prepared(p_order_id) then raise exception 'order_not_prepared'; end if;
    if exists (select 1 from public.box_types where is_active)
       and not exists (select 1 from public.order_boxes where order_id = p_order_id) then
      raise exception 'order_needs_boxes';
    end if;

    update public.orders set ready_at = now(), ready_by = v_uid where id = p_order_id;
    insert into public.order_audit_log (order_id, actor_id, action, detail)
    values (p_order_id, v_uid, 'order_ready', '{}'::jsonb);
  else
    -- A shipped order is reopened from Shipped first; Ready cannot be pulled
    -- out from under something that already left.
    if v_row.shipped_at is not null then raise exception 'order_already_shipped'; end if;
    if v_row.ready_at is null then return; end if;

    update public.orders set ready_at = null, ready_by = null where id = p_order_id;
    insert into public.order_audit_log (order_id, actor_id, action, detail)
    values (p_order_id, v_uid, 'order_ready_reopened', jsonb_build_object('ready_at', v_row.ready_at));
  end if;
end;
$$;
