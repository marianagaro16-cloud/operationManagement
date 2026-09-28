'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, BellRing, Plus } from 'lucide-react';
import { useI18n } from '@/i18n';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Badge, Card, EmptyState, ErrorState, Field, Input, Select } from '@/components/ui/primitives';
import { NoteText } from '@/components/ui/note';
import { NoteTextarea } from '@/components/ui/note-textarea';
import { addCustomerNote } from '@/server/sales-actions';
import { NOTE_KINDS, type Amount, type CustomerNoteKind } from '@/types/sales';
import type { CustomerFileView } from '@/server/sales';

const KIND_KEY = {
  call: 'sales.kindCall',
  visit: 'sales.kindVisit',
  message: 'sales.kindMessage',
  offer: 'sales.kindOffer',
} as const;

const number = (n: number, digits = 0) =>
  new Intl.NumberFormat('de-CH', { maximumFractionDigits: digits }).format(Number(n));

/**
 * One customer as sales sees them: how they order, what they buy, what went
 * wrong, and the notes of every call and visit — with follow-ups.
 */
export function CustomerFile({ view, today }: { view: CustomerFileView; today: string }) {
  const { t, formatDate } = useI18n();
  const { file, notes, followUps } = view;
  const { customer, orders } = file;
  const [adding, setAdding] = useState(false);

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
        </div>
        <p className="mt-1 break-words text-[12.5px] text-muted">
          {[customer.company_name_addition, customer.type, customer.name, address].filter(Boolean).join(' · ')}
        </p>
      </Card>

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

      {/* Notes and follow-ups */}
      <div className="mb-2 flex items-center justify-between gap-3">
        <h2 className="text-[15px] font-semibold">{t('sales.notes')}</h2>
        <Button size="sm" variant="primary" onClick={() => setAdding(true)}>
          <Plus className="h-3.5 w-3.5" aria-hidden />
          {t('sales.newNote')}
        </Button>
      </div>

      {followUps.length > 0 && (
        <Card className="mb-3 p-3">
          <p className="mb-1 text-[11.5px] font-semibold uppercase tracking-wide text-muted">{t('sales.followUps')}</p>
          <ul className="space-y-1">
            {followUps.map((f) => (
              <li key={f.id}>
                <Link href={`/reminders/${f.id}`} className="flex items-center gap-2 text-[12.5px] hover:text-accent">
                  <BellRing className="h-3.5 w-3.5 shrink-0 text-accent" aria-hidden />
                  <span className="tabular">{formatDate(f.next_at, 'weekday')}</span>
                  <span className="truncate text-muted">{f.title}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {notes.length === 0 ? (
        <EmptyState title={t('sales.noNotes')} />
      ) : (
        <ul className="space-y-2">
          {notes.map((n) => (
            <li key={n.id}>
              <Card className="p-3">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted">
                  <Badge tone="accent">{t(KIND_KEY[n.kind])}</Badge>
                  <span className="tabular font-medium text-fg">{formatDate(n.note_date, 'medium')}</span>
                  {n.author_name && <span>{t('sales.by', { name: n.author_name })}</span>}
                </div>
                <div className="mt-1.5 text-[13px] leading-relaxed">
                  <NoteText text={n.body} />
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}

      {adding && <NoteDialog customerId={customer.id} today={today} onClose={() => setAdding(false)} />}
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

function NoteDialog({ customerId, today, onClose }: { customerId: string; today: string; onClose: () => void }) {
  const { t } = useI18n();
  const router = useRouter();
  const [kind, setKind] = useState<CustomerNoteKind>('call');
  const [date, setDate] = useState(today);
  const [body, setBody] = useState('');
  const [followUp, setFollowUp] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    if (!body.trim()) return;
    setError(null);
    startTransition(async () => {
      const res = await addCustomerNote({
        customer_id: customerId,
        kind,
        note_date: date,
        body,
        follow_up_on: followUp || null,
      });
      if (!res.ok) return setError(res.error);
      router.refresh();
      if (res.data.followUp === 'failed') return setError(t('sales.followUpFailed'));
      onClose();
    });
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('sales.newNote')}
      description={t('sales.notePermanent')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>{t('common.cancel')}</Button>
          <Button variant="primary" onClick={submit} loading={pending} disabled={!body.trim()}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-3.5">
        {error && <ErrorState message={error} />}
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('sales.noteKind')} htmlFor="note-kind">
            <Select id="note-kind" value={kind} onChange={(e) => setKind(e.target.value as CustomerNoteKind)}>
              {NOTE_KINDS.map((k) => (
                <option key={k} value={k}>{t(KIND_KEY[k])}</option>
              ))}
            </Select>
          </Field>
          <Field label={t('sales.noteDate')} htmlFor="note-date">
            <Input id="note-date" type="date" max={today} value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
        </div>
        <Field label={t('sales.noteBody')} htmlFor="note-body" required>
          <NoteTextarea id="note-body" rows={4} value={body} onChange={(e) => setBody(e.target.value)} autoFocus />
        </Field>
        <Field label={t('sales.followUp')} hint={t('sales.followUpHint')} htmlFor="note-follow">
          <Input id="note-follow" type="date" min={today} value={followUp} onChange={(e) => setFollowUp(e.target.value)} className="max-w-48" />
        </Field>
      </div>
    </Dialog>
  );
}
