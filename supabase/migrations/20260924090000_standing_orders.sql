-- ============================================================
-- Standing orders: a cadence, a link back, and no duplicates
--
-- The pieces existed and did not add up to a feature. There was a template
-- table, a generate_order_from_template() RPC and a screen listing templates
-- — but saveTemplate() was never called by any screen, so there was no way to
-- CREATE a standing order at all. Production has zero templates, which is
-- what "we cannot do standing orders" actually meant.
--
-- Three schema changes, each answering a specific gap:
--
--   1. interval_weeks + anchor_date, so "every second Tuesday" is
--      expressible. delivery_weekday alone could only say "every Tuesday".
--
--   2. orders.recurring_template_id, so a generated order knows what
--      generated it. The from-template badge previously had to infer this
--      from the audit log.
--
--   3. a UNIQUE index on (template, delivery_date), which is what makes
--      automatic generation safe to run twice. For a standing order a
--      duplicate is far worse than a miss: it gets picked, allocated and
--      delivered.
-- ============================================================


-- ============================================================
-- cadence
-- ============================================================
alter table public.recurring_order_templates
  -- 1 = every week, 2 = every second week, and so on. Capped at 52 because
  -- beyond a year this is not a cadence, it is a reminder.
  add column interval_weeks int not null default 1
    check (interval_weeks between 1 and 52),
  /*
   * Which week the count starts from.
   *
   * NULL means "every interval_weeks week counted from any week", which is
   * only meaningful at interval 1 — so the CHECK below requires an anchor as
   * soon as the interval is wider than a week. Without one, "every second
   * Tuesday" has two equally valid answers and the schedule would drift
   * depending on when it was asked.
   */
  add column anchor_date date,

  add constraint recurring_templates_interval_needs_anchor check (
    interval_weeks = 1 or anchor_date is not null
  );

comment on column public.recurring_order_templates.interval_weeks is
  'Weeks between deliveries. 1 = weekly. Anything wider requires anchor_date to fix which week counts.';


-- ============================================================
-- the link back
-- ============================================================
alter table public.orders
  add column recurring_template_id uuid
    references public.recurring_order_templates (id) on delete set null;

create index orders_recurring_template_idx on public.orders (recurring_template_id)
  where recurring_template_id is not null;

comment on column public.orders.recurring_template_id is
  'The standing order that produced this one, when one did. SET NULL on delete: removing a template must never remove the orders it already produced.';

/*
 * ONE order per template per delivery date.
 *
 * This is the guard that makes the scheduler safe. It can run twice, run late,
 * run concurrently with somebody pressing Generate, or be replayed after a
 * failure, and the worst case is a row that does not insert.
 *
 * Partial, so it constrains only generated orders — hand-made orders for the
 * same customer and date are a different thing and stay unrestricted.
 */
create unique index orders_one_per_template_date
  on public.orders (recurring_template_id, delivery_date)
  where recurring_template_id is not null;


-- ============================================================
-- generation
-- ============================================================
/*
 * Rewritten for three reasons.
 *
 * AUTHORIZATION: it required is_admin(), while /admin/recurring is gated on
 * orders.manage_config — which a Manager holds. So a Manager could open the
 * screen, press Generate and be told not_authorized by a button that should
 * never have been offered. The capability now matches the screen.
 *
 * THE LINK: it now stamps recurring_template_id, which is what the unique
 * index above constrains.
 *
 * IDEMPOTENCE: an existing order for this template and date is RETURNED
 * rather than duplicated or raised over. Pressing Generate twice is a normal
 * thing for a person to do when they are unsure whether the first press took.
 */
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
  if not public.has_permission('orders.manage_config') then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  select * into v_tpl from public.recurring_order_templates where id = p_template_id;
  if not found then
    raise exception 'template_not_found' using errcode = 'P0002';
  end if;

  -- Already generated for this date: hand back what exists.
  select * into v_order
    from public.orders
   where recurring_template_id = p_template_id
     and delivery_date = p_delivery_date;
  if found then
    return v_order;
  end if;

  insert into public.orders (
    customer_id, delivery_date, preparation_date, delivery_method_id,
    status, order_type, note, recurring_template_id, created_by, updated_by
  ) values (
    v_tpl.customer_id,
    p_delivery_date,
    p_delivery_date - v_tpl.preparation_lead_days,
    v_tpl.delivery_method_id,
    -- DRAFT, always. A standing order proposes; a person confirms.
    'draft',
    v_tpl.order_type,
    v_tpl.note,
    p_template_id,
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

revoke all on function public.generate_order_from_template(uuid, date) from public, anon;
grant execute on function public.generate_order_from_template(uuid, date) to authenticated;
