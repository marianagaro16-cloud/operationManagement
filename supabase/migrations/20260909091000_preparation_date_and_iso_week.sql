-- ============================================================
-- Two rules that were implemented more than once, moved into the schema.
-- ============================================================


-- ============================================================
-- 1. Preparation may not fall after delivery
--
-- The rule existed as isValidSchedule() in domain/orders/scheduling.ts and ran
-- in saveOrder() only. generate_order_from_template() did its own subtraction
-- (p_delivery_date - preparation_lead_days) and never consulted it, and a
-- direct insert bypassed it entirely — so the one write path that creates
-- orders automatically was also the one path with no check.
--
-- The over-allocation rule was correctly pushed into a trigger for exactly
-- this reason. This one follows it.
-- ============================================================

-- Repair before constraining. The application has always blocked this, so
-- this should affect no rows; it exists so the migration cannot fail on a
-- database where something was inserted directly.
update public.orders
   set preparation_date = delivery_date
 where preparation_date > delivery_date;

alter table public.orders
  add constraint orders_preparation_not_after_delivery
  check (preparation_date <= delivery_date);

-- The lead-days arithmetic, in one place. IMMUTABLE: date minus integer
-- depends on nothing outside its arguments.
create or replace function public.preparation_date_for(
  p_delivery_date date,
  p_lead_days     int
)
returns date
language sql
immutable
as $$
  select p_delivery_date - greatest(coalesce(p_lead_days, 0), 0);
$$;

comment on function public.preparation_date_for(date, int) is
  'Preparation date for a delivery date and a lead time. The single implementation of the rule; the TypeScript copy in domain/orders/scheduling.ts is for client-side display only.';


-- ============================================================
-- 2. iso_week / iso_year become generated columns
--
-- They were computed in TypeScript by calendarWeek(), sent in the insert
-- payload, and then immediately overwritten by inventory_instance_snapshot().
-- Two implementations of "which ISO week is this" — one in Luxon, one in
-- Postgres — that agreed only by coincidence and were compared by nobody.
--
-- Generated columns end the argument: Postgres refuses a write to them, so
-- the duplicate cannot come back. Same reasoning as
-- inventory_instance_items.difference and customers.name.
--
-- EXTRACT over a `date` is immutable, which is what makes this legal here
-- (unlike the AT TIME ZONE expressions elsewhere in this schema).
-- ============================================================

drop index if exists public.inventory_instances_week_idx;

alter table public.inventory_instances
  drop column iso_week,
  drop column iso_year;

alter table public.inventory_instances
  add column iso_week int
    generated always as ((extract(week    from inventory_date))::int) stored,
  add column iso_year int
    generated always as ((extract(isoyear from inventory_date))::int) stored;

comment on column public.inventory_instances.iso_week is
  'ISO calendar week ("KW 37") of inventory_date. Derived, never written.';

create index inventory_instances_week_idx
  on public.inventory_instances (iso_year, iso_week);

-- The snapshot trigger keeps the three columns that are genuinely snapshots
-- (a historical inventory must survive its template being renamed, re-typed
-- or having Inventory Digital switched off) and stops touching the two that
-- are now derived.
create or replace function public.inventory_instance_snapshot()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tpl public.inventory_templates;
begin
  select * into v_tpl from public.inventory_templates where id = new.template_id;
  if not found then
    raise exception 'inventory_template_not_found' using errcode = 'P0002';
  end if;

  new.name_snapshot   := v_tpl.name;
  new.kind            := v_tpl.kind;
  new.digital_enabled := v_tpl.digital_enabled;

  -- iso_week and iso_year are generated columns and are not assignable.

  return new;
end;
$$;


-- ============================================================
-- 3. The template generator uses the shared rule
--
-- It previously inlined `p_delivery_date - v_tpl.preparation_lead_days`,
-- which was the third implementation of the lead-days subtraction and the
-- only order-creating path that never met isValidSchedule().
-- ============================================================
create or replace function public.generate_order_from_template(
  p_template_id uuid,
  p_delivery_date date
)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tpl   public.recurring_order_templates;
  v_order public.orders;
begin
  if not public.is_admin() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  select * into v_tpl from public.recurring_order_templates where id = p_template_id;
  if not found then
    raise exception 'template_not_found' using errcode = 'P0002';
  end if;

  insert into public.orders (
    customer_id, delivery_date, preparation_date, delivery_method_id,
    status, order_type, note, created_by, updated_by
  ) values (
    v_tpl.customer_id,
    p_delivery_date,
    -- One implementation of the rule, and the CHECK constraint above now
    -- backstops it regardless of write path.
    public.preparation_date_for(p_delivery_date, v_tpl.preparation_lead_days),
    v_tpl.delivery_method_id,
    'draft',
    v_tpl.order_type,
    v_tpl.note,
    (select auth.uid()),
    (select auth.uid())
  )
  returning * into v_order;

  insert into public.order_lines (order_id, product_id, ordered_quantity, position)
  select v_order.id, l.product_id, l.default_quantity, l.position
    from public.recurring_order_template_lines l
   where l.template_id = p_template_id;

  insert into public.order_audit_log (order_id, actor_id, action, detail)
  values (v_order.id, (select auth.uid()), 'generated_from_template',
          jsonb_build_object('template_id', p_template_id));

  return v_order;
end;
$$;

revoke all on function public.generate_order_from_template(uuid, date) from public;
grant execute on function public.generate_order_from_template(uuid, date) to authenticated;
