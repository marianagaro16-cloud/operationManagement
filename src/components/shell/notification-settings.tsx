'use client';

import { useI18n } from '@/i18n';
import { PageHeader } from '@/components/shell/app-shell';
import { PushToggle } from './push-toggle';
import { LanguageSelector } from './language-selector';
import { Card, CardBody } from '@/components/ui/primitives';

export function NotificationSettings() {
  const { t } = useI18n();

  return (
    <>
      <PageHeader title={t('nav.settings')} />
      <div className="space-y-4">
        <PushToggle />
        <Card>
          <CardBody className="flex items-center justify-between pt-4">
            <p className="text-[13px] font-medium">{t('language.label')}</p>
            <LanguageSelector />
          </CardBody>
        </Card>
      </div>
    </>
  );
}
