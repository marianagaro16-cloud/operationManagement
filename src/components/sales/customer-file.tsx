'use client';

import { CustomerNotes } from '@/components/notes/notes-view';
import type { QuickNote } from '@/types/notes';
import { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Plus } from 'lucide-react';
import { useI18n } from '@/i18n';
import { Button } from '@/components/ui/button';
import { Badge, Card, EmptyState } from '@/components/ui/primitives';
import { NoteText } from '@/components/ui/note';
import { NoteStar } from './note-star';
import { StageBadge as CollectionStageBadge, chf } from '@/components/collections/collection-parts';
import type { CollectionCaseRow } from '@/types/collections';
import { KindBadge, useKinds } from './activity-kind';
import { NoteDialog, PlanForTargetDialog, PlannedList } from './target-plan';
import type { ActivityKind, Amount } from '@/types/sales';
import type { ActaRow, ActaTopic } from '@/types/sales-acta';
import { TargetActas } from './acta-list';
import type { CustomerFileView } from '@/server/sales';

const number = (n: number, digits = 0) =>
  new Intl.NumberFormat('de-CH', { maximumFractionDigits: digits }).format(Number(n));

/**
 * One customer as sales sees them: how they order, what they buy, what went
 * wrong, the notes of every call and visit, and what is planned with them.
 */
