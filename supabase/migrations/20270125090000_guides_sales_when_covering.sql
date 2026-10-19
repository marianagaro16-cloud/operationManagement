-- ============================================================
-- Ventas reads a guide again on the days they cover its person (decided
-- 2026-10-19): the day guide and the articles, and they tick as any
-- coverer does. Supplier conditions and customer specifications stay
-- closed to them, covering or not. Nothing else opens a guide to them.
-- ============================================================

create or replace function public.guide_can_see(p_owner_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_approved() and (
    (not public.guide_barred() and (
      public.guide_can_edit()
      or p_owner_id = (select auth.uid())
      or public.is_absence_approver()
    ))
    -- Covering today, or tomorrow: the evening before is when one reads ahead.
    or public.guide_covers(p_owner_id, (now() at time zone 'Europe/Zurich')::date)
    or public.guide_covers(p_owner_id, (now() at time zone 'Europe/Zurich')::date + 1)
  );
$$;

create or replace function public.guide_check(p_point_id uuid, p_status text, p_comment text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := (select auth.uid());
  v_today date := (now() at time zone 'Europe/Zurich')::date;
  v_point public.guide_points;
begin
  select * into v_point from public.guide_points p where p.id = p_point_id and p.removed_at is null;
  if not found or v_uid is null or not public.guide_covers(v_point.guide_id, v_today) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if v_point.kind <> 'task' or not (extract(isodow from v_today)::smallint = any (v_point.weekdays)) then
    raise exception 'not_today';
  end if;

  if p_status is null then
    delete from public.guide_checks where point_id = p_point_id and check_date = v_today;
    return;
  end if;
  if p_status not in ('done', 'skipped') then raise exception 'invalid_status'; end if;

  insert into public.guide_checks (point_id, check_date, status, comment, checked_by)
  values (p_point_id, v_today, p_status, nullif(btrim(coalesce(p_comment, '')), ''), v_uid)
  on conflict (point_id, check_date) do update
    set status = excluded.status, comment = excluded.comment, checked_by = excluded.checked_by, updated_at = now();
end;
$$;

-- ---------- what stays closed to Ventas ----------

drop policy "supplier_order_info: read" on public.supplier_order_info;
create policy "supplier_order_info: read" on public.supplier_order_info for select to authenticated
  using ((select public.guide_reader()) and not (select public.guide_barred()));

drop policy "customer_specification_types: read" on public.customer_specification_types;
create policy "customer_specification_types: read" on public.customer_specification_types
  for select to authenticated
  using (((select public.has_permission('customers.manage')) or (select public.guide_reader())) and not (select public.guide_barred()));

drop policy "customer_specifications: read" on public.customer_specifications;
create policy "customer_specifications: read" on public.customer_specifications
  for select to authenticated
  using (((select public.has_permission('customers.manage')) or (select public.guide_reader())) and not (select public.guide_barred()));
