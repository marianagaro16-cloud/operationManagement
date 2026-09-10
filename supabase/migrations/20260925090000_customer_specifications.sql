-- ============================================================
-- Customer specifications
--
-- Standing reminders attached to a customer, for the office rather than the
-- floor. The real examples they were built from:
--
--   Los Guapos    send the invoice at month end
--   El Catrin     send the invoice in cc to ...
--   Samigo        send the invoice with every order
--   El Catrin     book transport on Monday
--   Emmi          book transport Tuesday before 12:00
--
-- NOT picking instructions. A plain USER must never see these — they are
-- somebody's own working notes about invoicing and transport, and putting
-- them on the preparation screen would show the whole floor who gets invoiced
-- in cc to whom.
--
-- No capability is minted for them. Reading and writing both take
-- customers.manage, which Manager and Power User hold and a plain user does
-- not — exactly the line asked for, expressed with a key that already means
-- "may look after customer master data".
--
-- DELIBERATELY NOT TASKS. "Book transport on Monday" is recognisably a
-- recurring task, and the Tasks module could carry it. It is recorded here
-- instead because these are things to have in mind while working, not work
-- items to tick off; a task nobody ticks becomes noise, and two records to
-- keep in step is worse than one to read. If one of these later proves it
-- needs to chase somebody, it can become a task then.
-- ============================================================


-- ============================================================
-- the vocabulary
--
-- A TABLE rather than an enum, for the reason this codebase has settled on
-- twice already: a fourth kind is a decision somebody makes on a Tuesday, and
-- Postgres demands TWO migrations to add an enum label — see the note at the
-- head of 20260908090000_roles_enum.
--
-- Descriptions rather than proper nouns, so each row carries a stable slug
-- for the dictionary with `name` as the fallback, exactly as customer_types
-- and incident_categories do.
-- ============================================================
create table public.customer_specification_types (
  id         uuid primary key default gen_random_uuid(),
  slug       text not null unique check (slug ~ '^[a-z][a-z0-9_]*$'),
  name       text not null check (length(btrim(name)) > 0),
  sort_order int  not null default 100,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger customer_specification_types_set_updated_at
  before update on public.customer_specification_types
  for each row execute function public.set_updated_at();

insert into public.customer_specification_types (slug, name, sort_order) values
  ('invoicing', 'Facturación', 10),
  ('transport', 'Transporte',  20),
  ('other',     'Otro',        90);


-- ============================================================
-- the specifications
-- ============================================================
create table public.customer_specifications (
  id          uuid primary key default gen_random_uuid(),

  -- RESTRICT: a customer carrying reminders is deactivated, never deleted,
  -- and the reminders go with them either way.
  customer_id uuid not null references public.customers (id) on delete restrict,
  type_id     uuid not null references public.customer_specification_types (id) on delete restrict,

  -- The reminder itself, in the words whoever wrote it chose. This one field
  -- IS free text on purpose: "send the invoice in cc to X" is a sentence, not
  -- a value to group by. The grouping lives in type_id, where it can be
  -- filtered on.
  body text not null check (length(btrim(body)) > 0),

  /*
   * Retired rather than deleted.
   *
   * A reminder that stops applying is history somebody may want to explain
   * later — "we used to invoice them monthly" is a real answer to a question
   * about an old invoice.
   */
  is_active boolean not null default true,

  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The combined list reads by type then customer; the customer index serves
-- the reverse question, "everything I must remember about El Catrin".
create index customer_specifications_type_idx     on public.customer_specifications (type_id);
create index customer_specifications_customer_idx on public.customer_specifications (customer_id);
create index customer_specifications_active_idx   on public.customer_specifications (is_active)
  where is_active;

create trigger customer_specifications_set_updated_at
  before update on public.customer_specifications
  for each row execute function public.set_updated_at();

comment on table public.customer_specifications is
  'Standing office reminders per customer — invoicing and transport arrangements. Hidden from plain users by design.';


-- ============================================================
-- Row Level Security
--
-- The unusual part, and the whole point: NOT readable by an approved user.
-- Every other reference table in this schema opens at is_approved(); these do
-- not, because the request was explicit that a plain user must not see them.
--
-- Predicates are wrapped in (select ...) so Postgres evaluates them once per
-- query rather than once per row — see
-- 20260923090000_rls_predicates_once_per_query.
-- ============================================================
alter table public.customer_specification_types enable row level security;
alter table public.customer_specifications      enable row level security;

create policy "customer_specification_types: manage read" on public.customer_specification_types
  for select to authenticated
  using (( SELECT public.has_permission('customers.manage')));

create policy "customer_specification_types: manage writes" on public.customer_specification_types
  for all to authenticated
  using (( SELECT public.has_permission('customers.manage')))
  with check (( SELECT public.has_permission('customers.manage')));

create policy "customer_specifications: manage read" on public.customer_specifications
  for select to authenticated
  using (( SELECT public.has_permission('customers.manage')));

create policy "customer_specifications: manage writes" on public.customer_specifications
  for all to authenticated
  using (( SELECT public.has_permission('customers.manage')))
  with check (( SELECT public.has_permission('customers.manage')));
