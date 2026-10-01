-- Duplicate activity definitions, removed (decided 2026-10-01). None was ever
-- planned: no day of any of them exists, so no history goes with them.
--   Limpieza Palomo — semestral copy (the monthly one is the active one)
--   Inventario Masamor y Del Barrio — semestral copy (the weekly one stays)
--   Inventario Colectivo Comestibles, La Güera del Barrio y Tatemados — semestral copy (the biweekly one stays)
delete from public.tasks t
 where t.id in (
   '1b8716a0-5e84-484f-8f57-e03a9557366b',
   '2ea56cec-29a2-4b6e-adba-95f23db6c92a',
   'd13e7255-7069-4f2c-94a2-d56c1ec14210'
 )
   and not t.is_active
   and not exists (select 1 from public.task_occurrences o where o.task_id = t.id);
