-- ============================================================
-- Boxes: which boxes an order is packed in, and how many
--
-- box_types   the list of boxes the warehouse uses: a name, the empty
--             weight, and the outside size. Managed by orders.manage_config,
--             like delivery methods. Retired rather than deleted once used.
--
-- order_boxes how many of each box type one order uses. Recorded by whoever
--             prepares (any approved user, the same people who record lots),
--             through order_set_box_quantity() only.
--
-- Rules:
--   * An order cannot be marked Ready without at least one box.
--   * Boxes stay editable while the order is Ready — they are often only
--     settled when loading — and freeze once it is Shipped.
--   * A Ready order cannot lose its last box.
--
-- The boxes' empty weight is added to the order's gross weight on screen;
-- the net weight never includes it.
-- ============================================================

create table if not exists public.box_types (
  id              uuid primary key default gen_random_uuid(),
  name            text not null check (btrim(name) <> ''),
  empty_weight_kg numeric(12,3) not null check (empty_weight_kg >= 0),
  -- Outside size in cm. Optional: a box nobody has measured is still a box.
  length_cm       numeric(8,1) check (length_cm is null or length_cm > 0),
  width_cm        numeric(8,1) check (width_cm is null or width_cm > 0),
  height_cm       numeric(8,1) check (height_cm is null or height_cm > 0),
  sort_order      int not null default 100,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

drop trigger if exists box_types_set_updated_at on public.box_types;
create trigger box_types_set_updated_at before update on public.box_types
  for each row execute function public.set_updated_at();

alter table public.box_types enable row level security;

drop policy if exists "box_types: approved read" on public.box_types;
create policy "box_types: approved read" on public.box_types
  for select to authenticated
  using ((select public.is_approved()));

drop policy if exists "box_types: config writes" on public.box_types;
create policy "box_types: config writes" on public.box_types
  for all to authenticated
  using ((select public.has_permission('orders.manage_config')))
  with check ((select public.has_permission('orders.manage_config')));

create table if not exists public.order_boxes (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references public.orders (id) on delete cascade,
  box_type_id uuid not null references public.box_types (id) on delete restrict,
  quantity    int not null check (quantity > 0 and quantity <= 999),
  created_by  uuid references public.profiles (id) on delete set null,
  updated_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (order_id, box_type_id)
);

create index if not exists order_boxes_box_type_idx on public.order_boxes (box_type_id);

drop trigger if exists order_boxes_set_updated_at on public.order_boxes;
create trigger order_boxes_set_updated_at before update on public.order_boxes
  for each row execute function public.set_updated_at();

alter table public.order_boxes enable row level security;

-- Read like lots. No write policy: writes go through the function below.
drop policy if exists "order_boxes: approved read" on public.order_boxes;
create policy "order_boxes: approved read" on public.order_boxes
  for select to authenticated
  using ((select public.is_approved()));

comment on table public.order_boxes is
  'Boxes one order is packed in. Written only by order_set_box_quantity().';

-- ---------- recording boxes ----------

/*
 * Set how many boxes of one type an order uses. 0 removes that type.
 *
 * Allowed on any order that is not cancelled and not shipped. A new type must
 * be active; a retired type already on the order can still be changed or
 * removed. Every change is written to the order's audit log.
 */
create or replace function public.order_set_box_quantity(
  p_order_id uuid,
  p_box_type_id uuid,
  p_quantity int
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := (select auth.uid());
  v_order public.orders;
  v_old   int;
begin
  if v_uid is null or not public.is_approved() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if p_quantity is null or p_quantity < 0 or p_quantity > 999 then
    raise exception 'invalid_box_quantity';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'order_not_found'; end if;
  if v_order.status = 'cancelled' then raise exception 'order_not_confirmed'; end if;
  if v_order.shipped_at is not null then raise exception 'order_shipped_locked'; end if;

  select quantity into v_old
    from public.order_boxes
   where order_id = p_order_id and box_type_id = p_box_type_id;

  if coalesce(v_old, 0) = p_quantity then return; end if;

  if p_quantity = 0 then
    -- A Ready order keeps at least one box: Ready was granted because it had one.
    if v_order.ready_at is not null and not exists (
      select 1 from public.order_boxes
       where order_id = p_order_id and box_type_id <> p_box_type_id
    ) then
      raise exception 'order_needs_boxes';
    end if;
    delete from public.order_boxes where order_id = p_order_id and box_type_id = p_box_type_id;
  elsif v_old is null then
    if not exists (select 1 from public.box_types where id = p_box_type_id and is_active) then
      raise exception 'box_type_inactive';
    end if;
    insert into public.order_boxes (order_id, box_type_id, quantity, created_by, updated_by)
    values (p_order_id, p_box_type_id, p_quantity, v_uid, v_uid);
  else
    update public.order_boxes
       set quantity = p_quantity, updated_by = v_uid
     where order_id = p_order_id and box_type_id = p_box_type_id;
  end if;

  insert into public.order_audit_log (order_id, actor_id, action, detail)
  values (p_order_id, v_uid, 'order_boxes_changed',
          jsonb_build_object('box_type_id', p_box_type_id, 'from', coalesce(v_old, 0), 'to', p_quantity));
end;
$$;

revoke all on function public.order_set_box_quantity(uuid, uuid, int) from public;
grant execute on function public.order_set_box_quantity(uuid, uuid, int) to authenticated;

-- ---------- Ready needs boxes ----------

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
    if not exists (select 1 from public.order_boxes where order_id = p_order_id) then
      raise exception 'order_needs_boxes';
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
