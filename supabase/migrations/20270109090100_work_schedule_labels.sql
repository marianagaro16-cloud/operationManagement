-- ============================================================
-- The schedule: the short name a person goes by on it (2026-10-09).
--
-- A worker file holds the full name — "Patricia Lucero Márquez Rojas" — and
-- the schedule has always said "Patty". The label is what the grid and the
-- PDF print; without one, the file's name or the external's is used.
-- ============================================================

alter table public.schedule_people add column label text;
