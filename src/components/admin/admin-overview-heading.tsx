'use client';

import { useI18n } from '@/i18n';
import { PageHeader } from '@/components/shell/app-shell';
import { Badge } from '@/components/ui/primitives';

export function AdminOverviewHeading({ pendingCount }: { pendingCount: number }) {
  const { t } = useI18n();
  return (
    <PageHeader
      title={t('admin.title')}
      subtitle={t('admin.overviewSubtitle')}
      action={
        pendingCount > 0 ? (
          <Badge tone="warn">
            {t('admin.pendingUsers')}: {pendingCount}
          </Badge>
        ) : undefined
      }
    />
  );
}
