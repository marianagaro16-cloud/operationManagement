-- ============================================================
-- A prospect's responsible person is checked when set or changed, not on
-- every update: someone who later leaves sales must not block the
-- notifier's bookkeeping, or any other change, on their open prospects.
-- ============================================================

create or replace function public.guard_prospect()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and old.stage in ('won', 'lost') then
    if new is distinct from old and (select auth.uid()) is not null then
      raise exception 'prospect_closed' using errcode = '42501';
    end if;
  end if;
  if new.owner_id is not null
     and (tg_op = 'INSERT' or new.owner_id is distinct from old.owner_id)
     and not exists (
       select 1 from public.profiles p
        where p.id = new.owner_id and p.status = 'approved'
          and (p.team = 'sales' or p.role in ('admin', 'owner'))
     ) then
    raise exception 'owner_not_sales' using errcode = '22023';
  end if;
  -- Won and lost go through their own functions, which set what they need.
  if (select auth.uid()) is not null and new.stage in ('won', 'lost')
     and (tg_op = 'INSERT' or old.stage is distinct from new.stage)
     and current_setting('app.prospect_closing', true) is distinct from 'on' then
    raise exception 'use_win_or_lose' using errcode = '42501';
  end if;
  return new;
end;
$$;
