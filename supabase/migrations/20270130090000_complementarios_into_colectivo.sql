-- Complementarios folded into Colectivo Comestibles (2026-10-23).
--
-- Its products change brand; the brand sync already in place then moves them
-- into the Colectivo Comestibles inventory (template and the counts not yet
-- completed) and empties the Complementarios one of untouched rows. That
-- inventory is switched off, not deleted: its completed counts stay as
-- history. The open count it leaves empty is removed. Then the brand goes.
do $$
declare
  v_from uuid;
  v_to   uuid;
  v_tpl  uuid;
begin
  select id into v_from from public.brands where name = 'Complementarios';
  if v_from is null then return; end if;
  select id into v_to from public.brands where name = 'Colectivo Comestibles';
  if v_to is null then raise exception 'Colectivo Comestibles brand not found'; end if;
  select id into v_tpl from public.inventory_templates where brand_id = v_from;

  update public.products set brand_id = v_to where brand_id = v_from;
  -- The guard asks who is editing; nobody is, here. Only the brand changes.
  alter table public.marketing_requests disable trigger marketing_requests_guard;
  update public.marketing_requests set brand_id = v_to where brand_id = v_from;
  alter table public.marketing_requests enable trigger marketing_requests_guard;
  update public.marketing_posts set brand_id = v_to where brand_id = v_from;

  if v_tpl is not null then
    -- Items added by hand, with no product, follow too: placed last in their
    -- group on the Colectivo Comestibles sheet.
    update public.inventory_template_items ti
       set template_id = v_target.id,
           sort_order  = coalesce((select max(x.sort_order) from public.inventory_template_items x
                                    where x.template_id = v_target.id and x.item_group is not distinct from ti.item_group),
                                  (select max(x.sort_order) from public.inventory_template_items x where x.template_id = v_target.id)) + 5
      from (select id from public.inventory_templates where brand_id = v_to) v_target
     where ti.template_id = v_tpl
       and ti.product_id is null
       and ti.is_active
       and not exists (select 1 from public.inventory_template_items y where y.template_id = v_target.id and y.name = ti.name);

    -- Its counts not yet completed, as long as nobody has worked on them.
    delete from public.inventory_instances i
     where i.template_id = v_tpl
       and i.completed_at is null
       and not exists (
         select 1 from public.inventory_instance_items ii
          where ii.instance_id = i.id
            and (ii.counted_at is not null or ii.digital_quantity is not null or ii.is_resolved
                 or exists (select 1 from public.inventory_entries e where e.instance_item_id = ii.id)));
    update public.inventory_templates set is_active = false, brand_id = null where id = v_tpl;
  end if;

  delete from public.brands where id = v_from;
end $$;
