'use client';

import Link from 'next/link';
import { Briefcase, Cake } from 'lucide-react';
import { useI18n } from '@/i18n';
import { Card } from '@/components/ui/primitives';
import type { Celebration } from '@/domain/hr/celebrations';

/** Birthdays and work anniversaries in the coming week. Nothing at all when there are none. */
export function CelebrationsCard({ celebrations }: { celebrations: Celebration[] }) {
  const { t, formatDate } = useI18n();
  if (celebrations.length === 0) return null;

  const when = (c: Celebration) =>
    c.daysAway === 0 ? t('celebrations.today')
      : c.daysAway === 1 ? t('celebrations.tomorrow')
        : formatDate(c.date, 'weekday');

  return (
    <section className="mb-6">
      <h2 className="mb-2 flex items-center gap-1.5 text-[15px] font-semibold">
        <Cake className="h-4 w-4 text-accent" aria-hidden />
        {t('celebrations.title')}
      </h2>
      <Card className="divide-y divide-border">
        {celebrations.map((c) => (
          <Link
            key={`${c.workerId}-${c.kind}`}
            href={`/hr/${c.workerId}`}
            className="flex items-center gap-3 px-3.5 py-2.5 transition-colors hover:bg-surface-2/60"
          >
            {c.kind === 'birthday'
              ? <Cake className="h-4 w-4 shrink-0 text-muted" aria-hidden />
              : <Briefcase className="h-4 w-4 shrink-0 text-muted" aria-hidden />}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13.5px] font-medium">{c.name}</span>
              <span className="block text-[12px] text-muted">
                {c.kind === 'birthday'
                  ? t('celebrations.birthday', { years: c.years })
                  : c.years === 1
                    ? t('celebrations.anniversaryOne')
                    : t('celebrations.anniversary', { years: c.years })}
              </span>
            </span>
            <span className={c.daysAway === 0 ? 'shrink-0 text-[12.5px] font-semibold text-accent' : 'shrink-0 text-[12.5px] text-muted'}>
              {when(c)}
            </span>
          </Link>
        ))}
      </Card>
    </section>
  );
}
