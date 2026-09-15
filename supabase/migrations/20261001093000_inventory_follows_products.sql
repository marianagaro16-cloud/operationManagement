-- ============================================================
-- Brand inventories follow the product list by themselves
--
-- The four brand templates are DEFINED as "this brand's active products",
-- but were only brought in line when somebody pressed "refresh from
-- products" — and scheduled inventories kept whatever list they were
-- generated with. The lists drifted: a deactivated product stayed on the
-- count sheet, a product moved to another brand appeared in neither.
--
-- Now any change to a product that affects which list it belongs on (created,
-- activated, deactivated, moved brand, renamed, re-familied, recoded) syncs
-- the affected brands' templates AND their inventories not yet completed.
--
-- What is never touched:
--   * completed inventories — history;
--   * an item somebody already worked on (counted, an entry, a digital value,
--     a resolution) — it stays on the sheet even if its product left, so no
--     count is lost;
--   * hand-added template items (no product) — the sync has no opinion on
--     them, exactly like planTemplateRefresh.
--
-- The ordering and naming mirror src/domain/inventory/refresh.ts: family,
-- then name; name = product name or family, a repeat suffixed with its code.
-- ============================================================

create or replace function public.inventory_sync_brand(p_brand_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_template_id uuid;
begin
  for v_template_id in
    select id from public.inventory_templates where brand_id = p_brand_id
  loop
    create temp table if not exists pg_temp.inventory_wanted (
      product_id uuid primary key,
      name       text not null,
      item_group text,
      sort_order int  not null
    ) on commit drop;
    truncate pg_temp.inventory_wanted;

    insert into pg_temp.inventory_wanted (product_id, name, item_group, sort_order)
    select w.id,
           case when w.repeat > 1
                then w.base || ' · ' || coalesce(w.code, left(w.id::text, 8))
                else w.base end,
           nullif(btrim(w.family), ''),
           (w.position * 10)::int
      from (
        select p.id, p.code, p.family, o.base,
               row_number() over (order by p.family collate "und-x-icu", p.name collate "und-x-icu", p.id) as position,
               row_number() over (partition by o.base
                                  order by p.family collate "und-x-icu", p.name collate "und-x-icu", p.id) as repeat
          from public.products p
         cross join lateral (select coalesce(nullif(btrim(p.name), ''), p.family) as base) o
         where p.brand_id = p_brand_id
           and p.is_active
      ) w;

    -- ---- the template ----

    -- Items whose product is still wanted: back on, right place, right name.
    -- A rename that would collide with another item's name is left for now
    -- rather than failing the product save that triggered it.
    update public.inventory_template_items ti
       set is_active  = true,
           item_group = w.item_group,
           sort_order = w.sort_order,
           name = case
                    when ti.name = w.name then ti.name
                    when exists (select 1 from public.inventory_template_items x
                                  where x.template_id = v_template_id
                                    and x.name = w.name and x.id <> ti.id) then ti.name
                    else w.name
                  end
      from pg_temp.inventory_wanted w
     where ti.template_id = v_template_id
       and ti.product_id = w.product_id
       and (not ti.is_active
            or ti.item_group is distinct from w.item_group
            or ti.sort_order <> w.sort_order
            or ti.name <> w.name);

    -- Products with no item yet.
    insert into public.inventory_template_items (template_id, name, item_group, product_id, sort_order)
    select v_template_id, w.name, w.item_group, w.product_id, w.sort_order
      from pg_temp.inventory_wanted w
     where not exists (select 1 from public.inventory_template_items ti
                        where ti.template_id = v_template_id and ti.product_id = w.product_id)
    on conflict (template_id, name) do nothing;

    -- Products that left the list: switched off, never deleted.
    update public.inventory_template_items ti
       set is_active = false
     where ti.template_id = v_template_id
       and ti.is_active
       and ti.product_id is not null
       and not exists (select 1 from pg_temp.inventory_wanted w where w.product_id = ti.product_id);

    -- ---- inventories not yet completed ----

    -- Drop what is no longer on the template, unless somebody worked on it.
    delete from public.inventory_instance_items ii
     using public.inventory_instances i, public.inventory_template_items ti
     where ii.instance_id = i.id
       and i.template_id = v_template_id
       and i.completed_at is null
       and ti.id = ii.template_item_id
       and not ti.is_active
       and ii.counted_at is null
       and ii.digital_quantity is null
       and not ii.is_resolved
       and not exists (select 1 from public.inventory_entries e where e.instance_item_id = ii.id)
       and not exists (select 1 from public.inventory_resolutions r where r.instance_item_id = ii.id)
       and not exists (select 1 from public.inventory_digital_history h where h.instance_item_id = ii.id);

    -- Add what joined.
    insert into public.inventory_instance_items (
      instance_id, template_item_id, item_name, item_group, item_sort_order, product_id
    )
    select i.id, ti.id, ti.name, ti.item_group, ti.sort_order, ti.product_id
      from public.inventory_instances i
      join public.inventory_template_items ti
        on ti.template_id = i.template_id and ti.is_active
     where i.template_id = v_template_id
       and i.completed_at is null
    on conflict (instance_id, template_item_id) do nothing;

    -- Keep the sheet in shelf order; rename only what nobody has counted yet.
    update public.inventory_instance_items ii
       set item_group      = ti.item_group,
           item_sort_order = ti.sort_order,
           item_name       = case when ii.counted_at is null then ti.name else ii.item_name end
      from public.inventory_instances i, public.inventory_template_items ti
     where ii.instance_id = i.id
       and i.template_id = v_template_id
       and i.completed_at is null
       and ti.id = ii.template_item_id
       and ti.product_id is not null
       and (ii.item_group is distinct from ti.item_group
            or ii.item_sort_order <> ti.sort_order
            or (ii.counted_at is null and ii.item_name <> ti.name));
  end loop;
end;
$$;

revoke all on function public.inventory_sync_brand(uuid) from public, anon, authenticated;

comment on function public.inventory_sync_brand(uuid) is
  'Brings the brand''s inventory templates and their not-yet-completed inventories in line with the brand''s active products. Called by the products triggers; never removes an item somebody already counted.';

-- ---- triggers: statement-level, so a bulk product import syncs each brand once ----

create or replace function public.products_sync_inventories_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_brand uuid;
begin
  for v_brand in
    select distinct brand_id from new_rows where brand_id is not null and is_active
  loop
    perform public.inventory_sync_brand(v_brand);
  end loop;
  return null;
end;
$$;

create or replace function public.products_sync_inventories_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_brand uuid;
begin
  for v_brand in
    select distinct b
      from old_rows o
      join new_rows n on n.id = o.id
     cross join lateral (values (o.brand_id), (n.brand_id)) as v(b)
     where b is not null
       and (o.brand_id is distinct from n.brand_id
            or o.is_active is distinct from n.is_active
            or o.name      is distinct from n.name
            or o.family    is distinct from n.family
            or o.code      is distinct from n.code)
  loop
    perform public.inventory_sync_brand(v_brand);
  end loop;
  return null;
end;
$$;

drop trigger if exists products_sync_inventories_insert on public.products;
create trigger products_sync_inventories_insert
  after insert on public.products
  referencing new table as new_rows
  for each statement execute function public.products_sync_inventories_insert();

drop trigger if exists products_sync_inventories_update on public.products;
create trigger products_sync_inventories_update
  after update on public.products
  referencing old table as old_rows new table as new_rows
  for each statement execute function public.products_sync_inventories_update();

-- One pass now, so every brand starts in line rather than at its next product edit.
select public.inventory_sync_brand(b.id)
  from public.brands b
 where exists (select 1 from public.inventory_templates t where t.brand_id = b.id);
