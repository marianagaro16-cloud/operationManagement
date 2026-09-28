-- ============================================================
-- Prospects: "how we found them" and "lost reason" become Admin's lists,
-- in three languages, like the HR lists — instead of fixed codes.
--
-- Spanish in `name`; German and English in `translations`
-- ({"de": {"name": ...}, "en": {...}}), a missing one falling back to the
-- Spanish. Switched off rather than deleted: old prospects still name them.
-- They start as the fixed options were. No prospect existed yet, so the
-- columns are replaced rather than migrated.
-- ============================================================

create table public.prospect_sources (
  id           uuid primary key default gen_random_uuid(),
  slug         text not null unique,
  name         text not null check (length(btrim(name)) > 0),
  translations jsonb not null default '{}'::jsonb,
  sort_order   int not null default 100,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table public.prospect_lost_reasons (
  id           uuid primary key default gen_random_uuid(),
  slug         text not null unique,
  name         text not null check (length(btrim(name)) > 0),
  translations jsonb not null default '{}'::jsonb,
  sort_order   int not null default 100,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create trigger prospect_sources_set_updated_at before update on public.prospect_sources
  for each row execute function public.set_updated_at();
create trigger prospect_lost_reasons_set_updated_at before update on public.prospect_lost_reasons
  for each row execute function public.set_updated_at();

insert into public.prospect_sources (slug, name, translations, sort_order) values
  ('recommendation', 'Recomendación', '{"de": {"name": "Empfehlung"}, "en": {"name": "Recommendation"}}', 10),
  ('visit',          'Visita',        '{"de": {"name": "Besuch"}, "en": {"name": "Visit"}}', 20),
  ('fair',           'Feria',         '{"de": {"name": "Messe"}, "en": {"name": "Fair"}}', 30),
  ('internet',       'Internet',      '{"de": {"name": "Internet"}, "en": {"name": "Internet"}}', 40),
  ('inbound',        'Nos contactó',  '{"de": {"name": "Haben uns kontaktiert"}, "en": {"name": "They contacted us"}}', 50),
  ('other',          'Otro',          '{"de": {"name": "Anderes"}, "en": {"name": "Other"}}', 90);

insert into public.prospect_lost_reasons (slug, name, translations, sort_order) values
  ('price',          'Precio',             '{"de": {"name": "Preis"}, "en": {"name": "Price"}}', 10),
  ('not_interested', 'No le interesa',     '{"de": {"name": "Kein Interesse"}, "en": {"name": "Not interested"}}', 20),
  ('has_supplier',   'Ya tiene proveedor', '{"de": {"name": "Hat schon einen Lieferanten"}, "en": {"name": "Already has a supplier"}}', 30),
  ('other',          'Otro',               '{"de": {"name": "Anderes"}, "en": {"name": "Other"}}', 90);

alter table public.prospect_sources      enable row level security;
alter table public.prospect_lost_reasons enable row level security;

create policy "prospect_sources: sales read" on public.prospect_sources
  for select to authenticated using ((select public.is_sales()));
create policy "prospect_sources: admin writes" on public.prospect_sources
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "prospect_lost_reasons: sales read" on public.prospect_lost_reasons
  for select to authenticated using ((select public.is_sales()));
create policy "prospect_lost_reasons: admin writes" on public.prospect_lost_reasons
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

-- ---------- the prospect points at them ----------

alter table public.prospects drop constraint prospects_lost_has_reason;
alter table public.prospects drop column source;
alter table public.prospects drop column lost_reason;
alter table public.prospects
  add column source_id uuid references public.prospect_sources (id) on delete restrict,
  add column lost_reason_id uuid references public.prospect_lost_reasons (id) on delete restrict;
alter table public.prospects
  add constraint prospects_lost_has_reason check (stage <> 'lost' or lost_reason_id is not null);

drop function public.sales_prospect_lose(uuid, text, text);

create or replace function public.sales_prospect_lose(p_prospect_id uuid, p_reason_id uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_stage text;
begin
  if not public.is_sales() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  select stage into v_stage from public.prospects where id = p_prospect_id for update;
  if not found then
    raise exception 'prospect_not_found' using errcode = 'P0002';
  end if;
  if v_stage in ('won', 'lost') then
    raise exception 'prospect_closed' using errcode = '42501';
  end if;
  if p_reason_id is null or not exists (
    select 1 from public.prospect_lost_reasons r where r.id = p_reason_id and r.is_active
  ) then
    raise exception 'lost_reason_required' using errcode = '22023';
  end if;

  perform set_config('app.prospect_closing', 'on', true);
  update public.prospects
     set stage = 'lost', lost_reason_id = p_reason_id, lost_note = nullif(btrim(coalesce(p_note, '')), ''),
         closed_at = now(), next_step = null, next_step_on = null
   where id = p_prospect_id;
  perform set_config('app.prospect_closing', 'off', true);
end;
$$;

revoke all on function public.sales_prospect_lose(uuid, uuid, text) from public, anon;
grant execute on function public.sales_prospect_lose(uuid, uuid, text) to authenticated;
