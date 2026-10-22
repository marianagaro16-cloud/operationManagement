-- ============================================================
-- Important dates in a worker file (decided 2026-10-22).
--
--   hr_workers.trial_end_date     end of the trial period (Probezeit)
--   hr_workers.contract_end_date  end of a fixed-term contract; empty = open-ended
--   hr_worker_dates               any other date HR wants to keep (a name, a
--                                 date, a note) — corrected or removed by
--                                 whoever may open the file
--   hr_date_notices               one row per notice sent, so the notifier,
--                                 called every few minutes, tells people once
--
-- Notices: within the 30 days before, and on the day, to whoever may open the
-- file (hr_celebration_recipients). Current staff only.
-- ============================================================

alter table public.hr_workers
  add column trial_end_date    date,
  add column contract_end_date date;

create table public.hr_worker_dates (
  id         uuid primary key default gen_random_uuid(),
  worker_id  uuid not null references public.hr_workers (id) on delete cascade,
  label      text not null check (length(btrim(label)) > 0),
  on_date    date not null,
  note       text,
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index hr_worker_dates_worker_idx on public.hr_worker_dates (worker_id);
create index hr_worker_dates_date_idx on public.hr_worker_dates (on_date);

create trigger hr_worker_dates_set_updated_at before update on public.hr_worker_dates
  for each row execute function public.set_updated_at();

alter table public.hr_worker_dates enable row level security;

create policy "hr_worker_dates: read" on public.hr_worker_dates for select to authenticated
  using (public.hr_can_worker(worker_id));
create policy "hr_worker_dates: add" on public.hr_worker_dates for insert to authenticated
  with check (public.hr_can_worker(worker_id));
create policy "hr_worker_dates: change" on public.hr_worker_dates for update to authenticated
  using (public.hr_can_worker(worker_id)) with check (public.hr_can_worker(worker_id));
create policy "hr_worker_dates: remove" on public.hr_worker_dates for delete to authenticated
  using (public.hr_can_worker(worker_id));

grant select, insert, update, delete on public.hr_worker_dates to authenticated;

-- ref_id: the worker for trial_end / contract_end, the hr_worker_dates row for custom.
create table public.hr_date_notices (
  kind    text not null check (kind in ('trial_end', 'contract_end', 'custom')),
  ref_id  uuid not null,
  on_date date not null,
  stage   text not null check (stage in ('before', 'day')),
  sent_at timestamptz not null default now(),
  primary key (kind, ref_id, on_date, stage)
);

-- Written and read only by the notifier (service role).
alter table public.hr_date_notices enable row level security;
