-- ============================================================
-- Restart the human-facing order number at 1001.
--
-- The September orders were tests and have been deleted, so the sequence
-- should start over rather than continuing from #1025.
-- ============================================================

-- `reference` is what people say out loud and write on paperwork, so two
-- orders must never share one. It was only an identity column, with nothing
-- stopping a duplicate — which is exactly what restarting a sequence can
-- cause. Add the constraint FIRST so the restart cannot create a collision.
create unique index if not exists orders_reference_key on public.orders (reference);

-- Restart only when the table is empty. Restarting with rows present would
-- hand out numbers that already exist, and the unique index above would then
-- reject perfectly ordinary order creation.
do $$
declare
  v_count bigint;
begin
  select count(*) into v_count from public.orders;

  if v_count = 0 then
    alter table public.orders alter column reference restart with 1001;
    raise notice 'orders.reference restarted at 1001';
  else
    raise notice 'orders.reference left alone: % order(s) exist', v_count;
  end if;
end
$$;
