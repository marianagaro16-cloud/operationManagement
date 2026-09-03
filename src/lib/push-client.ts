'use client';

import { useCallback, useEffect, useState } from 'react';
import { savePushSubscription, deletePushSubscription } from '@/server/push-actions';

/**
 * Browser push subscription, shared by the dashboard prompt and the settings
 * toggle so there is one implementation of the permission dance.
 */

export type PushState =
  | 'loading'
  | 'unsupported'   // browser cannot do push at all
  | 'needs-install' // iOS Safari: only works once added to the home screen
  | 'denied'        // blocked; only recoverable in browser settings
  | 'off'
  | 'on';

function toUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(normalized);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

/** iOS delivers push only to a home-screen install, never to a Safari tab. */
function isIosSafariTab(): boolean {
  if (typeof window === 'undefined') return false;
  const ua = navigator.userAgent;
  const isIos = /iPad|iPhone|iPod/.test(ua) ||
    // iPadOS reports as a Mac; the touch check distinguishes it.
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (!isIos) return false;
  const standalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as { standalone?: boolean }).standalone === true;
  return !standalone;
}

export function usePushSubscription() {
  const [state, setState] = useState<PushState>('loading');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (typeof window === 'undefined') return;

    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
      // On iOS the APIs are simply absent in a tab, so check that first to
      // give an actionable message instead of a flat "unsupported".
      setState(isIosSafariTab() ? 'needs-install' : 'unsupported');
      return;
    }
    if (isIosSafariTab()) { setState('needs-install'); return; }
    if (Notification.permission === 'denied') { setState('denied'); return; }

    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      setState(sub ? 'on' : 'off');
    } catch {
      setState('off');
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const enable = useCallback(async (): Promise<boolean> => {
    setError(null);
    setBusy(true);
    try {
      // Permission is only ever requested from a real tap; a prompt on page
      // load is the fastest way to be permanently denied.
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setState(permission === 'denied' ? 'denied' : 'off');
        return false;
      }

      const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!key) { setError('push_not_configured'); return false; }

      const reg = await navigator.serviceWorker.ready;
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({
          userVisibleOnly: true, // required by Chrome
          applicationServerKey: toUint8Array(key) as BufferSource,
        }));

      const json = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
      if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
        setError('subscription_incomplete');
        return false;
      }

      const res = await savePushSubscription({
        endpoint: json.endpoint,
        p256dh: json.keys.p256dh,
        auth: json.keys.auth,
        user_agent: navigator.userAgent.slice(0, 300),
      });
      if (!res.ok) { setError(res.error); return false; }

      setState('on');
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  const disable = useCallback(async () => {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        const endpoint = sub.endpoint;
        await sub.unsubscribe();
        await deletePushSubscription(endpoint);
      }
      setState('off');
    } finally {
      setBusy(false);
    }
  }, []);

  return { state, error, busy, enable, disable, refresh };
}

/* ------------------------- prompt dismissal ---------------------------- */

const DISMISS_KEY = 'om_push_prompt_dismissed';

/** Remember a dismissal per device, so the prompt is not nagging. */
export function isPromptDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === '1';
  } catch {
    return false; // private mode or blocked storage: just show it
  }
}

export function dismissPrompt(): void {
  try { localStorage.setItem(DISMISS_KEY, '1'); } catch { /* not critical */ }
}
