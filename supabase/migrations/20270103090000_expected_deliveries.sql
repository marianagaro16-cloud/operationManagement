-- ============================================================
-- EXPECTED DELIVERIES
--
-- What is coming from a supplier, so the floor is ready for it: the day (or
-- the week, while the supplier has not confirmed), how many pallets, where
-- they go, and — when known — what is on them.
--
-- The reception module says "a reception is not a purchase order", and that
-- stays true: nothing here is required to register a delivery, and a lorry
-- nobody announced is received exactly as before. An expected delivery is a
-- notice written by the office; when it arrives, ONE reception closes it.
--
-- Decided 2026-10-08:
--   writes   Admin, Owners, Manager and Power User
--   reads    those, and the people on the reception list — nobody else
--   arrival  the receiver registers the reception from the entry (or accepts
--            the suggestion on a new reception), compares the lines, and a
--            difference marks the reception's quantity check
--   history  arrived and cancelled entries are kept; nothing is deleted
-- ============================================================

create type public.expected_delivery_status as enum ('expected', 'arrived', 'cancelled');

/* Where the goods go, so room is made in the right place. */
create type public.expected_storage as enum ('dry', 'refrigerated', 'frozen');


-- ---------- who ----------

/*
 * Enters, changes and cancels: the office. By ROLE and not by a permission,
 * because goods_reception.manage_all is also held by the Production manager,
 * who receives but does not announce.
 */
create or replace function public.can_manage_expected_deliveries()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin()
      or exists (
        select 1 from public.profiles p
         where p.id = (select auth.uid())
           and p.status = 'approved'
           and p.deleted_at is null
           and p.role in ('manager', 'power_user')
      );
$$;

/* Reads: the office and whoever is on the reception list. */
create or replace function public.can_see_expected_deliveries()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.can_manage_expected_deliveries()
      or public.is_goods_reception_assignee();
$$;

revoke all on function public.can_manage_expected_deliveries() from public, anon;
revoke all on function public.can_see_expected_deliveries() from public, anon;
grant execute on function public.can_manage_expected_deliveries() to authenticated;
grant execute on function public.can_see_expected_deliveries() to authenticated;


-- ---------- the deliveries ----------

create table public.expected_deliveries (
  id uuid primary key default gen_random_uuid(),

  supplier_id    uuid not null references public.suppliers (id) on delete restrict,
  transporter_id uuid references public.transporters (id) on delete restrict,

  /*
   * Exactly one of the two: the day, or — while the supplier has not
   * confirmed — the Monday of the week it should come in.
   */
  expected_date date,
  expected_week date,
  -- The last day it can arrive and still be on time: the day itself, or the
  -- Friday of its week. Written by the trigger below.
  due_date date not null,
  -- How many times the date was pushed to another day or week.
  moved_count int not null default 0,

  pallets int check (pallets is null or pallets > 0),
  storage public.expected_storage[] not null check (cardinality(storage) >= 1),
  note    text,

  status public.expected_delivery_status not null default 'expected',

  -- The reception that closed it. One reception, one expected delivery.
  reception_id uuid unique references public.goods_receptions (id) on delete restrict,

  cancelled_at  timestamptz,
  cancelled_by  uuid references public.profiles (id) on delete set null,
  cancel_reason text,

  created_by uuid not null references public.profiles (id) on delete restrict,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint expected_deliveries_day_or_week check ((expected_date is null) <> (expected_week is null)),
  constraint expected_deliveries_week_is_monday check (expected_week is null or extract(isodow from expected_week) = 1),
  constraint expected_deliveries_arrived_has_reception check ((status = 'arrived') = (reception_id is not null)),
  constraint expected_deliveries_cancelled_is_stamped check ((status = 'cancelled') = (cancelled_at is not null))
);

