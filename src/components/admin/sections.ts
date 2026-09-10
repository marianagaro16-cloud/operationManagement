import type { MessageKey } from '@/i18n';
import { can, type Permission, type Role } from '@/lib/authz';

/**
 * The shape of the management area.
 *
 * ONE definition, read by both the hub that lists the sections and the nav
 * that renders the tabs inside one. Two copies of this would drift the first
 * time a screen was added to one and not the other — which is exactly how the
 * area got to eighteen flat tabs in three scrolling rows.
 *
 * Routes are NOT moved. Every screen keeps the URL it already had, so links,
 * bookmarks and the redirects inside each page keep working; the section a
 * screen belongs to is derived from its path rather than encoded in it.
 *
 * Deliberately plain data with no 'use client': a Server Component renders the
 * hub and a Client Component renders the tabs, and both need this.
 */

export type SectionSlug = 'master-data' | 'work' | 'review' | 'system';

export interface AdminScreen {
  href: string;
  label: MessageKey;
  /** Null means every role that reached the admin layout may see it. */
  permission: Permission | null;
}

export interface AdminSection {
  slug: SectionSlug;
  label: MessageKey;
  /** One line on the hub card saying what lives in here. */
  description: MessageKey;
  screens: AdminScreen[];
}

/**
 * Four sections, grouped by the JOB somebody is doing, not by the module the
 * code happens to live in.
 *
 * MASTER DATA is the nouns the operation talks about. WORK SETUP is what
 * causes work to exist. REVIEW is looking backwards. SYSTEM is accounts and
 * configuration. A screen that would fit two goes where a person would look
 * for it, not where its permission key suggests.
 */
export const ADMIN_SECTIONS: AdminSection[] = [
  {
    slug: 'master-data',
    label: 'nav.sectionMasterData',
    description: 'nav.sectionMasterDataBody',
    screens: [
      { href: '/admin/customers', label: 'master.customersTitle', permission: 'customers.manage' },
      // Standing office reminders per customer — invoicing and transport.
      // Beside Customers because that is what they are about, and behind
      // customers.manage because a plain user must not read them at all.
      { href: '/admin/specifications', label: 'spec.title', permission: 'customers.manage' },
      // Who goods come FROM, and who carried them. Master data in the same
      // sense customers are, so they live beside them rather than inside the
      // reception module — a supplier outlives any one delivery.
      { href: '/admin/suppliers', label: 'gr.suppliersTitle', permission: 'goods_reception.manage_config' },
      { href: '/admin/transporters', label: 'gr.transportersTitle', permission: 'goods_reception.manage_config' },
      { href: '/admin/products', label: 'master.productsTitle', permission: 'products.manage' },
      { href: '/admin/brands', label: 'master.brandsTitle', permission: 'products.manage' },
      { href: '/admin/delivery-methods', label: 'master.methodsTitle', permission: 'orders.manage_config' },
      { href: '/admin/incident-types', label: 'incident.typesTitle', permission: 'incidents.manage_config' },
    ],
  },
  {
    slug: 'work',
    label: 'nav.sectionWork',
    description: 'nav.sectionWorkBody',
    screens: [
      { href: '/admin/tasks', label: 'nav.tasks', permission: 'tasks.manage_definitions' },
      { href: '/admin/recurring', label: 'master.recurringTitle', permission: 'orders.manage_config' },
      // Beside standing orders rather than beside customers: all three of
      // these decide how an order comes into being, and they share a
      // capability because that is genuinely the same authority.
      { href: '/admin/order-templates', label: 'import.tplTitle', permission: 'orders.manage_config' },
      { href: '/admin/inventory', label: 'inventory.title', permission: 'inventory.manage_templates' },
      { href: '/admin/inventory/locations', label: 'inventory.locations', permission: 'inventory.manage_templates' },
      { href: '/admin/inventory/permissions', label: 'inventory.permissions', permission: 'inventory.grant_temporary_edit' },
      // Who may register an incoming delivery. Beside the inventory
      // assignment screens because it is the same kind of decision — a
      // standing operational responsibility, not a role.
      { href: '/admin/goods-reception/assignees', label: 'gr.assigneesTitle', permission: 'goods_reception.manage_config' },
    ],
  },
  {
    slug: 'review',
    label: 'nav.sectionReview',
    description: 'nav.sectionReviewBody',
    screens: [
      { href: '/admin/reports', label: 'report.title', permission: 'reports.view' },
      { href: '/admin/incident-reports', label: 'ireport.title', permission: 'incidents.view_all' },
      { href: '/admin/goods-reception-reports', label: 'gr.reportsTitle', permission: 'reports.view' },
      // No Statistics entry. Task statistics ARE the Tasks tab of
      // /admin/reports — the separate screen was merged there because the two
      // computed their own period bounds and disagreed about what a month
      // was. /admin/statistics survives as a redirect for old bookmarks, but
      // advertising it here offered a tab that bounced you to Reports and
      // then highlighted Reports, which reads as a broken link.
      { href: '/admin/history', label: 'nav.history', permission: 'tasks.manage_occurrences' },
    ],
  },
  {
    slug: 'system',
    label: 'nav.sectionSystem',
    description: 'nav.sectionSystemBody',
    screens: [
      { href: '/admin/users', label: 'nav.users', permission: 'users.manage' },
      // The only screen in this section a non-admin can open. It sits beside
      // the accounts because that is what it addresses — people, not
      // configuration — and a Power User who holds nothing else here reaches
      // the section card for this alone.
      { href: '/admin/notifications', label: 'notify.title', permission: 'notifications.send' },
      { href: '/admin/permissions', label: 'roles.matrixTitle', permission: 'permissions.configure' },
      { href: '/admin/settings', label: 'nav.settings', permission: 'system.configure' },
    ],
  },
];

/** The screens this viewer may actually open. */
export function visibleScreens(
  section: AdminSection,
  role: Role,
  caps: ReadonlySet<Permission>,
): AdminScreen[] {
  return section.screens.filter((s) => s.permission === null || can(role, caps, s.permission));
}

/** Sections with at least one screen for this viewer. An empty card is noise. */
export function visibleSections(
  role: Role,
  caps: ReadonlySet<Permission>,
): { section: AdminSection; screens: AdminScreen[] }[] {
  return ADMIN_SECTIONS.map((section) => ({
    section,
    screens: visibleScreens(section, role, caps),
  })).filter((s) => s.screens.length > 0);
}

/**
 * Which section a path belongs to.
 *
 * Longest match wins, so `/admin/inventory/locations` resolves to its own
 * entry rather than to `/admin/inventory`, which is a prefix of it.
 */
export function sectionFor(pathname: string): AdminSection | null {
  let best: { section: AdminSection; length: number } | null = null;

  for (const section of ADMIN_SECTIONS) {
    for (const screen of section.screens) {
      if (pathname !== screen.href && !pathname.startsWith(`${screen.href}/`)) continue;
      if (!best || screen.href.length > best.length) {
        best = { section, length: screen.href.length };
      }
    }
  }
  return best?.section ?? null;
}

/** Where a section card leads: straight to real data, never to another list. */
export function sectionEntry(screens: AdminScreen[]): string {
  return screens[0]?.href ?? '/admin';
}
