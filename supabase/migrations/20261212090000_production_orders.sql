-- ============================================================
-- Production orders (decided 2026-10-01).
--
-- An activity can be a production order: a product and how many units to
-- make. It repeats, is assigned and covered like any activity; completing a
-- day of it means recording what was made — units produced, the lot and its
-- best-before date, and a reason when fewer were made than asked. The lots
-- recorded here are offered when an order is prepared.
-- ============================================================

alter table public.tasks
  add column product_id      uuid references public.products (id) on delete restrict,
  add column target_quantity numeric(12, 3) check (target_quantity is null or target_quantity > 0),
  add constraint tasks_production_pair check ((product_id is null) = (target_quantity is null));

create index tasks_product_idx on public.tasks (product_id) where product_id is not null;

create table public.production_records (
  occurrence_id     uuid primary key references public.task_occurrences (id) on delete cascade,
  product_id        uuid not null references public.products (id) on delete restrict,
  target_quantity   numeric(12, 3) not null,
  produced_quantity numeric(12, 3) not null check (produced_quantity >= 0),
  lot_number        text check (lot_number is null or length(btrim(lot_number)) between 1 and 80),
  best_before       date,
  shortfall_reason  text check (shortfall_reason in ('raw_material', 'packaging', 'time', 'damaged', 'other')),
  shortfall_note    text check (shortfall_note is null or length(shortfall_note) <= 2000),
  recorded_by       uuid references public.profiles (id) on delete set null,
  recorded_at       timestamptz not null default now()
);

create index production_records_product_idx on public.production_records (product_id, recorded_at desc);

alter table public.production_records enable row level security;

-- Whoever may act on that day of the activity, and whoever plans work.
create policy "production_records: read" on public.production_records for select to authenticated
  using (
    (select public.has_permission('tasks.manage_occurrences'))
    or exists (
      select 1 from public.task_occurrences o
       where o.id = occurrence_id and public.can_act_on_task_occurrence(o.task_id, o.assignee_id)
    )
  );
create policy "not for external accounts" on public.production_records as restrictive for all to authenticated
  using (not (select public.is_external())) with check (not (select public.is_external()));
grant select on public.production_records to authenticated;

