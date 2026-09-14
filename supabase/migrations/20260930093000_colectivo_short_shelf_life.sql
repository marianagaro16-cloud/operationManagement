-- Colectivo Comestibles also warns about stock expiring within three months
-- of the count, as Complementarios does (20260930092000).
update public.inventory_templates set short_shelf_life_months = 3 where slug = 'colectivo-comestibles';
