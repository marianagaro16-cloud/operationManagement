-- ============================================================
-- Production plans (2026-10-23): the "Plan de Producción" Excel sheet, in
-- the app. One plan per day and line (Bio / Blue / Tortillas para freír):
-- customer rows × the line's products, a reserve, and what follows from the
-- totals (masa, flour, water, salt, grain, sacks, lot, best-before).
--
-- Who:
--   makes and edits  production_plans.manage — Admin and Owners (is_admin),
--                    and whoever is given it with a coverage period (Carlos
--                    while he covers Mariana). No role holds it by default.
--   reads            the Production manager, every plan; Production's plain
--                    users, the plan of today only.
-- ============================================================

insert into public.permission_catalog (key, module, is_configurable, sort_order) values
  ('production_plans.manage', 'production', true, 60)
on conflict (key) do nothing;

create or replace function public.can_plan_production()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_permission('production_plans.manage');
$$;
revoke all on function public.can_plan_production() from public, anon;
grant execute on function public.can_plan_production() to authenticated;

/* Reads a plan of this day: planners and the Production manager any; Production's users today's. */
create or replace function public.can_read_production_plan(p_plan_date date)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.can_plan_production()
      or exists (
        select 1 from public.profiles p
         where p.id = (select auth.uid()) and p.status = 'approved'
           and (p.role = 'production_manager'
                or (p.role = 'user' and 'production' = any (public.my_teams())
                    and p_plan_date = (now() at time zone 'Europe/Zurich')::date))
      );
$$;
revoke all on function public.can_read_production_plan(date) from public, anon;
grant execute on function public.can_read_production_plan(date) to authenticated;

-- ---------- lines and their settings ----------
--
-- The factors are the Excel's, per line, and editable:
--   masa pura   = tortilla kg × pure_share × (1 + waste) + masa kg
--   grain kg    = masa pura ÷ masa_per_grain_kg;  sacks = ⌈grain ÷ sack_kg⌉
--   mixed masa  (only when flour_factor is set) = tortilla kg × (1 + evaporation),
--               flour/water/salt = mixed × their factor
--   tortillas for totopos = totopo/tostada kg × totopo_factor (information)

create table public.production_lines (
  id                uuid primary key default gen_random_uuid(),
  slug              text not null unique,
  name              text not null check (length(btrim(name)) > 0),
  machine           text,
  sort_order        int not null default 100,
  is_active         boolean not null default true,
  pure_share        numeric(6, 4) not null default 1 check (pure_share > 0 and pure_share <= 1),
  waste             numeric(6, 4) not null default 0.25 check (waste >= 0 and waste < 2),
  masa_per_grain_kg numeric(6, 4) not null default 1.6 check (masa_per_grain_kg > 0),
  sack_kg           numeric(6, 2) not null default 22.68 check (sack_kg > 0),
  totopo_factor     numeric(6, 4) not null default 1.5 check (totopo_factor > 0),
  evaporation       numeric(6, 4) check (evaporation >= 0),
  flour_factor      numeric(6, 4) check (flour_factor >= 0),
  water_factor      numeric(6, 4) check (water_factor >= 0),
  salt_factor       numeric(8, 5) check (salt_factor >= 0),
  -- Printed under every plan of the line ("Usar sobre absorbente…").
  standing_notes    text check (length(standing_notes) <= 2000),
  updated_at        timestamptz not null default now()
);

create type public.production_plan_section as enum ('tortilla', 'masa', 'totopo', 'tostada');

create table public.production_line_products (
  line_id          uuid not null references public.production_lines (id) on delete cascade,
  product_id       uuid not null references public.products (id) on delete cascade,
  section          public.production_plan_section not null,
  -- The column heading it sits under: "Tortillas (14cm)", "Masa", "Totopos azules"…
  group_label      text not null check (length(btrim(group_label)) > 0),
  best_before_days int check (best_before_days between 0 and 1000),
  sort_order       int not null default 100,
  primary key (line_id, product_id)
);

-- ---------- plans ----------

