'use client';

import { useState, useTransition } from 'react';
import { CalendarPlus } from 'lucide-react';
import { useI18n } from '@/i18n';
import { Button } from '@/components/ui/button';
import { Card, CardBody, ErrorState } from '@/components/ui/primitives';
import { PageHeader } from '@/components/shell/app-shell';
import { generateHorizon } from '@/server/actions';
import { BUSINESS_TZ } from '@/lib/datetime';

export function SettingsView() {
  const { t } = useI18n();
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <>
      <PageHeader title={t('admin.settingsTitle')} />

      <div className="space-y-4">
        <Card>
          <CardBody className="pt-4">
            <div className="flex items-start gap-3">
              <CalendarPlus className="mt-0.5 h-4 w-4 shrink-0 text-muted" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium">{t('admin.generateTitle')}</p>
                <p className="mt-0.5 text-[12.5px] text-muted">{t('admin.generateBody')}</p>

                <Button
                  className="mt-3"
                  variant="secondary"
                  loading={pending}
                  onClick={() =>
                    startTransition(async () => {
                      setError(null);
                      setResult(null);
                      const res = await generateHorizon(60);
                      if (res.ok) setResult(t('admin.generated', { count: res.data.created }));
                      else setError(res.error);
                    })
                  }
                >
                  {t('admin.generateCta')}
                </Button>

                {result && <p className="mt-2 text-[12.5px] text-done">{result}</p>}
                {error && <div className="mt-2"><ErrorState message={error} /></div>}
              </div>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardBody className="pt-4">
            <p className="text-[13px] font-medium">Timezone</p>
            <p className="mt-0.5 text-[12.5px] text-muted">
              All recurrence and overdue calculations run in{' '}
              <code className="rounded bg-surface-2 px-1 py-0.5 text-[11.5px]">{BUSINESS_TZ}</code>,
              independent of each device&apos;s local timezone.
            </p>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
