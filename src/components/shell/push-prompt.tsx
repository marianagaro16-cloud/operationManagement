'use client';

import { useEffect, useState } from 'react';
import { Bell, Share, X } from 'lucide-react';
import { useI18n } from '@/i18n';
import { Button } from '@/components/ui/button';
import { ErrorState } from '@/components/ui/primitives';
import { dismissPrompt, isPromptDismissed, usePushSubscription } from '@/lib/push-client';

/**
 * Invites the user to turn on notifications, on the dashboard where they
 * already are.
 *
 * Nobody goes looking for a notifications setting, so relying on a menu item
 * means the feature is never switched on. The banner enables in one tap and
 * disappears for good once handled — it is an invitation, not a nag.
 */
export function PushPrompt() {
  const { t } = useI18n();
  const { state, error, busy, enable } = usePushSubscription();
  const [dismissed, setDismissed] = useState(true); // assume hidden until checked
  const [justEnabled, setJustEnabled] = useState(false);

  useEffect(() => {
    setDismissed(isPromptDismissed());
  }, []);

  // Nothing useful to say when it is already on, unsupported, or dismissed.
  if (dismissed || state === 'loading' || state === 'on' || state === 'unsupported') return null;
  // A denial can only be undone in browser settings, so a banner cannot help.
  if (state === 'denied') return null;

  if (justEnabled) {
    return (
      <div className="mb-4 flex items-center gap-2.5 rounded-xl border border-done/30 bg-done/[0.07] px-3.5 py-2.5">
        <Bell className="h-4 w-4 shrink-0 text-done" aria-hidden />
        <p className="text-[13px]">{t('push.enabled')}</p>
      </div>
    );
  }

  // iOS in a browser tab: enabling is impossible until the app is installed,
  // so the banner explains how rather than offering a button that cannot work.
  const iosInstall = state === 'needs-install';

  return (
    <section className="mb-4 rounded-xl border border-accent/25 bg-accent/[0.06] p-3.5">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent">
          {iosInstall ? <Share className="h-4 w-4" aria-hidden /> : <Bell className="h-4 w-4" aria-hidden />}
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-semibold leading-snug">{t('push.promptTitle')}</p>
          <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted">
            {iosInstall ? t('push.iosSteps') : t('push.promptBody')}
          </p>

          {error && <div className="mt-2"><ErrorState message={error} /></div>}

          {!iosInstall && (
            <Button
              className="mt-2.5"
              variant="primary"
              loading={busy}
              onClick={async () => {
                const ok = await enable();
                if (ok) setJustEnabled(true);
              }}
            >
              <Bell className="h-3.5 w-3.5" aria-hidden />
              {t('push.enable')}
            </Button>
          )}
        </div>

        <button
          onClick={() => { dismissPrompt(); setDismissed(true); }}
          aria-label={t('common.close')}
          className="-mr-1 -mt-1 shrink-0 rounded-md p-1 text-subtle transition-colors hover:text-fg"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>
    </section>
  );
}