create table public.production_plans (
  id         uuid primary key default gen_random_uuid(),
  line_id    uuid not null references public.production_lines (id) on delete restrict,
  plan_date  date not null,
  notes      text check (length(notes) <= 4000),
  -- [{ "corn": "Organic White Corn", "lot": "0518264EOWC" }]
  corn_lots  jsonb not null default '[]'::jsonb check (jsonb_typeof(corn_lots) = 'array'),
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (line_id, plan_date)
);
create index production_plans_date_idx on public.production_plans (plan_date);

create table public.production_plan_rows (
  id            uuid primary key default gen_random_uuid(),
  plan_id       uuid not null references public.production_plans (id) on delete cascade,
  customer_id   uuid references public.customers (id) on delete set null,
  -- A customer typed by hand, or what the row is ("Prueba nueva bolsa").
  label         text check (length(label) <= 200),
  is_reserve    boolean not null default false,
  delivery_date date,
  -- "jeff", "dhl", "10am"…
  delivery_note text check (length(delivery_note) <= 100),
  -- The orders it came from, so bringing orders in again adds only new ones.
  order_ids     uuid[] not null default '{}',
  sort_order    int not null default 100,
  check (customer_id is not null or label is not null or is_reserve)
);
create index production_plan_rows_plan_idx on public.production_plan_rows (plan_id, sort_order);
create unique index production_plan_rows_one_reserve on public.production_plan_rows (plan_id) where is_reserve;

