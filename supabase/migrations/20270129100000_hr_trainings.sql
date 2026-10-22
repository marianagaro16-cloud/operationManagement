-- ============================================================
-- Training and certificates (decided 2026-10-22).
--
--   hr_training_kinds  Admin's list (3 languages): how long a training is
--                      valid (empty = it does not expire), and which teams
--                      must have it
--   hr_trainings       one per training someone did: the kind, the day, when
--                      it expires (filled from the kind, can be changed), who
--                      gave it, hours, a note. A record, not the log: whoever
--                      may open the file corrects or removes it.
--
-- An expiry warns like the file's other dates (hr_date_notices, kind
-- 'training'), for each person's latest training of a kind.
-- ============================================================

create table public.hr_training_kinds (
  id              uuid primary key default gen_random_uuid(),
  name            text not null check (length(btrim(name)) > 0),
  translations    jsonb not null default '{}'::jsonb,
  validity_months int check (validity_months is null or validity_months between 1 and 240),
  required_teams  public.team[] not null default '{}',
  sort_order      int not null default 100,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create trigger hr_training_kinds_set_updated_at before update on public.hr_training_kinds
  for each row execute function public.set_updated_at();

alter table public.hr_training_kinds enable row level security;

create policy "hr_training_kinds: read" on public.hr_training_kinds for select to authenticated
  using ((select public.has_permission('hr.manage')));
create policy "hr_training_kinds: admin writes" on public.hr_training_kinds for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

grant select, insert, update, delete on public.hr_training_kinds to authenticated;

create table public.hr_trainings (
  id         uuid primary key default gen_random_uuid(),
  worker_id  uuid not null references public.hr_workers (id) on delete cascade,
  kind_id    uuid not null references public.hr_training_kinds (id) on delete restrict,
  done_on    date not null,
  expires_on date,
  provider   text,
  hours      numeric(6, 2) check (hours is null or hours > 0),
  note       text,
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hr_trainings_dates check (expires_on is null or expires_on >= done_on)
);

create index hr_trainings_worker_idx on public.hr_trainings (worker_id);
create index hr_trainings_expires_idx on public.hr_trainings (expires_on) where expires_on is not null;

create trigger hr_trainings_set_updated_at before update on public.hr_trainings
  for each row execute function public.set_updated_at();

alter table public.hr_trainings enable row level security;

create policy "hr_trainings: read" on public.hr_trainings for select to authenticated
  using (public.hr_can_worker(worker_id));
create policy "hr_trainings: add" on public.hr_trainings for insert to authenticated
  with check (public.hr_can_worker(worker_id));
create policy "hr_trainings: change" on public.hr_trainings for update to authenticated
  using (public.hr_can_worker(worker_id)) with check (public.hr_can_worker(worker_id));
create policy "hr_trainings: remove" on public.hr_trainings for delete to authenticated
  using (public.hr_can_worker(worker_id));

grant select, insert, update, delete on public.hr_trainings to authenticated;

alter table public.hr_date_notices drop constraint hr_date_notices_kind_check;
alter table public.hr_date_notices add constraint hr_date_notices_kind_check
  check (kind in ('trial_end', 'contract_end', 'custom', 'training'));
