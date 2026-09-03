'use client';

import { useState, useTransition } from 'react';
import { Bell, BellOff, BellRing, Share } from 'lucide-react';
import { useI18n } from '@/i18n';
import { Button } from '@/components/ui/button';
import { Card, CardBody, ErrorState } from '@/components/ui/primitives';
import { usePushSubscription } from '@/lib/push-client';
import { sendTestNotification } from '@/server/push-actions';

/**
 * Notification control on the settings page.
 *
 * Shares its subscription logic with the dashboard prompt via
 * usePushSubscription, so there is one implementation of the permission
 * dance rather than two that can drift apart.
 */
export function PushToggle() {
  const { t } = useI18n();
  const { state, error, busy, diagnostics, enable, disable } = usePushSubscription();
  const [message, setMessage] = useState<string | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const icon =
    state === 'on' ? <BellRing className="h-4 w-4 text-done" aria-hidden />
      : state === 'denied' ? <BellOff className="h-4 w-4 text-late" aria-hidden />
        : state === 'needs-install' ? <Share className="h-4 w-4 text-accent" aria-hidden />
          : <Bell className="h-4 w-4 text-muted" aria-hidden />;

  const body =
    state === 'unsupported' ? t('push.unsupported')
      : state === 'no-sw' ? t('push.noWorker')
      : state === 'needs-install' ? t('push.iosSteps')
        : state === 'denied' ? t('push.denied')
          : state === 'on' ? t('push.onBody')
            : t('push.offBody');

  return (
    <Card>
      <CardBody className="pt-4">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 shrink-0">{icon}</span>
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-medium">{t('push.title')}</p>
            <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted">{body}</p>

            {state === 'off' && (
              <Button
                className="mt-3"
                variant="primary"
                loading={busy}
                onClick={() => { setMessage(null); void enable(); }}
              >
                <Bell className="h-3.5 w-3.5" aria-hidden />
                {t('push.enable')}
              </Button>
            )}

            {state === 'on' && (
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  loading={pending}
                  onClick={() =>
                    startTransition(async () => {
                      setTestError(null);
                      setMessage(null);
                      const res = await sendTestNotification();
                      if (!res.ok) setTestError(res.error);
                      else if (res.data.sent === 0) setTestError(t('push.testNoDevices'));
                      else setMessage(t('push.testSent', { count: res.data.sent }));
                    })
                  }
                >
                  {t('push.test')}
                </Button>
                <Button variant="ghost" loading={busy} onClick={() => void disable()}>
                  <BellOff className="h-3.5 w-3.5" aria-hidden />
                  {t('push.disable')}
                </Button>
              </div>
            )}

            {message && <p className="mt-2 text-[12.5px] text-done">{message}</p>}
            {(error || testError) && (
              <div className="mt-2"><ErrorState message={testError ?? error ?? ''} /></div>
            )}
          </div>
        </div>
      </CardBody>
    </Card>
  );
}
