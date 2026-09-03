-- ============================================================
-- Daily tasks run Monday to Friday only.
--
-- The warehouse does not operate at weekends, so a daily task generating a
-- Saturday and Sunday requirement produced work nobody could do — and it
-- then showed up as overdue on Monday, which is worse than not scheduling
-- it at all.
--
-- The recurrence engine already supports a weekday restriction; the seed
-- simply used the unrestricted default.
-- ============================================================

update public.tasks
   set schedule_config = jsonb_build_object(
         'kind', 'daily',
         'weekdays', jsonb_build_array(1, 2, 3, 4, 5)   -- ISO: Mon..Fri
       )
 where frequency = 'daily'
   and (
     schedule_config is null
     or schedule_config->>'kind' = 'daily'
   )
   -- Leave alone any task an admin has already restricted deliberately.
   and schedule_config->'weekdays' is null;

-- Remove weekend requirements that were already materialised.
--
-- Only PENDING ones. A weekend occurrence that was actually completed or
-- skipped is operational history and is never deleted, even though the rule
-- that created it has changed.
delete from public.task_occurrences o
 using public.tasks t
 where o.task_id = t.id
   and t.frequency = 'daily'
   and o.status = 'pending'
   and extract(isodow from o.due_date) in (6, 7);
