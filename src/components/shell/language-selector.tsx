'use client';

import { Languages } from 'lucide-react';
import { useI18n } from '@/i18n';
import { LOCALES, type Locale } from '@/i18n/config';
import { cn } from '@/lib/utils';

/** Language switching is a first-class control, not buried in settings. */
export function LanguageSelector({ compact = false }: { compact?: boolean }) {
  const { locale, setLocale, t } = useI18n();

  return (
    <label className={cn('inline-flex items-center gap-1.5', compact && 'text-[13px]')}>
      <Languages className="h-3.5 w-3.5 text-subtle" aria-hidden />
      <span className="sr-only">{t('language.label')}</span>
      <select
        value={locale}
        onChange={(e) => setLocale(e.target.value as Locale)}
        className="cursor-pointer rounded-md border-0 bg-transparent py-1 pr-5 text-[13px] text-muted hover:text-fg focus:text-fg"
      >
        {LOCALES.map((l) => (
          <option key={l} value={l}>
            {t(`language.${l}` as 'language.en')}
          </option>
        ))}
      </select>
    </label>
  );
}
