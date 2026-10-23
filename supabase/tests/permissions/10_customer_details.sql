-- ============================================================
-- Customers' contact, billing and tax details (2026-10-23): seen by whoever
-- sees customers, except the external Marketing account; written by whoever
-- manages customers.
-- ============================================================

select pg_temp.person('floor', 'user', 'logistics');
select pg_temp.person('tona', 'user', 'marketing');
select pg_temp.person('power', 'power_user', 'operations');

insert into public.customers (company_name, country) values ('ZZ details AG', 'CH');
insert into public.customer_details (customer_id, email, phone)
values ((select id from public.customers where company_name = 'ZZ details AG'), 'zz@example.invalid', '044 000 00 00');

select pg_temp.sees('the floor sees a customer''s phone', 'floor', $q$select 1 from public.customer_details where email = 'zz@example.invalid'$q$);
select pg_temp.hidden('the external account does not', 'tona', $q$select 1 from public.customer_details where email = 'zz@example.invalid'$q$);
select pg_temp.sees('it still sees the customer', 'tona', $q$select 1 from public.customers where company_name = 'ZZ details AG'$q$);
select pg_temp.cannot('the floor does not change it', 'floor', $q$update public.customer_details set phone = '1' where email = 'zz@example.invalid'$q$);
select pg_temp.can('whoever manages customers does', 'power', $q$update public.customer_details set phone = '044 111 11 11' where email = 'zz@example.invalid'$q$);
