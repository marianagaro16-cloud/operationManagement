-- ============================================================
-- Restart the reception numbering after the verification round
--
-- verify-goods-reception.mjs created two receptions against this database
-- while proving the RLS rules, and its cleanup left one of them behind. The
-- fixtures are gone now, so the first REAL delivery should be GR-2026-0001
-- rather than GR-2026-0003.
--
-- This is the number somebody writes on a delivery note and says out loud on
-- the phone. Starting the operation's very first reception at 0003 invites
-- "where are the first two?", and the honest answer — "a test run had them" —
-- is not one anybody should have to give about a production record.
--
-- Follows 20260917090000_restart_numbering_after_testing exactly, which did
-- this for orders and incidents after their own testing round.
-- ============================================================

-- Guard first. `reference` is what the visible number is built from, so two
-- rows must never share one — and handing out a number that already exists is
-- precisely what restarting a sequence can do.
create unique index if not exists goods_receptions_reference_key
  on public.goods_receptions (reference);

/*
 * Restart ONLY on an empty table.
 *
 * On a database that already holds real receptions this is a no-op that says
 * so, rather than a sequence quietly rewound to hand out numbers already in
 * use. The same file therefore runs safely against an environment that was
 * never part of this verification round.
 */
do $$
declare
  v_receptions bigint;
begin
  select count(*) into v_receptions from public.goods_receptions;

  if v_receptions = 0 then
    alter table public.goods_receptions alter column reference restart with 1;
    raise notice 'goods_receptions.reference restarted at 1';
  else
    raise notice 'goods_receptions.reference left alone: % reception(s) exist', v_receptions;
  end if;
end
$$;