create table public.production_plan_quantities (
  row_id     uuid not null references public.production_plan_rows (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete restrict,
  quantity   numeric(10, 2) not null check (quantity > 0),
  primary key (row_id, product_id)
);

-- ---------- access ----------

alter table public.production_lines enable row level security;
alter table public.production_line_products enable row level security;
alter table public.production_plans enable row level security;
alter table public.production_plan_rows enable row level security;
alter table public.production_plan_quantities enable row level security;

-- Lines and their products: whoever can read some plan reads them; planners change them.
create policy "production_lines: read" on public.production_lines for select to authenticated
  using ((select public.can_read_production_plan((now() at time zone 'Europe/Zurich')::date)));
create policy "production_lines: plan" on public.production_lines for all to authenticated
  using ((select public.can_plan_production())) with check ((select public.can_plan_production()));
create policy "production_line_products: read" on public.production_line_products for select to authenticated
  using ((select public.can_read_production_plan((now() at time zone 'Europe/Zurich')::date)));
create policy "production_line_products: plan" on public.production_line_products for all to authenticated
  using ((select public.can_plan_production())) with check ((select public.can_plan_production()));

create policy "production_plans: read" on public.production_plans for select to authenticated
  using (public.can_read_production_plan(plan_date));
create policy "production_plans: plan" on public.production_plans for all to authenticated
  using ((select public.can_plan_production())) with check ((select public.can_plan_production()));

create policy "production_plan_rows: read" on public.production_plan_rows for select to authenticated
  using (exists (select 1 from public.production_plans pl where pl.id = plan_id and public.can_read_production_plan(pl.plan_date)));
create policy "production_plan_rows: plan" on public.production_plan_rows for all to authenticated
  using ((select public.can_plan_production())) with check ((select public.can_plan_production()));

create policy "production_plan_quantities: read" on public.production_plan_quantities for select to authenticated
  using (exists (select 1 from public.production_plan_rows r join public.production_plans pl on pl.id = r.plan_id
                  where r.id = row_id and public.can_read_production_plan(pl.plan_date)));
create policy "production_plan_quantities: plan" on public.production_plan_quantities for all to authenticated
  using ((select public.can_plan_production())) with check ((select public.can_plan_production()));

grant select, insert, update, delete on public.production_lines, public.production_line_products,
  public.production_plans, public.production_plan_rows, public.production_plan_quantities to authenticated;

-- ---------- the three lines, with the Excel's factors ----------

insert into public.production_lines
  (slug, name, machine, sort_order, pure_share, waste, masa_per_grain_kg, sack_kg, totopo_factor, evaporation, flour_factor, water_factor, salt_factor, standing_notes)
values
  -- Bio: masa pura = tortillas × 1.25 + masa; 41 kg masa per 22.68 kg sack.
  ('bio', 'Bio', 'ULMA', 10, 1, 0.25, 1.8078, 22.68, 1.5, null, null, null, null,
   E'Usar sobre absorbente para todas las tortillas con gas.\nGuardar en cartón, nombre del cliente.\nCaja doble, nombre del cliente.'),
  -- Blue: masa pura = tortillas × (1 + 0.084 × 3); grain = masa ÷ 1.6.
  ('blue', 'Blue', 'ERME', 20, 1, 0.252, 1.6, 22.68, 1.5, null, null, null, null,
   E'Usar sobre absorbente en todo lo empacado con gas.\nGuardar en cartón, nombre del cliente.'),
  -- Tortillas para freír: half masa pura (× 1.252), half mixed with flour; grain = masa ÷ 1.7.
  ('chip', 'Tortillas para freír', null, 30, 0.5, 0.252, 1.7, 22.71, 1.3, 0.168, 0.24, 0.29, 0.0015,
   E'Masa fina y sellar con cinta blanca.\nGuardar en cartón, nombre del cliente.\nCaja con burbuja, nombre del cliente.\nCaja doble, nombre del cliente.');

-- ---------- each line's products, from the Excel columns (by product code) ----------

create temporary table seed_line_products (line text, code text, section public.production_plan_section, grp text, days int, ord int) on commit drop;
insert into seed_line_products values
  -- Bio
  ('bio', '0004', 'tortilla', 'Tortillas (14cm)', 100, 10),
  ('bio', '0001', 'tortilla', 'Tortillas (14cm)', 100, 11),
  ('bio', '0036', 'tortilla', 'Tortillas (14cm)', 100, 12),
  ('bio', '0002', 'tortilla', 'Tortillas (14cm)', 100, 13),
  ('bio', '0051', 'tortilla', 'Tortillas (14cm)', 45, 14),
  ('bio', '0013', 'tortilla', 'Tortillas (12cm)', 100, 20),
  ('bio', '0015', 'tortilla', 'Tortillas (12cm)', 100, 21),
  ('bio', '0046', 'tortilla', 'Tortillas (12cm)', 45, 22),
  ('bio', '0008', 'tortilla', 'Tortillas (10cm)', 100, 30),
  ('bio', '0093', 'tortilla', 'Tortillas (10cm)', 45, 31),
  ('bio', '0107', 'tortilla', 'Tortillas (19cm)', 100, 40),
  ('bio', '0039', 'tortilla', 'Tortillas (19cm)', 45, 41),
  ('bio', '0057', 'tortilla', 'Huarache', 100, 50),
  ('bio', '0059', 'tortilla', 'Huarache', 45, 51),
  ('bio', '0214', 'tortilla', 'Huarache', 100, 52),
  ('bio', '0096', 'tortilla', 'Huarache', 100, 53),
  ('bio', '0009', 'tortilla', 'Corazón', 100, 60),
  ('bio', '0138', 'tortilla', 'Corazón', 45, 61),
  ('bio', '0005', 'masa', 'Masa', 30, 70),
  ('bio', '0193', 'masa', 'Masa', 30, 71),
  -- Blue
  ('blue', '0033', 'tortilla', 'Tortillas azules (14cm)', 30, 10),
  ('blue', '0026', 'tortilla', 'Tortillas azules (14cm)', 30, 11),
  ('blue', '0028', 'tortilla', 'Tortillas azules (14cm)', 30, 12),
  ('blue', '0034', 'tortilla', 'Tortillas azules (12cm)', 30, 20),
  ('blue', '0029', 'tortilla', 'Tortillas azules (12cm)', 30, 21),
  ('blue', '0031', 'tortilla', 'Tortillas azules (10cm)', 30, 30),
  ('blue', '0032', 'tortilla', 'Tortillas azules (10cm)', 30, 31),
  ('blue', '0359', 'tortilla', 'Tortillas azules para freír', 30, 40),
  ('blue', '0055', 'tortilla', 'Tortillas azules para freír', 30, 41),
  ('blue', '0186', 'tortilla', 'Tortillas azules para freír', 30, 42),
  ('blue', '0192', 'tortilla', 'Tortillas azules para freír', 30, 43),
  ('blue', '0044', 'tortilla', 'Tlayuda azul (19cm)', 30, 50),
  ('blue', '0017', 'masa', 'Masa azul', 7, 60),
  ('blue', '0190', 'masa', 'Masa azul', 7, 61),
  -- Tortillas para freír
  ('chip', '0066', 'tortilla', 'Tortillas para freír (14cm)', 45, 10),
  ('chip', '0003', 'tortilla', 'Tortillas para freír (14cm)', 30, 11),
  ('chip', '0075', 'tortilla', 'Tortillas para freír (14cm)', 30, 12),
  ('chip', '0320', 'tortilla', 'Tortillas para freír (19cm)', 45, 20),
  ('chip', '0108', 'tortilla', 'Tortillas para freír (12cm)', 45, 30),
  ('chip', '0099', 'tortilla', 'Tortillas para freír (12cm)', 30, 31),
  ('chip', '0124', 'tortilla', 'Tortillas para freír (10cm)', 45, 40),
  ('chip', '0121', 'tortilla', 'Tortillas para freír (10cm)', 30, 41),
  ('chip', '0144', 'tortilla', 'Tortillas para freír (06cm)', 45, 50),
  ('chip', '0006', 'totopo', 'Totopos amarillos', 60, 100),
  ('chip', '0010', 'totopo', 'Totopos amarillos', 60, 101),
  ('chip', '0216', 'totopo', 'Totopos amarillos', 80, 102),
  ('chip', '0217', 'totopo', 'Totopos amarillos', 80, 103),
  ('chip', '0041', 'totopo', 'Totopos amarillos', 80, 104),
  ('chip', '0111', 'totopo', 'Totopos amarillos', 35, 105),
  ('chip', '0022', 'totopo', 'Totopos amarillos', 35, 106),
  ('chip', '0104', 'totopo', 'Totopos amarillos', 35, 107),
  ('chip', '0218', 'totopo', 'Totopos azules', 80, 110),
  ('chip', '2019', 'totopo', 'Totopos azules', 80, 111),
  ('chip', '0042', 'totopo', 'Totopos azules', 60, 112),
  ('chip', '0050', 'totopo', 'Totopos azules', 60, 113),
  ('chip', '0114', 'totopo', 'Totopos azules', 35, 114),
  ('chip', '0079', 'totopo', 'Totopos azules', 35, 115),
  ('chip', '0196', 'totopo', 'Totopos mix', 60, 120),
  ('chip', '0109', 'totopo', 'Totopos mix', 35, 121),
  ('chip', '0086', 'totopo', 'Totopos mix', 35, 122),
  ('chip', '0197', 'totopo', 'Totopos mix', 35, 123),
  ('chip', '0027', 'tostada', 'Tostadas amarillas', 45, 130),
  ('chip', '0126', 'tostada', 'Tostadas amarillas', 45, 131),
  ('chip', '0127', 'tostada', 'Tostadas amarillas', 45, 132),
  ('chip', '0118', 'tostada', 'Tostadas amarillas', 45, 133),
  ('chip', '0074', 'tostada', 'Tostadas amarillas', 45, 134),
  ('chip', '0019', 'tostada', 'Tostadas amarillas', 45, 135),
  ('chip', '0153', 'tostada', 'Tostadas amarillas', 45, 136),
  ('chip', '0011', 'tostada', 'Tostadas amarillas', 45, 137),
  ('chip', '0030', 'tostada', 'Tostadas azules', 45, 140),
  ('chip', '0077', 'tostada', 'Tostadas azules', 45, 141),
  ('chip', '0195', 'tostada', 'Tostadas azules', 45, 142),
  ('chip', '0088', 'tostada', 'Tostadas azules', 45, 143),
  ('chip', '0005', 'masa', 'Masa', 30, 150),
  ('chip', '0193', 'masa', 'Masa', 30, 151);

insert into public.production_line_products (line_id, product_id, section, group_label, best_before_days, sort_order)
select l.id, p.id, s.section, s.grp, s.days, s.ord
  from seed_line_products s
  join public.production_lines l on l.slug = s.line
  join public.products p on p.code = s.code and p.is_active;
