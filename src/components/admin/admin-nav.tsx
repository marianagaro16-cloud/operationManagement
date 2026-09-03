'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';

export function AdminNav() {
  const { t } = useI18n();
  const pathname = usePathname();

  const items = [
    { href: '/admin', label: t('nav.overview') },
    { href: '/admin/tasks', label: t('nav.tasks') },
    { href: '/admin/customers', label: t('master.customersTitle') },
    { href: '/admin/products', label: t('master.productsTitle') },
    { href: '/admin/delivery-methods', label: t('master.methodsTitle') },
    { href: '/admin/recurring', label: t('master.recurringTitle') },
    { href: '/admin/users', label: t('nav.users') },
    { href: '/admin/history', label: t('nav.history') },
    { href: '/admin/reports', label: t('report.title') },
    { href: '/admin/statistics', label: t('nav.statistics') },
    { href: '/admin/settings', label: t('nav.settings') },
  ];

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
