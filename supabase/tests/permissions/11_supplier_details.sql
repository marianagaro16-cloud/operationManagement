-- ============================================================
-- Supplier details and who supplies each product (2026-10-23): the office
-- only — Owners, Admin, Power User. Not the receivers, not the Production
-- manager, not the external account.
-- ============================================================

select pg_temp.person('power', 'power_user', 'operations');
select pg_temp.person('boss', 'admin', 'operations');
select pg_temp.person('receiver', 'user', 'logistics');
select pg_temp.person('pm', 'production_manager', 'production');
select pg_temp.person('tona', 'user', 'marketing');

insert into public.suppliers (name) values ('ZZ supplier');
insert into public.supplier_details (supplier_id, email, iban)
values ((select id from public.suppliers where name = 'ZZ supplier'), 'zz@example.invalid', 'CH00 0000');
insert into public.product_suppliers (product_id, supplier_id, is_main)
values ((select id from public.products where is_active order by name limit 1), (select id from public.suppliers where name = 'ZZ supplier'), true);

select pg_temp.sees('the Power User sees a supplier''s details', 'power', $q$select 1 from public.supplier_details where email = 'zz@example.invalid'$q$);
select pg_temp.sees('Admin does', 'boss', $q$select 1 from public.supplier_details where email = 'zz@example.invalid'$q$);
select pg_temp.hidden('a receiver does not', 'receiver', $q$select 1 from public.supplier_details where email = 'zz@example.invalid'$q$);
select pg_temp.hidden('the Production manager does not', 'pm', $q$select 1 from public.supplier_details where email = 'zz@example.invalid'$q$);
select pg_temp.hidden('the external account does not', 'tona', $q$select 1 from public.supplier_details where email = 'zz@example.invalid'$q$);
select pg_temp.can('the Power User edits them', 'power', $q$update public.supplier_details set phone = '044' where email = 'zz@example.invalid'$q$);
select pg_temp.cannot('a receiver cannot', 'receiver', $q$update public.supplier_details set phone = '1' where email = 'zz@example.invalid'$q$);

select pg_temp.sees('the office sees who supplies a product', 'power', $q$select 1 from public.product_suppliers ps join public.suppliers s on s.id = ps.supplier_id where s.name = 'ZZ supplier'$q$);
select pg_temp.hidden('a receiver does not', 'receiver', $q$select 1 from public.product_suppliers ps join public.suppliers s on s.id = ps.supplier_id where s.name = 'ZZ supplier'$q$);
select pg_temp.cannot('two main suppliers for one product are refused', 'boss',
  $q$insert into public.product_suppliers (product_id, supplier_id, is_main)
     select ps.product_id, (select id from public.suppliers where name <> 'ZZ supplier' order by name limit 1), true
       from public.product_suppliers ps join public.suppliers s on s.id = ps.supplier_id where s.name = 'ZZ supplier'$q$);
select pg_temp.can('an alternative supplier is fine', 'boss',
  $q$insert into public.product_suppliers (product_id, supplier_id, is_main)
     select ps.product_id, (select id from public.suppliers where name <> 'ZZ supplier' order by name limit 1), false
       from public.product_suppliers ps join public.suppliers s on s.id = ps.supplier_id where s.name = 'ZZ supplier'$q$);

-- Raw materials and packaging: inventory items, same rules.
insert into public.inventory_item_suppliers (item_id, supplier_id, is_main)
values ((select i.id from public.inventory_template_items i join public.inventory_templates t on t.id = i.template_id where t.slug = 'materia-prima' order by i.sort_order limit 1),
        (select id from public.suppliers where name = 'ZZ supplier'), true);
select pg_temp.sees('the office sees who supplies a raw material', 'power', $q$select 1 from public.inventory_item_suppliers ps join public.suppliers s on s.id = ps.supplier_id where s.name = 'ZZ supplier'$q$);
select pg_temp.hidden('a receiver does not', 'receiver', $q$select 1 from public.inventory_item_suppliers ps join public.suppliers s on s.id = ps.supplier_id where s.name = 'ZZ supplier'$q$);
select pg_temp.hidden('the Production manager does not', 'pm', $q$select 1 from public.inventory_item_suppliers ps join public.suppliers s on s.id = ps.supplier_id where s.name = 'ZZ supplier'$q$);
select pg_temp.cannot('a receiver cannot add one', 'receiver',
  $q$insert into public.inventory_item_suppliers (item_id, supplier_id) select item_id, (select id from public.suppliers where name <> 'ZZ supplier' order by name limit 1) from public.inventory_item_suppliers limit 1$q$);
select pg_temp.cannot('two main suppliers for one item are refused', 'boss',
  $q$insert into public.inventory_item_suppliers (item_id, supplier_id, is_main)
     select ps.item_id, (select id from public.suppliers where name <> 'ZZ supplier' order by name limit 1), true
       from public.inventory_item_suppliers ps join public.suppliers s on s.id = ps.supplier_id where s.name = 'ZZ supplier'$q$);
