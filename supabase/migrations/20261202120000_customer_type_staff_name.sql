-- "Personal" rather than "Empleado": a segment, and neutral.
update public.customer_types set name = 'Personal' where slug = 'employee';
