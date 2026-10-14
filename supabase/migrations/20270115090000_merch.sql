-- ============================================================
-- MERCH
--
-- "Week X, pens go to every Gastro customer": a campaign names an item, a
-- week and who gets it; each customer's first order with delivery that week
-- carries it, and what went to whom is kept for good.
--
-- Decided 2026-10-14:
--   merch      its own list, NOT catalogue products — no lots, not in the
--              sales report, not in "customers going quiet"
--   who gets   customer type(s), minus or plus customers by hand
--   which      the first not-yet-shipped order with delivery in the week; no
--              order → it waits for the next one, up to the campaign's own
--              number of weeks, then "not sent"
--   orders     sale, event, sponsorship and consignment — never a sample or
--              a replacement
--   quantity   the campaign's, changeable per customer and on the order
--   packing    ticked as packed, or "not sent" with a reason; Ready waits
--              until every merch item on the order is one or the other
--   stock      per item: what came in, less what shipped and what was
--              handed over in person
--   plans      Admin, Owners, Ventas, Managers and Power Users
-- ============================================================


-- ---------- who plans ----------

/* Ventas (with Admin and Owners, as is_sales() has it), Managers and Power Users. */
create or replace function public.can_manage_merch()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_sales()
      or exists (
        select 1 from public.profiles p
         where p.id = (select auth.uid())
           and p.status = 'approved'
           and p.deleted_at is null
           and p.role in ('manager', 'power_user')
      );
$$;

revoke all on function public.can_manage_merch() from public, anon;
grant execute on function public.can_manage_merch() to authenticated;


-- ---------- items and their stock ----------

create table public.merch_items (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(btrim(name)) > 0),
  note        text,
  -- Never deleted: a retired item keeps its history.
  is_active   boolean not null default true,
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create unique index merch_items_name_key on public.merch_items (lower(btrim(name)));

create trigger merch_items_set_updated_at before update on public.merch_items
  for each row execute function public.set_updated_at();

/*
 * What came in (positive) and counted corrections (either sign). What went
 * out is not written here: it is read from shipped orders and hand-overs, so
 * reopening a shipment puts the stock back by itself.
 */
create table public.merch_stock_entries (
  id          uuid primary key default gen_random_uuid(),
  item_id     uuid not null references public.merch_items (id) on delete restrict,
  quantity    int  not null check (quantity <> 0 and abs(quantity) <= 1000000),
  entry_date  date not null default (now() at time zone 'Europe/Zurich')::date,
  note        text,
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now()
);

create index merch_stock_entries_item_idx on public.merch_stock_entries (item_id, entry_date desc);


-- ---------- campaigns ----------

