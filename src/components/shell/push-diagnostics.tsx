'use client';

import { Check, X } from 'lucide-react';
import { Card, CardBody } from '@/components/ui/primitives';
import type { PushDiagnostics as Diagnostics, PushState } from '@/lib/push-client';

/**
 * Why notifications are or are not working on THIS device.
 *
 * Push failures are near-impossible to diagnose remotely — the same symptom
 * ("nothing happens") covers a blocked permission, a missing service worker,
 * an insecure origin and an uninstalled iOS PWA. This turns that into
 * something the user can read out.
 */
export function PushDiagnosticsPanel({
  state,
  diagnostics,
}: {
  state: PushState;
  diagnostics: Diagnostics | null;
}) {
  if (!diagnostics) return null;

  const rows: { label: string; ok: boolean; note?: string }[] = [
    { label: 'Secure connection (https)', ok: diagnostics.secure },
    { label: 'Service worker supported', ok: diagnostics.serviceWorker },
    { label: 'Push supported', ok: diagnostics.pushManager },
    { label: 'Service worker active', ok: diagnostics.active },
    { label: 'Server key present', ok: diagnostics.vapidKey },
    {
      label: 'Permission',
      ok: diagnostics.permission === 'granted',
      note: diagnostics.permission,
    },
    { label: 'This device subscribed', ok: diagnostics.subscribed },
  ];

  if (diagnostics.ios) {
    rows.splice(3, 0, {
      label: 'Installed to home screen',
      ok: diagnostics.standalone,
      note: diagnostics.standalone ? undefined : 'required on iOS',
    });
  }

  return (
    <Card>
      <CardBody className="pt-4">
        <p className="text-[13px] font-medium">Diagnostics</p>
        <p className="mt-0.5 text-[12px] text-muted">
          Status on this device — read this out if notifications are not working.
        </p>

        <ul className="mt-2.5 space-y-1">
          {rows.map((r) => (
            <li key={r.label} className="flex items-center gap-2 text-[12.5px]">
              {r.ok ? (
                <Check className="h-3.5 w-3.5 shrink-0 text-done" aria-hidden />
              ) : (
                <X className="h-3.5 w-3.5 shrink-0 text-late" aria-hidden />
              )}
              <span className={r.ok ? 'text-muted' : 'font-medium text-fg'}>{r.label}</span>
              {r.note && <span className="text-subtle">({r.note})</span>}
            </li>
          ))}
        </ul>

        <p className="mt-2.5 border-t border-border pt-2 text-[11.5px] tabular text-subtle">
          state: {state}
        </p>
      </CardBody>
    </Card>
  );
}
