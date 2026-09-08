'use client';

import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { useI18n } from '@/i18n';
import { Badge, Card } from '@/components/ui/primitives';
import { PageHeader } from '@/components/shell/app-shell';
import type { Permission, Role } from '@/lib/authz';
import { sectionEntry, visibleSections } from './sections';

/**
 * The management area's front door.
 *
 * Four cards instead of eighteen tabs. Each one leads STRAIGHT to its first
 * screen rather than to another list, so the common path from here is one tap
 * to real data — which is what keeps the hub from being a toll booth.
 *
 * The card lists what is inside it. A section is not a mystery you have to
 * open to understand, and naming the screens is what lets somebody who knows
 * where they are going skip reading the heading.
 *
 * There is no Overview screen any more. What it showed — configuration health
 * and pending approvals — is here, above and on the cards, because a warning
 * on a tab nobody opens is a warning nobody sees.
 */
export function AdminHub({
  role,
  caps,
  pendingUsers,
  health,
}: {
  role: Role;
  caps: Permission[];
  /** Accounts waiting for approval, surfaced on the System card. */
  pendingUsers: number;
  health: React.ReactNode;
}) {
  const { t } = useI18n();
  const sections = visibleSections(role, new Set(caps));

  return (
    <>
      <PageHeader title={t('nav.manage')} subtitle={t('nav.manageSubtitle')} />

      {/* Anything wrong with the configuration, before the menu rather than
          behind it. */}
      <div className="mb-4">{health}</div>

      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        {sections.map(({ section, screens }) => (
          <Link key={section.slug} href={sectionEntry(screens)} className="group">
            <Card className="h-full p-3.5 transition-colors hover:border-accent/40 hover:bg-surface-2/40">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 text-[14px] font-semibold">
                    {t(section.label)}
                    {section.slug === 'system' && pendingUsers > 0 && (
                      <Badge tone="warn">
                        {t('admin.pendingUsers')}: {pendingUsers}
                      </Badge>
                    )}
                  </p>
                  <p className="mt-0.5 text-[12px] text-muted">{t(section.description)}</p>

                  {/* What is actually in here, so the card is a signpost and
                      not a riddle. */}
                  <p className="mt-2 truncate text-[11.5px] text-subtle">
                    {screens.map((s) => t(s.label)).join(' · ')}
                  </p>
                </div>

                <span className="shrink-0 pt-0.5 text-subtle transition-colors group-hover:text-accent">
                  <ChevronRight className="h-4 w-4" aria-hidden />
                </span>
              </div>
            </Card>
          </Link>
        ))}
      </div>
    </>
  );
}
