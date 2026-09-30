-- ============================================================
-- Collections (Cobranza): following up unpaid invoices once the invoicing
-- program's three reminders have run out, and handing a customer to a
-- collection agency when that does not work.
--
--   collection_team       who works collections — a list Admin keeps.
--   collection_agencies   Admin's list of agencies.
--   collection_cases      one customer's unpaid invoices, followed up by one
--                         responsible: follow_up → promise → paid |
--                         agency → paid_agency | uncollectible.
--   collection_invoices   the invoices of a case (number, due date, CHF).
--   collection_payments   what came in; the open amount is invoices minus
--                         payments.
--   collection_events     the history: calls, emails, notes, promises,
--                         payments, stage changes, the handover.
--   collection_notices    ledger of the morning follow-up notices.
--
-- Only the team reads or writes any of it. Everyone else learns one thing:
-- that a customer has payments pending (collection_flagged_customers()).
-- ============================================================

create table public.collection_team (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  added_by   uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

-- Daniela and Mariana, to start with.
insert into public.collection_team (profile_id)
select id from public.profiles
 where id in ('59538c6a-4a6f-48d3-bde3-5481d98ccc47', '6249d52a-605a-4caa-a0bf-99cd1b083cf3')
on conflict do nothing;

create or replace function public.is_collections()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.collection_team t
      join public.profiles p on p.id = t.profile_id
     where t.profile_id = (select auth.uid()) and p.status = 'approved' and p.deleted_at is null
  );
$$;

revoke all on function public.is_collections() from public, anon;
grant execute on function public.is_collections() to authenticated;

create table public.collection_agencies (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (length(btrim(name)) > 0),
  sort_order int not null default 100,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger collection_agencies_set_updated_at before update on public.collection_agencies
  for each row execute function public.set_updated_at();

-- ---------- cases ----------

create table public.collection_cases (
  id               uuid primary key default gen_random_uuid(),
  customer_id      uuid not null references public.customers (id) on delete restrict,
  responsible_id   uuid references public.profiles (id) on delete set null,
  stage            text not null default 'follow_up'
                   check (stage in ('follow_up', 'promise', 'paid', 'agency', 'paid_agency', 'uncollectible')),
  -- The day the customer promised to pay: then it is checked.
  promised_on      date,
  -- The next call or email, in the responsible's agenda.
  next_follow_up   date,
  agency_id        uuid references public.collection_agencies (id) on delete restrict,
  agency_sent_on   date,
  agency_reference text,
  note             text,
  closed_at        timestamptz,
  created_by       uuid references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint collection_cases_agency check (stage not in ('agency', 'paid_agency') or (agency_id is not null and agency_sent_on is not null)),
  constraint collection_cases_promise check (stage <> 'promise' or promised_on is not null)
);

create index collection_cases_customer_idx on public.collection_cases (customer_id);
create index collection_cases_open_idx on public.collection_cases (next_follow_up) where closed_at is null;

create trigger collection_cases_set_updated_at before update on public.collection_cases
  for each row execute function public.set_updated_at();

/* A responsible is on the team; a closed stage closes the case. */
create or replace function public.guard_collection_case()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.responsible_id is not null
     and (tg_op = 'INSERT' or new.responsible_id is distinct from old.responsible_id)
     and not exists (select 1 from public.collection_team t where t.profile_id = new.responsible_id) then
    raise exception 'responsible_not_team' using errcode = '22023';
  end if;
  if new.stage in ('paid', 'paid_agency', 'uncollectible') then
    new.closed_at := coalesce(new.closed_at, now());
    new.next_follow_up := null;
  else
    new.closed_at := null;
  end if;
  return new;
end;
$$;

create trigger collection_cases_guard
  before insert or update on public.collection_cases
  for each row execute function public.guard_collection_case();

create table public.collection_invoices (
  id             uuid primary key default gen_random_uuid(),
  case_id        uuid not null references public.collection_cases (id) on delete cascade,
  invoice_number text not null check (length(btrim(invoice_number)) > 0),
  due_date       date,
  amount         numeric(12, 2) not null check (amount > 0),
  created_at     timestamptz not null default now()
);

create index collection_invoices_case_idx on public.collection_invoices (case_id);

create table public.collection_payments (
  id         uuid primary key default gen_random_uuid(),
  case_id    uuid not null references public.collection_cases (id) on delete cascade,
  paid_on    date not null,
  amount     numeric(12, 2) not null check (amount > 0),
  via_agency boolean not null default false,
  note       text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create index collection_payments_case_idx on public.collection_payments (case_id);

create table public.collection_events (
  id          bigserial primary key,
  case_id     uuid not null references public.collection_cases (id) on delete cascade,
  kind        text not null check (kind in ('call', 'email', 'note', 'promise', 'payment', 'stage', 'agency', 'invoice', 'responsible')),
  happened_on date not null default ((now() at time zone 'Europe/Zurich')::date),
  body        text,
  detail      jsonb not null default '{}'::jsonb,
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now()
);

create index collection_events_case_idx on public.collection_events (case_id, created_at);

create table public.collection_notices (
  case_id uuid not null references public.collection_cases (id) on delete cascade,
  on_date date not null,
  kind    text not null,
  sent_at timestamptz not null default now(),
  primary key (case_id, on_date, kind)
);

-- ---------- RLS: the team only ----------

alter table public.collection_team     enable row level security;
alter table public.collection_agencies enable row level security;
alter table public.collection_cases    enable row level security;
alter table public.collection_invoices enable row level security;
alter table public.collection_payments enable row level security;
alter table public.collection_events   enable row level security;
alter table public.collection_notices  enable row level security;

create policy "collection_team: team and admin read" on public.collection_team for select to authenticated
  using ((select public.is_collections()) or (select public.is_admin()));
create policy "collection_team: admin writes" on public.collection_team for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

create policy "collection_agencies: team and admin read" on public.collection_agencies for select to authenticated
  using ((select public.is_collections()) or (select public.is_admin()));
create policy "collection_agencies: admin writes" on public.collection_agencies for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

create policy "collection_cases: team all" on public.collection_cases for all to authenticated
  using ((select public.is_collections())) with check ((select public.is_collections()));
create policy "collection_invoices: team all" on public.collection_invoices for all to authenticated
  using ((select public.is_collections())) with check ((select public.is_collections()));
create policy "collection_payments: team all" on public.collection_payments for all to authenticated
  using ((select public.is_collections())) with check ((select public.is_collections()));
-- The history is only added to.
create policy "collection_events: team read" on public.collection_events for select to authenticated
  using ((select public.is_collections()));
create policy "collection_events: team add" on public.collection_events for insert to authenticated
  with check ((select public.is_collections()) and created_by = (select auth.uid()));

-- ---------- what everyone else may know ----------

/* Customers with a collection case still open: "Pagos pendientes" — nothing more. */
create or replace function public.collection_flagged_customers()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select distinct c.customer_id
    from public.collection_cases c
   where c.closed_at is null and public.is_approved();
$$;

revoke all on function public.collection_flagged_customers() from public, anon;
grant execute on function public.collection_flagged_customers() to authenticated;