create table public.merch_campaigns (
  id          uuid primary key default gen_random_uuid(),
  item_id     uuid not null references public.merch_items (id) on delete restrict,
  -- The Monday of the week it goes out.
  week_start  date not null check (extract(isodow from week_start) = 1),
  -- Per customer, unless changed for one of them.
  quantity    int  not null check (quantity between 1 and 9999),
  -- How many weeks after its own it may still wait for a customer's order.
  carry_weeks int  not null default 4 check (carry_weeks between 0 and 12),
  -- The last day an order may deliver it: the Sunday of the last week.
  deadline    date generated always as (week_start + (carry_weeks * 7 + 6)) stored,
  -- The types it was aimed at, to show — who actually gets it is the list below.
  customer_type_ids uuid[] not null default '{}',
  note        text,
  cancelled_at timestamptz,
  cancelled_by uuid references public.profiles (id) on delete set null,
  created_by  uuid references public.profiles (id) on delete set null,
  updated_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index merch_campaigns_week_idx on public.merch_campaigns (week_start desc);
create index merch_campaigns_item_idx on public.merch_campaigns (item_id);

create trigger merch_campaigns_set_updated_at before update on public.merch_campaigns
  for each row execute function public.set_updated_at();

create type public.merch_packing as enum ('open', 'packed', 'not_sent');

/*
 * One customer of one campaign — and, once an order carries it, the merch
 * line of that order.
 *
 *   waiting   no order yet (order_id null, not expired)
 *   on order  order_id set, packing open or packed
 *   sent      packed on an order that shipped
 *   not sent  marked so while packing, or no order came in time (expired_at)
 */
create table public.merch_campaign_customers (
  id           uuid primary key default gen_random_uuid(),
  campaign_id  uuid not null references public.merch_campaigns (id) on delete cascade,
  customer_id  uuid not null references public.customers (id) on delete restrict,
  quantity     int  not null check (quantity between 1 and 9999),
  order_id     uuid references public.orders (id) on delete set null,
  packing      public.merch_packing not null default 'open',
  not_sent_reason text check (not_sent_reason in ('none_left', 'declined', 'forgot', 'other')),
  not_sent_note   text,
  packed_by    uuid references public.profiles (id) on delete set null,
  packed_at    timestamptz,
  expired_at   timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (campaign_id, customer_id),
  constraint merch_cc_packed_needs_order check (packing = 'open' or order_id is not null),
  constraint merch_cc_not_sent_reason check (
    (packing = 'not_sent') = (not_sent_reason is not null)
    and (not_sent_reason is distinct from 'other' or length(btrim(coalesce(not_sent_note, ''))) > 0)
  ),
  constraint merch_cc_expired_has_no_order check (expired_at is null or order_id is null)
);

create index merch_cc_customer_idx on public.merch_campaign_customers (customer_id);
create index merch_cc_order_idx    on public.merch_campaign_customers (order_id) where order_id is not null;
create index merch_cc_waiting_idx  on public.merch_campaign_customers (campaign_id) where order_id is null and expired_at is null;

create trigger merch_campaign_customers_set_updated_at before update on public.merch_campaign_customers
  for each row execute function public.set_updated_at();


-- ---------- handed over in person ----------

create table public.merch_handouts (
  id          uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id) on delete restrict,
  item_id     uuid not null references public.merch_items (id) on delete restrict,
  quantity    int  not null check (quantity between 1 and 9999),
  given_on    date not null,
  note        text,
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now()
);

create index merch_handouts_customer_idx on public.merch_handouts (customer_id, given_on desc);
create index merch_handouts_item_idx     on public.merch_handouts (item_id, given_on desc);


-- ---------- notices already sent (scheduler only) ----------

create table public.merch_notices (
  kind        text not null check (kind in ('heads_up', 'low_stock')),
  -- heads_up: the person told; low_stock: the item.
  ref_id      uuid not null,
  -- heads_up: the Monday; low_stock: the day it was first short.
  notice_date date not null,
  created_at  timestamptz not null default now(),
  primary key (kind, ref_id, notice_date)
);


-- ---------- stock ----------

/*
 * Per item: in, out, and what is still promised.
 *
 *   stock     entries − packed merch on shipped orders − hand-overs
 *   promised  every campaign line not finished yet: waiting, or on an order
 *             not shipped — open or packed
 */
create view public.merch_item_stock
with (security_invoker = true) as
select
  i.id as item_id,
  coalesce((select sum(e.quantity) from public.merch_stock_entries e where e.item_id = i.id), 0)::int as received,
  coalesce((
    select sum(t.quantity)
      from public.merch_campaign_customers t
      join public.merch_campaigns c on c.id = t.campaign_id
      join public.orders o on o.id = t.order_id
     where c.item_id = i.id and t.packing = 'packed' and o.shipped_at is not null
  ), 0)::int as sent,
  coalesce((select sum(h.quantity) from public.merch_handouts h where h.item_id = i.id), 0)::int as handed,
  coalesce((
    select sum(t.quantity)
      from public.merch_campaign_customers t
      join public.merch_campaigns c on c.id = t.campaign_id
      left join public.orders o on o.id = t.order_id
     where c.item_id = i.id
       and c.cancelled_at is null
       and t.expired_at is null
       and t.packing <> 'not_sent'
       and (o.id is null or o.shipped_at is null)
  ), 0)::int as promised
