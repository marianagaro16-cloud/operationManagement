-- ============================================================
-- Orders: Ready and Shipped.
--
-- An order's status was only its commercial state — draft, confirmed,
-- cancelled. Whether it was prepared was derived from the lots, and nothing
-- at all recorded that it had left. So a prepared order looked the same the
-- day after it shipped as the moment it was finished, and anything past its
-- date looked late.
--
-- Two recorded milestones, each with when and who:
--
--   ready    the person preparing confirms the order is prepared
--   shipped  the order has left (shipped, or picked up at the factory)
--
-- WHY MILESTONE COLUMNS, NOT MORE STATUS VALUES
--
-- A dozen places read `status = 'confirmed'` to mean "a real order": the
-- reports, the delivery alerts, preparation, the edit lock. Adding 'ready'
-- and 'shipped' to the same enum would have made every one of them silently
-- stop counting prepared and shipped orders. Kept apart, the commercial
-- status keeps its meaning, the fulfilment progress sits beside it, and
-- impossible combinations — a draft that shipped, a cancelled order marked
-- ready — are refused by constraints rather than merely unlikely.
--
-- The status the screen shows is derived from both:
--   Draft → Confirmed → In preparation → Ready → Shipped   (or Cancelled)
--
-- Marked by whoever prepares — any approved user, the same people who record
-- lots — and reopened the same way. Everything else about an order is still
-- written only by orders.manage.
-- ============================================================

alter table public.orders
  add column ready_at   timestamptz,
  add column ready_by   uuid references public.profiles (id) on delete set null,
  add column shipped_at timestamptz,
  add column shipped_by uuid references public.profiles (id) on delete set null;

alter table public.orders
  add constraint orders_ready_attributed check (ready_by is null or ready_at is not null),
  add constraint orders_shipped_attributed check (shipped_by is null or shipped_at is not null),
  -- Nothing ships before it is prepared.
  add constraint orders_shipped_requires_ready check (shipped_at is null or ready_at is not null),
  -- Only a confirmed order is prepared or shipped: a draft has not been
  -- agreed, a cancelled one is not going anywhere. Cancelling a ready order
  -- therefore means reopening it first.
  add constraint orders_milestones_need_confirmed check (
    (ready_at is null and shipped_at is null) or status = 'confirmed'
  );

-- "Ready but not shipped yet" is the list somebody works through at the door.
create index orders_ready_unshipped_idx on public.orders (delivery_date)
  where ready_at is not null and shipped_at is null;
create index orders_shipped_at_idx on public.orders (shipped_at) where shipped_at is not null;

comment on column public.orders.ready_at is 'When the order was confirmed as prepared. Set only by order_set_ready().';
comment on column public.orders.shipped_at is 'When the order left — shipped or picked up. Set only by order_set_shipped().';

-- ---------- what "prepared" means ----------

/*
 * Every line accounted for: fully allocated (or over, which a manager may
 * record), or short WITH a reason. An explained shortfall is a finished
 * preparation — treating it as unfinished pushes people to allocate stock
 * they do not have just to close the order.
 *
 * The same rule as the preparation report and src/domain/orders/progress.ts
 * (isPrepared). The old isComplete — every line exact — is kept for what it
 * says, but no longer decides whether an order is done.
 */
create or replace function public.order_is_prepared(p_order_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.order_lines l where l.order_id = p_order_id)
     and not exists (
       select 1
         from public.order_lines l
         cross join lateral (
           select coalesce(sum(a.quantity), 0) as allocated
             from public.lot_allocations a
            where a.order_line_id = l.id
         ) s
        where l.order_id = p_order_id
          and not (
            (s.allocated > 0 and s.allocated >= l.ordered_quantity)
            or (s.allocated > 0 and nullif(btrim(coalesce(l.shortfall_reason, '')), '') is not null)
          )
     );
$$;

revoke all on function public.order_is_prepared(uuid) from public;
grant execute on function public.order_is_prepared(uuid) to authenticated;

-- ---------- ready ----------

