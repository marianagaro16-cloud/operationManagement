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
  | 'no-sw'         // service worker never became active
  | 'denied'        // blocked; only recoverable in browser settings
  | 'off'
  | 'on';

/** Everything needed to diagnose a device without being in front of it. */
export interface PushDiagnostics {
  serviceWorker: boolean;
  pushManager: boolean;
  notification: boolean;
  permission: string;
  registered: boolean;
  active: boolean;
  subscribed: boolean;
  vapidKey: boolean;
  standalone: boolean;
  ios: boolean;
  secure: boolean;
}

function toUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(normalized);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

/**
 * The server's VAPID public key.
 *
 * Deliberately fetched rather than read from `process.env.NEXT_PUBLIC_...`:
 * that value is inlined when the app is BUILT, so adding it to the host and
 * not redeploying leaves the browser with nothing and the user with a flat
 * "push_not_configured". Asking the server means the key is always the one it
 * is actually signing with.
 *
 * Cached for the page's lifetime — it changes only when the pair is rotated.
 */
let keyCache: string | null | undefined;

async function fetchVapidKey(): Promise<string | null> {
  if (keyCache !== undefined) return keyCache;
  try {
    const res = await fetch('/api/push/key');
    const json = res.ok ? ((await res.json()) as { key?: string }) : null;
    keyCache = json?.key ?? null;
  } catch {
    keyCache = null; // offline or the route is missing; treated as unconfigured
  }
  return keyCache;
}

/** Does an existing subscription use the key the server signs with? */
function sameKey(existing: ArrayBuffer | null, wanted: Uint8Array): boolean {
  // A subscription whose key the browser will not disclose cannot be
  // verified, so treat it as stale rather than trusting it.
  if (!existing) return false;
  const bytes = new Uint8Array(existing);
  return bytes.length === wanted.length && bytes.every((b, i) => b === wanted[i]);
}

function isIos(): boolean {
  if (typeof window === 'undefined') return false;
  const ua = navigator.userAgent;
  return (
    /iPad|iPhone|iPod/.test(ua) ||
    // iPadOS reports itself as a Mac; the touch check distinguishes it.
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );
}

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as { standalone?: boolean }).standalone === true
  );
}

/**
 * Get an ACTIVE service worker registration.
 *
 * `navigator.serviceWorker.ready` never resolves when nothing is registered —
 * it does not reject, it simply hangs, which would leave the UI stuck on
 * "loading" forever. So: look for an existing registration, register
 * explicitly if there is none, and race `ready` against a timeout so this
 * always returns.
 */
async function getActiveRegistration(timeoutMs = 6000): Promise<ServiceWorkerRegistration | null> {
  try {
    const existing = await navigator.serviceWorker.getRegistration();
    if (existing?.active) return existing;

    // Idempotent: registering an already-registered worker is a no-op.
    await navigator.serviceWorker.register('/sw.js');

    return await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
    ]);
  } catch {
    return null;
  }
}

export function usePushSubscription() {
  const [state, setState] = useState<PushState>('loading');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [diagnostics, setDiagnostics] = useState<PushDiagnostics | null>(null);

  const refresh = useCallback(async () => {
    if (typeof window === 'undefined') return;

    const hasSw = 'serviceWorker' in navigator;
    const hasPush = 'PushManager' in window;
    const hasNotification = 'Notification' in window;
    const ios = isIos();
    const standalone = isStandalone();
    const serverKey = await fetchVapidKey();

    const base: PushDiagnostics = {
      serviceWorker: hasSw,
      pushManager: hasPush,
      notification: hasNotification,
      permission: hasNotification ? Notification.permission : 'n/a',
      registered: false,
      active: false,
      subscribed: false,
      vapidKey: Boolean(serverKey),
      standalone,
      ios,
      // Push requires a secure context; localhost counts as secure.
      secure: window.isSecureContext,
    };

    // On iOS the APIs are absent in a tab, so check that first to give an
    // actionable message rather than a flat "unsupported".
    if (ios && !standalone) {
      setDiagnostics(base);
      setState('needs-install');
      return;
    }
    if (!hasSw || !hasPush || !hasNotification) {
      setDiagnostics(base);
      setState('unsupported');
      return;
    }

    const reg = await getActiveRegistration();
    base.registered = Boolean(reg);
    base.active = Boolean(reg?.active);

    if (!reg) {
      setDiagnostics(base);
      setState('no-sw');
      return;
    }

    let sub: PushSubscription | null = null;
    try {
      sub = await reg.pushManager.getSubscription();
    } catch {
      sub = null;
    }
    base.subscribed = Boolean(sub);
    setDiagnostics(base);

    // Permission is checked AFTER the registration probe so the diagnostics
    // are complete even for a denied device.
    if (Notification.permission === 'denied') { setState('denied'); return; }
    setState(sub ? 'on' : 'off');
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const enable = useCallback(async (): Promise<boolean> => {
    setError(null);
    setBusy(true);
    try {
      const key = await fetchVapidKey();
      if (!key) { setError('push_not_configured'); return false; }

      const reg = await getActiveRegistration();
      if (!reg) { setError('service_worker_unavailable'); setState('no-sw'); return false; }

      // Permission is only ever requested from a real tap; a prompt on page
      // load is the fastest way to be permanently denied.
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setState(permission === 'denied' ? 'denied' : 'off');
        return false;
      }

      // A subscription left over from a DIFFERENT key — an earlier pair, or a
      // build that shipped a stale one — is worse than none: the push service
      // keeps accepting it and the server can never deliver to it. Reusing it
      // blindly is how "I allowed it and nothing happens" becomes permanent,
      // so replace it whenever the key does not match.
      const keyBytes = toUint8Array(key);
      const existing = await reg.pushManager.getSubscription();
      const usable = existing !== null && sameKey(existing.options.applicationServerKey, keyBytes);
      if (existing && !usable) await existing.unsubscribe();

      const sub = usable
        ? existing
        : await reg.pushManager.subscribe({
            userVisibleOnly: true, // required by Chrome
            applicationServerKey: keyBytes as BufferSource,
          });

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
      void refresh();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  const disable = useCallback(async () => {
    setBusy(true);
    try {
      const reg = await getActiveRegistration();
      const sub = reg ? await reg.pushManager.getSubscription() : null;
      if (sub) {
        const endpoint = sub.endpoint;
        await sub.unsubscribe();
        await deletePushSubscription(endpoint);
      }
      setState('off');
      void refresh();
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  return { state, error, busy, diagnostics, enable, disable, refresh };
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
