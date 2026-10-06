-- ============================================================
-- Guías (decided 2026-10-06): what a person does day by day, written down
-- for whoever covers them.
--
-- The office manual lived in a Word file. Its daily lists, its rules and its
-- how-tos now live here, tied to the coverage the app already plans:
--
--   guides              one per person who has one: an introduction and a
--                       note per weekday.
--   guide_points        what to do on which weekdays, in order — with an
--                       optional deadline, a how-to article and a supplier.
--                       'rule' points are things to keep in mind, not to tick.
--   guide_checks        the covering person's day: each point done or "not
--                       today", with a comment. Only they tick, only on the
--                       day they cover; the owner never has a checklist.
--   guide_articles      shared how-tos and reference: text, images, tables.
--   supplier_order_info how to order from a supplier: contact, minimum,
--                       deadline. Beside `suppliers`, not on it, because the
--                       supplier list is open to everyone and this is not.
--   guide_notices       ledger of the afternoon reminder and the end-of-day
--                       notice about points left open.
--
-- Who reads: Admin, Owners and Managers (who also write everything), the
-- guide's own person, the absence approvers, and whoever covers that person —
-- on the coverage day and the day before, to read ahead. Articles and
-- supplier cards: anyone who can read a guide.
-- ============================================================

-- ---------- who ----------

/* Writes guides, articles and supplier cards: Admin, Owners and Managers. */
create or replace function public.guide_can_edit()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin()
      or exists (
        select 1 from public.profiles p
         where p.id = (select auth.uid()) and p.status = 'approved' and p.deleted_at is null and p.role = 'manager'
      );
$$;

/* The caller covers this person on that day (any hours of it). */
create or replace function public.guide_covers(p_owner_id uuid, p_date date)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.coverage_assignments c
      join public.absences a on a.id = c.absence_id
     where c.coverer_id = (select auth.uid())
       and a.profile_id = p_owner_id
       and c.removed_at is null
       and a.status = 'approved'
       and c.cover_date = p_date
  );
$$;

