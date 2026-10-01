-- Orders prepared for our own employees: their customers carry this segment.
insert into public.customer_types (slug, name, sort_order) values ('employee', 'Empleado', 40)
on conflict (slug) do nothing;
