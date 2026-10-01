-- Jefferson works orders and shipping. He keeps doing the warehouse work as
-- well: a person sees the activities assigned to them, whatever their team.
update public.profiles set team = 'logistics' where id = 'ae76299a-64ed-4f0b-a07a-88bb65f8f18d';

-- The activities that are about shipping, delivering and pickups.
update public.tasks set team = 'logistics'
 where team = 'operations'
   and title in (
     'Preparar Oxybaby en una caja con protección Eddy me quedo de confirmar dirección de envio.',
     'llevar base de metal a taqueria de badenstrasse',
     'Máquina Erme – Preparar para recogida',
     'Recolección - Máquina ERME - 9:00am'
   );
