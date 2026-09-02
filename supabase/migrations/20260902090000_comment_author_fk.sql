-- ============================================================
-- Point comment authorship at public.profiles.
--
-- task_comments.user_id referenced auth.users, which lives in a schema
-- PostgREST does not expose. There was therefore no relationship it could
-- use to embed the author, and `select(..., profiles:user_id(...))` failed
-- with PGRST200 — so posted comments never appeared.
--
-- profiles.id is itself a FK to auth.users(id), so re-pointing preserves
-- referential integrity and the existing cascade behaviour while making the
-- author embeddable.
-- ============================================================

alter table public.task_comments
  drop constraint if exists task_comments_user_id_fkey;

alter table public.task_comments
  add constraint task_comments_user_id_fkey
  foreign key (user_id) references public.profiles (id) on delete cascade;