create or replace function public.order_set_ready(p_order_id uuid, p_ready boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_row public.orders;
begin
  if v_uid is null or not public.is_approved() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  select * into v_row from public.orders where id = p_order_id for update;
  if not found then raise exception 'order_not_found'; end if;

  if p_ready then
    if v_row.status <> 'confirmed' then raise exception 'order_not_confirmed'; end if;
    if v_row.ready_at is not null then return; end if;
    if not public.order_is_prepared(p_order_id) then raise exception 'order_not_prepared'; end if;

    update public.orders set ready_at = now(), ready_by = v_uid where id = p_order_id;
    insert into public.order_audit_log (order_id, actor_id, action, detail)
    values (p_order_id, v_uid, 'order_ready', '{}'::jsonb);
  else
    -- A shipped order is reopened from Shipped first; Ready cannot be pulled
    -- out from under something that already left.
    if v_row.shipped_at is not null then raise exception 'order_already_shipped'; end if;
    if v_row.ready_at is null then return; end if;

    update public.orders set ready_at = null, ready_by = null where id = p_order_id;
    insert into public.order_audit_log (order_id, actor_id, action, detail)
    values (p_order_id, v_uid, 'order_ready_reopened', jsonb_build_object('ready_at', v_row.ready_at));
  end if;
end;
$$;

-- ---------- shipped (one or many) ----------

/*
 * Mark orders shipped, or undo it. Takes a list so the day's DHL orders can
 * go in one press.
 *
 * All or nothing: if any order in the list is not ready, none is marked and
 * the error says so — half a batch marked shipped is harder to notice and
 * undo than a refusal. Orders already in the requested state are skipped.
 * Returns how many actually changed.
 */
create or replace function public.order_set_shipped(p_order_ids uuid[], p_shipped boolean)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := (select auth.uid());
  v_row     public.orders;
  v_changed integer := 0;
begin
  if v_uid is null or not public.is_approved() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if p_order_ids is null or cardinality(p_order_ids) = 0 then return 0; end if;
  if cardinality(p_order_ids) > 200 then raise exception 'too_many_orders'; end if;

  for v_row in
    select * from public.orders where id = any (p_order_ids) order by id for update
  loop
    if p_shipped then
      if v_row.shipped_at is not null then continue; end if;
      if v_row.status <> 'confirmed' or v_row.ready_at is null then
        raise exception 'order_not_ready:%', v_row.reference;
      end if;
      update public.orders set shipped_at = now(), shipped_by = v_uid where id = v_row.id;
      insert into public.order_audit_log (order_id, actor_id, action, detail)
      values (v_row.id, v_uid, 'order_shipped', '{}'::jsonb);
    else
      if v_row.shipped_at is null then continue; end if;
      update public.orders set shipped_at = null, shipped_by = null where id = v_row.id;
      insert into public.order_audit_log (order_id, actor_id, action, detail)
      values (v_row.id, v_uid, 'order_shipped_reopened', jsonb_build_object('shipped_at', v_row.shipped_at));
    end if;
    v_changed := v_changed + 1;
  end loop;

  if v_changed = 0 and p_shipped and not exists (
    select 1 from public.orders where id = any (p_order_ids)
  ) then
    raise exception 'order_not_found';
  end if;

  return v_changed;
end;
$$;

revoke all on function public.order_set_ready(uuid, boolean) from public;
revoke all on function public.order_set_shipped(uuid[], boolean) from public;
grant execute on function public.order_set_ready(uuid, boolean) to authenticated;
grant execute on function public.order_set_shipped(uuid[], boolean) to authenticated;

-- ---------- locks ----------

/*
 * A ready order's contents are frozen: no lot added, changed or removed, no
 * line edited, no shortfall reason rewritten. What was confirmed as prepared
 * stays what it is, until somebody reopens it. Managers included — reopening
 * is one tap, and it leaves a record that the order was changed after it was
 * called ready.
 */
create or replace function public.guard_ready_order_contents()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order_id uuid;
begin
  if tg_table_name = 'lot_allocations' then
    select l.order_id into v_order_id
      from public.order_lines l
     where l.id = coalesce(new.order_line_id, old.order_line_id);
  else
    v_order_id := coalesce(new.order_id, old.order_id);
  end if;

  if exists (select 1 from public.orders o where o.id = v_order_id and o.ready_at is not null) then
    raise exception 'order_ready_locked';
  end if;

  return coalesce(new, old);
end;
$$;

create trigger lot_allocations_guard_ready
  before insert or update or delete on public.lot_allocations
  for each row execute function public.guard_ready_order_contents();

create trigger order_lines_guard_ready
  before insert or update or delete on public.order_lines
  for each row execute function public.guard_ready_order_contents();

/*
 * A shipped order is history: its customer, dates, delivery method, type,
 * status and note no longer change. Incidents and replacement orders are how
 * something about it gets followed up. The milestone columns themselves stay
 * writable, which is how order_set_shipped() reopens it.
 */
create or replace function public.guard_shipped_order_edit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.shipped_at is not null and new.shipped_at is not null and (
       new.customer_id        is distinct from old.customer_id
    or new.delivery_date      is distinct from old.delivery_date
    or new.delivery_time      is distinct from old.delivery_time
    or new.preparation_date   is distinct from old.preparation_date
    or new.delivery_method_id is distinct from old.delivery_method_id
    or new.status             is distinct from old.status
    or new.order_type         is distinct from old.order_type
    or new.note               is distinct from old.note
  ) then
    raise exception 'order_shipped_locked';
  end if;
  return new;
end;
$$;

create trigger orders_guard_shipped
  before update on public.orders
  for each row execute function public.guard_shipped_order_edit();

-- ---------- drafts are not prepared ----------

/*
 * Standing orders are generated as drafts precisely so that nothing reaches
 * the floor before a person confirms it — but lots could still be recorded
 * against a draft, and the preparation screen listed them. A lot now needs a
 * CONFIRMED order (it used to need "not cancelled"). No lot has ever been
 * recorded on a draft, so nothing existing is affected.
 */
drop policy if exists "lots: approved insert" on public.lot_allocations;
create policy "lots: approved insert" on public.lot_allocations
  for insert to authenticated
  with check (
    ( select is_approved())
    and created_by = ( select auth.uid())
    and exists (
      select 1
        from public.order_lines ol
        join public.orders o on o.id = ol.order_id
       where ol.id = lot_allocations.order_line_id
         and o.status = 'confirmed'
    )
  );