create index expected_deliveries_open_idx     on public.expected_deliveries (due_date) where status = 'expected';
create index expected_deliveries_due_idx      on public.expected_deliveries (due_date);
create index expected_deliveries_supplier_idx on public.expected_deliveries (supplier_id);

create or replace function public.set_expected_delivery_due()
returns trigger
language plpgsql
as $$
declare
  v_moved boolean;
begin
  new.due_date := coalesce(new.expected_date, new.expected_week + 4);

  if TG_OP = 'UPDATE' then
    if old.expected_date is not null then
      v_moved := new.due_date <> old.due_date;
    else
      -- A week made exact inside that same week is a confirmation, not a move.
      v_moved := coalesce(
        new.expected_week <> old.expected_week,
        new.expected_date not between old.expected_week and old.expected_week + 6
      );
    end if;
    if v_moved then
      new.moved_count := old.moved_count + 1;
    end if;
  end if;

  return new;
end;
$$;

create trigger expected_deliveries_due before insert or update on public.expected_deliveries
  for each row execute function public.set_expected_delivery_due();

create trigger expected_deliveries_set_updated_at before update on public.expected_deliveries
  for each row execute function public.set_updated_at();

comment on table public.expected_deliveries is
  'A delivery the office announced. Not a purchase order: one reception closes it, and a delivery nobody announced is received as always.';


-- ---------- what is on it (optional) ----------

create table public.expected_delivery_lines (
  id          uuid primary key default gen_random_uuid(),
  delivery_id uuid not null references public.expected_deliveries (id) on delete cascade,

  -- A product of the catalogue, or a description: seals, crates and raw
  -- materials are not products we sell.
  product_id  uuid references public.products (id) on delete restrict,
  description text,

  quantity numeric(12,3) not null check (quantity > 0),
  unit     text not null check (unit in ('units', 'boxes', 'kg', 'pallets', 'bags', 'liters')),

  -- What the receiver counted on arrival. Null: not compared.
  received_quantity numeric(12,3) check (received_quantity is null or received_quantity >= 0),

  sort_order int not null default 0,
  created_at timestamptz not null default now(),

  constraint expected_delivery_lines_product_or_text check (
    (product_id is not null) <> (length(btrim(coalesce(description, ''))) > 0)
  )
);

create index expected_delivery_lines_delivery_idx on public.expected_delivery_lines (delivery_id, sort_order);


-- ---------- notices already sent ----------

create table public.expected_delivery_notices (
  delivery_id uuid not null references public.expected_deliveries (id) on delete cascade,
  -- eve: the afternoon before. morning: the day itself. week: the Monday of a
  -- week without a day. late: to whoever entered it, once the day has passed.
  kind        text not null check (kind in ('eve', 'morning', 'week', 'late')),
  -- The day the notice is about, so a moved delivery is announced again.
  notice_date date not null,
  sent_at     timestamptz not null default now(),
  primary key (delivery_id, kind, notice_date)
);


-- ---------- RLS ----------

alter table public.expected_deliveries       enable row level security;
alter table public.expected_delivery_lines   enable row level security;
-- No policies: written and read by the scheduled job only.
alter table public.expected_delivery_notices enable row level security;

create policy "expected_deliveries: receivers and office read" on public.expected_deliveries
  for select to authenticated using ((select public.can_see_expected_deliveries()));
create policy "expected_deliveries: office insert" on public.expected_deliveries
  for insert to authenticated
  with check ((select public.can_manage_expected_deliveries()) and created_by = (select auth.uid()));
create policy "expected_deliveries: office update" on public.expected_deliveries
  for update to authenticated
  using ((select public.can_manage_expected_deliveries()))
  with check ((select public.can_manage_expected_deliveries()));
-- No delete policy: an entry is cancelled, never removed.

create policy "expected_delivery_lines: receivers and office read" on public.expected_delivery_lines
  for select to authenticated using ((select public.can_see_expected_deliveries()));
