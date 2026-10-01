-- ============================================================
-- Late arrivals in the worker file (decided 2026-10-01).
--
-- Workers do not clock in through the app: whoever keeps the file records the
-- time they should have started and the time they arrived. Each entry may
-- carry a reason (Admin's list), whether it was excused, and whether they
-- warned in advance. Unlike the log, an entry can be corrected or removed —
-- by whoever recorded it, within 24 hours; then it is fixed.
--
-- Same access as the rest of the file: hr_can_worker().
-- ============================================================

create table public.hr_late_reasons (
  id           uuid primary key default gen_random_uuid(),
  slug         text not null unique,
  name         text not null check (length(btrim(name)) > 0),
  translations jsonb not null default '{}'::jsonb,
  sort_order   int not null default 100,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create trigger hr_late_reasons_set_updated_at
  before update on public.hr_late_reasons
  for each row execute function public.set_updated_at();

insert into public.hr_late_reasons (slug, name, translations, sort_order) values
  ('traffic',   'Tráfico',            '{"en":{"name":"Traffic"},"de":{"name":"Verkehr"}}', 10),
  ('transport', 'Transporte público', '{"en":{"name":"Public transport"},"de":{"name":"Öffentlicher Verkehr"}}', 20),
  ('health',    'Salud',              '{"en":{"name":"Health"},"de":{"name":"Gesundheit"}}', 30),
  ('personal',  'Personal',           '{"en":{"name":"Personal"},"de":{"name":"Persönlich"}}', 40),
  ('no_notice', 'Sin aviso',          '{"en":{"name":"No notice"},"de":{"name":"Ohne Bescheid"}}', 50),
  ('other',     'Otro',               '{"en":{"name":"Other"},"de":{"name":"Anderes"}}', 90)
on conflict (slug) do nothing;

create table public.hr_late_arrivals (
  id            uuid primary key default gen_random_uuid(),
  worker_id     uuid not null references public.hr_workers (id) on delete cascade,
  arrival_date  date not null,
  expected_time time not null,
  arrived_time  time not null,
  minutes_late  int generated always as ((extract(epoch from (arrived_time - expected_time)) / 60)::int) stored,
  reason_id     uuid references public.hr_late_reasons (id) on delete restrict,
  excused       boolean not null default false,
  notified      boolean not null default false,
  note          text check (note is null or length(note) <= 2000),
  created_by    uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint hr_late_arrivals_after check (arrived_time > expected_time)
);

create index hr_late_arrivals_worker_idx on public.hr_late_arrivals (worker_id, arrival_date desc);

create trigger hr_late_arrivals_set_updated_at
  before update on public.hr_late_arrivals
  for each row execute function public.set_updated_at();

/* Corrected or removed by whoever recorded it, within a day of recording it. */
create or replace function public.hr_late_editable(p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.hr_late_arrivals a
     where a.id = p_id
       and a.created_by = (select auth.uid())
       and a.created_at > now() - interval '24 hours'
       and public.hr_can_worker(a.worker_id)
  );
$$;

revoke all on function public.hr_late_editable(uuid) from public, anon;
grant execute on function public.hr_late_editable(uuid) to authenticated;

/* Who recorded it and when stay as they were. */
create or replace function public.guard_hr_late_arrival()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.worker_id := old.worker_id;
  new.created_by := old.created_by;
  new.created_at := old.created_at;
  return new;
end;
$$;

create trigger hr_late_arrivals_guard before update on public.hr_late_arrivals
  for each row execute function public.guard_hr_late_arrival();

alter table public.hr_late_reasons enable row level security;
alter table public.hr_late_arrivals enable row level security;

create policy "hr_late_reasons: read" on public.hr_late_reasons for select to authenticated
  using ((select public.has_permission('hr.manage')));
create policy "hr_late_reasons: admin writes" on public.hr_late_reasons for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

create policy "hr_late_arrivals: read" on public.hr_late_arrivals for select to authenticated
  using (public.hr_can_worker(worker_id));
create policy "hr_late_arrivals: add" on public.hr_late_arrivals for insert to authenticated
  with check (public.hr_can_worker(worker_id) and created_by = (select auth.uid()));
create policy "hr_late_arrivals: correct within a day" on public.hr_late_arrivals for update to authenticated
  using (public.hr_late_editable(id)) with check (public.hr_can_worker(worker_id));
create policy "hr_late_arrivals: remove within a day" on public.hr_late_arrivals for delete to authenticated
  using (public.hr_late_editable(id));

grant select, insert, update, delete on public.hr_late_reasons, public.hr_late_arrivals to authenticated;

-- From how many unexcused late arrivals in a calendar month HR is told. Admin's setting.
insert into public.app_settings (key, value) values ('hr_late_alert_threshold', '3'::jsonb)
on conflict (key) do nothing;
