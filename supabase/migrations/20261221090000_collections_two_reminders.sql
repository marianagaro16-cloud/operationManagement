-- ============================================================
-- Two payment reminders, not three (decided 2026-10-02): after the second the
-- case goes to follow-up. Cases recorded with three keep them (the check still
-- allows 3 for that history); the cases already at two reminders move to
-- follow-up now, with their follow-up today.
-- ============================================================

with moved as (
  update public.collection_cases
     set stage = 'follow_up',
         next_follow_up = (now() at time zone 'Europe/Zurich')::date
   where stage = 'reminders' and reminders_sent >= 2
  returning id
)
insert into public.collection_events (case_id, kind, body, detail)
select id, 'stage', 'Dos recordatorios: pasa a seguimiento.', '{"stage": "follow_up", "from": "reminders"}'::jsonb
  from moved;
