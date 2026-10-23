-- Suppliers made complete, and who supplies each product (decided 2026-10-23).
--
--   * A supplier's contact, address, ordering, tax and payment details. How
--     to order (channel, contact, minimum, deadline) already lives in the
--     Guías supplier card (supplier_order_info) and stays there; this adds
--     what it lacks: our customer number with them, order days, delivery
--     time.
--   * Who supplies each product: several suppliers, one of them the main.
--   * Both are for the office only — Owners, Admin, Power User.

-- Owners, Admin and the Power User.
create or replace function public.is_office()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles p
     where p.id = (select auth.uid()) and p.status = 'approved' and p.role in ('owner', 'admin', 'power_user')
  );
$$;
revoke all on function public.is_office() from public, anon;
grant execute on function public.is_office() to authenticated;

create table public.supplier_details (
  supplier_id     uuid primary key references public.suppliers (id) on delete cascade,
  bexio_no        integer unique,
  contact_person  text check (length(contact_person) <= 200),
  email           text check (length(email) <= 200),
  phone           text check (length(phone) <= 60),
  mobile          text check (length(mobile) <= 60),
  website         text check (length(website) <= 300),
  street          text check (length(street) <= 300),
  postal_code     text check (length(postal_code) <= 20),
  city            text check (length(city) <= 100),
  country         text check (length(country) <= 2),
  -- Our customer number in their books.
  our_customer_no text check (length(our_customer_no) <= 60),
  -- ISO weekdays they take orders on: 1 = Monday … 7 = Sunday.
  order_days      smallint[] check (order_days <@ array[1, 2, 3, 4, 5, 6, 7]::smallint[]),
  -- Working days from order to delivery.
  lead_time_days  smallint check (lead_time_days between 0 and 365),
  vat_no          text check (length(vat_no) <= 60),
  uid_no          text check (length(uid_no) <= 60),
  iban            text check (length(iban) <= 40),
  payment_terms   text check (length(payment_terms) <= 200),
  notes           text check (length(notes) <= 4000),
  updated_by      uuid references public.profiles (id),
  updated_at      timestamptz not null default now()
);

create trigger supplier_details_set_updated_at before update on public.supplier_details
  for each row execute function public.set_updated_at();

alter table public.supplier_details enable row level security;
create policy "supplier_details: office" on public.supplier_details for all to authenticated
  using ((select public.is_office())) with check ((select public.is_office()));
grant select, insert, update, delete on public.supplier_details to authenticated;

create table public.product_suppliers (
  product_id    uuid not null references public.products (id) on delete cascade,
  supplier_id   uuid not null references public.suppliers (id) on delete cascade,
  is_main       boolean not null default false,
  -- Their article number for it, when they have one.
  supplier_code text check (length(supplier_code) <= 60),
  created_at    timestamptz not null default now(),
  primary key (product_id, supplier_id)
);
-- One main supplier per product at most.
create unique index product_suppliers_one_main on public.product_suppliers (product_id) where is_main;
create index product_suppliers_supplier_idx on public.product_suppliers (supplier_id);

alter table public.product_suppliers enable row level security;
create policy "product_suppliers: office" on public.product_suppliers for all to authenticated
  using ((select public.is_office())) with check ((select public.is_office()));
grant select, insert, update, delete on public.product_suppliers to authenticated;
