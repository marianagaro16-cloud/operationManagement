'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronRight, Inbox } from 'lucide-react';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import { formatAgo } from '@/lib/relative-time';
import { Button } from '@/components/ui/button';
import { Card, EmptyState } from '@/components/ui/primitives';
import { PageHeader } from '@/components/shell/app-shell';
import { markInboxRead } from '@/server/inbox-actions';
import type { InboxEntry } from '@/server/inbox';
import { NoteText } from '@/components/ui/note';

/**
 * Every notification sent to the viewer, newest first.
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
  const [now] = useState(() => Date.now());

  const isUnread = (e: InboxEntry) => !e.read_at && !allRead && !readIds.has(e.id);
  const unread = entries.filter(isUnread).length;

  function open(entry: InboxEntry) {
    const leaves = entry.url && entry.url !== '/inbox';
    if (isUnread(entry)) {
      setReadIds((prev) => new Set(prev).add(entry.id));
      startTransition(async () => {
        await markInboxRead([entry.id]);
        if (!leaves) router.refresh();
      });
    }
    if (leaves) router.push(entry.url!);
  }

  function markAll() {
    setAllRead(true);
    startTransition(async () => {
      await markInboxRead();
      router.refresh();
    });
  }

  return (
    <>
      <PageHeader
        title={t('inbox.title')}
        subtitle={t('inbox.subtitle')}
        action={
          unread > 0 ? (
            <Button size="sm" variant="secondary" disabled={pending} onClick={markAll}>
              {t('inbox.markAllRead')}
            </Button>
          ) : undefined
        }
      />

      {entries.length === 0 ? (
        <EmptyState
          icon={<Inbox className="h-5 w-5" aria-hidden />}
          title={t('inbox.empty')}
          body={t('inbox.emptyBody')}
        />
      ) : (
        <>
          {unread > 0 && (
            <p className="mb-2 text-[13px] font-semibold">{t('inbox.unread', { count: unread })}</p>
          )}
          <Card>
            <ul className="divide-y divide-border">
              {entries.map((entry) => {
                const fresh = isUnread(entry);
                const urgent = entry.level === 'critical' || entry.level === 'overdue';
                const leaves = entry.url && entry.url !== '/inbox';
                return (
                  <li key={entry.id}>
                    <button
                      onClick={() => open(entry)}
                      className={cn(
                        'flex w-full items-start gap-3 px-3.5 py-3 text-left transition-colors hover:bg-surface-2/60',
                        fresh && 'bg-accent/[0.04]',
                      )}
                    >
                      <span
                        className={cn(
                          'mt-1.5 h-2 w-2 shrink-0 rounded-full',
                          fresh ? (urgent ? 'bg-late' : 'bg-accent') : 'bg-transparent',
                        )}
                        aria-hidden
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline gap-2">
                          <p
                            className={cn(
                              'min-w-0 flex-1 truncate text-[13.5px]',
                              fresh ? 'font-semibold' : 'font-medium text-muted',
                            )}
                          >
                            {entry.title}
                          </p>
                          <span className="shrink-0 text-[11.5px] tabular text-subtle">
                            {formatAgo(entry.created_at, now, locale)}
                          </span>
                        </div>
                        {entry.body && (
                          <NoteText
                            className={cn('mt-0.5 text-[13px]', fresh ? 'text-fg' : 'text-muted')}
                            text={entry.body}
                          />
                        )}
                      </div>
                      {leaves && <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-subtle" aria-hidden />}
                    </button>
                  </li>
                );
              })}
            </ul>
          </Card>
        </>
      )}
    </>
  );
}
