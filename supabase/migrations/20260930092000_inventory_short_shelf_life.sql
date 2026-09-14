-- ============================================================
-- Warn about short shelf life when a count is completed.
--
-- Asked for the Complementarios inventory: when it is done, say which
-- products have less than three months left before they expire.
--
-- A setting on the template rather than a name matched in code. "Only
-- Complementarios" is a fact about that template today; written as
-- `name = 'Complementarios'` it would break on a rename and could not be
-- extended to a second template without a deploy. Null means no warning,
-- which is every other template.
-- ============================================================

alter table public.inventory_templates
  add column short_shelf_life_months smallint
  check (short_shelf_life_months is null or short_shelf_life_months between 1 and 24);

comment on column public.inventory_templates.short_shelf_life_months is
  'When set, completing a count of this template warns about stock expiring within this many months of the count date. Null = no warning.';

update public.inventory_templates set short_shelf_life_months = 3 where slug = 'complementarios';

-- One more alert kind in the dedupe ledger, so it is sent once per count.
alter table public.inventory_notifications drop constraint if exists inventory_notifications_kind_check;
alter table public.inventory_notifications add constraint inventory_notifications_kind_check check (kind in (
  'assigned', 'due_today', 'deadline_soon', 'completed', 'digital_pending', 'review_required', 'short_shelf_life'
));
