-- "Suiza pro México" and "Suiza pro Mexico" were the same customer, entered
-- twice (2026-10-23). The active one — typed, with the orders — stays; it
-- takes the address the other had (and where the map placed it), and any
-- contact detail it lacks. The other had nothing else pointing at it.
do $$
declare
  v_keep constant uuid := '4f50da7e-c82d-4923-8a33-76a197d3b520';
  v_drop constant uuid := '6d2f1df0-2873-45f6-a745-548057218607';
begin
  if not exists (select 1 from public.customers where id = v_drop) then return; end if;

  update public.customers k
     set street = coalesce(k.street, d.street),
         postal_code = coalesce(k.postal_code, d.postal_code),
         city = coalesce(k.city, d.city),
         latitude = coalesce(k.latitude, d.latitude),
         longitude = coalesce(k.longitude, d.longitude),
         location_precision = coalesce(k.location_precision, d.location_precision),
         geocoded_at = coalesce(k.geocoded_at, d.geocoded_at),
         address_checked_at = coalesce(k.address_checked_at, d.address_checked_at),
         address_checked_by = coalesce(k.address_checked_by, d.address_checked_by),
         delivery_notes = coalesce(k.delivery_notes, d.delivery_notes),
         website = coalesce(k.website, d.website)
    from public.customers d
   where k.id = v_keep and d.id = v_drop;

  update public.customer_details k
     set email = coalesce(k.email, d.email), email2 = coalesce(k.email2, d.email2),
         phone = coalesce(k.phone, d.phone), phone2 = coalesce(k.phone2, d.phone2), mobile = coalesce(k.mobile, d.mobile),
         language = coalesce(k.language, d.language),
         billing_address = coalesce(k.billing_address, d.billing_address),
         billing_postal_code = coalesce(k.billing_postal_code, d.billing_postal_code),
         billing_city = coalesce(k.billing_city, d.billing_city),
         billing_country = coalesce(k.billing_country, d.billing_country),
         vat_no = coalesce(k.vat_no, d.vat_no), uid_no = coalesce(k.uid_no, d.uid_no),
         bexio_remarks = coalesce(k.bexio_remarks, d.bexio_remarks)
    from public.customer_details d
   where k.customer_id = v_keep and d.customer_id = v_drop;
  -- The bexio contact behind both now names the one customer.
  update public.customer_details set bexio_no = coalesce(bexio_no, 212)
   where customer_id = v_keep and not exists (select 1 from public.customer_details where bexio_no = 212);

  delete from public.customers where id = v_drop;
end $$;
