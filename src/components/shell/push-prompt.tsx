'use client';

import { useEffect, useState } from 'react';
import { Bell, BellOff, Share, X } from 'lucide-react';
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
 * disappears for good once handled — an invitation, not a nag.
 *
 * It also appears for the states a user CANNOT fix by tapping (permission
 * blocked, iOS not installed), because a silent absence gives them nothing
 * to act on and nothing to report.
 */
export function PushPrompt() {
  const { t } = useI18n();
  const { state, error, busy, enable } = usePushSubscription();
  const [dismissed, setDismissed] = useState(true); // hidden until checked
  const [justEnabled, setJustEnabled] = useState(false);

  useEffect(() => {
    setDismissed(isPromptDismissed());
  }, []);

  if (dismissed) return null;
  // Still probing, already on, or genuinely impossible: say nothing.
  if (state === 'loading' || state === 'on' || state === 'unsupported') return null;

  if (justEnabled) {
    return (
      <div className="mb-4 flex items-center gap-2.5 rounded-xl border border-done/30 bg-done/[0.07] px-3.5 py-2.5">
        <Bell className="h-4 w-4 shrink-0 text-done" aria-hidden />
        <p className="text-[13px]">{t('push.enabled')}</p>
      </div>
    );
  }

  const blocked = state === 'denied';
  const iosInstall = state === 'needs-install';
  const noWorker = state === 'no-sw';
  // Only 'off' can be resolved by tapping a button here.
  const actionable = state === 'off';

  const body =
    iosInstall ? t('push.iosSteps')
      : blocked ? t('push.denied')
        : noWorker ? t('push.noWorker')
          : t('push.promptBody');

  const icon =
    iosInstall ? <Share className="h-4 w-4" aria-hidden />
      : blocked || noWorker ? <BellOff className="h-4 w-4" aria-hidden />
        : <Bell className="h-4 w-4" aria-hidden />;

  const tone = blocked || noWorker
    ? { border: 'border-warn/30', bg: 'bg-warn/[0.06]', chip: 'bg-warn/15 text-warn' }
    : { border: 'border-accent/25', bg: 'bg-accent/[0.06]', chip: 'bg-accent/15 text-accent' };

  return (
    <section className={`mb-4 rounded-xl border ${tone.border} ${tone.bg} p-3.5`}>
      <div className="flex items-start gap-3">
        <div className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${tone.chip}`}>
          {icon}
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-semibold leading-snug">
            {blocked || noWorker ? t('push.problemTitle') : t('push.promptTitle')}
          </p>
          <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted">{body}</p>

          {error && <div className="mt-2"><ErrorState message={error} /></div>}

          {actionable && (
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
