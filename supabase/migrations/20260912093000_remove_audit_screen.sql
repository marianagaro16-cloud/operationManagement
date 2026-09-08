-- ============================================================
-- Remove the audit SCREEN, keep the audit DATA.
--
-- Nobody uses /admin/audit, so the page, its unified view and its two
-- capabilities go. Not one row is deleted and not one trigger is removed:
-- every module log keeps recording exactly what it recorded yesterday, and
-- this migration is reversible by restoring the view and the two catalogue
-- rows.
--
-- THE PART THAT IS NOT COSMETIC
--
-- Four log tables gate their reads on has_permission('audit.view_operational'):
-- order, task, inventory and incident. Two of them are NOT just an audit
-- trail — they are the data behind features people use:
--
--   order_audit_log     the Lot Nummer Tracker's history panel, which answers
--                       "who entered this lot" and "who changed 12 to 15"
--   incident_audit_log  the History section of an incident, which is the
--                       investigation record §18 exists to preserve
--
-- Deleting the capability from permission_catalog cascades its grants away,
-- and has_permission() would then answer false for everyone except an admin
-- — so both features would quietly empty out for exactly the managers and
-- power users who use them. Nothing would error; the panels would just go
-- blank, which is the worst way for a permission to break.
--
-- So each log is repointed to the capability that already governs its own
-- module. This is arguably where they should have been all along: reading the
-- lot history is part of using the Lot Tracker, not a separate act of
-- auditing, and canUseLotTracker() has always asked for orders.manage.
-- ============================================================

-- ---------- order log: the Lot Tracker's history ----------
drop policy if exists "audit: operational reads" on public.order_audit_log;
create policy "order_audit_log: order manage reads" on public.order_audit_log
  for select to authenticated using (public.has_permission('orders.manage'));

-- ---------- incident log: the investigation record ----------
drop policy if exists "incident_audit_log: operational reads" on public.incident_audit_log;
create policy "incident_audit_log: incident reads" on public.incident_audit_log
  for select to authenticated using (public.has_permission('incidents.view_all'));

-- ---------- task log ----------
drop policy if exists "task_audit_log: operational reads" on public.task_audit_log;
create policy "task_audit_log: task manage reads" on public.task_audit_log
  for select to authenticated using (public.has_permission('tasks.manage_occurrences'));

-- ---------- inventory log ----------
drop policy if exists "inventory_audit_log: operational reads" on public.inventory_audit_log;
create policy "inventory_audit_log: inventory manage reads" on public.inventory_audit_log
  for select to authenticated using (public.has_permission('inventory.manage_instances'));

/*
 * security_audit_log is deliberately untouched.
 *
 * Its read policy is `public.is_admin()`, which never referenced a capability,
 * so removing audit.view_security below cannot affect it. It goes on recording
 * who changed a role, approved an account, edited the permission matrix or
 * changed a product code — that is a security control, and the screen being
 * gone is not a reason to stop keeping it.
 */


-- ============================================================
-- the view and the capabilities
-- ============================================================
/*
 * The view was only ever there so one page could ORDER BY and LIMIT across
 * four logs at once. With the page gone it has no caller, and each log is
 * queried directly by the feature that owns it.
 */
drop view if exists public.operational_audit;

/*
 * Deleting the catalogue rows cascades the matching role_permissions grants,
 * because role_permissions.permission references permission_catalog(key) with
 * ON DELETE CASCADE. No orphan grant is left behind, and has_permission() for
 * a key that no longer exists simply returns false.
 */
delete from public.permission_catalog
 where key in ('audit.view_operational', 'audit.view_security');
