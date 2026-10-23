-- ============================================================
-- Production plans: lots of the raw materials used (2026-10-23).
--
-- Not only the corn: lime, salt and flour too, picked from the lots the
-- Materia Prima inventory recorded. Each line names which Materia Prima items
-- its plans carry (Bio: white and yellow corn, lime, salt; Blue: blue corn,
-- lime, salt; Tortillas para freír: white and yellow corn, lime, salt, flour).
--
-- material_lots: [{ "item_id": uuid|null, "material": "Cal (25 kg)", "lot": "2250" }]
-- ============================================================

alter table public.production_plans rename column corn_lots to material_lots;
alter table public.production_plans rename constraint production_plans_corn_lots_check to production_plans_material_lots_check;

alter table public.production_lines
  add column material_item_ids uuid[] not null default '{}';

update public.production_lines l
   set material_item_ids = coalesce((
     select array_agg(i.id order by i.sort_order)
       from public.inventory_template_items i
       join public.inventory_templates t on t.id = i.template_id and t.slug = 'materia-prima'
      where i.is_active and (
        i.name in ('Cal (25 kg)', 'Sal (25 kg)')
        or (l.slug in ('bio', 'chip') and i.name in ('Maíz Bio blanco (22.68 kg)', 'Maíz Bio amarillo (22.68 kg)'))
        or (l.slug = 'blue' and i.name = 'Maíz Bio azul (22.68 kg)')
        or (l.slug = 'chip' and i.name like 'Harina de maíz%')
      )
   ), '{}');
