-- ============================================================
-- "Volver a contar": the reviewer sends products back to the counter.
--
-- Decided 2026-11-17. Whoever reviews the differences (the counter can't see
-- them, 20270211090000) picks products and asks for them to be counted again.
-- Unlike un-ticking "done", this works at any time, also while the count is
-- still open before 18:00, and always counts as a recount:
--   * the product goes back to "not done" and opens for the assignees
--     (inventory_can_edit_item), whatever the day;
--   * the counter's lines stay — they correct them, then mark it done;
--   * the assignees get the one notice per inventory (inventory-notify.ts),
--     which names neither the reviewer nor the reason.
-- ============================================================

create or replace function public.inventory_request_recount(p_item_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := (select auth.uid());
  v_count integer := 0;
  r       record;
begin
  if v_uid is null or not public.is_approved()
     or not public.has_permission('inventory.manage_instances') then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  for r in
    select ii.id, ii.instance_id, ii.counted_at
      from public.inventory_instance_items ii
     where ii.id = any (p_item_ids)
     for update of ii
  loop
    -- Only someone who sees the digital side may ask: the counter can't send
    -- themselves products they don't know to be wrong.
    if public.inventory_digital_hidden(r.instance_id) then
      raise exception 'not_authorized' using errcode = '42501';
    end if;

    update public.inventory_instance_items
       set counted_at = null, counted_by = null,
           recount_requested_at = now(), recount_requested_by = v_uid,
           recount_notified_at = null
     where id = r.id;

    insert into public.inventory_audit_log (instance_id, instance_item_id, actor_id, action, previous_value, new_value)
    values (r.instance_id, r.id, v_uid, 'item_reopened',
            jsonb_build_object('counted_at', r.counted_at),
            jsonb_build_object('counted_at', null, 'recount', true));
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke all on function public.inventory_request_recount(uuid[]) from public;
grant execute on function public.inventory_request_recount(uuid[]) to authenticated;
