-- ============================================================
-- One inventory per brand, built from the product list
--
-- The inventories grew out of a workbook and stopped matching how the
-- operation is actually organised:
--
--   * "Masamor / Del Barrio" counted two brands in one list, mixed with
--     groups that are neither ("Fritura", "TooGooToGo").
--   * "Colectivo Comestibles" held 145 items of which 23 were actually
--     Complementarios and 7 were Del Barrio.
--   * "Empaques" existed twice, monthly and semi-annual, over the SAME 26
--     items — one list, counted on two schedules.
--   * Only 59 of 259 items were linked to a product at all; the rest were
--     free text that no order, report or lot could ever join to.
--
-- After this there is exactly one inventory per brand, and its items ARE the
-- brand's active products — so a product and the thing counted on the shelf
-- are the same record, not two spellings of one.
--
-- Materia Prima is deliberately untouched. It counts raw material, which is
-- not a product we sell, and it is the one list that was already right.
-- ============================================================


-- ============================================================
-- 1. Empaques: one list, one schedule
-- ============================================================
/*
 * The two templates held identical items — verified before writing this, 26
 * against 26 with nothing on either side alone. So this is purely a choice of
 * cadence, and monthly wins: skipping a month is easy, while discovering a
 * six-month-old counting error is not.
 *
 * The semi-annual one is DEACTIVATED, not dropped. It has no recorded count,
 * so deleting it would lose nothing today — but a deactivated template is a
 * decision somebody can reverse, and a deleted one is a decision they cannot.
 */
update public.inventory_templates
   set name = 'Empaques', slug = 'empaques'
 where slug = 'empaques-mensual';

update public.inventory_templates
   set is_active = false
 where slug = 'empaques-semestral';


-- ============================================================
-- 2. The combined brand template is retired, never deleted
-- ============================================================
/*
 * "Masamor / Del Barrio" carries real history: two counting sessions and 19
 * recorded entries. inventory_instance_items references its template items
 * with ON DELETE RESTRICT precisely so that history cannot be erased by
 * tidying up the list it was counted from — the database is right and this
 * migration does not fight it.
 *
 * It is therefore deactivated. It stops generating new counts and leaves the
 * screens, while every entry ever recorded against it stays readable.
 */
update public.inventory_templates
   set is_active = false
 where slug = 'masamor-del-barrio';


-- ============================================================
-- 3. One template per brand
-- ============================================================
/*
 * Colectivo Comestibles already exists and keeps its id, so nothing that
 * references it has to change; the other three are created. All four are
 * upserted on slug, which makes this section safe to re-run.
 *
 * Weekly counts fall on FRIDAY, which is both what the operation does and
 * what the code already documented as DEFAULT_WEEKLY_INVENTORY_WEEKDAY — the
 * stored Monday was the outlier.
 *
 * kind = 'expiry' for all four: a finished good is counted as a quantity with
 * an expiry date. Lot numbers belong to raw material and locations to
 * packaging, which is why those two templates keep their own kinds.
 */
insert into public.inventory_templates (slug, name, kind, frequency, schedule_config, digital_enabled, is_active)
values
  ('masamor', 'Masamor', 'expiry', 'weekly',
   '{"kind": "weekly", "weekday": 5}'::jsonb, true, true),

  ('del-barrio', 'Del Barrio', 'expiry', 'weekly',
   '{"kind": "weekly", "weekday": 5}'::jsonb, true, true),

  ('colectivo-comestibles', 'Colectivo Comestibles', 'expiry', 'monthly',
   '{"kind": "monthly", "rules": [{"type": "nthWeekday", "nth": 2, "weekday": 4},
                                  {"type": "nthWeekday", "nth": -1, "weekday": 4}]}'::jsonb, true, true),

  ('complementarios', 'Complementarios', 'expiry', 'monthly',
   '{"kind": "monthly", "rules": [{"type": "nthWeekday", "nth": 2, "weekday": 4},
                                  {"type": "nthWeekday", "nth": -1, "weekday": 4}]}'::jsonb, true, true)
