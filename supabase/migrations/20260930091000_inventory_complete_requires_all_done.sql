-- ============================================================
-- An inventory cannot be completed until every product is done.
--
-- Products are now marked done one at a time (20260930090000). Completing
-- the whole count while some are still open would close a count with lines
-- nobody finished — the gap the per-product Done exists to make visible. So
-- inventory_complete() refuses while any product lacks counted_at, and says
-- how many are left.
--
-- Enforced here, in the one function that completes an inventory, so it holds
-- for every role and every path, not only for the button that hides itself.
-- Everything else in the function is unchanged.
-- ============================================================

create or replace function public.inventory_complete(p_instance_id uuid)
returns public.inventory_instances
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.inventory_instances;
  v_open integer;
begin
  if not public.inventory_can_edit(p_instance_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  select count(*) into v_open
    from public.inventory_instance_items
   where instance_id = p_instance_id
     and counted_at is null;

  if v_open > 0 then
    -- The count travels in the message so the screen can say "3 products
    -- are not done yet" rather than a bare refusal.
    raise exception 'items_not_done:%', v_open using errcode = 'P0001';
  end if;

  update public.inventory_instances
     set completed_at = now(),
         completed_by = (select auth.uid())
   where id = p_instance_id
     and completed_at is null
   returning * into v_row;

  if not found then
    raise exception 'inventory_already_completed' using errcode = '23505';
  end if;

  -- Re-derive every item now that the instance is closed: on a template with
  -- Inventory Digital disabled, completion is what moves items to Completed.
  update public.inventory_instance_items
     set updated_at = now()
   where instance_id = p_instance_id;

  perform public.inventory_sync_instance_status(p_instance_id);

  select * into v_row from public.inventory_instances where id = p_instance_id;
  return v_row;
end;
$$;
