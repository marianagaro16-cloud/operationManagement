-- ============================================================
-- Winning a prospect: customers have no contact-person field (their name is
-- generated from the company name), so the contact details stay on the
-- prospect, which the customer's file links back to.
-- ============================================================

create or replace function public.sales_prospect_win(p_prospect_id uuid)
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

  insert into public.customers (company_name, street, postal_code, city, customer_type_id)
  values (v_p.company_name, v_p.street, v_p.postal_code, v_p.city, v_p.customer_type_id)
  returning id into v_customer;

  insert into public.customer_notes (customer_id, kind, note_date, body, created_by, created_at)
  select v_customer, n.kind, n.note_date, n.body, n.created_by, n.created_at
    from public.prospect_notes n where n.prospect_id = p_prospect_id;

  perform set_config('app.prospect_closing', 'on', true);
  update public.prospects
     set stage = 'won', customer_id = v_customer, closed_at = now(),
         next_step = null, next_step_on = null
   where id = p_prospect_id;
  perform set_config('app.prospect_closing', 'off', true);

  return v_customer;
end;
$$;
