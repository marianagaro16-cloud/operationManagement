-- Customers who must pay in advance, because of their payment history.
-- Only the collections team sets it; everyone who handles orders is warned.

alter table public.customers
  add column prepay_required boolean not null default false,
  add column prepay_since date;

create or replace function public.guard_customer_prepay()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.prepay_required is distinct from old.prepay_required then
    if not public.is_collections() then
      raise exception 'not_authorized';
    end if;
    new.prepay_since := case when new.prepay_required then current_date else null end;
  else
    new.prepay_since := old.prepay_since;
  end if;
  return new;
end;
$$;

create trigger customers_guard_prepay before update on public.customers
  for each row execute function public.guard_customer_prepay();

-- The collections team is not necessarily allowed to edit customers otherwise.
create or replace function public.set_customer_prepay(p_customer_id uuid, p_on boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_collections() then
    raise exception 'not_authorized';
  end if;
  update public.customers set prepay_required = p_on where id = p_customer_id;
  if not found then
    raise exception 'not_found';
  end if;
end;
$$;

revoke all on function public.set_customer_prepay(uuid, boolean) from public, anon;
grant execute on function public.set_customer_prepay(uuid, boolean) to authenticated;
