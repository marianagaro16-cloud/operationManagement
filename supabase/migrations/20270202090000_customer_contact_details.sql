-- Contact, billing and tax details of the customers (2026-10-23), first
-- filled from the bexio contacts export.
--
-- Everyone who sees a customer sees these too — except the external
-- Marketing account, which gets only what it needs: the website, kept on the
-- customer itself. The rest lives in its own table, closed to that account,
-- because the customers table is readable by every approved account.
--
-- The address on the customer stays the DELIVERY address (the van's round
-- uses it); bexio's is often the billing one and is kept apart.

alter table public.customers add column if not exists website text check (length(website) <= 300);

create table public.customer_details (
  customer_id         uuid primary key references public.customers (id) on delete cascade,
  bexio_no            integer unique,
  email               text check (length(email) <= 200),
  email2              text check (length(email2) <= 200),
  phone               text check (length(phone) <= 60),
  phone2              text check (length(phone2) <= 60),
  mobile              text check (length(mobile) <= 60),
  -- The language to write to them in: de, fr, it, en, es.
  language            text check (language in ('de', 'fr', 'it', 'en', 'es')),
  billing_address     text check (length(billing_address) <= 500),
  billing_postal_code text check (length(billing_postal_code) <= 20),
  billing_city        text check (length(billing_city) <= 100),
  billing_country     text check (length(billing_country) <= 2),
  vat_no              text check (length(vat_no) <= 60),
  uid_no              text check (length(uid_no) <= 60),
  bexio_remarks       text check (length(bexio_remarks) <= 4000),
  updated_at          timestamptz not null default now()
);

create trigger customer_details_set_updated_at before update on public.customer_details
  for each row execute function public.set_updated_at();

alter table public.customer_details enable row level security;

create policy "customer_details: read, not for external accounts" on public.customer_details for select to authenticated
  using ((select public.is_approved()) and not (select public.is_external()));
create policy "customer_details: manage writes" on public.customer_details for all to authenticated
  using ((select public.has_permission('customers.manage')))
  with check ((select public.has_permission('customers.manage')));

grant select, insert, update, delete on public.customer_details to authenticated;
