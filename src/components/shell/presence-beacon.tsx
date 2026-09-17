'use client';

import { useEffect, useMemo, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { HEARTBEAT_MS } from '@/domain/presence';

/**
 * Tells the server this app is open, so an admin can see who is using it.
 *
 * Checks in when a screen opens, when the app comes back to the foreground,
 * and every HEARTBEAT_MS while it stays visible. A hidden tab or a phone in a
 * pocket stops checking in, which is exactly what lets the person drop off the
 * online list — an app left open in the background is not somebody using it.
 *
 * Renders nothing. A failed check-in is ignored: the next one retries, and
 * presence is never worth an error on somebody's screen.
 */
export function PresenceBeacon() {
  const pathname = usePathname();
  const supabase = useMemo(() => createClient(), []);
  const path = useRef(pathname);
  path.current = pathname;

  useEffect(() => {
    if (document.visibilityState !== 'visible') return;
    // A query builder only sends when it is awaited — `then` is what fires it.
    supabase.rpc('touch_presence', { p_path: pathname }).then(() => undefined);
  }, [pathname, supabase]);

  useEffect(() => {
    const touch = () => {
      if (document.visibilityState !== 'visible') return;
      supabase.rpc('touch_presence', { p_path: path.current }).then(() => undefined);
    };
    const timer = window.setInterval(touch, HEARTBEAT_MS);
    document.addEventListener('visibilitychange', touch);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', touch);
    };
  }, [supabase]);

  return null;
}
