-- ============================================================
-- Every inventory follows its template, not only the brand ones.
--
-- 20261001093000 made the four BRAND inventories follow the product list:
-- inventory_sync_brand() rebuilds their template items and then carries the
-- change into every inventory not yet completed. Empaques and Materia Prima
-- are not brand inventories — their items are written by hand — so nothing
-- carried a change into the inventories already on the calendar. Adding a
-- packaging item on Tuesday left Thursday's count with the old sheet, and the
-- only way to notice was to count and find it missing.
--
-- The instance half of that sync is not about brands at all, so it becomes a
-- function of its own, fired whenever a template's items change:
--
--   removed from the template   -> dropped from inventories not yet counted,
--                                  and ONLY where nobody has touched the row
--   added to the template       -> added to them
--   renamed or reordered        -> followed, and the name only while the row
--                                  is still uncounted
--
-- A completed inventory is never touched: what it counted is what it counted.
-- ============================================================

create or replace function public.inventory_sync_template(p_template_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Gone from the template. Untouched rows only: a count, a digital figure,
  -- a resolution or any history makes the row somebody's work, and work is
  -- never deleted by a definition change.
  delete from public.inventory_instance_items ii
   using public.inventory_instances i, public.inventory_template_items ti
   where ii.instance_id = i.id
     and i.template_id = p_template_id
     and i.completed_at is null
     and ti.id = ii.template_item_id
     and not ti.is_active
     and ii.counted_at is null
     and ii.digital_quantity is null
     and not ii.is_resolved
     and not exists (select 1 from public.inventory_entries e where e.instance_item_id = ii.id)
     and not exists (select 1 from public.inventory_resolutions r where r.instance_item_id = ii.id)
     and not exists (select 1 from public.inventory_digital_history h where h.instance_item_id = ii.id);

  -- Joined the template.
  insert into public.inventory_instance_items (
    instance_id, template_item_id, item_name, item_group, item_sort_order, product_id
  )
  select i.id, ti.id, ti.name, ti.item_group, ti.sort_order, ti.product_id
    from public.inventory_instances i
    join public.inventory_template_items ti
      on ti.template_id = i.template_id and ti.is_active
   where i.template_id = p_template_id
     and i.completed_at is null
  on conflict (instance_id, template_item_id) do nothing;

  -- Renamed or moved. The name is left alone once the row has been counted,
  -- so a sheet somebody has worked on keeps saying what they counted.
  update public.inventory_instance_items ii
     set item_group      = ti.item_group,
         item_sort_order = ti.sort_order,
         item_name       = case when ii.counted_at is null then ti.name else ii.item_name end
    from public.inventory_instances i, public.inventory_template_items ti
   where ii.instance_id = i.id
     and i.template_id = p_template_id
     and i.completed_at is null
     and ti.id = ii.template_item_id
     and (ii.item_group is distinct from ti.item_group
          or ii.item_sort_order <> ti.sort_order
          or (ii.counted_at is null and ii.item_name <> ti.name));
end;
$$;

comment on function public.inventory_sync_template(uuid) is
  'Carries a template''s item list into its inventories that are not yet completed. Fired by the triggers below, and reused by inventory_sync_brand().';

revoke all on function public.inventory_sync_template(uuid) from public;

/*
 * Statement-level, with transition tables: one pass per edit rather than one
 * per row. A brand refresh writes eighty template items in a statement, and
 * eighty identical syncs would be eighty scans of the same inventories.
 *
 * Postgres names a transition table per trigger, and PL/pgSQL cannot address
 * one by variable, so each operation gets its own tiny function around the
 * same call.
 */
create or replace function public.inventory_template_items_synced_new()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_template_id uuid;
begin
  for v_template_id in select distinct template_id from changed loop
    perform public.inventory_sync_template(v_template_id);
  end loop;
  return null;
end;
$$;

create or replace function public.inventory_template_items_synced_old()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_template_id uuid;
begin
  for v_template_id in select distinct template_id from changed loop
    perform public.inventory_sync_template(v_template_id);
  end loop;
  return null;
end;
$$;

create trigger inventory_template_items_sync_insert
  after insert on public.inventory_template_items
  referencing new table as changed
  for each statement execute function public.inventory_template_items_synced_new();

create trigger inventory_template_items_sync_update
  after update on public.inventory_template_items
  referencing new table as changed
  for each statement execute function public.inventory_template_items_synced_new();

create trigger inventory_template_items_sync_delete
  after delete on public.inventory_template_items
  referencing old table as changed
  for each statement execute function public.inventory_template_items_synced_old();


-- ---------- catch up what drifted before this existed ----------
-- Empaques and Materia Prima have inventories on the calendar carrying an
-- older sheet. This is the same function the triggers now call, so running it
-- once leaves nothing special about today.
do $$
declare
  v_id uuid;
begin
  for v_id in select id from public.inventory_templates loop
    perform public.inventory_sync_template(v_id);
  end loop;
end;
$$;
