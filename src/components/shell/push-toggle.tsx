'use client';

import { useEffect, useState, useTransition } from 'react';
import { Bell, BellOff, BellRing } from 'lucide-react';
import { useI18n } from '@/i18n';
import { Button } from '@/components/ui/button';
import { Card, CardBody, ErrorState } from '@/components/ui/primitives';
import { savePushSubscription, deletePushSubscription, sendTestNotification } from '@/server/push-actions';

/**
 * Notification opt-in.
 *
 * Permission is only ever requested from an explicit tap. A permission prompt
 * fired on page load is the fastest way to get permanently denied, and a
 * denial cannot be undone from the page — only in browser settings.
 */

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(normalized);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

type State = 'loading' | 'unsupported' | 'denied' | 'off' | 'on';

export function PushToggle() {
  const { t } = useI18n();
  const [state, setState] = useState<State>('loading');
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
      setState('unsupported');
      return;
    }
    if (Notification.permission === 'denied') {
      setState('denied');
      return;
    }
    navigator.serviceWorker.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => setState(sub ? 'on' : 'off'))
      .catch(() => setState('off'));
  }, []);

  async function enable() {
    setError(null);
    setMessage(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setState(permission === 'denied' ? 'denied' : 'off');
        return;
      }

      const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!key) { setError(t('push.notConfigured')); return; }

      const reg = await navigator.serviceWorker.ready;
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({
          // Required by Chrome: every push must be user-visible.
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(key) as BufferSource,
        }));

      const json = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
      if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
        setError(t('push.failed'));
        return;
      }

      startTransition(async () => {
        const res = await savePushSubscription({
          endpoint: json.endpoint as string,
          p256dh: json.keys!.p256dh as string,
          auth: json.keys!.auth as string,
          user_agent: navigator.userAgent.slice(0, 300),
        });
        if (!res.ok) { setError(res.error); return; }
        setState('on');
        setMessage(t('push.enabled'));
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function disable() {
    setError(null);
    setMessage(null);
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (!sub) { setState('off'); return; }
    const endpoint = sub.endpoint;
    await sub.unsubscribe();
    startTransition(async () => {
      await deletePushSubscription(endpoint);
      setState('off');
    });
  }

  const icon =
    state === 'on' ? <BellRing className="h-4 w-4 text-done" aria-hidden />
      : state === 'denied' ? <BellOff className="h-4 w-4 text-late" aria-hidden />
        : <Bell className="h-4 w-4 text-muted" aria-hidden />;

  return (
    <Card>
      <CardBody className="pt-4">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 shrink-0">{icon}</span>
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-medium">{t('push.title')}</p>
            <p className="mt-0.5 text-[12.5px] text-muted">
              {state === 'unsupported' ? t('push.unsupported')
                : state === 'denied' ? t('push.denied')
                  : state === 'on' ? t('push.onBody')
                    : t('push.offBody')}
            </p>

            {/* Installing to the home screen is mandatory on iOS, not advice. */}
            {state !== 'unsupported' && state !== 'on' && (
              <p className="mt-1 text-[12px] text-subtle">{t('push.iosHint')}</p>
            )}

            {state === 'off' && (
              <Button className="mt-3" variant="primary" onClick={enable} loading={pending}>
                <Bell className="h-3.5 w-3.5" aria-hidden />
                {t('push.enable')}
              </Button>
            )}

            {state === 'on' && (
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  onClick={() =>
                    startTransition(async () => {
                      setError(null);
                      const res = await sendTestNotification();
                      if (!res.ok) setError(res.error);
                      else setMessage(t('push.testSent', { count: res.data.sent }));
                    })
                  }
                  loading={pending}
                >
                  {t('push.test')}
                </Button>
                <Button variant="ghost" onClick={disable} loading={pending}>
                  <BellOff className="h-3.5 w-3.5" aria-hidden />
                  {t('push.disable')}
                </Button>
              </div>
            )}

            {message && <p className="mt-2 text-[12.5px] text-done">{message}</p>}
            {error && <div className="mt-2"><ErrorState message={error} /></div>}
          </div>
        </div>
      </CardBody>
    </Card>
  );
}
