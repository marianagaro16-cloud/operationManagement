-- ============================================================
-- Event material: a "pack by" day (decided 2026-10-27).
--
-- The material had only the day before the event to be packed, too late
-- for a Saturday fair whose material must be ready on the Thursday.
--
--   event_kinds.material_pack_days   the kind's default: so many days before
--                                    the start. Admin's, like its standard
--                                    tasks; empty = no default.
--   events.material_pack_by          the event's own day, filled from the
--                                    kind when it is created, changed by
--                                    whoever edits the event. Empty = the
--                                    old rule: the day before.
--
-- On that day each bringer has "pack material" in Inicio and Agenda and a
-- morning push; that evening the responsible person hears what is still not
-- packed and who brings it — instead of the day-before warning.
-- ============================================================

alter table public.event_kinds
  add column material_pack_days int check (material_pack_days is null or material_pack_days between 0 and 60);

alter table public.events
  add column material_pack_by date,
  add constraint events_material_pack_by_before_start check (material_pack_by is null or material_pack_by <= start_date);

/* A new event takes its kind's default; an event that moves takes its pack-by day along. */
create or replace function public.event_material_pack_by()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_days int;
begin
  if tg_op = 'INSERT' then
    if new.material_pack_by is null then
      select k.material_pack_days into v_days from public.event_kinds k where k.id = new.kind_id;
      if v_days is not null then new.material_pack_by := new.start_date - v_days; end if;
    end if;
  elsif new.start_date <> old.start_date
        and new.material_pack_by is not distinct from old.material_pack_by
        and old.material_pack_by is not null then
    new.material_pack_by := old.material_pack_by + (new.start_date - old.start_date);
  end if;
  return new;
end;
$$;

create trigger events_material_pack_by before insert or update of start_date on public.events
  for each row execute function public.event_material_pack_by();

-- Once per bringer and event: the morning push of the pack-by day.
create table public.event_material_pack_notices (
  event_id   uuid not null references public.events (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  sent_at    timestamptz not null default now(),
  primary key (event_id, profile_id)
);
-- Written and read only by the notifier (service role).
alter table public.event_material_pack_notices enable row level security;

-- ---------- what the bringer sees ----------

/* The brief carries the pack-by day: the assignee's event card shows it. */
create or replace function public.event_brief(e public.events)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', e.id, 'name', e.name, 'stage', e.stage,
    'start_date', e.start_date, 'end_date', e.end_date,
    'open_time', e.open_time, 'close_time', e.close_time,
    'place_name', e.place_name, 'street', e.street, 'postal_code', e.postal_code, 'city', e.city,
    'material_pack_by', e.material_pack_by
  );
$$;

/*
 * As before, but the material sits on its pack-by day (the start when there
 * is none), and material not all packed after that day comes along until the
 * event starts, as an open task does.
 */
create or replace function public.my_event_work(p_from date, p_to date)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'shifts', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', s.id, 'date', s.shift_date, 'start', s.start_time, 'end', s.end_time,
               'event', public.event_brief(e)) order by s.shift_date, s.start_time)
        from public.event_shifts s
        join public.events e on e.id = s.event_id
       where s.profile_id = (select auth.uid())
         and e.stage in ('confirmed', 'done')
         and s.shift_date between p_from and p_to
    ), '[]'::jsonb),
    'materials', coalesce((
      select jsonb_agg(jsonb_build_object(
               'event', public.event_brief(e),
               'date', coalesce(e.material_pack_by, e.start_date),
               'total', m.total, 'packed', m.packed) order by e.start_date)
        from public.events e
        join lateral (
          select count(*) as total, count(*) filter (where x.packed) as packed
            from public.event_materials x
           where x.event_id = e.id and x.bringer_profile = (select auth.uid())
        ) m on m.total > 0
       where e.stage in ('confirmed', 'done')
         and coalesce(e.material_pack_by, e.start_date) <= p_to
         and (coalesce(e.material_pack_by, e.start_date) >= p_from
              or (m.packed < m.total and e.start_date >= p_from))
    ), '[]'::jsonb),
    'tasks', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', a.id, 'title', a.title, 'date', a.activity_date, 'status', a.status,
               'event', public.event_brief(e)) order by a.activity_date)
        from public.sales_activities a
        join public.events e on e.id = a.event_id
       where a.salesperson_id = (select auth.uid())
         and e.stage <> 'cancelled'
         and a.activity_date <= p_to
         and (a.activity_date >= p_from or a.status = 'planned')
    ), '[]'::jsonb)
  )
  where public.is_approved();
$$;

revoke all on function public.event_material_pack_by() from public, anon, authenticated;
