'use client';

import { CalendarClock, ArrowDown } from 'lucide-react';
import { useI18n } from '@/i18n';
import type { Frequency } from '@/types/database';

/**
 * The safeguard against the failure mode this system exists to prevent:
 * an operator works through the familiar daily checklist, sees it hit 100%,
 * and never notices that a monthly or semiannual requirement also fell today.
 *
 * It is deliberately loud, states the actual count and which cadences are
 * involved, and links straight to the section.
 */
export function ExtraTasksBanner({ frequencies, count }: { frequencies: Frequency[]; count: number }) {
  const { t } = useI18n();
  if (count === 0) return null;

  const kinds = [...new Set(frequencies)]
    .map((f) => t(`frequency.${f}` as 'frequency.daily').toLowerCase())
    .join(', ');

  return (
    <a
      href="#extra-tasks"
      className="group mb-4 flex items-start gap-3 rounded-xl border border-warn/30 bg-warn/[0.07] p-3.5 transition-colors hover:bg-warn/10"
    >
      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-warn/15 text-warn">
        <CalendarClock className="h-4 w-4" aria-hidden />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[14px] font-semibold leading-snug">
          {count === 1
            ? t('dashboard.extraBannerTitleOne')
            : t('dashboard.extraBannerTitle', { count })}
        </p>
        <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted">
          {t('dashboard.extraBannerBody', { kinds })}
        </p>
        <span className="mt-1.5 inline-flex items-center gap-1 text-[12.5px] font-medium text-warn">
          {t('dashboard.extraBannerCta')}
          <ArrowDown className="h-3 w-3 transition-transform group-hover:translate-y-0.5" aria-hidden />
        </span>
      </div>
    </a>
  );
}
