'use client';

import { useI18n } from '@/i18n';
import { PageHeader } from '@/components/shell/app-shell';

export function CalendarHeading() {
  const { t } = useI18n();
  return <PageHeader title={t('admin.calendarTitle')} subtitle={t('admin.calendarSubtitle')} />;
}
