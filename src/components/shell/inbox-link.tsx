'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Inbox } from 'lucide-react';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import { createClient } from '@/lib/supabase/client';

/** How often an open app re-counts unread notifications. */
const RECOUNT_MS = 60_000;

/**
 * The inbox icon in the header, with its unread count.
 *
 * The count arrives with the layout, but a layout is not re-rendered when
 * somebody moves between screens — so without a recount, a notification that
 * lands while the app is open would not show until a full reload. It recounts
 * every minute while visible and whenever the app comes back to the
 * foreground: one head-only count of the viewer's own rows.
 */
export function InboxLink({ initialUnread, active }: { initialUnread: number; active: boolean }) {
  const { t } = useI18n();
  const supabase = useMemo(() => createClient(), []);
  const [unread, setUnread] = useState(initialUnread);

  // A fresh server count (after marking read, say) wins over the last poll.
  useEffect(() => setUnread(initialUnread), [initialUnread]);

  useEffect(() => {
    let cancelled = false;
    const recount = async () => {
      if (document.visibilityState !== 'visible') return;
      const { count, error } = await supabase
        .from('notification_inbox')
        .select('id', { count: 'exact', head: true })
        .is('read_at', null);
      if (!cancelled && !error) setUnread(count ?? 0);
    };
    const timer = window.setInterval(recount, RECOUNT_MS);
    document.addEventListener('visibilitychange', recount);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', recount);
    };
  }, [supabase]);

  return (
    <Link
      href="/inbox"
      aria-label={unread > 0 ? `${t('inbox.title')} · ${t('inbox.unread', { count: unread })}` : t('inbox.title')}
      className={cn(
        'relative flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-colors',
        active ? 'bg-surface-2 text-fg' : 'text-muted hover:bg-surface-2 hover:text-fg',
      )}
    >
      <Inbox className="h-[18px] w-[18px]" aria-hidden />
      {unread > 0 && (
        <span
          className="absolute right-0.5 top-0.5 min-w-[16px] rounded-full bg-late px-1 text-center text-[10px] font-semibold leading-4 tabular text-white"
          aria-hidden
        >
          {unread > 99 ? '99+' : unread}
        </span>
      )}
    </Link>
  );
}
