-- ============================================================
-- Carlos Viscaya is Ventas: his account and his HR file.
--
-- Only the team changes. He stays a Power User with every permission he had:
-- the team scopes plain Users and the Production manager, not him. He covers
-- for the operations manager on holidays, so that access is deliberate.
-- Applied once the app that knows the Ventas team was live.
-- ============================================================

update public.profiles set team = 'sales' where email = 'carlos@colectivoanonimo.ch';

update public.hr_workers w
   set team = 'sales'
  from public.profiles p
 where p.id = w.profile_id and p.email = 'carlos@colectivoanonimo.ch';
