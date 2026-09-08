'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useI18n, type MessageKey } from '@/i18n';
import { cn } from '@/lib/utils';
import { can, type Permission, type Role } from '@/lib/authz';

/**
 * Tabs of the management area, filtered by capability and grouped by job.
 *
 * Previously an unfiltered list, because the layout had already restricted the
 * whole subtree to admins. Now that a Manager and a Power User get in, each tab
 * declares what it needs and the ones a viewer cannot use are simply absent —
 * a Power User does not see an Inventory Templates tab that would reject them.
 *
 * The grouping is new and is presentational only: sixteen tabs in one
 * horizontally scrolling row mixed three unrelated jobs, and reaching the last
 * of them on a phone meant scrolling past ten a person never opens. Setup is
 * what shapes future work, Review is looking backwards at what happened, and
 * System is the account and configuration machinery. Each tab keeps exactly the
 * capability it had.
 *
 * `permission: null` means every role that reached this layout may see it.
 */

type Group = 'setup' | 'review' | 'system';

interface Tab {
  href: string;
  label: string;
  permission: Permission | null;
  group: Group;
}

const GROUP_LABEL: Record<Group, MessageKey> = {
  setup: 'nav.groupSetup',
  review: 'nav.groupReview',
  system: 'nav.groupSystem',
};

export function AdminNav({ caps, role }: { caps: Permission[]; role: Role }) {
  const { t } = useI18n();
  const pathname = usePathname();
  const held = new Set(caps);
  const allow = (p: Permission | null) => p === null || can(role, held, p);

  const all: Tab[] = [
    { href: '/admin', label: t('nav.overview'), permission: null, group: 'setup' },

    // ---- what shapes future work ----
    { href: '/admin/tasks', label: t('nav.tasks'), permission: 'tasks.manage_definitions', group: 'setup' },
    { href: '/admin/customers', label: t('master.customersTitle'), permission: 'customers.manage', group: 'setup' },
    { href: '/admin/products', label: t('master.productsTitle'), permission: 'products.manage', group: 'setup' },
    { href: '/admin/delivery-methods', label: t('master.methodsTitle'), permission: 'orders.manage_config', group: 'setup' },
    { href: '/admin/recurring', label: t('master.recurringTitle'), permission: 'orders.manage_config', group: 'setup' },
    { href: '/admin/order-templates', label: t('import.tplTitle'), permission: 'orders.manage_config', group: 'setup' },
    { href: '/admin/inventory', label: t('inventory.title'), permission: 'inventory.manage_templates', group: 'setup' },
    { href: '/admin/inventory/locations', label: t('inventory.locations'), permission: 'inventory.manage_templates', group: 'setup' },
    { href: '/admin/inventory/permissions', label: t('inventory.permissions'), permission: 'inventory.grant_temporary_edit', group: 'setup' },

    { href: '/admin/incident-types', label: t('incident.typesTitle'), permission: 'incidents.manage_config', group: 'setup' },

    // ---- looking backwards ----
    { href: '/admin/reports', label: t('report.title'), permission: 'reports.view', group: 'review' },
    { href: '/admin/incident-reports', label: t('ireport.title'), permission: 'incidents.view_all', group: 'review' },
    { href: '/admin/statistics', label: t('nav.statistics'), permission: 'reports.view', group: 'review' },
    { href: '/admin/history', label: t('nav.history'), permission: 'tasks.manage_occurrences', group: 'review' },

    // ---- accounts and configuration ----
    { href: '/admin/users', label: t('nav.users'), permission: 'users.manage', group: 'system' },
    { href: '/admin/permissions', label: t('roles.matrixTitle'), permission: 'permissions.configure', group: 'system' },
    { href: '/admin/settings', label: t('nav.settings'), permission: 'system.configure', group: 'system' },
  ];

  const items = all.filter((i) => allow(i.permission));

  // A group with nothing in it for this viewer is not rendered at all, so a
  // Power User does not see an empty "System" heading.
  const groups: Group[] = (['setup', 'review', 'system'] as const).filter((g) =>
    items.some((i) => i.group === g),
  );

  return (
    <nav className="-mx-4 mb-5 space-y-1.5 border-b border-border px-4 pb-2">
      {groups.map((group) => (
        <div key={group} className="flex items-center gap-2">
          <span className="w-16 shrink-0 text-[10.5px] font-medium uppercase tracking-wide text-subtle">
            {t(GROUP_LABEL[group])}
          </span>
          {/* Each row scrolls on its own, so a long Setup row never pushes
              Review and System off the screen. */}
          <ul className="-mx-1 flex min-w-0 flex-1 gap-1 overflow-x-auto px-1">
            {items
              .filter((i) => i.group === group)
              .map(({ href, label }) => {
                const active = pathname === href;
                return (
                  <li key={href}>
                    <Link
                      href={href}
                      className={cn(
                        'inline-block whitespace-nowrap rounded-md px-2.5 py-1.5 text-[13px] font-medium transition-colors',
                        active
                          ? 'bg-accent/10 text-accent'
                          : 'text-muted hover:bg-surface-2 hover:text-fg',
                      )}
                    >
                      {label}
                    </Link>
                  </li>
                );
              })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