from public.merch_items i;


-- ============================================================
-- putting merch on orders
-- ============================================================

/*
 * The orders that can carry merch.
 */
create or replace function public.merch_order_type_ok(p_type public.order_type)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_type::text in ('sale', 'event', 'sponsorship', 'consignment');
$$;

/*
 * Re-place one customer's merch.
 *
 * 1. Merch on an order that no longer fits — cancelled, moved out of the
 *    window, another type, another customer, campaign cancelled — comes off
 *    it, unless the order already shipped.
 * 2. Every open line (not packed, not marked not sent, not on a Ready order)
 *    goes on the customer's earliest order in its window that is not Ready,
 *    not shipped and delivers today or later — or waits for one.
 *
 * Idempotent, so it runs after every change to an order and every save of a
 * campaign. Internal: called by the trigger and the campaign functions only.
 */
create or replace function public.merch_assign(p_customer_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'Europe/Zurich')::date;
  r record;
  v_order uuid;
begin
  if p_customer_id is null then return; end if;

  update public.merch_campaign_customers t
     set order_id = null, packing = 'open', not_sent_reason = null, not_sent_note = null,
         packed_by = null, packed_at = null
    from public.orders o, public.merch_campaigns c
   where t.customer_id = p_customer_id
     and o.id = t.order_id
     and c.id = t.campaign_id
     and o.shipped_at is null
     and (
       o.status = 'cancelled'
       or o.customer_id <> t.customer_id
       or not public.merch_order_type_ok(o.order_type)
       or o.delivery_date not between c.week_start and c.deadline
       or c.cancelled_at is not null
     );

  for r in
    select t.id, t.order_id, c.week_start, c.deadline
      from public.merch_campaign_customers t
      join public.merch_campaigns c on c.id = t.campaign_id
      left join public.orders cur on cur.id = t.order_id
     where t.customer_id = p_customer_id
       and t.packing = 'open'
       and t.expired_at is null
       and c.cancelled_at is null
       and (cur.id is null or (cur.ready_at is null and cur.shipped_at is null))
  loop
    select o.id into v_order
      from public.orders o
     where o.customer_id = p_customer_id
       and o.status in ('draft', 'confirmed')
       and public.merch_order_type_ok(o.order_type)
       and o.ready_at is null
       and o.shipped_at is null
       and o.delivery_date between greatest(r.week_start, v_today) and r.deadline
     order by o.delivery_date, o.delivery_time nulls last, o.reference
     limit 1;

    -- Already on an order that still fits and nothing earlier came in: stay.
    if v_order is distinct from r.order_id then
      if r.order_id is not null and v_order is null and exists (
        select 1 from public.orders o
         where o.id = r.order_id and o.delivery_date between r.week_start and r.deadline
      ) then
        continue;
      end if;
      update public.merch_campaign_customers set order_id = v_order where id = r.id;
    end if;
  end loop;
end;
$$;

revoke all on function public.merch_assign(uuid) from public, anon, authenticated;

create or replace function public.orders_merch_assign()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.merch_assign(new.customer_id);
  if tg_op = 'UPDATE' and old.customer_id is distinct from new.customer_id then
    perform public.merch_assign(old.customer_id);
  end if;
  return null;
end;
$$;

create trigger orders_merch_assign_ins after insert on public.orders
  for each row execute function public.orders_merch_assign();
create trigger orders_merch_assign_upd
  after update of customer_id, delivery_date, delivery_time, status, order_type, ready_at, shipped_at on public.orders
  for each row execute function public.orders_merch_assign();


-- ============================================================
-- campaigns: save and cancel
-- ============================================================

/*
 * Create or change a campaign with its final list of customers.
 *
 * Customers taken off lose their line unless it is packed, marked, on a
 * Ready order or sent — those are facts and stay. New ones get the
 * campaign's quantity; a changed campaign quantity follows on every line that
 * still had the old one and is not on a Ready order. Then everybody's merch
 * is re-placed.
 */
