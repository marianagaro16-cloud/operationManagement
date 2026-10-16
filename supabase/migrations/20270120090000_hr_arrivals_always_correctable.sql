-- ============================================================
-- Arrivals: whoever recorded one may correct or delete it at any time,
-- no longer only within 24 hours — mistakes turn up later too.
-- ============================================================

/* Corrected or removed by whoever recorded it. */
create or replace function public.hr_late_editable(p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.hr_late_arrivals a
     where a.id = p_id
       and a.created_by = (select auth.uid())
       and public.hr_can_worker(a.worker_id)
  );
$$;

alter policy "hr_late_arrivals: correct within a day" on public.hr_late_arrivals
  rename to "hr_late_arrivals: recorder corrects";
alter policy "hr_late_arrivals: remove within a day" on public.hr_late_arrivals
  rename to "hr_late_arrivals: recorder removes";
