-- Marketing may cancel an event too (20261210090000): the same function, allowed for Marketing.
create or replace function public.event_cancel(p_event_id uuid, p_reason text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_e public.events%rowtype;
  v_o public.orders%rowtype;
begin
  if not (public.is_sales() or public.is_marketing()) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'events_cancel_reason' using errcode = '22023';
  end if;
  select * into v_e from public.events where id = p_event_id for update;
  if not found then
    raise exception 'event_not_found' using errcode = 'P0002';
  end if;
  if v_e.stage not in ('idea', 'confirmed') then
    raise exception 'event_closed' using errcode = '22023';
  end if;

  update public.events set stage = 'cancelled', cancel_reason = btrim(p_reason) where id = p_event_id;
  delete from public.sales_activities where event_id = p_event_id and status = 'planned';

  if v_e.order_id is null then
    return 'none';
  end if;
  select * into v_o from public.orders where id = v_e.order_id for update;
  if v_o.status <> 'confirmed' then
    return 'none';
  end if;
  if v_o.shipped_at is not null then
    return 'kept';
  end if;
  update public.orders
     set status = 'cancelled', ready_at = null, ready_by = null, updated_by = (select auth.uid())
   where id = v_o.id;
  return 'cancelled';
end;
$$;
