-- ============================================================
-- A quick note has a title (decided 2026-10-12).
--
-- Notes become pages in "Mi espacio": a title, the text and the checklist,
-- written in place. The title is optional — a note written quickly from the
-- header still has none, and is listed by its first line.
-- ============================================================

alter table public.quick_notes
  add column title text not null default '' check (char_length(title) <= 200);

comment on column public.quick_notes.title is
  'The page''s title. Empty for a note jotted down without one; it is then listed by its first line.';
