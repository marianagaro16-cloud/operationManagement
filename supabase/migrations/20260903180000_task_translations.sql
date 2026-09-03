-- ============================================================
-- Translations for task titles and descriptions.
--
-- Task titles are DATA, not interface text, so they cannot live in the i18n
-- message files. They are entered by an admin and need to render in whichever
-- language the reader has chosen.
--
-- Spanish stays in `title` / `description`: it is the source language the
-- activities were written in, and the fallback when a translation is missing.
-- A missing translation therefore shows the Spanish original rather than an
-- empty row or a raw key.
--
-- JSONB rather than title_de / title_en columns so adding a language later is
-- data, not a migration.
--   { "de": { "title": "...", "description": "..." },
--     "en": { "title": "...", "description": "..." } }
-- ============================================================

alter table public.tasks
  add column if not exists translations jsonb not null default '{}'::jsonb;

comment on column public.tasks.translations is
  'Per-locale title/description overrides. Spanish lives in title/description and is the fallback.';

-- Restrict the keys to the locales the app actually supports, so a typo like
-- {"deu": ...} fails at write time instead of silently producing text nobody
-- ever sees.
--
-- Expressed with the jsonb "-" operator rather than a subquery: CHECK
-- constraints cannot contain subqueries. Removing the allowed keys must leave
-- an empty object.
alter table public.tasks
  drop constraint if exists tasks_translations_shape;

alter table public.tasks
  add constraint tasks_translations_shape check (
    jsonb_typeof(translations) = 'object'
    and translations - ARRAY['de', 'en'] = '{}'::jsonb
  );

-- Admin-only, like every other task-definition field: the existing
-- "tasks: admin writes" policy already covers this column, and users still
-- cannot write any part of a definition.