create or replace function public.merch_save_campaign(
  p_id uuid,
  p_item_id uuid,
  p_week_start date,
  p_quantity int,
  p_carry_weeks int,
  p_customer_type_ids uuid[],
  p_customer_ids uuid[],
  p_note text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_old public.merch_campaigns;
  v_id  uuid;
  v_affected uuid[];
  c uuid;
begin
  if not public.can_manage_merch() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if p_customer_ids is null or cardinality(p_customer_ids) = 0 then
    raise exception 'merch_no_customers';
  end if;
  if not exists (select 1 from public.merch_items where id = p_item_id) then
    raise exception 'merch_item_not_found';
  end if;

  if p_id is null then
    if not exists (select 1 from public.merch_items where id = p_item_id and is_active) then
      raise exception 'merch_item_inactive';
    end if;
    insert into public.merch_campaigns (item_id, week_start, quantity, carry_weeks, customer_type_ids, note, created_by, updated_by)
    values (p_item_id, p_week_start, p_quantity, p_carry_weeks, coalesce(p_customer_type_ids, '{}'),
            nullif(btrim(coalesce(p_note, '')), ''), v_uid, v_uid)
    returning id into v_id;
    v_affected := p_customer_ids;
  else
    select * into v_old from public.merch_campaigns where id = p_id for update;
    if not found then raise exception 'merch_campaign_not_found'; end if;
    if v_old.cancelled_at is not null then raise exception 'merch_campaign_cancelled'; end if;
    v_id := p_id;

    update public.merch_campaigns
       set item_id = p_item_id, week_start = p_week_start, quantity = p_quantity, carry_weeks = p_carry_weeks,
           customer_type_ids = coalesce(p_customer_type_ids, '{}'),
           note = nullif(btrim(coalesce(p_note, '')), ''), updated_by = v_uid
     where id = p_id;

    select array_agg(distinct x) into v_affected
      from (select unnest(p_customer_ids) as x
            union select customer_id from public.merch_campaign_customers where campaign_id = p_id) s;

    delete from public.merch_campaign_customers t
     where t.campaign_id = p_id
       and t.customer_id <> all (p_customer_ids)
       and t.packing = 'open'
       and not exists (select 1 from public.orders o where o.id = t.order_id and (o.ready_at is not null or o.shipped_at is not null));

    if p_quantity <> v_old.quantity then
      update public.merch_campaign_customers t
         set quantity = p_quantity
       where t.campaign_id = p_id
         and t.quantity = v_old.quantity
         and not exists (select 1 from public.orders o where o.id = t.order_id and (o.ready_at is not null or o.shipped_at is not null));
    end if;

    -- A wider window gives expired customers another chance.
    update public.merch_campaign_customers t
       set expired_at = null
      from public.merch_campaigns c
     where c.id = p_id and t.campaign_id = p_id and t.expired_at is not null
       and c.deadline >= (now() at time zone 'Europe/Zurich')::date;
  end if;

  insert into public.merch_campaign_customers (campaign_id, customer_id, quantity)
  select v_id, x, p_quantity from unnest(p_customer_ids) x
  on conflict (campaign_id, customer_id) do nothing;

  foreach c in array v_affected loop
    perform public.merch_assign(c);
  end loop;

  return v_id;
end;
$$;

/*
 * Cancel a campaign. What is not packed yet comes off its orders and stops
 * waiting; what is packed, on a Ready order, or sent stays — it is real.
 */
create or replace function public.merch_cancel_campaign(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.can_manage_merch() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  update public.merch_campaigns
     set cancelled_at = now(), cancelled_by = (select auth.uid()), updated_by = (select auth.uid())
   where id = p_id and cancelled_at is null;
  if not found then raise exception 'merch_campaign_not_found'; end if;

  delete from public.merch_campaign_customers t
   where t.campaign_id = p_id
     and t.packing = 'open'
     and not exists (select 1 from public.orders o where o.id = t.order_id and (o.ready_at is not null or o.shipped_at is not null));
end;
$$;

revoke all on function public.merch_save_campaign(uuid, uuid, date, int, int, uuid[], uuid[], text) from public, anon;
revoke all on function public.merch_cancel_campaign(uuid) from public, anon;
grant execute on function public.merch_save_campaign(uuid, uuid, date, int, int, uuid[], uuid[], text) to authenticated;
grant execute on function public.merch_cancel_campaign(uuid) to authenticated;


-- ============================================================
-- on the order: packing and quantity
-- ============================================================

/*
 * Packed, not sent (with a reason), or back to open — by whoever prepares
 * orders, as lots are. Frozen once the order is Ready, like the lots.
 */
create or replace function public.merch_set_packing(
  p_line_id uuid,
  p_packing public.merch_packing,
  p_reason text,
  p_note text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := (select auth.uid());
  v_line public.merch_campaign_customers;
  v_order public.orders;
begin
  if v_uid is null or not public.is_approved() or public.is_external() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  select * into v_line from public.merch_campaign_customers where id = p_line_id for update;
  if not found or v_line.order_id is null then raise exception 'merch_line_not_found'; end if;

  select * into v_order from public.orders where id = v_line.order_id;
  if v_order.status = 'cancelled' then raise exception 'order_not_confirmed'; end if;
  if v_order.shipped_at is not null then raise exception 'order_shipped_locked'; end if;
  if v_order.ready_at is not null then raise exception 'order_ready_locked'; end if;

  if p_packing = 'not_sent' then
    if p_reason is null or p_reason not in ('none_left', 'declined', 'forgot', 'other') then
      raise exception 'merch_reason_required';
    end if;
    if p_reason = 'other' and length(btrim(coalesce(p_note, ''))) = 0 then
      raise exception 'merch_reason_required';
    end if;
  end if;

  update public.merch_campaign_customers
     set packing = p_packing,
         not_sent_reason = case when p_packing = 'not_sent' then p_reason end,
         not_sent_note   = case when p_packing = 'not_sent' then nullif(btrim(coalesce(p_note, '')), '') end,
         packed_by = case when p_packing = 'open' then null else v_uid end,
         packed_at = case when p_packing = 'open' then null else now() end
   where id = p_line_id;

  insert into public.order_audit_log (order_id, actor_id, action, detail)
  values (v_order.id, v_uid, 'merch_packing',
          jsonb_build_object('line_id', p_line_id, 'from', v_line.packing, 'to', p_packing, 'reason', p_reason));

  -- Back to open: it may belong on an earlier order again.
  if p_packing = 'open' then
    perform public.merch_assign(v_line.customer_id);
  end if;
end;
$$;

/* How many: whoever plans merch, or manages orders — until the order is Ready. */
create or replace function public.merch_set_quantity(p_line_id uuid, p_quantity int)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_line public.merch_campaign_customers;
begin
  if not (public.can_manage_merch() or public.has_permission('orders.manage')) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if p_quantity is null or p_quantity < 1 or p_quantity > 9999 then
    raise exception 'merch_invalid_quantity';
  end if;

  select * into v_line from public.merch_campaign_customers where id = p_line_id for update;
  if not found then raise exception 'merch_line_not_found'; end if;
  if exists (select 1 from public.orders o where o.id = v_line.order_id and o.shipped_at is not null) then
    raise exception 'order_shipped_locked';
  end if;
  if exists (select 1 from public.orders o where o.id = v_line.order_id and o.ready_at is not null) then
    raise exception 'order_ready_locked';
  end if;

  update public.merch_campaign_customers set quantity = p_quantity where id = p_line_id;
  if v_line.order_id is not null then
    insert into public.order_audit_log (order_id, actor_id, action, detail)
    values (v_line.order_id, (select auth.uid()), 'merch_quantity',
            jsonb_build_object('line_id', p_line_id, 'from', v_line.quantity, 'to', p_quantity));
  end if;
end;
$$;

revoke all on function public.merch_set_packing(uuid, public.merch_packing, text, text) from public, anon;
revoke all on function public.merch_set_quantity(uuid, int) from public, anon;
grant execute on function public.merch_set_packing(uuid, public.merch_packing, text, text) to authenticated;
grant execute on function public.merch_set_quantity(uuid, int) to authenticated;


-- ============================================================
-- Ready waits for the merch
-- ============================================================

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
    if exists (select 1 from public.box_types where is_active)
       and not exists (select 1 from public.order_boxes where order_id = p_order_id) then
      raise exception 'order_needs_boxes';
    end if;
    -- Every merch item packed or marked not sent (2026-10-14).
    if exists (select 1 from public.merch_campaign_customers where order_id = p_order_id and packing = 'open') then
      raise exception 'order_merch_open';
    end if;

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


-- ============================================================
-- RLS
-- ============================================================

alter table public.merch_items              enable row level security;
alter table public.merch_stock_entries      enable row level security;
alter table public.merch_campaigns          enable row level security;
alter table public.merch_campaign_customers enable row level security;
alter table public.merch_handouts           enable row level security;
-- No policies: the scheduler's alone.
alter table public.merch_notices            enable row level security;

-- Items, campaigns and the lines: read by everyone approved, because whoever
-- packs an order sees its merch. Written through the functions above, or by
-- whoever plans merch.
create policy "merch_items: approved read" on public.merch_items
  for select to authenticated using ((select public.is_approved()));
create policy "merch_items: planners write" on public.merch_items
  for all to authenticated
  using ((select public.can_manage_merch())) with check ((select public.can_manage_merch()));

create policy "merch_campaigns: approved read" on public.merch_campaigns
  for select to authenticated using ((select public.is_approved()));

create policy "merch_campaign_customers: approved read" on public.merch_campaign_customers
  for select to authenticated using ((select public.is_approved()));

-- Stock and hand-overs: the planners.
create policy "merch_stock_entries: planners read" on public.merch_stock_entries
  for select to authenticated using ((select public.can_manage_merch()));
create policy "merch_stock_entries: planners add" on public.merch_stock_entries
  for insert to authenticated
  with check ((select public.can_manage_merch()) and created_by = (select auth.uid()));

create policy "merch_handouts: planners read" on public.merch_handouts
  for select to authenticated using ((select public.can_manage_merch()));
create policy "merch_handouts: planners add" on public.merch_handouts
  for insert to authenticated
  with check ((select public.can_manage_merch()) and created_by = (select auth.uid()));
-- A mistaken entry can be taken back.
create policy "merch_handouts: planners delete" on public.merch_handouts
  for delete to authenticated using ((select public.can_manage_merch()));

-- Not for the external (Marketing) account.
do $$
declare
  t text;
begin
  foreach t in array array['merch_items', 'merch_stock_entries', 'merch_campaigns', 'merch_campaign_customers', 'merch_handouts']
  loop
    execute format(
      'create policy "not for external accounts" on public.%I as restrictive for all to authenticated
         using (not (select public.is_external())) with check (not (select public.is_external()))',
      t
    );
  end loop;
end;
$$;

grant select, insert, update on public.merch_items to authenticated;
grant select, insert on public.merch_stock_entries to authenticated;
grant select on public.merch_campaigns to authenticated;
grant select on public.merch_campaign_customers to authenticated;
grant select, insert, delete on public.merch_handouts to authenticated;
grant select on public.merch_item_stock to authenticated;

comment on table public.merch_campaigns is
  'Merch for a week: an item, a quantity and who gets it. Each customer''s first order in the window carries it.';
comment on table public.merch_campaign_customers is
  'One customer of a campaign, and the merch line of the order that carries it. Status is derived: waiting, on order, sent, not sent.';
