-- ============================================================
-- Incidents belong to the area of their cause (decided 2026-10-02): a
-- production cause → Producción; any other cause → Logística (orders,
-- preparation, transport, delivery…). Without a cause yet, it follows who
-- reports it, Operaciones' people filing to Logística.
-- ============================================================

create or replace function public.incident_team_from_cause()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.primary_cause is not null then
    new.team := case when new.primary_cause = 'production' then 'production' else 'logistics' end;
  elsif tg_op = 'INSERT' then
    new.team := case
      when coalesce(new.team, (select p.team from public.profiles p where p.id = coalesce(new.created_by, (select auth.uid())))) = 'production'
        then 'production'::public.team
      else 'logistics'::public.team
    end;
  end if;
  return new;
end;
$$;

-- Before the default-team trigger fills a missing team, this decides it.
drop trigger if exists incidents_default_team on public.incidents;
create trigger incidents_team_from_cause
  before insert or update of primary_cause on public.incidents
  for each row execute function public.incident_team_from_cause();

-- The ones filed under Operaciones are about orders and deliveries: Logística.
update public.incidents set team = 'logistics' where team = 'operations';