/* What was made, recorded — and the day completed with it. */
create or replace function public.record_production(
  p_occurrence_id uuid,
  p_produced      numeric,
  p_lot           text,
  p_best_before   date,
  p_reason        text,
  p_note          text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_o public.task_occurrences%rowtype;
  v_t public.tasks%rowtype;
begin
  if not public.is_approved() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  select * into v_o from public.task_occurrences where id = p_occurrence_id for update;
  if not found then
    raise exception 'occurrence_not_found' using errcode = 'P0002';
  end if;
  select * into v_t from public.tasks where id = v_o.task_id;
  if v_t.product_id is null then
    raise exception 'not_production' using errcode = '22023';
  end if;
  if not (public.can_act_on_task_occurrence(v_o.task_id, v_o.assignee_id) or public.has_permission('tasks.manage_occurrences')) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if p_produced is null or p_produced < 0 then
    raise exception 'invalid_quantity' using errcode = '22023';
  end if;
  if p_produced > 0 and nullif(btrim(coalesce(p_lot, '')), '') is null then
    raise exception 'lot_required' using errcode = '22023';
  end if;
  if p_produced < v_t.target_quantity and p_reason is null then
    raise exception 'reason_required' using errcode = '22023';
  end if;

  insert into public.production_records
    (occurrence_id, product_id, target_quantity, produced_quantity, lot_number, best_before, shortfall_reason, shortfall_note, recorded_by, recorded_at)
  values
    (p_occurrence_id, v_t.product_id, v_t.target_quantity, p_produced, nullif(btrim(coalesce(p_lot, '')), ''), p_best_before,
     case when p_produced < v_t.target_quantity then p_reason end,
     nullif(btrim(coalesce(p_note, '')), ''), (select auth.uid()), now())
  on conflict (occurrence_id) do update set
    produced_quantity = excluded.produced_quantity,
    lot_number        = excluded.lot_number,
    best_before       = excluded.best_before,
    shortfall_reason  = excluded.shortfall_reason,
    shortfall_note    = excluded.shortfall_note,
    recorded_by       = excluded.recorded_by,
    recorded_at       = excluded.recorded_at;

  update public.task_occurrences
     set status = 'completed', completed_by = (select auth.uid()), completed_at = now(),
         skipped_by = null, skipped_at = null, skip_reason = null
   where id = p_occurrence_id;
end;
$$;

revoke all on function public.record_production(uuid, numeric, text, date, text, text) from public, anon;
grant execute on function public.record_production(uuid, numeric, text, date, text, text) to authenticated;

/* A production order is completed by recording what was made, not by a tick. */
create or replace function public.guard_production_completion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'completed' and old.status is distinct from 'completed'
     and exists (select 1 from public.tasks t where t.id = new.task_id and t.product_id is not null)
     and not exists (select 1 from public.production_records r where r.occurrence_id = new.id) then
    raise exception 'production_record_required' using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger task_occurrences_guard_production before update on public.task_occurrences
  for each row execute function public.guard_production_completion();

/* The lots recently made of a product — offered when preparing an order. */
create or replace function public.recent_production_lots(p_product_id uuid)
returns table (lot_number text, best_before date, produced_on date)
language sql
stable
security definer
set search_path = ''
as $$
  select distinct on (r.lot_number) r.lot_number, r.best_before, (r.recorded_at at time zone 'Europe/Zurich')::date
    from public.production_records r
   where r.product_id = p_product_id and r.lot_number is not null and public.is_approved() and not public.is_external()
   order by r.lot_number, r.recorded_at desc
   limit 20;
$$;

revoke all on function public.recent_production_lots(uuid) from public, anon;
grant execute on function public.recent_production_lots(uuid) to authenticated;

-- ---------- the weekly "Producir…" activities become production orders ----------

with map(title, product_name) as (values
  ('Producir 20 unidades de Cal 50 g', 'Cal "del Barrio" - 50g'),
  ('Producir 20 unidades de Chapulines 100 g', 'Chapulines Enchilados- 100g'),
  ('Producir 20 unidades de Chile Ancho 100g', 'Chile Ancho- Del Barrio - 100g'),
  ('Producir 20 unidades de Chile Árbol 100g', 'Chile Árbol - Del Barrio - 100g'),
  ('Producir 20 unidades de Chile Chipotle (Meco) 100g Retail', 'Chile Chipotle (Meco)- Del Barrio - 100g'),
  ('Producir 20 unidades de Chile Chipotle (Morita) 100g', 'Chile Chipotle (Morita)- Del Barrio - 100g'),
  ('Producir 20 unidades de Chile Guajillo 100g', 'Chile Guajillo - Del Barrio - 100g'),
  ('Producir 20 unidades de Chile Pasilla 100g', 'Chile Pasilla - Del Barrio - 100g'),
  ('Producir 20 unidades de Flor de Jamaica 1Kg Gastro', 'Hibiskusblüte "Del Barrio" - 1Kg'),
  ('Producir 20 unidades de Flor de Jamaica 250g retail', 'Hibiskusblüte "Del Barrio" - 250g'),
  ('Producir 50 unidades de Chapulines 15g', 'Chapulines Enchilados "del Barrio" - 15g'),
  ('Producir 50 unidades de Chile Poblano 500g', 'Geröstete Chile Poblano "del Barrio" - 0.5kg'),
  ('Producir 20 unidades de Harina 1kg', 'White Corn Flour "del Barrio" - 1kg')
)
update public.tasks t
   set product_id = p.id,
       target_quantity = (regexp_match(t.title, '^Producir (\d+) '))[1]::numeric
  from map m
  join public.products p on p.name = m.product_name and p.is_active
 where t.title = m.title and t.is_active;

update public.tasks set title = 'Producir 20 unidades de Harina blanca 1kg'
 where title = 'Producir 20 unidades de Harina 1kg' and product_id is not null;

-- Harina: white and yellow, the same days and people.
with src as (
  select * from public.tasks where title = 'Producir 20 unidades de Harina blanca 1kg' and is_active limit 1
), copy as (
  insert into public.tasks (title, description, frequency, schedule_config, is_active, is_skippable, team, category_id, starts_on, translations, created_by, product_id, target_quantity)
  select 'Producir 20 unidades de Harina amarilla 1kg', s.description, s.frequency, s.schedule_config, true, s.is_skippable, s.team, s.category_id, s.starts_on, s.translations, s.created_by,
         (select id from public.products where name = 'Yellow Corn Flour "del Barrio" - 1kg' and is_active), 20
    from src s
   where exists (select 1 from public.products where name = 'Yellow Corn Flour "del Barrio" - 1kg' and is_active)
  returning id
)
insert into public.task_assignees (task_id, user_id)
select copy.id, a.user_id from copy, src, public.task_assignees a where a.task_id = src.id;
