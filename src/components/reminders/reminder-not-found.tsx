'use client';

import Link from 'next/link';
import { useI18n } from '@/i18n';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/primitives';

/**
 * Deliberately the same for "does not exist" and "not shared with you":
 * telling them apart would reveal that somebody else's reminder exists.
 */
export function ReminderNotFound() {
  const { t } = useI18n();
  return (
    <EmptyState
      title={t('reminder.notFound')}
      action={
        <Link href="/reminders">
          <Button>{t('reminder.back')}</Button>
        </Link>
      }
    />
  );
}