create policy "expected_delivery_lines: office writes" on public.expected_delivery_lines
  for all to authenticated
  using ((select public.can_manage_expected_deliveries()))
  with check ((select public.can_manage_expected_deliveries()));

grant select, insert, update on public.expected_deliveries to authenticated;
grant select, insert, update, delete on public.expected_delivery_lines to authenticated;


-- ---------- arrival ----------

/*
 * The reception that closes an expected delivery.
 *
 * The receiver may not write to expected_deliveries, so the link is made
 * here: by someone who sees the entry and may write to that reception, for an
 * entry still open and a reception of the same supplier.
 */
create or replace function public.link_expected_delivery(p_delivery uuid, p_reception uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_delivery  public.expected_deliveries;
  v_reception public.goods_receptions;
begin
  if not public.can_see_expected_deliveries() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  select * into v_reception from public.goods_receptions where id = p_reception;
  if not found then
    raise exception 'reception_not_found' using errcode = 'P0002';
  end if;
  if not public.can_write_goods_reception(v_reception.status) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  select * into v_delivery from public.expected_deliveries where id = p_delivery for update;
  if not found or v_delivery.status <> 'expected' then
    raise exception 'expected_not_open' using errcode = '23514';
  end if;
  if v_reception.supplier_id is distinct from v_delivery.supplier_id then
    raise exception 'expected_supplier_mismatch' using errcode = '23514';
  end if;
  if exists (select 1 from public.expected_deliveries d where d.reception_id = p_reception) then
    raise exception 'reception_already_linked' using errcode = '23505';
  end if;

  update public.expected_deliveries
     set status = 'arrived', reception_id = p_reception, updated_by = (select auth.uid())
   where id = p_delivery;
end;
$$;

/*
 * What the receiver counted, line by line: [{ "id": …, "received": 6 }, …].
 *
 * A difference marks the reception's quantity check; every line counted and
 * equal marks it checked, when nobody had recorded a check yet. Returns
 * whether there is a difference.
 */
create or replace function public.record_expected_received(p_delivery uuid, p_lines jsonb)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_delivery  public.expected_deliveries;
  v_reception public.goods_receptions;
  v_differs   boolean;
  v_all_equal boolean;
begin
  if not public.can_see_expected_deliveries() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  select * into v_delivery from public.expected_deliveries where id = p_delivery for update;
  if not found or v_delivery.reception_id is null then
    raise exception 'expected_not_arrived' using errcode = '23514';
  end if;

  select * into v_reception from public.goods_receptions where id = v_delivery.reception_id;
  if not public.can_write_goods_reception(v_reception.status) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  update public.expected_delivery_lines l
     set received_quantity = (x.received)::numeric
    from jsonb_to_recordset(coalesce(p_lines, '[]'::jsonb)) as x (id uuid, received text)
   where l.id = x.id and l.delivery_id = p_delivery;

  select coalesce(bool_or(l.received_quantity is not null and l.received_quantity <> l.quantity), false),
         coalesce(bool_and(l.received_quantity is not null and l.received_quantity = l.quantity), false)
    into v_differs, v_all_equal
    from public.expected_delivery_lines l
   where l.delivery_id = p_delivery;

  if v_differs and v_reception.quantity_check <> 'discrepancy' then
    update public.goods_receptions
       set quantity_check = 'discrepancy', updated_by = (select auth.uid())
     where id = v_reception.id;
  elsif v_all_equal and v_reception.quantity_check = 'not_checked' then
    update public.goods_receptions
       set quantity_check = 'checked_ok', updated_by = (select auth.uid())
     where id = v_reception.id;
  end if;

  return v_differs;
end;
$$;

revoke all on function public.link_expected_delivery(uuid, uuid) from public, anon;
revoke all on function public.record_expected_received(uuid, jsonb) from public, anon;
grant execute on function public.link_expected_delivery(uuid, uuid) to authenticated;
grant execute on function public.record_expected_received(uuid, jsonb) to authenticated;
