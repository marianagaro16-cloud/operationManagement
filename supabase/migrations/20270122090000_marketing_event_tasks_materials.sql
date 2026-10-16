-- ============================================================
-- Marketing (Tona) on events, decided 2026-10-16:
--
--   material   Marketing keeps the material list like Sales: adds, edits,
--              ticks packed and came back, copies the standard list.
--   tasks      an event's task may be given to someone in Marketing. They
--              see all of the event's tasks and tick only their own done;
--              Sales, Admin and Owners still plan and change them. Sales
--              planning outside events stays closed to Marketing.
-- ============================================================

-- ---------- material ----------

drop policy "event_materials: marketing read" on public.event_materials;
create policy "event_materials: marketing all" on public.event_materials for all to authenticated
  using ((select public.is_marketing())) with check ((select public.is_marketing()));

create or replace function public.event_copy_kind_materials(p_event_id uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare v_n int;
begin
  if not (public.is_sales() or public.is_marketing()) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  insert into public.event_materials (event_id, name, quantity, sort_order)
  select e.id, m.name, m.quantity, m.sort_order
    from public.events e
    join public.event_kind_materials m on m.kind_id = e.kind_id
   where e.id = p_event_id
     and not exists (
       select 1 from public.event_materials x
        where x.event_id = e.id and lower(btrim(x.name)) = lower(btrim(m.name))
     );
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- ---------- tasks ----------

create policy "sales_activities: marketing reads event tasks" on public.sales_activities
  for select to authenticated
  using ((select public.is_marketing()) and event_id is not null);

create policy "sales_activities: marketing ticks own event task" on public.sales_activities
  for update to authenticated
  using ((select public.is_marketing()) and event_id is not null and salesperson_id = (select auth.uid()))
  with check ((select public.is_marketing()) and event_id is not null and salesperson_id = (select auth.uid()));

/*
 * The salesperson is someone in sales — or, on an event's task, someone in
 * Marketing. A result, once set, stays. Someone outside sales who may touch
 * a task (its Marketing person) only records the result.
 */
create or replace function public.guard_sales_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (tg_op = 'INSERT' or new.salesperson_id is distinct from old.salesperson_id)
     and not exists (
       select 1 from public.profiles p
        where p.id = new.salesperson_id and p.status = 'approved'
          and (p.team = 'sales' or p.role in ('admin', 'owner')
               or (p.team = 'marketing' and new.event_id is not null))
     ) then
    raise exception 'salesperson_not_sales' using errcode = '22023';
  end if;
  if tg_op = 'UPDATE' and old.status <> 'planned'
     and (new.status is distinct from old.status or new.customer_id is distinct from old.customer_id
          or new.prospect_id is distinct from old.prospect_id or new.activity_date is distinct from old.activity_date
          or new.kind_id is distinct from old.kind_id) then
    raise exception 'activity_recorded' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and (select auth.uid()) is not null and not public.is_sales()
     and (to_jsonb(new) - array['status', 'done_at', 'acta_required']) is distinct from (to_jsonb(old) - array['status', 'done_at', 'acta_required']) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  return new;
end;
$$;
