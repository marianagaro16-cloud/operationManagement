-- ============================================================
-- SHORT EXPIRY, TOLD TO MARKETING AND SALES
--
-- When a count of a template that watches expiry dates (Complementarios) is
-- completed and something is short, the list also goes out commercially: a
-- request to Marketing, so promotions can be planned with those products,
-- and a notice to Ventas and the owners (decided 2026-10-08).
-- ============================================================

-- One more kind in the dedupe ledger: sent once per count.
alter table public.inventory_notifications drop constraint if exists inventory_notifications_kind_check;
alter table public.inventory_notifications add constraint inventory_notifications_kind_check check (kind in (
  'assigned', 'due_today', 'deadline_soon', 'completed', 'digital_pending', 'review_required', 'short_shelf_life',
  'short_shelf_life_commercial'
));

-- In whose name the request to Marketing is made: Daniela. She receives
-- Marketing's comments and status changes. Change it here to change who.
insert into public.app_settings (key, value)
values ('inventory.short_expiry_requester', '"59538c6a-4a6f-48d3-bde3-5481d98ccc47"'::jsonb)
on conflict (key) do nothing;
