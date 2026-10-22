-- ============================================================
-- Start and leaving checklists (decided 2026-10-22).
--
--   hr_checklist_items    Admin's two lists, Ingreso ('start') and Salida
--                         ('leave'): for some teams or all (empty), in three
--                         languages. An item may be one the app ticks itself
--                         (auto): keys, the app account, required trainings.
--   hr_checklists         one per worker and phase, with a due date. Made
--                         when a file is created (start) or marked as left
--                         (leave), or by hand from the file.
--   hr_checklist_entries  the items as they were when the list was made, so
--                         changing Admin's list leaves running lists alone.
--                         A tick keeps who and when, can be undone, and may
--                         carry a note.
--
-- Same access as the file: hr_can_worker().
-- ============================================================

create table public.hr_checklist_items (
  id           uuid primary key default gen_random_uuid(),
  phase        text not null check (phase in ('start', 'leave')),
  name         text not null check (length(btrim(name)) > 0),
  translations jsonb not null default '{}'::jsonb,
  teams        public.team[] not null default '{}',
  auto         text check (auto in ('keys', 'account', 'trainings')),
  sort_order   int not null default 100,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create trigger hr_checklist_items_set_updated_at before update on public.hr_checklist_items
  for each row execute function public.set_updated_at();

alter table public.hr_checklist_items enable row level security;

create policy "hr_checklist_items: read" on public.hr_checklist_items for select to authenticated
  using ((select public.has_permission('hr.manage')));
create policy "hr_checklist_items: admin writes" on public.hr_checklist_items for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

grant select, insert, update, delete on public.hr_checklist_items to authenticated;

-- A start that is sensible for everyone; Admin changes it in Gestión.
insert into public.hr_checklist_items (phase, name, translations, auto, sort_order) values
  ('start', 'Contrato firmado',               '{"en":{"name":"Contract signed"},"de":{"name":"Vertrag unterschrieben"}}', null, 10),
  ('start', 'Llaves entregadas',              '{"en":{"name":"Keys handed over"},"de":{"name":"Schlüssel übergeben"}}', 'keys', 20),
  ('start', 'Cuenta de la app',               '{"en":{"name":"App account"},"de":{"name":"App-Konto"}}', 'account', 30),
  ('start', 'Ropa de trabajo',                '{"en":{"name":"Work clothes"},"de":{"name":"Arbeitskleidung"}}', null, 40),
  ('start', 'Formaciones requeridas hechas',  '{"en":{"name":"Required trainings done"},"de":{"name":"Erforderliche Schulungen absolviert"}}', 'trainings', 50),
  ('leave', 'Llaves devueltas',               '{"en":{"name":"Keys returned"},"de":{"name":"Schlüssel zurückgegeben"}}', 'keys', 10),
  ('leave', 'Cuenta de la app desactivada',   '{"en":{"name":"App account switched off"},"de":{"name":"App-Konto deaktiviert"}}', 'account', 20),
  ('leave', 'Ropa de trabajo devuelta',       '{"en":{"name":"Work clothes returned"},"de":{"name":"Arbeitskleidung zurückgegeben"}}', null, 30),
  ('leave', 'Evaluación final',               '{"en":{"name":"Final evaluation"},"de":{"name":"Schlussbeurteilung"}}', null, 40);

create table public.hr_checklists (
  id         uuid primary key default gen_random_uuid(),
  worker_id  uuid not null references public.hr_workers (id) on delete cascade,
  phase      text not null check (phase in ('start', 'leave')),
  due_on     date not null,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (worker_id, phase)
);

create table public.hr_checklist_entries (
  id           uuid primary key default gen_random_uuid(),
  checklist_id uuid not null references public.hr_checklists (id) on delete cascade,
  item_id      uuid references public.hr_checklist_items (id) on delete set null,
  name         text not null,
  translations jsonb not null default '{}'::jsonb,
  auto         text check (auto in ('keys', 'account', 'trainings')),
  sort_order   int not null default 100,
  done_at      timestamptz,
  done_by      uuid references public.profiles (id) on delete set null,
  note         text
);

create index hr_checklist_entries_list_idx on public.hr_checklist_entries (checklist_id);

/* May the caller open the file this checklist belongs to? */
create or replace function public.hr_can_checklist(p_checklist_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.hr_checklists c
     where c.id = p_checklist_id and public.hr_can_worker(c.worker_id)
  );
$$;

revoke all on function public.hr_can_checklist(uuid) from public, anon;
grant execute on function public.hr_can_checklist(uuid) to authenticated;

alter table public.hr_checklists enable row level security;
alter table public.hr_checklist_entries enable row level security;

create policy "hr_checklists: read" on public.hr_checklists for select to authenticated
  using (public.hr_can_worker(worker_id));
create policy "hr_checklists: add" on public.hr_checklists for insert to authenticated
  with check (public.hr_can_worker(worker_id));
create policy "hr_checklists: change" on public.hr_checklists for update to authenticated
  using (public.hr_can_worker(worker_id)) with check (public.hr_can_worker(worker_id));
create policy "hr_checklists: remove" on public.hr_checklists for delete to authenticated
  using (public.hr_can_worker(worker_id));

create policy "hr_checklist_entries: read" on public.hr_checklist_entries for select to authenticated
  using (public.hr_can_checklist(checklist_id));
create policy "hr_checklist_entries: add" on public.hr_checklist_entries for insert to authenticated
  with check (public.hr_can_checklist(checklist_id));
create policy "hr_checklist_entries: change" on public.hr_checklist_entries for update to authenticated
  using (public.hr_can_checklist(checklist_id)) with check (public.hr_can_checklist(checklist_id));

grant select, insert, update, delete on public.hr_checklists to authenticated;
grant select, insert, update on public.hr_checklist_entries to authenticated;
