-- ============================================================
-- Order book search, done in the database (2026-10-22).
--
-- The search used to fetch every order since go-live with all its lines and
-- filter in the app: slow, slower each month, and past PostgREST's row cap it
-- silently dropped the older orders. This returns only the ids that match;
-- the app then fetches just those orders.
--
-- The app does the accent-folded text matching against the customer and
-- product lists (small, already loaded) and passes, per search term, the ids
-- it matched plus the reference digits:
--   p_terms = [{"c": [customer ids], "p": [product ids], "r": "1001" | null}, …]
-- An order matches when EVERY term matches its customer, its reference or a
-- product on one of its lines — the same AND-of-terms rule as before.
--
-- Security invoker: orders RLS decides what each viewer gets back.
-- ============================================================

create or replace function public.search_order_ids(
  p_from  date,
  p_to    date,
  p_terms jsonb
)
returns setof uuid
language sql
stable
security invoker
set search_path = ''
as $$
  select o.id
  from public.orders o
  where o.delivery_date between p_from and p_to
    and not exists (
      select 1
      from jsonb_array_elements(coalesce(p_terms, '[]'::jsonb)) t
      where not (
        o.customer_id in (select jsonb_array_elements_text(coalesce(t -> 'c', '[]'::jsonb))::uuid)
        or (nullif(t ->> 'r', '') is not null
            and strpos(o.reference::text, t ->> 'r') > 0)
        or exists (
          select 1
          from public.order_lines l
          where l.order_id = o.id
            and l.product_id in (select jsonb_array_elements_text(coalesce(t -> 'p', '[]'::jsonb))::uuid)
        )
      )
    )
  order by o.delivery_date, o.reference
$$;

revoke all on function public.search_order_ids(date, date, jsonb) from public, anon;
grant execute on function public.search_order_ids(date, date, jsonb) to authenticated;
