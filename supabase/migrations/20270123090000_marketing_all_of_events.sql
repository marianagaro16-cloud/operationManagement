-- ============================================================
-- Marketing (Tona) does everything on events, like Sales (decided
-- 2026-10-16): tasks, budget, contacts, products and their order, results,
-- and may be the event's responsible person.
--
-- What stays closed: the rest of sales (planning outside events, the
-- prospect pipeline, customers' notes) and the operation (Orders). The
-- event's order is read and changed only through the event's functions.
-- ============================================================

-- ---------- who works on events ----------

create or replace function public.is_events()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_sales() or public.is_marketing();
$$;

revoke all on function public.is_events() from public, anon;
grant execute on function public.is_events() to authenticated;

-- ---------- the responsible person; results and done ----------

/* The responsible person is someone in sales or in Marketing. */
create or replace function public.guard_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.owner_id is not null
     and (tg_op = 'INSERT' or new.owner_id is distinct from old.owner_id)
     and not exists (
       select 1 from public.profiles p
        where p.id = new.owner_id and p.status = 'approved'
          and (p.team in ('sales', 'marketing') or p.role in ('admin', 'owner'))
     ) then
    raise exception 'owner_not_sales' using errcode = '22023';
  end if;
  return new;
end;
$$;

create or replace function public.guard_event_results()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_events() and (
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

-- ---------- budget ----------

drop policy "not for external accounts" on public.event_costs;
create policy "event_costs: marketing all" on public.event_costs for all to authenticated
  using ((select public.is_marketing())) with check ((select public.is_marketing()));
create policy "event_cost_types: marketing read" on public.event_cost_types for select to authenticated
  using ((select public.is_marketing()));

-- ---------- products, returns, the event's order ----------

create policy "event_returns: marketing all" on public.event_returns for all to authenticated
  using ((select public.is_marketing())) with check ((select public.is_marketing()));

/* Same functions, allowed for Marketing: the check is swapped in place. */
do $$
declare
  f   text;
  d   text;
  new text;
begin
  foreach f in array array['public.event_set_products(uuid, jsonb)', 'public.event_set_delivery(uuid, date, uuid)'] loop
    d := pg_get_functiondef(f::regprocedure);
    new := replace(d, 'if not public.is_sales() then', 'if not public.is_events() then');
    if new = d then
      raise exception 'check not found in %', f;
    end if;
    execute new;
  end loop;

  -- The event's order is corrected through the event by whoever works on events.
  d := pg_get_functiondef('public.guard_confirmed_order_edit()'::regprocedure);
  new := replace(d, 'and public.is_sales())', 'and public.is_events())');
  if new = d then
    raise exception 'check not found in guard_confirmed_order_edit';
  end if;
  execute new;
end $$;

/*
 * The event's order as the event shows it: header, lines, and what was
 * prepared. For whoever works on events — Orders itself stays closed to
 * the external account.
 */
create or replace function public.event_order(p_event_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
           'id', o.id, 'reference', o.reference, 'status', o.status,
           'ready_at', o.ready_at, 'shipped_at', o.shipped_at,
           'delivery_date', o.delivery_date, 'delivery_method_id', o.delivery_method_id,
           'lines', coalesce((
             select jsonb_agg(jsonb_build_object(
                      'product_id', l.product_id, 'ordered_quantity', l.ordered_quantity,
                      'note', l.note, 'position', l.position,
                      'prepared', (select coalesce(sum(a.quantity), 0) from public.lot_allocations a where a.order_line_id = l.id))
                    order by l.position)
               from public.order_lines l where l.order_id = o.id), '[]'::jsonb))
    from public.events e
    join public.orders o on o.id = e.order_id
   where e.id = p_event_id and public.is_events();
$$;

revoke all on function public.event_order(uuid) from public, anon;
grant execute on function public.event_order(uuid) to authenticated;

-- ---------- tasks ----------

drop policy "sales_activities: marketing ticks own event task" on public.sales_activities;

create policy "sales_activities: marketing adds event tasks" on public.sales_activities
  for insert to authenticated
  with check ((select public.is_marketing()) and event_id is not null
              and created_by = (select auth.uid()) and status = 'planned');
create policy "sales_activities: marketing changes event tasks" on public.sales_activities
  for update to authenticated
  using ((select public.is_marketing()) and event_id is not null)
  with check ((select public.is_marketing()) and event_id is not null);
create policy "sales_activities: marketing removes planned event tasks" on public.sales_activities
  for delete to authenticated
  using ((select public.is_marketing()) and event_id is not null and status = 'planned');

create policy "sales_activity_kinds: marketing read" on public.sales_activity_kinds for select to authenticated
  using ((select public.is_marketing()));

/* As 20270122090000, without the "only the result" rule: Marketing now plans event tasks. */
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
  -- Outside sales, only an event's own task (no customer, no prospect) —
  -- besides the follow-up call event_add_contact() plans for sales.
  if (select auth.uid()) is not null and not public.is_sales()
     and current_setting('app.event_contact', true) is distinct from 'on'
     and (new.event_id is null or new.customer_id is not null or new.prospect_id is not null) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- ---------- contacts ----------

-- The event's contacts, not the rest of the pipeline.
create policy "prospects: marketing reads event contacts" on public.prospects for select to authenticated
  using ((select public.is_marketing()) and event_id is not null);

/*
 * Someone met at the event: a prospect, source Fair, linked to the event,
 * followed up by someone in sales (the event's responsible when they are in
 * sales) with a call on the given day.
 */
create or replace function public.event_add_contact(
  p_event_id     uuid,
  p_company_name text,
  p_contact_name text,
  p_phone        text,
  p_email        text,
  p_interest     text,
  p_follow_up    date,
  p_follower     uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_e     public.events%rowtype;
  v_owner uuid;
  v_id    uuid;
begin
  if not public.is_events() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_company_name, '')), '') is null then
    raise exception 'name_required' using errcode = '22023';
  end if;
  if p_follow_up is null then
    raise exception 'invalid_date' using errcode = '22023';
  end if;
  select * into v_e from public.events where id = p_event_id;
  if not found then
    raise exception 'event_not_found' using errcode = 'P0002';
  end if;

  v_owner := coalesce(p_follower, v_e.owner_id);
  -- guard_prospect and guard_sales_activity check that they are in sales.
  insert into public.prospects (company_name, contact_name, phone, email, interest, source_id, stage, owner_id, event_id, created_by)
  values (btrim(p_company_name), nullif(btrim(p_contact_name), ''), nullif(btrim(p_phone), ''),
          nullif(btrim(p_email), ''), nullif(btrim(p_interest), ''),
          (select id from public.prospect_sources where slug = 'fair'), 'new', v_owner, p_event_id, (select auth.uid()))
  returning id into v_id;

  perform set_config('app.event_contact', 'on', true);
  insert into public.sales_activities (salesperson_id, kind_id, activity_date, prospect_id, created_by)
  values (v_owner, (select id from public.sales_activity_kinds where slug = 'call'), p_follow_up, v_id, (select auth.uid()));
  perform set_config('app.event_contact', 'off', true);
  return v_id;
end;
$$;

revoke all on function public.event_add_contact(uuid, text, text, text, text, text, date, uuid) from public, anon;
grant execute on function public.event_add_contact(uuid, text, text, text, text, text, date, uuid) to authenticated;

-- ---------- photos and files ----------

create policy "event_files: marketing removes" on public.event_files for delete to authenticated
  using ((select public.is_marketing()));
create policy "event files: marketing removes" on storage.objects for delete to authenticated
  using (bucket_id = 'event-files' and (select public.is_marketing()));
