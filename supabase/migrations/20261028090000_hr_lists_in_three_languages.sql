-- ============================================================
-- Evaluation criteria and note types, in German and English too.
--
-- Spanish stays the source, in name/description; other languages are
-- overrides, the shape inventory templates already use:
--   {"de": {"name": "...", "description": "..."}, "en": {...}}
-- A missing translation falls back to the Spanish.
--
-- A saved score keeps its criterion's words as they were — name AND
-- translations — so renaming or re-translating a criterion later leaves every
-- past evaluation reading exactly as it was written.
-- ============================================================

alter table public.hr_criteria
  add column translations jsonb not null default '{}'::jsonb;
alter table public.hr_note_types
  add column translations jsonb not null default '{}'::jsonb;
alter table public.hr_evaluation_scores
  add column criterion_translations jsonb not null default '{}'::jsonb;

comment on column public.hr_criteria.translations is
  'Per-locale overrides of name/description; Spanish is in the base fields.';
comment on column public.hr_note_types.translations is
  'Per-locale overrides of name; Spanish is in the base field.';
comment on column public.hr_evaluation_scores.criterion_translations is
  'Copy of the criterion''s translations, frozen with criterion_name.';
