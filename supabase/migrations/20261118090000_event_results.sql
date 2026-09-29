-- ============================================================
-- Events, step 3: how it went, who we met, and its photos and files.
--
--   results        on the event: how it went, a rating 1–5, repeat it?
--                  (yes / no / maybe), and optional figures — visitors
--                  (approx.), samples given, contacts made. Asked for when
--                  it is marked done; can be completed later.
--   event_notes    notes any time, before, during or after. Permanent, like
--                  the notes on a customer.
--   prospects      a contact met there becomes a prospect linked to the
--                  event (prospects.event_id).
--   event_files    photos and PDFs, in the private bucket 'event-files',
--                  under `<event id>/<random>.<ext>`.
--
-- For sales (is_sales()), like the rest of the event.
-- ============================================================

alter table public.events
  add column result_summary  text,
  add column result_rating   smallint check (result_rating between 1 and 5),
  add column result_repeat   text check (result_repeat in ('yes', 'no', 'maybe')),
  add column result_visitors int check (result_visitors >= 0),
  add column result_samples  int check (result_samples >= 0),
  add column result_contacts int check (result_contacts >= 0);

-- ---------- notes ----------

create table public.event_notes (
  id         uuid primary key default gen_random_uuid(),
  event_id   uuid not null references public.events (id) on delete cascade,
  body       text not null check (length(btrim(body)) > 0),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create index event_notes_event_idx on public.event_notes (event_id, created_at);

alter table public.event_notes enable row level security;

create policy "event_notes: sales read" on public.event_notes for select to authenticated
  using ((select public.is_sales()));
create policy "event_notes: sales add" on public.event_notes for insert to authenticated
  with check ((select public.is_sales()) and created_by = (select auth.uid()));

-- ---------- contacts ----------

alter table public.prospects add column event_id uuid references public.events (id) on delete set null;
create index prospects_event_idx on public.prospects (event_id) where event_id is not null;

-- ---------- photos and files ----------

create table public.event_files (
  id           uuid primary key default gen_random_uuid(),
  event_id     uuid not null references public.events (id) on delete cascade,
  storage_path text not null unique,
  file_name    text not null,
  mime_type    text not null,
  size_bytes   int not null check (size_bytes > 0),
  uploaded_by  uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now()
);

create index event_files_event_idx on public.event_files (event_id, created_at);

alter table public.event_files enable row level security;

create policy "event_files: sales read" on public.event_files for select to authenticated
  using ((select public.is_sales()));
create policy "event_files: sales add" on public.event_files for insert to authenticated
  with check ((select public.is_sales()) and uploaded_by = (select auth.uid()));
create policy "event_files: sales remove" on public.event_files for delete to authenticated
  using ((select public.is_sales()));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'event-files',
  'event-files',
  false,
  10485760, -- 10 MB
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf']
)
on conflict (id) do nothing;

create policy "event files: read" on storage.objects
  for select to authenticated
  using (bucket_id = 'event-files' and (select public.is_sales()));

create policy "event files: upload" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'event-files'
    and (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$'
    and (select public.is_sales())
  );

create policy "event files: remove" on storage.objects
  for delete to authenticated
  using (bucket_id = 'event-files' and (select public.is_sales()));
