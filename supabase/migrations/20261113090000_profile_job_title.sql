-- ============================================================
-- A job title on an account: what the person is, beside what they may do.
--
-- The role decides access; the title only names the job — "Encargado de
-- turno de producción" is a User in access, and says so in the user list.
-- Set by whoever manages users (the profiles update policy is Admin's).
-- Marco Camuendo is the first: he covers Jefferson on holidays, with the
-- same access, as a User.
-- ============================================================

alter table public.profiles add column job_title text;

comment on column public.profiles.job_title is
  'What the person''s job is called; shown with their name. Access comes from the role, never from this.';

update public.profiles set job_title = 'Encargado de turno de producción' where email = 'mariana@masamor.ch';

update public.hr_workers w
   set position = 'Encargado de turno de producción'
  from public.profiles p
 where p.id = w.profile_id and p.email = 'mariana@masamor.ch' and w.position is null;
