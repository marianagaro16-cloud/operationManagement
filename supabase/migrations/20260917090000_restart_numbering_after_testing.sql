-- ============================================================
-- Restart the human-facing numbering after the testing round
--
-- The orders and incidents entered while trying the app out have been
-- removed, so the next real order should be #1001 and the next real incident
-- INC-2026-0001 rather than continuing from wherever the tests happened to
-- stop. These are the numbers people say out loud and write on paperwork;
-- starting them mid-sequence invites "which #1009 do you mean".
--
-- Follows 20260903210000_restart_order_reference exactly, which did this the
-- first time the September test orders were cleared.
-- ============================================================

-- Guard first. `reference` is what people quote, so two rows must never share
-- one — and handing out a number that already exists is precisely what
-- restarting a sequence can do. Orders already carry this index; incidents get
-- it here for the same reason.
create unique index if not exists incidents_reference_key on public.incidents (reference);

/*
 * Restart ONLY on an empty table.
 *
 * On a database that still holds orders this is a no-op that says so, rather
 * than a sequence quietly rewound to hand out numbers already in use. The
 * same file therefore runs safely against an environment that was never part
 * of this testing round.
 */
do $$
declare
  v_orders    bigint;
  v_incidents bigint;
begin
  select count(*) into v_orders    from public.orders;
  select count(*) into v_incidents from public.incidents;

  if v_orders = 0 then
    alter table public.orders alter column reference restart with 1001;
    raise notice 'orders.reference restarted at 1001';
  else
    raise notice 'orders.reference left alone: % order(s) exist', v_orders;
  end if;

  if v_incidents = 0 then
    alter table public.incidents alter column reference restart with 1;
    raise notice 'incidents.reference restarted at 1';
  else
    raise notice 'incidents.reference left alone: % incident(s) exist', v_incidents;
  end if;
end
$$;
