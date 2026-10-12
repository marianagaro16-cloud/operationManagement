-- ============================================================
-- Colour in "Mi espacio" (decided 2026-10-12).
--
-- A note page can carry an emoji and a cover colour, chosen by its owner and
-- seen by whoever it is shared with. Each person also picks one colour for
-- their own workspace; nobody else sees or changes it.
-- ============================================================

alter table public.quick_notes
  add column icon text check (icon is null or char_length(icon) between 1 and 16),
  add column cover text check (cover is null or cover in ('slate', 'red', 'orange', 'amber', 'green', 'teal', 'blue', 'violet', 'pink'));

comment on column public.quick_notes.icon is 'An emoji shown beside the page''s title and in the side list. Optional.';
comment on column public.quick_notes.cover is 'The colour of the band across the top of the page. Optional.';

create table public.space_settings (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  accent text check (accent is null or accent in ('slate', 'red', 'orange', 'amber', 'green', 'teal', 'blue', 'violet', 'pink')),
  updated_at timestamptz not null default now()
);

comment on table public.space_settings is 'How a person''s own "Mi espacio" looks. One row per person, their own only.';

create trigger space_settings_set_updated_at before update on public.space_settings
  for each row execute function public.set_updated_at();

alter table public.space_settings enable row level security;

create policy "space_settings: own read" on public.space_settings for select to authenticated
  using (profile_id = (select auth.uid()));
create policy "space_settings: own add" on public.space_settings for insert to authenticated
  with check (profile_id = (select auth.uid()));
create policy "space_settings: own change" on public.space_settings for update to authenticated
  using (profile_id = (select auth.uid())) with check (profile_id = (select auth.uid()));

grant select, insert, update on public.space_settings to authenticated;
