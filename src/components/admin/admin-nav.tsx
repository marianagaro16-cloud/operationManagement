'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import type { Permission, Role } from '@/lib/authz';
import { sectionFor, visibleScreens } from './sections';

/**
 * The tabs of ONE section, not of the whole management area.
 *
 * This used to render every admin screen at once — eighteen of them, in three
 * horizontally scrolling rows, mixing four unrelated jobs. Reaching the last
 * of them on a phone meant scrolling past ten a person never opens, and every
 * screen added since made it worse.
 *
 * Now `/admin` is a hub of four section cards and this renders only the
 * section you are actually in: four to six tabs, which fit a phone without
 * scrolling. The back link is what makes the hierarchy legible — without it a
 * section page looks like a page that lost its navigation.
 *
 * Renders nothing on the hub itself, which has the cards instead.
 */
export function AdminNav({ caps, role }: { caps: Permission[]; role: Role }) {
  const { t } = useI18n();
  const pathname = usePathname();

  const section = sectionFor(pathname);
  if (!section) return null;

  const screens = visibleScreens(section, role, new Set(caps));
  // A section the viewer holds exactly one screen in needs no tab strip — the
  // back link alone says where they are.
  if (screens.length === 0) return null;

  return (
    <nav className="-mx-4 mb-5 border-b border-border px-4 pb-2">
      <Link
        href="/admin"
        className="mb-1.5 inline-flex items-center gap-1 text-[12px] font-medium text-muted transition-colors hover:text-fg"
      >
        <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
        {t('nav.manage')}
        <span className="text-subtle">· {t(section.label)}</span>
      </Link>

      {screens.length > 1 && (
        <ul className="-mx-1 flex gap-1 overflow-x-auto px-1">
          {screens.map(({ href, label }) => {
            // Exact match, or a child route of it — so an incident report's
            // own page keeps the Incident reports tab lit.
            const active = pathname === href || pathname.startsWith(`${href}/`);
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
                  {t(label)}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </nav>
  );
}
