-- ============================================================
-- Checking the delivery addresses.
--
-- 214 addresses arrived from the contacts export, and 15 of them could only
-- be placed on their town: the map did not know the street. A stop placed on
-- a town still orders the round sensibly, and the driver still reads the real
-- address — but somebody going through the list has to be able to SEE which
-- ones those are, rather than opening each in a map to find out.
--
-- Two columns, both about the address and neither about the customer:
--
--   location_precision   'address' — the street itself was found
--                        'city'    — only the town; good enough to order by,
--                                    worth a human look
--   address_checked_at   somebody looked at it and said it is right. A review
--                        of 214 addresses is done over days, and this is what
--                        remembers where it got to.
-- ============================================================

alter table public.customers
  add column location_precision text
    check (location_precision is null or location_precision in ('address', 'city')),
  add column address_checked_at timestamptz,
  add column address_checked_by uuid references public.profiles (id) on delete set null;

comment on column public.customers.location_precision is
  'How exactly the coordinates were found: the street (address) or only the town (city). NULL while there are no coordinates.';
comment on column public.customers.address_checked_at is
  'When somebody confirmed the address is right. Cleared whenever the address itself changes.';

-- What is already known: everything placed is 'address' except the fifteen
-- the import could only put on their town.
update public.customers
   set location_precision = 'address'
 where latitude is not null;

update public.customers
   set location_precision = 'city'
 where latitude is not null
   and company_name in (
     'A Table & CO SA', 'Allcook SA', 'Alm Enterprises Limited Liability Company',
     'Bernisches Historisches Museum', 'Catering Sabores Latinos', 'Gastrophysik GmbH',
     'Hotel Eden au Lac AG, Zürich', 'Hotel Restaurante Les Rangiers', 'Lucha Libre',
     'MIMI''S Restaurant AG', 'Min Min Group GmbH', 'Mondieu GmbH',
     'Restaurant The Counter', 'Ristorantes Argentinos Streetfood', 'Tesoro Café'
   );

/*
 * A confirmation is about the address that was confirmed. Change the street
 * and the tick goes, because nobody has looked at the new one — which is the
 * whole point of having it.
 */
create or replace function public.customer_address_unchecked()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.street is distinct from old.street
     or new.postal_code is distinct from old.postal_code
     or new.city is distinct from old.city
     or new.country is distinct from old.country then
    new.address_checked_at := null;
    new.address_checked_by := null;
  end if;
  return new;
end;
$$;

create trigger customers_address_unchecked
  before update of street, postal_code, city, country on public.customers
  for each row execute function public.customer_address_unchecked();
