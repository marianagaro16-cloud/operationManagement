-- ============================================================
-- The company's owners: Daniela, Aaron and Eddy.
--
-- A separate step from the role itself, applied once the app that knows the
-- role was live — before that, an Owner would have lost the admin screens.
-- ============================================================

update public.profiles
   set role = 'owner'
 where email in ('daniela@colectivoanonimo.ch', 'aaron@colectivoanonimo.ch', 'eddy@colectivoanonimo.ch');
