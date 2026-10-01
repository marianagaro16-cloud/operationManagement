-- How a shipment was packed is a question about shipping.
update public.tasks set team = 'logistics'
 where team = 'operations' and title = 'Preguntar sobre como fue empacado';
