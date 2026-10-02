-- Weekly, biweekly, monthly and semiannual activities were only ever labels:
-- nothing is generated from them, every day of them is placed by hand. They
-- become "según necesidad"; their planned days stay exactly as they are.
-- Daily activities keep their rule: they appear every day by themselves.
update public.tasks
   set frequency = 'as_needed',
       schedule_config = '{"kind": "as_needed"}'::jsonb
 where frequency in ('weekly', 'biweekly', 'monthly', 'semiannual');
