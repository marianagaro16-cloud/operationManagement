-- ============================================================
-- WHAT ARRIVED: product lines on a reception, with their best-before date
--
-- A reception used to say who delivered, in what state and whether the count
-- was right — never what. The floor now writes, per product, how much came
-- and until when it keeps, which replaces the office's step of copying Del
-- Barrio / Colectivo Comestibles deliveries into the order-control workbook.
--
-- Decided 2026-10-14:
--   what      product (catalogue or free text), quantity, best-before; lot
--             optional
--   which     every delivery, any supplier
--   required  no — a reception completes without lines
--   use       a record, listed and exported from Recepción; no alerts
--   who       whoever may write the reception (receivers while it is open),
--             and the office — Admin, Owners, Manager, Power User — at any
--             time, a completed reception included
-- ============================================================

create table public.goods_reception_lines (
  id           uuid primary key default gen_random_uuid(),
  reception_id uuid not null references public.goods_receptions (id) on delete cascade,

  -- A catalogue product, or a description: cheese, packaging and raw
  -- material are not products we sell.
  product_id   uuid references public.products (id) on delete restrict,
  description  text,

  quantity     numeric(12,3) check (quantity is null or quantity > 0),
  unit         text not null default 'units' check (unit in ('units', 'boxes', 'kg', 'pallets', 'bags', 'liters')),
  best_before  date,
  lot_number   text,
  note         text,

  sort_order   int not null default 0,
  created_by   uuid references public.profiles (id) on delete set null,
  updated_by   uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint goods_reception_lines_product_or_text check (
    (product_id is not null) <> (length(btrim(coalesce(description, ''))) > 0)
  )
);

create index goods_reception_lines_reception_idx on public.goods_reception_lines (reception_id, sort_order);
create index goods_reception_lines_product_idx   on public.goods_reception_lines (product_id);
create index goods_reception_lines_best_before_idx on public.goods_reception_lines (best_before);

create trigger goods_reception_lines_set_updated_at before update on public.goods_reception_lines
  for each row execute function public.set_updated_at();

comment on table public.goods_reception_lines is
  'What arrived on a reception: product or description, quantity, best-before. Optional; a record, not stock.';


-- ---------- who writes ----------

create or replace function public.can_write_reception_lines(p_reception_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.can_write_goods_reception_child(p_reception_id)
      or public.can_manage_expected_deliveries();
$$;

revoke all on function public.can_write_reception_lines(uuid) from public, anon;
grant execute on function public.can_write_reception_lines(uuid) to authenticated;


-- ---------- history ----------

create or replace function public.log_goods_reception_line_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.goods_reception_lines;
begin
  if tg_op = 'DELETE' then
    v_row := old;
    -- Going with its reception: nothing to record.
    if not exists (select 1 from public.goods_receptions r where r.id = old.reception_id) then
      return old;
    end if;
  else
    v_row := new;
  end if;

  insert into public.goods_reception_audit_log (reception_id, actor_id, action, new_value)
  values (
    v_row.reception_id,
    (select auth.uid()),
    case tg_op when 'INSERT' then 'line_added' when 'UPDATE' then 'line_changed' else 'line_removed' end,
    jsonb_build_object('product_id', v_row.product_id, 'description', v_row.description,
                       'quantity', v_row.quantity, 'best_before', v_row.best_before)
  );

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger goods_reception_lines_audit
  after insert or update or delete on public.goods_reception_lines
  for each row execute function public.log_goods_reception_line_change();


-- ---------- RLS ----------

alter table public.goods_reception_lines enable row level security;

-- Read like the reception itself: every approved user.
create policy "gr_lines: approved read" on public.goods_reception_lines
  for select to authenticated using ((select public.is_approved()));
create policy "gr_lines: scoped writes" on public.goods_reception_lines
  for all to authenticated
  using (public.can_write_reception_lines(reception_id))
  with check (public.can_write_reception_lines(reception_id));
create policy "not for external accounts" on public.goods_reception_lines
  as restrictive for all to authenticated
  using (not (select public.is_external())) with check (not (select public.is_external()));

grant select, insert, update, delete on public.goods_reception_lines to authenticated;
