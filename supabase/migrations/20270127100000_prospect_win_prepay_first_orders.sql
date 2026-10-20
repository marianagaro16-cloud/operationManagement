-- Winning a prospect creates the customer: the first orders paid in advance are set then too,
-- as in the new-customer form. Later changes stay with the collections team.

drop function public.sales_prospect_win(uuid);

create function public.sales_prospect_win(p_prospect_id uuid, p_prepay_first_orders integer default 0)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p        public.prospects%rowtype;
  v_customer uuid;
begin
  if not public.is_sales() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  select * into v_p from public.prospects where id = p_prospect_id for update;
  if not found then
    raise exception 'prospect_not_found' using errcode = 'P0002';
  end if;
  if v_p.stage in ('won', 'lost') then
    raise exception 'prospect_closed' using errcode = '42501';
  end if;

  insert into public.customers (company_name, street, postal_code, city, customer_type_id, prepay_first_orders)
  values (v_p.company_name, v_p.street, v_p.postal_code, v_p.city, v_p.customer_type_id, coalesce(p_prepay_first_orders, 0))
  returning id into v_customer;

  insert into public.customer_notes (customer_id, kind_id, note_date, body, created_by, created_at)
  select v_customer, n.kind_id, n.note_date, n.body, n.created_by, n.created_at
    from public.prospect_notes n where n.prospect_id = p_prospect_id;

  -- The Actas of the meetings held with them, drafts included.
  update public.sales_actas
     set customer_id = v_customer, prospect_id = null
   where prospect_id = p_prospect_id;

  -- What was still planned with the prospect is planned with the customer now.
  update public.sales_activities
     set customer_id = v_customer, prospect_id = null
   where prospect_id = p_prospect_id and status = 'planned';

  perform set_config('app.prospect_closing', 'on', true);
  update public.prospects
     set stage = 'won', customer_id = v_customer, closed_at = now()
   where id = p_prospect_id;
  perform set_config('app.prospect_closing', 'off', true);

  return v_customer;
end;
$$;

revoke all on function public.sales_prospect_win(uuid, integer) from public, anon;
grant execute on function public.sales_prospect_win(uuid, integer) to authenticated;