/* May the caller read this person's guide? */
create or replace function public.guide_can_see(p_owner_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_approved() and (
    public.guide_can_edit()
    or p_owner_id = (select auth.uid())
    or public.is_absence_approver()
    -- Covering today, or tomorrow: the evening before is when one reads ahead.
    or public.guide_covers(p_owner_id, (now() at time zone 'Europe/Zurich')::date)
    or public.guide_covers(p_owner_id, (now() at time zone 'Europe/Zurich')::date + 1)
  );
$$;

-- ---------- articles ----------

create table public.guide_articles (
  id         uuid primary key default gen_random_uuid(),
  title      text not null check (length(btrim(title)) > 0),
  -- Free grouping: Bexio, Envíos, Proveedores…
  topic      text not null default '',
  -- In order: {type: heading|text|image|table, …}. See src/types/guide.ts.
  blocks     jsonb not null default '[]'::jsonb,
  sort_order int not null default 100,
  removed_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger guide_articles_set_updated_at before update on public.guide_articles
  for each row execute function public.set_updated_at();

-- ---------- guides ----------

create table public.guides (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  intro      text,
  -- A line per weekday, by ISO day: {"1": "6 ½ personas"}.
  day_notes  jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger guides_set_updated_at before update on public.guides
  for each row execute function public.set_updated_at();

create table public.guide_points (
  id          uuid primary key default gen_random_uuid(),
  guide_id    uuid not null references public.guides (profile_id) on delete cascade,
  -- task: something to do, ticked by whoever covers. rule: to keep in mind.
  kind        text not null default 'task' check (kind in ('task', 'rule')),
  -- ISO weekdays, 1 = Monday. A rhythm finer than that stays in the text.
  weekdays    smallint[] not null check (cardinality(weekdays) > 0 and weekdays <@ array[1, 2, 3, 4, 5, 6, 7]::smallint[]),
  title       text not null check (length(btrim(title)) > 0),
  body        text,
  deadline    time,
  article_id  uuid references public.guide_articles (id) on delete set null,
  supplier_id uuid references public.suppliers (id) on delete set null,
  sort_order  int not null default 100,
  -- Removed points stay, so the days already ticked keep their words.
  removed_at  timestamptz,
  created_by  uuid references public.profiles (id) on delete set null,
  updated_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index guide_points_guide_idx on public.guide_points (guide_id, sort_order) where removed_at is null;

create trigger guide_points_set_updated_at before update on public.guide_points
  for each row execute function public.set_updated_at();

-- ---------- the covering person's day ----------

create table public.guide_checks (
  point_id   uuid not null references public.guide_points (id) on delete cascade,
  check_date date not null,
  -- skipped: it does not apply today ("only the last Thursday of the month").
  status     text not null check (status in ('done', 'skipped')),
  comment    text,
  checked_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (point_id, check_date)
);

create index guide_checks_date_idx on public.guide_checks (check_date);

-- ---------- how to order from a supplier ----------

create table public.supplier_order_info (
  supplier_id uuid primary key references public.suppliers (id) on delete cascade,
  how         text,
  contact     text,
  minimum     text,
  deadline    text,
  notes       text,
  updated_by  uuid references public.profiles (id) on delete set null,
  updated_at  timestamptz not null default now()
);

create trigger supplier_order_info_set_updated_at before update on public.supplier_order_info
  for each row execute function public.set_updated_at();

-- ---------- notices ----------

create table public.guide_notices (
  guide_id    uuid not null references public.guides (profile_id) on delete cascade,
  notice_date date not null,
  -- remind: to whoever covers, in the afternoon. summary: to the approvers, at the end of the day.
  kind        text not null check (kind in ('remind', 'summary')),
  sent_at     timestamptz not null default now(),
  primary key (guide_id, notice_date, kind)
);

-- ---------- RLS ----------

/* Reads articles and supplier cards: whoever can read some guide. */
create or replace function public.guide_reader()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.guide_can_edit()
      or exists (select 1 from public.guides g where public.guide_can_see(g.profile_id));
$$;

alter table public.guides              enable row level security;
alter table public.guide_points        enable row level security;
alter table public.guide_checks        enable row level security;
alter table public.guide_articles      enable row level security;
alter table public.supplier_order_info enable row level security;
-- Written and read only by the notifier (service role).
alter table public.guide_notices       enable row level security;

create policy "guides: read" on public.guides for select to authenticated
  using (public.guide_can_see(profile_id));
create policy "guides: editors write" on public.guides for all to authenticated
  using ((select public.guide_can_edit())) with check ((select public.guide_can_edit()));

create policy "guide_points: read" on public.guide_points for select to authenticated
  using (public.guide_can_see(guide_id));
create policy "guide_points: editors write" on public.guide_points for all to authenticated
  using ((select public.guide_can_edit())) with check ((select public.guide_can_edit()));

-- Ticked through guide_check() only.
create policy "guide_checks: read" on public.guide_checks for select to authenticated
  using (exists (select 1 from public.guide_points p where p.id = point_id and public.guide_can_see(p.guide_id)));

create policy "guide_articles: read" on public.guide_articles for select to authenticated
  using ((select public.guide_reader()));
create policy "guide_articles: editors write" on public.guide_articles for all to authenticated
  using ((select public.guide_can_edit())) with check ((select public.guide_can_edit()));

create policy "supplier_order_info: read" on public.supplier_order_info for select to authenticated
  using ((select public.guide_reader()));
create policy "supplier_order_info: editors write" on public.supplier_order_info for all to authenticated
  using ((select public.guide_can_edit())) with check ((select public.guide_can_edit()));

-- ---------- ticking a point ----------

/*
 * By whoever covers the guide's person today, for today. done, skipped ("not
 * today"), or NULL to clear it again. Editors and the owner do not tick: the
 * list is the covering person's.
 */
create or replace function public.guide_check(p_point_id uuid, p_status text, p_comment text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := (select auth.uid());
  v_today date := (now() at time zone 'Europe/Zurich')::date;
  v_point public.guide_points;
begin
  select * into v_point from public.guide_points p where p.id = p_point_id and p.removed_at is null;
  if not found or v_uid is null or not public.guide_covers(v_point.guide_id, v_today) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if v_point.kind <> 'task' or not (extract(isodow from v_today)::smallint = any (v_point.weekdays)) then
    raise exception 'not_today';
  end if;

  if p_status is null then
    delete from public.guide_checks where point_id = p_point_id and check_date = v_today;
    return;
  end if;
  if p_status not in ('done', 'skipped') then raise exception 'invalid_status'; end if;

  insert into public.guide_checks (point_id, check_date, status, comment, checked_by)
  values (p_point_id, v_today, p_status, nullif(btrim(coalesce(p_comment, '')), ''), v_uid)
  on conflict (point_id, check_date) do update
    set status = excluded.status, comment = excluded.comment, checked_by = excluded.checked_by, updated_at = now();
end;
$$;

-- ---------- what the caller may open ----------

/* One round trip for the menu and the page: may they edit, and whose guides they see. */
create or replace function public.guide_access()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'edit', public.guide_can_edit(),
    'guides', coalesce((
      select jsonb_agg(jsonb_build_object(
               'profile_id', g.profile_id,
               'name', coalesce(nullif(btrim(p.name), ''), p.email),
               'covering_today', public.guide_covers(g.profile_id, (now() at time zone 'Europe/Zurich')::date)
             ) order by coalesce(nullif(btrim(p.name), ''), p.email))
        from public.guides g
        join public.profiles p on p.id = g.profile_id
       where public.guide_can_see(g.profile_id)
    ), '[]'::jsonb)
  );
$$;

-- ---------- images of the articles ----------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('guide-files', 'guide-files', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
on conflict (id) do nothing;

create policy "guide files: read" on storage.objects
  for select to authenticated
  using (bucket_id = 'guide-files' and public.guide_reader());
create policy "guide files: editors upload" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'guide-files' and public.guide_can_edit());
create policy "guide files: editors remove" on storage.objects
  for delete to authenticated
  using (bucket_id = 'guide-files' and public.guide_can_edit());

revoke all on function public.guide_can_edit() from public, anon;
revoke all on function public.guide_covers(uuid, date) from public, anon;
revoke all on function public.guide_can_see(uuid) from public, anon;
revoke all on function public.guide_reader() from public, anon;
revoke all on function public.guide_check(uuid, text, text) from public, anon;
revoke all on function public.guide_access() from public, anon;
grant execute on function public.guide_can_edit() to authenticated;
grant execute on function public.guide_covers(uuid, date) to authenticated;
grant execute on function public.guide_can_see(uuid) to authenticated;
grant execute on function public.guide_reader() to authenticated;
grant execute on function public.guide_check(uuid, text, text) to authenticated;
grant execute on function public.guide_access() to authenticated;
