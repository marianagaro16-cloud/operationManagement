'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import { can, type Permission, type Role } from '@/lib/authz';

/**
 * Tabs of the management area, filtered by capability.
 *
 * Previously an unfiltered list, because the layout had already restricted the
 * whole subtree to admins. Now that a Manager and a Power User get in, each tab
 * declares what it needs and the ones a viewer cannot use are simply absent —
 * a Power User does not see an Inventory Templates tab that would reject them.
 *
 * `permission: null` means every role that reached this layout may see it.
 */
export function AdminNav({ caps, role }: { caps: Permission[]; role: Role }) {
  const { t } = useI18n();
  const pathname = usePathname();
  const held = new Set(caps);
  const allow = (p: Permission | null) => p === null || can(role, held, p);

  const all: { href: string; label: string; permission: Permission | null }[] = [
    { href: '/admin', label: t('nav.overview'), permission: null },
    { href: '/admin/tasks', label: t('nav.tasks'), permission: 'tasks.manage_definitions' },
    { href: '/admin/customers', label: t('master.customersTitle'), permission: 'customers.manage' },
    { href: '/admin/products', label: t('master.productsTitle'), permission: 'products.manage' },
    { href: '/admin/delivery-methods', label: t('master.methodsTitle'), permission: 'orders.manage_config' },
    { href: '/admin/recurring', label: t('master.recurringTitle'), permission: 'orders.manage_config' },
    { href: '/admin/inventory', label: t('inventory.title'), permission: 'inventory.manage_templates' },
    { href: '/admin/inventory/locations', label: t('inventory.locations'), permission: 'inventory.manage_templates' },
    { href: '/admin/inventory/permissions', label: t('inventory.permissions'), permission: 'inventory.grant_temporary_edit' },
    { href: '/admin/users', label: t('nav.users'), permission: 'users.manage' },
    { href: '/admin/permissions', label: t('roles.matrixTitle'), permission: 'permissions.configure' },
    { href: '/admin/history', label: t('nav.history'), permission: 'tasks.manage_occurrences' },
    { href: '/admin/audit', label: t('audit.title'), permission: 'audit.view_operational' },
    { href: '/admin/reports', label: t('report.title'), permission: 'reports.view' },
    { href: '/admin/statistics', label: t('nav.statistics'), permission: 'reports.view' },
    { href: '/admin/settings', label: t('nav.settings'), permission: 'system.configure' },
  ];

  const items = all.filter((i) => allow(i.permission));

  return (
    // Horizontally scrollable on phones rather than wrapping into a tall block.
    <nav className="-mx-4 mb-5 overflow-x-auto px-4">
      <ul className="flex min-w-max gap-1 border-b border-border pb-px">
        {items.map(({ href, label }) => {
          const active = pathname === href;
          return (
            <li key={href}>
              <Link
                href={href}
                className={cn(
                  'inline-block whitespace-nowrap border-b-2 px-2.5 py-2 text-[13px] font-medium transition-colors',
                  active
                    ? 'border-accent text-fg'
                    : 'border-transparent text-muted hover:text-fg',
                )}
              >
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