export function CustomerFile({
  view,
  wonFromId,
  kinds,
  viewerId,
  today,
  collections,
  quickNotes = [],
  actas,
  actaTopics,
}: {
  quickNotes?: QuickNote[];
  /** The Actas of the visits and appointments with them, and those still owed. */
  actas: ActaRow[];
  actaTopics: ActaTopic[];
  /** Payments pending — and, for the collections team, the cases. */
  collections: { flagged: 'reminder' | 'pending' | null; prepay: boolean; cases: CollectionCaseRow[] | null };
  view: CustomerFileView;
  /** The prospect this customer was won from: its contact details live there. */
  wonFromId: string | null;
  kinds: ActivityKind[];
  /** Who plans from here: the viewer. */
  viewerId: string;
  today: string;
}) {
  const { t, formatDate } = useI18n();
  const k = useKinds(kinds);
  const { file, notes, planned } = view;
  const { customer, orders } = file;
  const [adding, setAdding] = useState(false);
  const [planning, setPlanning] = useState(false);

  const address = [customer.street, [customer.postal_code, customer.city].filter(Boolean).join(' ')]
    .filter(Boolean)
    .join(', ');

  return (
    <>
      <Link href="/sales" className="mb-3 inline-flex items-center gap-1 text-[12.5px] text-muted hover:text-fg">
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
        {t('sales.back')}
      </Link>

      <Card className="mb-4 p-3.5 sm:p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="break-words text-xl font-semibold leading-tight">{customer.company_name}</h1>
          {!customer.is_active && <Badge tone="neutral">{t('sales.inactive')}</Badge>}
          {collections.flagged === 'pending' && <Badge tone="late">{t('collection.flag')}</Badge>}
          {collections.flagged === 'reminder' && <Badge tone="warn">{t('collection.flagReminder')}</Badge>}
          {collections.prepay && <Badge tone="late">{t('collection.prepay')}</Badge>}
        </div>
        <p className="mt-1 break-words text-[12.5px] text-muted">
          {[customer.company_name_addition, customer.type, address].filter(Boolean).join(' · ')}
        </p>
        {wonFromId && (
          <Link href={`/sales/prospects/${wonFromId}`} className="mt-1 inline-block text-[12.5px] font-medium text-accent hover:underline">
            {t('sales.wonFrom')}
          </Link>
        )}
      </Card>

      {collections.cases && collections.cases.length > 0 && (
        <Card className="mb-4 p-3">
          <div className="mb-1 flex items-center justify-between gap-2">
            <h2 className="text-[11.5px] font-semibold uppercase tracking-wide text-muted">{t('collection.navLabel')}</h2>
            <Link href="/collections" className="text-[12px] font-medium text-accent hover:underline">{t('collection.navLabel')}</Link>
          </div>
          <ul className="divide-y divide-border">
            {collections.cases.map((c) => (
              <li key={c.id}>
                <Link href={`/collections/${c.id}`} className="flex items-center gap-2 py-1.5 text-[13px] hover:text-accent">
                  <CollectionStageBadge stage={c.stage} reminders={c.reminders_sent} />
                  <span className="min-w-0 flex-1 truncate text-muted">{formatDate(c.created_at.slice(0, 10), 'short')}</span>
                  <span className="font-medium tabular">{chf(c.closed_at ? c.total : c.open)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* How they order */}
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label={t('sales.ordersTotal')} value={number(orders.total)} hint={orders.first ? t('sales.since', { date: formatDate(orders.first, 'medium') }) : undefined} />
        <Stat label={t('sales.lastOrder')} value={orders.last ? formatDate(orders.last, 'medium') : t('sales.never')} />
        <Stat label={t('sales.nextOrder')} value={orders.next ? formatDate(orders.next, 'medium') : t('sales.none')} />
        <Stat
          label={t('sales.rhythm')}
          value={file.rhythm_days !== null ? t('sales.everyDays', { days: number(file.rhythm_days, 1) }) : t('sales.rhythmUnknown')}
        />
      </div>

      <Card className="mb-4 p-3.5 sm:p-4">
        <h2 className="text-[14px] font-semibold">{t('sales.last30')}</h2>
        <PeriodCompare now={file.periods.last30} before={file.periods.prev30} />
        <p className="mt-1 text-[11.5px] text-subtle">{t('sales.kgHint')}</p>
      </Card>

      <div className="mb-4 grid gap-4 lg:grid-cols-2">
        <Card className="p-3.5 sm:p-4">
          <h2 className="mb-2 text-[14px] font-semibold">{t('sales.topProducts')}</h2>
          {file.top_products.length === 0 ? (
            <p className="text-[12.5px] text-muted">{t('sales.noOrders')}</p>
          ) : (
            <ul className="divide-y divide-border">
              {file.top_products.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3 py-1.5 text-[12.5px]">
                  <span className="min-w-0 truncate">
                    {p.code && <span className="mr-1.5 tabular text-subtle">{p.code}</span>}
                    {p.name}
                  </span>
                  <span className="shrink-0 tabular text-muted">
                    {t('sales.units', { quantity: number(p.quantity) })}
                    {p.kg ? ` · ${number(p.kg, 1)} kg` : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="p-3.5 sm:p-4">
          <h2 className="mb-2 text-[14px] font-semibold">{t('sales.recentOrders')}</h2>
          {file.recent_orders.length === 0 ? (
            <p className="text-[12.5px] text-muted">{t('sales.noOrders')}</p>
          ) : (
            <ul className="divide-y divide-border">
              {file.recent_orders.map((o) => (
                <li key={o.id}>
                  <Link href={`/orders/${o.id}`} className="flex items-center justify-between gap-3 py-1.5 text-[12.5px] hover:text-accent">
                    <span className="tabular">
                      #{o.reference} · {formatDate(o.delivery_date, 'medium')}
                    </span>
                    <span className="shrink-0 tabular text-muted">
                      {t('sales.orderLines', { lines: o.lines })} · {t('sales.units', { quantity: number(o.quantity) })}
                      {o.kg ? ` · ${number(o.kg, 1)} kg` : ''}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card className="mb-4 p-3.5 sm:p-4">
        <h2 className="mb-2 text-[14px] font-semibold">{t('sales.incidents')}</h2>
        {file.incidents.length === 0 ? (
          <p className="text-[12.5px] text-muted">{t('sales.noIncidents')}</p>
        ) : (
          <ul className="divide-y divide-border">
            {file.incidents.map((i) => (
              <li key={i.id}>
                <Link href={`/incidents/${i.id}`} className="block py-1.5 text-[12.5px] hover:text-accent">
                  <span className="tabular font-medium">#{i.incident_number}</span>
                  <span className="text-muted"> · {formatDate(i.created_at, 'medium')}</span>
                  {i.description && <span className="block truncate text-muted">{i.description}</span>}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* The viewer's own quick notes about this customer (and those shared with them). */}
      <CustomerNotes notes={quickNotes} customer={{ id: customer.id, name: customer.company_name }} viewerId={viewerId} />

      <TargetActas rows={actas} kinds={kinds} topics={actaTopics} today={today} />

      {/* Notes and follow-ups */}
      <div className="mb-2 flex items-center justify-between gap-3">
        <h2 className="text-[15px] font-semibold">{t('sales.notes')}</h2>
        <Button size="sm" variant="primary" onClick={() => setAdding(true)}>
          <Plus className="h-3.5 w-3.5" aria-hidden />
          {t('sales.newNote')}
        </Button>
      </div>

      <PlannedList planned={planned} kinds={kinds} today={today} onPlan={() => setPlanning(true)} />

      {notes.length === 0 ? (
        <EmptyState title={t('sales.noNotes')} />
      ) : (
        <ul className="space-y-2">
          {notes.map((n) => (
            <li key={n.id}>
              <Card className="p-3">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted">
                  <KindBadge kind={k.get(n.kind_id)} />
                  <span className="tabular font-medium text-fg">{formatDate(n.note_date, 'medium')}</span>
                  {n.author_name && <span>{t('sales.by', { name: n.author_name })}</span>}
                  <NoteStar target="customer" noteId={n.id} starred={n.starred} />
                </div>
                <div className="mt-1.5 text-[13px] leading-relaxed">
                  <NoteText text={n.body} />
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}

      {adding && <NoteDialog target={{ kind: 'customer', id: customer.id }} kinds={kinds} today={today} onClose={() => setAdding(false)} />}
      {planning && (
        <PlanForTargetDialog
          target={{ kind: 'customer', id: customer.id }}
          salespersonId={viewerId}
          kinds={kinds}
          today={today}
          onClose={() => setPlanning(false)}
        />
      )}
    </>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card className="p-3">
      <p className="text-[11.5px] font-medium text-muted">{label}</p>
      <p className="mt-0.5 break-words text-[15px] font-semibold tabular leading-tight">{value}</p>
      {hint && <p className="mt-0.5 text-[11.5px] text-subtle">{hint}</p>}
    </Card>
  );
}

function PeriodCompare({ now, before }: { now: Amount; before: Amount }) {
  const { t } = useI18n();
  const change = (a: number, b: number) => {
    if (!b) return null;
    const pct = Math.round(((a - b) / b) * 100);
    return `${pct > 0 ? '+' : ''}${pct}%`;
  };
  const qtyChange = change(Number(now.quantity), Number(before.quantity));
  return (
    <div className="mt-1">
      <p className="text-[18px] font-semibold tabular">
        {t('sales.units', { quantity: number(now.quantity) })}
        <span className="ml-2 text-[14px] font-medium text-muted">{number(now.kg, 1)} kg</span>
      </p>
      <p className="text-[12.5px] text-muted">
        {qtyChange ? t('sales.vsPrev30', { change: qtyChange }) : t('sales.noPrev')}
      </p>
    </div>
  );
}
