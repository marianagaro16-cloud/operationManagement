-- ============================================================
-- An order must say how it is being delivered
--
-- delivery_method_id has been nullable since the orders module shipped, so
-- an order could be created, confirmed, picked and delivered without anybody
-- recording whether it went by DHL, by Planzer, or was collected at the
-- factory. That is a question somebody always has to answer eventually —
-- usually the morning it ships, from memory.
--
-- SAFE TO ENFORCE TODAY, checked rather than assumed: all 25 orders and both
-- standing order templates already carry a method, so nothing needs
-- backfilling and no historical row has to be guessed at. Had there been
-- even one, this migration would have had to invent a delivery method for a
-- past delivery, which is exactly the kind of fabricated data a NOT NULL is
-- supposed to prevent.
--
-- THE TEMPLATE IS CONSTRAINED TOO, and that is the load-bearing half.
-- A standing order generates its drafts from the template's method. If a
-- template were allowed to have none, the nightly scheduler would fail at
-- 03:30 against the new constraint on orders — a failure nobody sees until a
-- delivery does not exist. Requiring it on the template moves that error to
-- the moment somebody saves the template, where there is a person to read it.
-- ============================================================

do $$
declare
  v_orders    bigint;
  v_templates bigint;
begin
  select count(*) into v_orders    from public.orders                     where delivery_method_id is null;
  select count(*) into v_templates from public.recurring_order_templates  where delivery_method_id is null;

  -- Fails loudly rather than half-applying. A NOT NULL that cannot be added
  -- because real rows violate it is a data question, not a schema one, and it
  -- needs a person to decide what those rows should say.
  if v_orders > 0 or v_templates > 0 then
    raise exception
      'cannot require delivery method: % order(s) and % template(s) have none',
      v_orders, v_templates;
  end if;
end
$$;

alter table public.orders
  alter column delivery_method_id set not null;

alter table public.recurring_order_templates
  alter column delivery_method_id set not null;

comment on column public.orders.delivery_method_id is
  'How the order reaches the customer. Required: an order nobody can say the delivery route for is an order somebody has to reconstruct on the morning it ships.';
