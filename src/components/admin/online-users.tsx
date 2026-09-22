'use client';

import { useEffect, useMemo, useState } from 'react';
import { useI18n, type MessageKey } from '@/i18n';
import { createClient } from '@/lib/supabase/client';
import { displayName, initials } from '@/lib/utils';
import { BUSINESS_TZ } from '@/lib/datetime';
import { formatAgo } from '@/lib/relative-time';
import { Badge, Card, EmptyState } from '@/components/ui/primitives';
import { PageHeader } from '@/components/shell/app-shell';
import { areaFor, isOnline, type PresenceArea, type PresenceRow } from '@/domain/presence';
import type { Role } from '@/lib/authz';
import type { Profile } from '@/types/database';

/** How often the list re-reads check-ins. Well inside the online window. */
const REFRESH_MS = 10_000;

const AREA_LABEL: Record<PresenceArea, MessageKey> = {
  dashboard: 'nav.dashboard',
  orders: 'orders.title',
  'lot-tracker': 'lot.title',
  incidents: 'incident.navLabel',
  'goods-reception': 'gr.navLabel',
  inventory: 'inventory.title',
  reminders: 'reminder.navLabel',
  calendar: 'nav.calendar',
  admin: 'nav.manage',
  settings: 'nav.settings',
};

const ROLE_LABEL: Record<Role, MessageKey> = {
  admin: 'roles.admin',
  manager: 'roles.manager',
  power_user: 'roles.powerUser',
  production_manager: 'roles.productionManager',
  user: 'roles.user',
};

/**
 * Who has the app open right now, and when everybody else was last seen.
 *
 * Live by polling rather than by subscription: check-ins arrive every 30
 * seconds anyway, so re-reading one small table every few seconds is as
 * current as a stream would be, with nothing to reconnect when a laptop
 * sleeps.
 */
export function OnlineUsers({
  users,
  initialPresence,
}: {
  users: Profile[];
  initialPresence: PresenceRow[];
}) {
  const { t, locale } = useI18n();
  const supabase = useMemo(() => createClient(), []);
  const [presence, setPresence] = useState(initialPresence);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      if (document.visibilityState !== 'visible') return;
      const { data } = await supabase
        .from('user_presence')
        .select('user_id, last_seen_at, started_at, path');
      if (cancelled) return;
      // A failed read keeps the last good list rather than emptying the screen.
      if (data) setPresence(data as PresenceRow[]);
      setNow(Date.now());
    };
    const timer = window.setInterval(refresh, REFRESH_MS);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [supabase]);

  const byUser = new Map(presence.map((p) => [p.user_id, p]));
  const rows = users.map((user) => ({ user, seen: byUser.get(user.id) ?? null }));

  const online = rows
    .filter((r) => isOnline(r.seen?.last_seen_at, now))
    .sort((a, b) => displayName(a.user).localeCompare(displayName(b.user)));
  const offline = rows
    .filter((r) => !isOnline(r.seen?.last_seen_at, now))
    // Most recently seen first; never seen at the bottom.
    .sort((a, b) => (b.seen?.last_seen_at ?? '').localeCompare(a.seen?.last_seen_at ?? ''));

  const time = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', timeZone: BUSINESS_TZ });
  const ago = (iso: string) => formatAgo(iso, now, locale);

  const screenLabel = (path: string | null) => {
    const area = areaFor(path);
    return area ? t(AREA_LABEL[area]) : null;
  };

  const person = (user: Profile, detail: React.ReactNode, isLive: boolean) => (
    <li key={user.id} className="flex items-center gap-3 px-3.5 py-2.5">
      <span className="relative shrink-0">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-surface-2 text-[11px] font-semibold text-muted">
          {initials(user.name, user.email)}
        </span>
        {isLive && (
          <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-surface bg-done" aria-hidden />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13.5px] font-medium">{displayName(user)}</p>
        <p className="truncate text-[12px] text-muted">{detail}</p>
      </div>
      <Badge className="shrink-0">{t(ROLE_LABEL[user.role])}</Badge>
    </li>
  );

  return (
    <>
      <PageHeader title={t('online.title')} subtitle={t('online.subtitle')} />

      <section className="mb-6">
        <h2 className="mb-2 flex items-center gap-2 text-[13px] font-semibold">
          <span className="h-2 w-2 rounded-full bg-done" aria-hidden />
          {t('online.onlineNow', { count: online.length })}
        </h2>
        {online.length === 0 ? (
          <EmptyState title={t('online.nobody')} body={t('online.nobodyBody')} />
        ) : (
          <Card>
            <ul className="divide-y divide-border">
              {online.map(({ user, seen }) => {
                const screen = screenLabel(seen!.path);
                const since = t('online.since', { time: time.format(new Date(seen!.started_at)) });
                return person(user, screen ? `${screen} · ${since}` : since, true);
              })}
            </ul>
          </Card>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-[13px] font-semibold">{t('online.offline', { count: offline.length })}</h2>
        {offline.length > 0 && (
          <Card>
            <ul className="divide-y divide-border">
              {offline.map(({ user, seen }) =>
                person(
                  user,
                  seen ? t('online.lastSeen', { when: ago(seen.last_seen_at) }) : t('online.neverSeen'),
                  false,
                ),
              )}
            </ul>
          </Card>
        )}
      </section>
    </>
  );
}
