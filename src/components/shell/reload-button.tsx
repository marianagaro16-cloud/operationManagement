'use client';

import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';

/**
 * Reload, in the header of every screen.
 *
 * Installed on a phone the app has no browser bar, so there is no reload to
 * reach for — and a screen left open through an update needs one. A full
 * reload, not a refresh of the data: it also fetches the new version.
 */
export function ReloadButton() {
  const { t } = useI18n();
  const [reloading, setReloading] = useState(false);
  return (
    <button
      type="button"
      aria-label={t('common.reload')}
      title={t('common.reload')}
      onClick={() => {
        setReloading(true);
        window.location.reload();
      }}
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:bg-surface-2 hover:text-fg"
    >
      <RefreshCw className={cn('h-[18px] w-[18px]', reloading && 'animate-spin')} aria-hidden />
    </button>
  );
}
