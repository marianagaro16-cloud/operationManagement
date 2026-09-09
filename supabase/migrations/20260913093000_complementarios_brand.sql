-- ============================================================
-- A fourth brand: Complementarios.
--
-- Added as a migration rather than typed into the live database, so a fresh
-- environment comes up with the same four brands the production one has —
-- seeded reference data is part of the schema, not of the data somebody
-- happens to have entered.
--
-- `on conflict do nothing` against the case-insensitive unique index, so this
-- is safe to re-run and safe on a database where somebody already added it by
-- hand through the Brands screen.
-- ============================================================

insert into public.brands (name, sort_order)
values ('Complementarios', 40)
on conflict do nothing;
