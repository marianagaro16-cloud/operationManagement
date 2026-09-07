-- ============================================================
-- Where a generated order came from, and what it was proposed as.
--
-- generate_order_from_template() copied recurring_order_template_lines
-- .default_quantity into order_lines.ordered_quantity and left no link back.
-- The order carried no template id; the only trace was a JSON blob in
-- order_audit_log, which no query reads.
--
-- Three consequences, all of them silent:
--   * "which orders did this standing arrangement produce" was unanswerable
--   * editing a template left already-generated drafts on the old quantities
--     with no way to find them
--   * a draft exists to be REVIEWED, but the order did not know what had been
--     proposed, so an edited line was indistinguishable from an original one
--
-- order_lines.ordered_quantity stays authoritative — it is what ships. The
-- proposal is recorded beside it so a divergence becomes a query instead of
-- somebody's memory.
-- ============================================================

alter table public.orders
  add column generated_from_template_id uuid
    references public.recurring_order_templates (id) on delete set null;

comment on column public.orders.generated_from_template_id is
  'The recurring template this order was generated from, if any. ON DELETE SET NULL: removing a template must never take its orders with it. Null for orders created by hand.';

create index orders_template_idx
  on public.orders (generated_from_template_id)
  where generated_from_template_id is not null;

alter table public.order_lines
  add column generated_quantity numeric(12,3)
    check (generated_quantity is null or generated_quantity > 0);

comment on column public.order_lines.generated_quantity is
  'What the recurring template proposed for this line at generation time, frozen. Never authoritative — ordered_quantity is what ships. Null on hand-created lines and on lines added after generation.';


-- ---------- backfill from the audit log ----------
-- The link has existed all along inside order_audit_log.detail; it was simply
-- unreachable. This recovers it for every order already generated.
--
-- The proposed QUANTITY cannot be recovered — it was never recorded anywhere —
-- so generated_quantity stays null on historical rows and the UI treats null
-- as "no proposal on file" rather than as "unchanged".
update public.orders o
   set generated_from_template_id = (l.detail ->> 'template_id')::uuid
  from public.order_audit_log l
 where l.order_id = o.id
   and l.action = 'generated_from_template'
   and l.detail ? 'template_id'
   and o.generated_from_template_id is null
   -- Only where the template still exists, so the FK holds.
   and exists (
     select 1 from public.recurring_order_templates t
      where t.id = (l.detail ->> 'template_id')::uuid
   );


-- ---------- the generator records both ----------
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
    status, order_type, note, generated_from_template_id, created_by, updated_by
  ) values (
    v_tpl.customer_id,
    p_delivery_date,
    public.preparation_date_for(p_delivery_date, v_tpl.preparation_lead_days),
    v_tpl.delivery_method_id,
    'draft',
    v_tpl.order_type,
    v_tpl.note,
    p_template_id,
    (select auth.uid()),
    (select auth.uid())
  )
  returning * into v_order;

  -- ordered_quantity is what the order asks for and an admin may change it.
  -- generated_quantity freezes what was proposed, so the review step can show
  -- exactly which lines were touched.
  insert into public.order_lines (order_id, product_id, ordered_quantity, generated_quantity, position)
  select v_order.id, l.product_id, l.default_quantity, l.default_quantity, l.position
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
