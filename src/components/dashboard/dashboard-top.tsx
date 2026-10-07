'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { DateTime } from 'luxon';
import {
  AlertTriangle, ArrowDownRight, ArrowUpRight, Ban, Bell, Boxes, CalendarCheck, CalendarOff, CheckCircle2, ChevronRight, ClipboardCheck,
  ClipboardList, ListTodo, MapPin, Package, Receipt, Target, TrendingUp, Users, Zap,
} from 'lucide-react';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import { BUSINESS_TZ } from '@/lib/datetime';
import { Card } from '@/components/ui/primitives';
import type { NowItem, NowKind } from '@/domain/dashboard/now';

/* The top of the dashboard: who and when, the figures, and what needs doing now. */

export function Greeting({ name, today }: { name: string | null; today: string }) {
  const { t, formatDate } = useI18n();
  const hour = DateTime.now().setZone(BUSINESS_TZ).hour;
  const hello = hour < 12 ? t('dashboard.greetingMorning') : hour < 19 ? t('dashboard.greetingAfternoon') : t('dashboard.greetingEvening');
  const first = name?.split(' ')[0];
  return (
    <div className="mb-4">
      <h1 className="text-[22px] font-semibold leading-tight">
        {hello}{first ? `, ${first}` : ''}
      </h1>
      <p className="mt-0.5 text-[13px] capitalize text-muted">{formatDate(today, 'weekday')}</p>
    </div>
  );
}

export interface Figure {
  key: string;
  icon: ReactNode;
  label: string;
  value: string;
  hint?: ReactNode;
  href?: string;
  /** done: finished; late: something is late; neutral otherwise. */
  tone?: 'done' | 'late' | 'neutral';
}

/** A row of figures: two across on a phone, up to four on a computer. */
export function FigureRow({ figures }: { figures: Figure[] }) {
  if (figures.length === 0) return null;
  return (
    <div className={cn('mb-4 grid grid-cols-2 gap-2.5', figures.length >= 4 ? 'lg:grid-cols-4' : figures.length === 3 ? 'lg:grid-cols-3' : '')}>
      {figures.map((f) => {
        const body = (
          <Card className={cn('h-full px-3.5 py-3 transition-colors', f.href && 'hover:bg-surface-2/50', f.tone === 'late' && 'border-late/30')}>
            <div className="flex items-center gap-1.5 text-muted">
              {f.icon}
              <span className="truncate text-[11.5px] font-medium">{f.label}</span>
            </div>
            <p className={cn('mt-1 text-[22px] font-semibold leading-tight tabular', f.tone === 'done' ? 'text-done' : f.tone === 'late' ? 'text-late' : 'text-fg')}>
              {f.value}
            </p>
            {f.hint && <div className="mt-0.5 text-[11.5px] text-muted">{f.hint}</div>}
          </Card>
        );
        return f.href ? <Link key={f.key} href={f.href}>{body}</Link> : <div key={f.key}>{body}</div>;
      })}
    </div>
  );
}

/** Up or down against before, with an arrow — never colour alone. */
export function ChangeHint({ now, before, suffix }: { now: number; before: number; suffix: string }) {
  if (!before) return <span>{suffix}</span>;
  const pct = Math.round(((now - before) / before) * 100);
  const Icon = pct >= 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <span className="inline-flex items-center gap-0.5">
      <Icon className={cn('h-3.5 w-3.5', pct >= 0 ? 'text-done' : 'text-late')} aria-hidden />
      <span className={cn('font-medium tabular', pct >= 0 ? 'text-done' : 'text-late')}>{pct > 0 ? '+' : ''}{pct}%</span>
      <span className="ml-1">{suffix}</span>
    </span>
  );
}

const NOW_ICON: Record<NowKind, typeof Zap> = {
  urgentOrders: Package,
  overdueActivities: AlertTriangle,
  blockedActivities: Ban,
  overdueCounts: Boxes,
  countsToday: Boxes,
  overdueReminders: Bell,
  overduePersonalTasks: ListTodo,
  planLate: CalendarCheck,
  planToday: CalendarCheck,
  evaluationsDue: ClipboardCheck,
  hrFollowUps: ClipboardCheck,
  absencesToApprove: CalendarOff,
  coverageGaps: AlertTriangle,
  meetingInvites: Users,
  meetingRecords: ClipboardCheck,
  meetingFollowUps: ClipboardCheck,
  collectionFollowUps: Receipt,
};

