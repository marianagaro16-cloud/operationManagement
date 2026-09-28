-- ============================================================
-- Sales: the report — units and net kg, a month against the one before.
--
-- Confirmed orders, by delivery date, up to today: an order scheduled for a
-- later day is not a sale yet. The running month compares against the same
-- days of the month before (1-28 against 1-28), so it is not made to look
-- small by an unfinished month; a past month compares in full.
--
-- By customer, by product, by customer type, and the months since history
-- began. For sales (is_sales()). No money: the app has no prices.
-- ============================================================

create or replace function public.sales_report(p_month date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today    date := (now() at time zone 'Europe/Zurich')::date;
  v_start    date := date_trunc('month', p_month)::date;
  v_end      date;
  v_prev     date;
  v_prev_end date;
begin
  if not public.is_sales() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  v_end  := least((v_start + interval '1 month - 1 day')::date, v_today);
  v_prev := (v_start - interval '1 month')::date;
  -- The same days of the month before, as far as that month has them.
  v_prev_end := least(v_prev + (v_end - v_start), (v_start - 1));

  return (
    with lines as (
      select o.customer_id, l.product_id, o.delivery_date d,
             l.ordered_quantity q, l.ordered_quantity * p.net_weight_kg kg
        from public.orders o
        join public.order_lines l on l.order_id = o.id
        left join public.products p on p.id = l.product_id
       where o.status = 'confirmed' and o.delivery_date <= v_today
    ),
    scoped as (
      select *, (d between v_start and v_end) cur, (d between v_prev and v_prev_end) prev
        from lines
       where d between v_prev and v_end
    )
    select jsonb_build_object(
      'period',   jsonb_build_object('from', v_start, 'to', v_end),
      'previous', jsonb_build_object('from', v_prev, 'to', v_prev_end),
      'totals', (
        select jsonb_build_object(
          'quantity', coalesce(sum(q) filter (where cur), 0),
          'kg', round(coalesce(sum(kg) filter (where cur), 0)::numeric, 1),
          'prev_quantity', coalesce(sum(q) filter (where prev), 0),
          'prev_kg', round(coalesce(sum(kg) filter (where prev), 0)::numeric, 1),
          'customers', count(distinct customer_id) filter (where cur))
          from scoped),
      'customers', (
        select coalesce(jsonb_agg(x order by x.quantity desc, x.prev_quantity desc), '[]'::jsonb)
          from (select c.id, c.company_name name, c.city,
                       coalesce(sum(s.q) filter (where s.cur), 0) quantity,
                       round(coalesce(sum(s.kg) filter (where s.cur), 0)::numeric, 1) kg,
                       coalesce(sum(s.q) filter (where s.prev), 0) prev_quantity,
                       round(coalesce(sum(s.kg) filter (where s.prev), 0)::numeric, 1) prev_kg
                  from scoped s join public.customers c on c.id = s.customer_id
                 group by c.id, c.company_name, c.city) x),
      'products', (
        select coalesce(jsonb_agg(x order by x.quantity desc, x.prev_quantity desc), '[]'::jsonb)
          from (select p.id, p.code, p.name,
                       coalesce(sum(s.q) filter (where s.cur), 0) quantity,
                       round(coalesce(sum(s.kg) filter (where s.cur), 0)::numeric, 1) kg,
                       coalesce(sum(s.q) filter (where s.prev), 0) prev_quantity,
                       round(coalesce(sum(s.kg) filter (where s.prev), 0)::numeric, 1) prev_kg
                  from scoped s join public.products p on p.id = s.product_id
                 group by p.id, p.code, p.name) x),
      'types', (
        select coalesce(jsonb_agg(x order by x.quantity desc, x.prev_quantity desc), '[]'::jsonb)
          from (select t.id, coalesce(t.name, '—') name,
                       count(distinct s.customer_id) filter (where s.cur) customers,
                       coalesce(sum(s.q) filter (where s.cur), 0) quantity,
                       round(coalesce(sum(s.kg) filter (where s.cur), 0)::numeric, 1) kg,
                       coalesce(sum(s.q) filter (where s.prev), 0) prev_quantity,
                       round(coalesce(sum(s.kg) filter (where s.prev), 0)::numeric, 1) prev_kg
                  from scoped s
                  join public.customers c on c.id = s.customer_id
                  left join public.customer_types t on t.id = c.customer_type_id
                 group by t.id, t.name) x),
      'trend', (
        select coalesce(jsonb_agg(x order by x.month), '[]'::jsonb)
          from (select date_trunc('month', d)::date as month,
                       sum(q) quantity, round(coalesce(sum(kg), 0)::numeric, 1) kg
                  from lines group by 1) x)
    )
  );
end;
$$;

revoke all on function public.sales_report(date) from public, anon;
grant execute on function public.sales_report(date) to authenticated;
