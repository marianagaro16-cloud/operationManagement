-- An event's results — and marking it done, which is where they are filled
-- in — are Sales' (Carlos, Admin, Owners), not Marketing's (decided 2026-10-01).
create or replace function public.guard_event_results()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_sales() and (
       new.result_summary  is distinct from old.result_summary
    or new.result_rating   is distinct from old.result_rating
    or new.result_repeat   is distinct from old.result_repeat
    or new.result_visitors is distinct from old.result_visitors
    or new.result_samples  is distinct from old.result_samples
    or new.result_contacts is distinct from old.result_contacts
    or (new.stage = 'done' and old.stage <> 'done')
  ) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger events_guard_results before update on public.events
  for each row execute function public.guard_event_results();
