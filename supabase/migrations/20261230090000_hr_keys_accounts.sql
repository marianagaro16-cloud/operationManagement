-- ============================================================
-- Keys: an app account as the holder (2026-10-07).
--
-- The owners have no worker file — and one's own file is hidden — so they
-- could only be written in by name like an external person. A key can now be
-- held by an account: the holder is a worker file, an account or a name,
-- exactly one of the three. Read like the keys of people without a file.
-- ============================================================

alter table public.hr_keys
  add column profile_id uuid references public.profiles (id) on delete cascade;

alter table public.hr_keys drop constraint hr_keys_holder;
alter table public.hr_keys add constraint hr_keys_holder
  check (num_nonnulls(worker_id, profile_id, nullif(btrim(coalesce(holder_name, '')), '')) = 1);

create index hr_keys_profile_idx on public.hr_keys (profile_id) where profile_id is not null;
