-- ============================================================
-- Complete an inventory product on its own.
--
-- A count of 114 products was one long list with a single "Complete
-- inventory" at the end, so the only way to know what was left was to read
-- every line again. Now each product can be marked done by the person who
-- counted it; done products fold away to the bottom, and what remains at the
-- top is what is still to count.
--
-- NOT the existing `status` column. That one belongs to the review cycle —
-- in_progress, completed, to_review, resolved — and is driven by completing
-- the whole inventory and by reconciling differences. "I have finished
-- counting this product" is a different fact, recorded by a different person
-- at a different moment, so it gets its own columns rather than overloading a
-- state machine other screens depend on.
-- ============================================================

alter table public.inventory_instance_items
  add column counted_at timestamptz,
  add column counted_by uuid references public.profiles (id) on delete set null;

-- When and who travel together; a completion is never anonymous. (The
-- author's account being removed later nulls counted_by alone — the SET NULL
-- — so the check only requires a moment to accompany an author, not the
-- reverse.)
alter table public.inventory_instance_items
  add constraint inventory_item_counted_attributed
  check (counted_by is null or counted_at is not null);

comment on column public.inventory_instance_items.counted_at is
  'When the counter marked this product done. Separate from status, which belongs to the review cycle.';

/*
 * Mark a product done, or reopen it.
 *
 * Whoever may count may do this: inventory_can_edit() is the same rule the
 * entries themselves use — assigned, still open, before the 18:00 deadline,
 * or holding a grant, or managing inventories.
 *
 * Done requires something to have been recorded — a quantity, including an
 * explicit zero. Marking an untouched line done would say "counted" about a
 * shelf nobody looked at, which is exactly the ambiguity the "empty" button
 * exists to remove.
 */
create or replace function public.inventory_item_set_done(p_item_id uuid, p_done boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid      uuid := (select auth.uid());
  v_instance uuid;
  v_before   timestamptz;
begin
  select ii.instance_id, ii.counted_at into v_instance, v_before
    from public.inventory_instance_items ii
   where ii.id = p_item_id
   for update;

  if not found then
    raise exception 'inventory_item_not_found';
  end if;
  if not public.inventory_can_edit(v_instance) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  if p_done then
    if not exists (
      select 1 from public.inventory_entries e
       where e.instance_item_id = p_item_id and e.quantity is not null
    ) then
      raise exception 'nothing_counted';
    end if;

    update public.inventory_instance_items
       set counted_at = now(), counted_by = v_uid
     where id = p_item_id;
  else
    update public.inventory_instance_items
       set counted_at = null, counted_by = null
     where id = p_item_id;
  end if;

  -- Only a change is history; pressing done on something already done is not.
  if (v_before is null) = p_done then
    insert into public.inventory_audit_log (instance_id, instance_item_id, actor_id, action, previous_value, new_value)
    values (
      v_instance, p_item_id, v_uid,
      case when p_done then 'item_counted' else 'item_reopened' end,
      jsonb_build_object('counted_at', v_before),
      jsonb_build_object('counted_at', case when p_done then now() end)
    );
  end if;
end;
$$;

revoke all on function public.inventory_item_set_done(uuid, boolean) from public;
grant execute on function public.inventory_item_set_done(uuid, boolean) to authenticated;
