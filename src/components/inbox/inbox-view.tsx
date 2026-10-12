'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { DateTime } from 'luxon';
import { ChevronRight, Inbox } from 'lucide-react';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import { BUSINESS_TZ } from '@/lib/datetime';
import { formatAgo } from '@/lib/relative-time';
import { EmptyState } from '@/components/ui/primitives';
import { SpaceTitle } from '@/components/space/bits';
import { markInboxRead } from '@/server/inbox-actions';
import type { InboxEntry } from '@/server/inbox';
import { NoteText } from '@/components/ui/note';

/**
 * Every notification sent to the viewer, newest first, by day.
 *
 * An entry stays unread until it is opened, so the list doubles as a to-do of
 * what has not been looked at yet. Opening one that points somewhere — an
 * order, an inventory, a reminder — marks it read and goes there. A direct
 * message points here, because the message is the whole content.
 */
export function InboxView({ entries }: { entries: InboxEntry[] }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // Read locally at once, so a tap never waits on the round trip to go grey.
  const [readIds, setReadIds] = useState<Set<string>>(new Set());
  const [allRead, setAllRead] = useState(false);
  const [onlyUnread, setOnlyUnread] = useState(false);
  const [now] = useState(() => Date.now());

  const isUnread = (e: InboxEntry) => !e.read_at && !allRead && !readIds.has(e.id);
  const unread = entries.filter(isUnread).length;
  // A direct message points at the inbox itself: there is nowhere to go.
  const leaves = (e: InboxEntry) => Boolean(e.url) && e.url !== '/inbox' && e.url !== '/space/inbox';

  function open(entry: InboxEntry) {
    if (isUnread(entry)) {
      setReadIds((prev) => new Set(prev).add(entry.id));
      startTransition(async () => {
        await markInboxRead([entry.id]);
        if (!leaves(entry)) router.refresh();
      });
    }
    if (leaves(entry)) router.push(entry.url!);
  }

  function markAll() {
    setAllRead(true);
    startTransition(async () => {
      await markInboxRead();
      router.refresh();
    });
  }

  // Today, yesterday, and everything before.
  const today = DateTime.fromMillis(now, { zone: BUSINESS_TZ }).startOf('day');
  const dayOf = (e: InboxEntry) => {
    const diff = today.diff(DateTime.fromISO(e.created_at).setZone(BUSINESS_TZ).startOf('day'), 'days').days;
    return diff <= 0 ? 'today' : diff === 1 ? 'yesterday' : 'earlier';
  };
  const shown = onlyUnread ? entries.filter(isUnread) : entries;
  const days = (['today', 'yesterday', 'earlier'] as const)
    .map((day) => ({ day, list: shown.filter((e) => dayOf(e) === day) }))
    .filter((d) => d.list.length > 0);

  const tab = (on: boolean) =>
    cn('-mb-px border-b-2 px-0.5 pb-1.5 font-medium transition-colors', on ? 'border-accent text-fg' : 'border-transparent text-muted hover:text-fg');

  return (
    <>
      <SpaceTitle title={t('space.inbox')} icon={<Inbox className="h-6 w-6 shrink-0 text-sky-500" aria-hidden />}>
        <p className="mt-1 text-[13px] text-muted">{t('space.inboxKept')}</p>
      </SpaceTitle>

      {entries.length === 0 ? (
        <EmptyState icon={<Inbox className="h-5 w-5" aria-hidden />} title={t('inbox.empty')} body={t('inbox.emptyBody')} />
      ) : (
        <>
          <div className="mb-3 flex items-center gap-4 border-b border-border text-[13px]">
            <button role="tab" aria-selected={!onlyUnread} onClick={() => setOnlyUnread(false)} className={tab(!onlyUnread)}>
              {t('space.inboxAll')}
            </button>
            <button role="tab" aria-selected={onlyUnread} onClick={() => setOnlyUnread(true)} className={tab(onlyUnread)}>
              {t('inbox.unread', { count: unread })}
            </button>
            {unread > 0 && (
              <button onClick={markAll} disabled={pending} className="mb-1.5 ml-auto text-[12.5px] text-muted hover:text-fg disabled:opacity-50">
                {t('inbox.markAllRead')}
              </button>
            )}
          </div>

          {days.length === 0 && <p className="px-1 py-3 text-[13px] text-subtle">{t('space.inboxNoneUnread')}</p>}

          <div className="space-y-4">
            {days.map(({ day, list }) => (
              <section key={day}>
                <h2 className="mb-0.5 px-1 text-[12px] font-semibold text-subtle">{t(`space.${day}`)}</h2>
                <ul>
                  {list.map((entry) => {
                    const fresh = isUnread(entry);
                    const urgent = entry.level === 'critical' || entry.level === 'overdue';
                    return (
                      <li key={entry.id}>
                        <button
                          onClick={() => open(entry)}
                          className="flex w-full items-start gap-2.5 rounded-md px-1 py-2 text-left transition-colors hover:bg-surface-2/50"
                        >
                          <span
                            className={cn('mt-[7px] h-2 w-2 shrink-0 rounded-full', fresh ? (urgent ? 'bg-late' : 'bg-accent') : 'bg-transparent')}
                            aria-hidden
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-baseline gap-2">
                              <p className={cn('min-w-0 flex-1 break-words text-[14.5px] leading-snug', fresh ? 'font-semibold' : 'text-muted')}>
                                {entry.title}
                              </p>
                              <span className="shrink-0 text-[12px] tabular text-subtle">{formatAgo(entry.created_at, now, locale)}</span>
                            </div>
                            {entry.body && <NoteText className={cn('mt-0.5 text-[13px]', fresh ? 'text-fg' : 'text-muted')} text={entry.body} />}
                          </div>
                          {leaves(entry) && <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-subtle" aria-hidden />}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
        </>
      )}
    </>
  );
}
