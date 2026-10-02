-- Saving an event's products failed with "DELETE requires a WHERE clause":
-- the function emptied its working list without a condition. Same function,
-- with one (2026-10-02).

create or replace function public.event_set_products(p_event_id uuid, p_lines jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_e public.events%rowtype;
  v_o public.orders%rowtype;
begin
  if not public.is_sales() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  select * into v_e from public.events where id = p_event_id for update;
  if not found then
    raise exception 'event_not_found' using errcode = 'P0002';
  end if;
  if v_e.stage not in ('idea', 'confirmed') then
    raise exception 'event_closed' using errcode = '22023';
  end if;
  if jsonb_typeof(p_lines) <> 'array'
     or exists (select 1 from jsonb_array_elements(p_lines) x where coalesce((x ->> 'quantity')::numeric, 0) <= 0) then
    raise exception 'invalid_quantity' using errcode = '22023';
  end if;
  if (select count(*) from jsonb_array_elements(p_lines))
     <> (select count(distinct x ->> 'product_id') from jsonb_array_elements(p_lines) x) then
    raise exception 'duplicate_product' using errcode = '22023';
  end if;

  create temp table if not exists pg_temp.event_lines (product_id uuid, quantity numeric, note text, position int) on commit drop;
  -- Emptied with a condition: the API refuses an unconditional DELETE (safeupdate).
  delete from pg_temp.event_lines where true;
  insert into pg_temp.event_lines
  select (x ->> 'product_id')::uuid, (x ->> 'quantity')::numeric, nullif(btrim(x ->> 'note'), ''), (n - 1)::int
    from jsonb_array_elements(p_lines) with ordinality t(x, n);

  if v_e.order_id is not null then
    select * into v_o from public.orders where id = v_e.order_id for update;
  end if;

  -- An idea, or a confirmed event without a live order: the event's own list.
  if v_e.stage = 'idea' or v_e.order_id is null or v_o.status <> 'confirmed' then
    delete from public.event_products where event_id = p_event_id;
    insert into public.event_products (event_id, product_id, quantity, note, position)
    select p_event_id, product_id, quantity, note, position from pg_temp.event_lines;
    if v_e.stage = 'confirmed' then
      perform public.event_make_order(p_event_id);
    end if;
    return;
  end if;

  if v_o.ready_at is not null then
    raise exception 'event_order_ready' using errcode = '22023';
  end if;

  if not exists (select 1 from pg_temp.event_lines) then
    update public.orders set status = 'cancelled', updated_by = (select auth.uid()) where id = v_o.id;
    update public.events set order_id = null where id = p_event_id;
    return;
  end if;

  delete from public.order_lines l
   where l.order_id = v_o.id and l.product_id not in (select product_id from pg_temp.event_lines);
  update public.order_lines l
     set ordered_quantity = n.quantity, note = n.note, position = n.position
    from pg_temp.event_lines n
   where l.order_id = v_o.id and l.product_id = n.product_id;
  insert into public.order_lines (order_id, product_id, ordered_quantity, note, position)
  select v_o.id, n.product_id, n.quantity, n.note, n.position
    from pg_temp.event_lines n
   where not exists (select 1 from public.order_lines l where l.order_id = v_o.id and l.product_id = n.product_id);
  update public.orders set updated_by = (select auth.uid()) where id = v_o.id;
end;
$$;
