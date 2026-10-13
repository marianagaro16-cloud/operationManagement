-- ============================================================
-- The schedule: the Fritura goes round (2026-10-13).
--
-- Fritura is made on Mondays, by one person, in turn among the people marked
-- for it: whoever did it longest ago is next, and whoever does not work that
-- day is passed over and stays first in line. A new week comes with the
-- person filled in; the person and the day can be changed, or left empty when
-- there is no Fritura. On the sheet it reads "Fritura: Bruce" on that day's
-- line of "Datos importantes de la semana".
--
-- To start with: Rafael, Marco, Jorge, Gabriel and Bruce.
-- ============================================================

alter table public.schedule_people
  add column in_frying_rotation boolean not null default false;

update public.schedule_people
set in_frying_rotation = true
where is_active and coalesce(label, external_name) in ('Rafael', 'Marco', 'Jorge', 'Gabriel', 'Bruce');

alter table public.schedule_weeks
  add column frying_person uuid references public.schedule_people (id) on delete set null,
  -- 0 = Sunday … 6 = Saturday; Monday unless moved.
  add column frying_day smallint not null default 1 check (frying_day between 0 and 6);

-- ------------------------------------------------------------
-- The weeks there already are: the Fritura was written by hand in Monday's
-- note. It becomes the field — so the turn knows who went — and leaves the
-- note, in the week and in each version kept of it, so it is not read twice.
-- ------------------------------------------------------------

create temporary table frying_so_far (week_start date, person text, note_was text, note_now text);
insert into frying_so_far values
  ('2026-10-04', 'Gabriel', 'Fritura Gabriel. Reunión general 8:00am', 'Reunión general 8:00am'),
  ('2026-10-11', 'Jorge',   'Fritura  Jorge',                           null),
  ('2026-10-18', 'Bruce',   'Fritrura: Bruce',                          null);

update public.schedule_weeks w
set frying_person = p.id,
    day_notes = case
      when w.day_notes ->> '1' is distinct from f.note_was then w.day_notes
      when f.note_now is null then w.day_notes - '1'
      else jsonb_set(w.day_notes, '{1}', to_jsonb(f.note_now))
    end
from frying_so_far f
join public.schedule_people p on coalesce(p.label, p.external_name) = f.person
where w.week_start = f.week_start;

update public.schedule_week_versions v
set snapshot = jsonb_set(
      v.snapshot || jsonb_build_object('frying_person', p.id, 'frying_day', 1),
      '{day_notes}',
      case
        when v.snapshot -> 'day_notes' ->> '1' is distinct from f.note_was then coalesce(v.snapshot -> 'day_notes', '{}'::jsonb)
        when f.note_now is null then (v.snapshot -> 'day_notes') - '1'
        else jsonb_set(v.snapshot -> 'day_notes', '{1}', to_jsonb(f.note_now))
      end
    )
from frying_so_far f
join public.schedule_people p on coalesce(p.label, p.external_name) = f.person
join public.schedule_weeks w on w.week_start = f.week_start
where v.week_id = w.id;

drop table frying_so_far;