/** What is late or due now, most urgent first. A clear day says so. */
export function NowCard({ items }: { items: NowItem[] }) {
  const { t } = useI18n();
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center gap-1.5 border-b border-border px-3.5 py-2.5">
        <Zap className="h-4 w-4 text-accent" aria-hidden />
        <h2 className="text-[14px] font-semibold">{t('dashboard.nowTitle')}</h2>
        {items.length > 0 && <span className="text-[12px] tabular text-muted">{items.length}</span>}
      </div>
      {items.length === 0 ? (
        <p className="flex items-center gap-2 px-3.5 py-4 text-[13px] text-done">
          <CheckCircle2 className="h-4 w-4" aria-hidden />
          {t('dashboard.nowClear')}
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {items.map((item) => {
            const Icon = NOW_ICON[item.kind];
            const late = item.level === 'late';
            return (
              <li key={item.kind}>
                <Link href={item.href} className="flex items-center gap-3 px-3.5 py-2.5 transition-colors hover:bg-surface-2/60">
                  <span
                    className={cn(
                      'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
                      late ? 'bg-late/10 text-late' : 'bg-warn/10 text-warn',
                    )}
                  >
                    <Icon className="h-4 w-4" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] font-medium">{t(`dashboard.now_${item.kind}` as 'dashboard.nowTitle')}</span>
                    <span className="block truncate text-[12px] text-muted">
                      <span className={cn('font-medium', late ? 'text-late' : 'text-warn')}>
                        {late ? t('dashboard.nowLate') : t('dashboard.nowToday')}
                      </span>
                      {item.names && item.names.length > 0 && ` · ${item.names.join(', ')}`}
                    </span>
                  </span>
                  <span className={cn('shrink-0 text-[15px] font-semibold tabular', late ? 'text-late' : 'text-fg')}>{item.count}</span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-subtle" aria-hidden />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

interface Count {
  done: number;
  total: number;
}

const number = (n: number) => new Intl.NumberFormat('de-CH', { maximumFractionDigits: 0 }).format(n);
const pct = (c: Count) => (c.total ? Math.round((c.done / c.total) * 100) : 0);

/** Owners and Admin: how the business is going today and this month. */
export function BusinessFigures({
  orders,
  sales,
  incidents,
  activities,
}: {
  orders: { total: number; ready: number; shipped: number };
  sales: { quantity: number; prevQuantity: number } | null;
  incidents: { open: number; newThisWeek: number };
  activities: Count & { overdue: number; blocked: number };
}) {
  const { t } = useI18n();
  const figures: Figure[] = [
    {
      key: 'orders',
      icon: <Package className="h-4 w-4" aria-hidden />,
      label: t('dashboard.figOrdersToday'),
      value: number(orders.total),
      hint: t('dashboard.figOrdersHint', { ready: orders.ready, shipped: orders.shipped }),
      href: '/orders?tab=all',
      tone: orders.total > 0 && orders.shipped >= orders.total ? 'done' : 'neutral',
    },
    {
      key: 'sales',
      icon: <TrendingUp className="h-4 w-4" aria-hidden />,
      label: t('dashboard.figSales'),
      value: sales ? number(sales.quantity) : '—',
      hint: sales ? <ChangeHint now={sales.quantity} before={sales.prevQuantity} suffix={t('dashboard.figSalesHint')} /> : undefined,
      href: '/sales?tab=report',
    },
    {
      key: 'incidents',
      icon: <AlertTriangle className="h-4 w-4" aria-hidden />,
      label: t('dashboard.figIncidents'),
      value: number(incidents.open),
      hint: t('dashboard.figIncidentsHint', { count: incidents.newThisWeek }),
      href: '/incidents',
      tone: incidents.open > 0 ? 'late' : 'done',
    },
    {
      key: 'activities',
      icon: <CheckCircle2 className="h-4 w-4" aria-hidden />,
      label: t('dashboard.figActivities'),
      value: activities.total ? `${pct(activities)}%` : '—',
      hint: t('dashboard.figActivitiesHint', { overdue: activities.overdue, blocked: activities.blocked }),
      href: '#today',
      tone: activities.overdue > 0 ? 'late' : activities.total && activities.done >= activities.total ? 'done' : 'neutral',
    },
  ];
  return <FigureRow figures={figures} />;
}

/**
 * Everyone else: today's progress. A stream with nothing in it today is left
 * out rather than shown as 0/0, which would claim a clear day on the strength
 * of work that does not exist.
 */
export function ProgressFigures({
  activities,
  prepare,
  counts,
  plan,
  planLate,
}: {
  activities: Count;
  prepare: Count;
  counts: Count;
  /** Sales people: today's plan, and what is still planned from before. */
  plan?: Count;
  planLate?: number;
}) {
  const { t } = useI18n();
  const count = (key: string, icon: ReactNode, label: string, c: Count, href: string, hint: string): Figure => ({
    key, icon, label, value: `${c.done}/${c.total}`, hint, href, tone: c.done >= c.total ? 'done' : 'neutral',
  });
  const figures: Figure[] = [
    activities.total > 0 && count('activities', <CheckCircle2 className="h-4 w-4" aria-hidden />, t('dashboard.streamTasks'), activities, '#today', t('dashboard.figDone')),
    prepare.total > 0 && count('prepare', <ClipboardList className="h-4 w-4" aria-hidden />, t('dashboard.streamPrepare'), prepare, '/orders?tab=to_prepare', t('dashboard.figReady')),
    counts.total > 0 && count('counts', <Boxes className="h-4 w-4" aria-hidden />, t('dashboard.streamCounts'), counts, '/inventory', t('dashboard.figDone')),
    plan && plan.total > 0 && count('plan', <CalendarCheck className="h-4 w-4" aria-hidden />, t('sales.planToday'), plan, '/sales?tab=planning', t('dashboard.figDone')),
    planLate !== undefined && planLate > 0 && {
      key: 'planLate',
      icon: <AlertTriangle className="h-4 w-4" aria-hidden />,
      label: t('dashboard.now_planLate'),
      value: String(planLate),
      hint: t('dashboard.figPlanLateHint'),
      href: '/sales?tab=planning',
      tone: 'late' as const,
    },
  ].filter(Boolean) as Figure[];
  return <FigureRow figures={figures} />;
}