on conflict (slug) do update
   set name            = excluded.name,
       kind            = excluded.kind,
       frequency       = excluded.frequency,
       schedule_config = excluded.schedule_config,
       digital_enabled = excluded.digital_enabled,
       is_active       = true;


-- ============================================================
-- 4. The items ARE the brand's active products
-- ============================================================
/*
 * Cleared first, so the hand-written lists do not survive alongside the
 * generated ones and leave a product counted twice under two spellings.
 *
 * The delete deliberately SKIPS any item a count already references. Today
 * none of these four has recorded history, so nothing is skipped — but if one
 * ever does, this refuses to erase it rather than failing on the foreign key,
 * and the upsert below simply relinks it.
 */
delete from public.inventory_template_items i
 where i.template_id in (
         select id from public.inventory_templates
          where slug in ('masamor', 'del-barrio', 'colectivo-comestibles', 'complementarios')
       )
   and not exists (
         select 1 from public.inventory_instance_items ii
          where ii.template_item_id = i.id
       );

/*
 * Inactive products are excluded. A discontinued product is not on the shelf,
 * and asking somebody to count it every Friday is how a list stops being read.
 *
 * item_group comes from the product FAMILY — Tequila, Mezcal, Queso, Papitas —
 * which is the only grouping the catalogue actually carries (category is null
 * on every product). It is what makes a 94-item list walkable.
 *
 * A name is unique per template, and the catalogue contains one genuine
 * duplicate: two Masamor products share a name and a family and differ only
 * by code. The second occurrence is suffixed with its code rather than
 * dropped — two rows on the shelf are two rows to count, and silently
 * counting one of them would be a quiet loss.
 */
with ranked as (
  select
    p.id,
    p.brand_id,
    p.code,
    coalesce(nullif(btrim(p.name), ''), p.family) as item_name,
    nullif(btrim(p.family), '')                   as family,
    row_number() over (
      partition by p.brand_id, coalesce(nullif(btrim(p.name), ''), p.family)
      order by p.code nulls last, p.id
    ) as same_name,
    row_number() over (
      partition by p.brand_id
      order by nullif(btrim(p.family), '') nulls last,
               coalesce(nullif(btrim(p.name), ''), p.family)
    ) * 10 as position
  from public.products p
  where p.is_active
    and p.brand_id is not null
),
target as (
  select b.id as brand_id, t.id as template_id
    from public.brands b
    join public.inventory_templates t
      on t.slug = case b.name
                    when 'Masamor'               then 'masamor'
                    when 'Del Barrio'            then 'del-barrio'
                    when 'Colectivo Comestibles' then 'colectivo-comestibles'
                    when 'Complementarios'       then 'complementarios'
                  end
)
insert into public.inventory_template_items
  (template_id, name, item_group, product_id, sort_order, is_active)
select
  t.template_id,
  case when r.same_name = 1 then r.item_name
       else r.item_name || ' · ' || coalesce(r.code, left(r.id::text, 8)) end,
  r.family,
  r.id,
  r.position,
  true
from ranked r
join target t on t.brand_id = r.brand_id
on conflict (template_id, name) do update
   set item_group = excluded.item_group,
       product_id = excluded.product_id,
       sort_order = excluded.sort_order,
       is_active  = true;


-- ============================================================
-- What is deliberately NOT here
-- ============================================================
/*
 * No automatic synchronisation. These items are a SNAPSHOT of the product
 * list at the moment this ran; a product added next week does not appear on
 * its brand's count by itself, and a product deactivated next week does not
 * leave it.
 *
 * That is a real limitation and it is stated rather than hidden. Making the
 * list live would mean a count whose contents change underneath it between
 * being opened and being completed, which is worse than a list somebody
 * refreshes deliberately. Section 4 is written to be re-runnable for exactly
 * that purpose.
 *
 * No assignees are carried over: there were none on any template.
 */
