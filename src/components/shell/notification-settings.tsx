'use client';

import { useI18n } from '@/i18n';
import { PageHeader } from '@/components/shell/app-shell';
import { PushToggle } from './push-toggle';
import { PushDiagnosticsPanel } from './push-diagnostics';
import { LanguageSelector } from './language-selector';
import { Card, CardBody } from '@/components/ui/primitives';
import { usePushSubscription } from '@/lib/push-client';

export function NotificationSettings() {
  const { t } = useI18n();
  // Shared hook: the toggle and the diagnostics panel see the same state.
  const { state, diagnostics } = usePushSubscription();

  return (
    <>
      <PageHeader title={t('nav.settings')} />
      <div className="space-y-4">
        <PushToggle />
        <PushDiagnosticsPanel state={state} diagnostics={diagnostics} />
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
