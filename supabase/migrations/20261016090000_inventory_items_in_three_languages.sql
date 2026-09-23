-- ============================================================
-- The counting sheet speaks the counter's language.
--
-- Template items have carried German and English names since the item editor
-- was built, and nothing ever showed them: an inventory copies the item's
-- NAME when it is created, and the sheet reads that copy. A Swiss counter
-- therefore read "Bolsa al vacío negra - chica" in an app set to German.
--
-- The copy is the right design — a finished count must keep saying what it
-- counted — so the translations are copied alongside it rather than read live
-- from the template.
-- ============================================================

alter table public.inventory_instance_items
  add column item_translations jsonb not null default '{}'::jsonb;

comment on column public.inventory_instance_items.item_translations is
  'Copy of the template item''s translations, frozen with item_name so a finished sheet keeps the words it was counted with.';


-- ---------- new inventories carry them ----------
create or replace function public.inventory_materialise_items()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.inventory_instance_items (
    instance_id, template_item_id, item_name, item_translations, item_group, item_sort_order, product_id
  )
  select new.id, ti.id, ti.name, ti.translations, ti.item_group, ti.sort_order, ti.product_id
    from public.inventory_template_items ti
   where ti.template_id = new.template_id
     and ti.is_active
   order by ti.sort_order, ti.name;

  -- Carry the template's usual counters onto the instance so a scheduled
  -- inventory does not arrive with nobody able to touch it.
  insert into public.inventory_assignments (instance_id, user_id)
  select new.id, ta.user_id
    from public.inventory_template_assignees ta
   where ta.template_id = new.template_id
  on conflict do nothing;

  insert into public.inventory_audit_log (instance_id, template_id, actor_id, action, new_value)
  values (
    new.id, new.template_id, (select auth.uid()), 'inventory_created',
    jsonb_build_object(
      'inventory_date', new.inventory_date,
      'iso_week', new.iso_week,
      'period_key', new.period_key
    )
  );

  return new;
end;
$$;


-- ---------- and a later edit follows, on the same terms as the name ----------
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
    instance_id, template_item_id, item_name, item_translations, item_group, item_sort_order, product_id
  )
  select i.id, ti.id, ti.name, ti.translations, ti.item_group, ti.sort_order, ti.product_id
    from public.inventory_instances i
    join public.inventory_template_items ti
      on ti.template_id = i.template_id and ti.is_active
   where i.template_id = p_template_id
     and i.completed_at is null
  on conflict (instance_id, template_item_id) do nothing;

  -- Renamed, retranslated or moved. The words are left alone once the row has
  -- been counted, so a sheet somebody has worked on keeps saying what they
  -- counted — in every language.
  update public.inventory_instance_items ii
     set item_group        = ti.item_group,
         item_sort_order   = ti.sort_order,
         item_name         = case when ii.counted_at is null then ti.name else ii.item_name end,
         item_translations = case when ii.counted_at is null then ti.translations else ii.item_translations end
    from public.inventory_instances i, public.inventory_template_items ti
   where ii.instance_id = i.id
     and i.template_id = p_template_id
     and i.completed_at is null
     and ti.id = ii.template_item_id
     and (ii.item_group is distinct from ti.item_group
          or ii.item_sort_order <> ti.sort_order
          or (ii.counted_at is null
              and (ii.item_name <> ti.name or ii.item_translations is distinct from ti.translations)));
end;
$$;


-- ---------- the brand sync stops keeping its own copy of this ----------
/*
 * inventory_sync_brand() rebuilt the template items and then repeated the
 * instance half itself. That copy predates inventory_sync_template(), and two
 * versions of one rule is how the sheet came to carry a name but no
 * translations. It now rebuilds the template and delegates.
 *
 * The delegation is belt and braces: writing those template items already
 * fires the statement triggers that call the same function.
 */
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

    -- Inventories not yet completed follow, by the one rule there is.
    perform public.inventory_sync_template(v_template_id);
  end loop;
end;
$$;


-- ---------- catch up the sheets already on the calendar ----------
update public.inventory_instance_items ii
   set item_translations = ti.translations
  from public.inventory_instances i, public.inventory_template_items ti
 where ii.instance_id = i.id
   and i.completed_at is null
   and ti.id = ii.template_item_id
   and ii.counted_at is null
   and ii.item_translations is distinct from ti.translations;
