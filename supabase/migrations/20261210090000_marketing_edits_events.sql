-- ============================================================
-- Marketing edits events too (decided 2026-10-01).
--
-- Marketing creates and changes events — details, stage, staff, results —
-- beside Sales. What stays Sales': the tasks and contacts (they live in the
-- sales planning and prospects), the budget and the products (an order), and
-- the responsible person is still someone in sales, whose planning the tasks
-- go into.
-- ============================================================

create policy "events: marketing add" on public.events for insert to authenticated
  with check ((select public.is_marketing()) and created_by = (select auth.uid()));
create policy "events: marketing change" on public.events for update to authenticated
  using ((select public.is_marketing())) with check ((select public.is_marketing()));
create policy "events: marketing removes ideas" on public.events for delete to authenticated
  using ((select public.is_marketing()) and stage = 'idea');

create policy "event_shifts: marketing all" on public.event_shifts for all to authenticated
  using ((select public.is_marketing())) with check ((select public.is_marketing()));

/* Confirming plans the kind's tasks for the (sales) responsible and makes the order: Marketing may do it too. */
create or replace function public.event_confirm(p_event_id uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_e    public.events%rowtype;
  v_kind uuid := (select id from public.sales_activity_kinds where slug = 'event_task');
  v_n    int;
begin
  if not (public.is_sales() or public.is_marketing()) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  select * into v_e from public.events where id = p_event_id for update;
  if not found then
    raise exception 'event_not_found' using errcode = 'P0002';
  end if;
  if v_e.stage <> 'idea' then
    raise exception 'event_not_idea' using errcode = '22023';
  end if;
  if v_e.owner_id is null then
    raise exception 'owner_required' using errcode = '22023';
  end if;

  insert into public.sales_activities (salesperson_id, kind_id, activity_date, title, event_id, created_by)
  select v_e.owner_id, v_kind,
         case t.anchor when 'end' then v_e.end_date + t.days else v_e.start_date + t.days end,
         t.title, v_e.id, (select auth.uid())
    from public.event_kind_tasks t
   where t.kind_id = v_e.kind_id
   order by t.sort_order;
  get diagnostics v_n = row_count;

  update public.events set stage = 'confirmed' where id = p_event_id;
  -- What the event takes becomes an order (20261117090100), whoever confirms.
  perform public.event_make_order(p_event_id);
  return v_n;
end;
$$;

/* Workers without an account, for scheduling staff: names only, for Sales and Marketing. */
create or replace function public.event_staff_workers()
returns table (id uuid, name text, team public.team)
language sql
stable
security definer
set search_path = ''
as $$
  select w.id, w.name, w.team
    from public.hr_workers w
   where w.is_active and w.profile_id is null and (public.is_sales() or public.is_marketing())
   order by w.name;
$$;
