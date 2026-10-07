-- ============================================================
-- Keys (decided 2026-10-07): who holds which key, and since when.
--
-- One row per key handed over: its number, what it opens, who has it, the day
-- it was handed over and the day it came back. The holder is a worker with a
-- file, or anyone else by name — an external person, a company, someone
-- without a file. A returned key stays, so the register is also its history.
--
-- Read and written with the files: a worker's keys by whoever may open that
-- file, the keys of people without a file by everyone with access to files.
-- Only an Admin removes a row.
-- ============================================================

create table public.hr_keys (
  id            uuid primary key default gen_random_uuid(),
  key_number    text not null check (length(btrim(key_number)) > 0),
  opens         text,
  worker_id     uuid references public.hr_workers (id) on delete cascade,
  -- Someone without a file: their name, and who they are (company, phone).
  holder_name   text,
  holder_detail text,
  handed_on     date not null,
  returned_on   date,
  note          text,
  created_by    uuid references public.profiles (id) on delete set null,
  updated_by    uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  -- A worker or a name, never both.
  constraint hr_keys_holder check ((worker_id is null) <> (length(btrim(coalesce(holder_name, ''))) = 0)),
  constraint hr_keys_dates check (returned_on is null or returned_on >= handed_on)
);

create index hr_keys_worker_idx on public.hr_keys (worker_id) where worker_id is not null;

create trigger hr_keys_set_updated_at before update on public.hr_keys
  for each row execute function public.set_updated_at();

/* May the caller see and write the keys of this holder? */
create or replace function public.hr_can_key(p_worker_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_worker_id is null then public.is_approved() and public.has_permission('hr.manage')
    else public.hr_can_worker(p_worker_id)
  end;
$$;

revoke all on function public.hr_can_key(uuid) from public, anon;
grant execute on function public.hr_can_key(uuid) to authenticated;

alter table public.hr_keys enable row level security;

create policy "hr_keys: read" on public.hr_keys for select to authenticated
  using (public.hr_can_key(worker_id));
create policy "hr_keys: add" on public.hr_keys for insert to authenticated
  with check (public.hr_can_key(worker_id));
create policy "hr_keys: change" on public.hr_keys for update to authenticated
  using (public.hr_can_key(worker_id)) with check (public.hr_can_key(worker_id));
create policy "hr_keys: admin removes" on public.hr_keys for delete to authenticated
  using ((select public.is_admin()) and public.hr_can_key(worker_id));

grant select, insert, update, delete on public.hr_keys to authenticated;
