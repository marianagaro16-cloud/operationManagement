'use client';

import { useState, useTransition, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Banknote, Building2, CalendarCheck, Mail, MessageSquare, Phone, Plus, RotateCcw, Trash2, XCircle } from 'lucide-react';
import { useI18n, type MessageKey } from '@/i18n';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Card, ErrorState, Field, Input, Select } from '@/components/ui/primitives';
import { NoteText } from '@/components/ui/note';
import { NoteTextarea } from '@/components/ui/note-textarea';
import {
  addInvoice,
  addPayment,
  logContact,
  removeInvoice,
  sendToAgency,
  setPromise,
  setResponsible,
  setStage,
} from '@/server/collection-actions';
import type { CollectionAgency, CollectionCaseRow, CollectionEvent, CollectionInvoice, CollectionPayment } from '@/types/collections';
import { StageBadge, chf, useCollectionLabels } from './collection-parts';

type Open = 'contact' | 'promise' | 'payment' | 'agency' | 'uncollectible' | 'settled' | 'reopen' | 'invoice' | null;

/** One collection case: what is owed, where it stands, what was done, and the next step. */
export function CaseView({
  row,
  invoices,
  payments,
  events,
  team,
  agencies,
  today,
}: {
  row: CollectionCaseRow;
  invoices: CollectionInvoice[];
  payments: CollectionPayment[];
  events: CollectionEvent[];
  team: { id: string; name: string }[];
  agencies: CollectionAgency[];
  today: string;
}) {
  const { t, formatDate } = useI18n();
  const router = useRouter();
  const labels = useCollectionLabels();
  const [open, setOpen] = useState<Open>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const closed = !!row.closed_at;
  const beforeAgency = row.stage === 'follow_up' || row.stage === 'promise';
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) return setError(labels.error(res.error ?? ''));
      router.refresh();
    });
  };

  return (
    <>
      <Link href="/collections" className="mb-3 inline-flex items-center gap-1 text-[12.5px] text-muted hover:text-fg">
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
        {t('collection.navLabel')}
      </Link>

      <Card className="mb-4 p-3.5 sm:p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold leading-tight">
              <Link href={`/sales/customers/${row.customer_id}`} className="hover:text-accent">{row.customer_name}</Link>
            </h1>
            <p className="mt-1 flex flex-wrap items-center gap-2 text-[12.5px] text-muted">
              <StageBadge stage={row.stage} />
              {row.stage === 'promise' && row.promised_on && t('collection.promisedFor', { date: formatDate(row.promised_on, 'short') })}
              {row.agency_name && (
                <span>
                  {row.agency_name}
                  {row.agency_sent_on && ` · ${formatDate(row.agency_sent_on, 'short')}`}
                  {row.agency_reference && ` · ${t('collection.agencyRef', { ref: row.agency_reference })}`}
                </span>
              )}
            </p>
          </div>
          <div className="text-right">
            <p className="text-2xl font-semibold tabular">{chf(row.open)}</p>
            <p className="text-[12px] text-muted tabular">{t('collection.invoicedPaid', { total: chf(row.total), paid: chf(row.paid) })}</p>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-end gap-3 border-t border-border pt-3 text-[13px]">
          <Field label={t('collection.responsible')} htmlFor="case-responsible">
            <Select
              id="case-responsible"
              value={row.responsible_id ?? ''}
              disabled={pending || closed}
              onChange={(e) => run(() => setResponsible(row.id, e.target.value))}
              className="w-auto"
            >
              {!row.responsible_id && <option value="">—</option>}
              {team.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          </Field>
          {!closed && (
            <p className={cn('pb-2', row.next_follow_up && row.next_follow_up < today ? 'font-semibold text-late' : 'text-muted')}>
              {row.next_follow_up ? t('collection.nextOn', { date: formatDate(row.next_follow_up, 'weekday') }) : t('collection.noNext')}
            </p>
          )}
        </div>

        {error && <div className="mt-3"><ErrorState message={error} /></div>}

        <div className="mt-3 flex flex-wrap gap-2">
          {!closed && (
            <Button size="sm" variant="primary" onClick={() => setOpen('contact')}>
              <Phone className="h-3.5 w-3.5" aria-hidden />
              {t('collection.logContact')}
            </Button>
          )}
          {beforeAgency && (
            <Button size="sm" variant="secondary" onClick={() => setOpen('promise')}>
              <CalendarCheck className="h-3.5 w-3.5" aria-hidden />
              {t('collection.promise')}
            </Button>
          )}
          {!closed && row.open > 0 && (
            <Button size="sm" variant="success" onClick={() => setOpen('payment')}>
              <Banknote className="h-3.5 w-3.5" aria-hidden />
              {t('collection.payment')}
            </Button>
          )}
          {beforeAgency && (
            <Button size="sm" variant="secondary" onClick={() => setOpen('agency')}>
              <Building2 className="h-3.5 w-3.5" aria-hidden />
              {t('collection.toAgency')}
            </Button>
          )}
          {!closed && (
            <Button size="sm" variant="ghost" onClick={() => setOpen('settled')}>
              {t('collection.settled')}
            </Button>
          )}
          {!closed && (
            <Button size="sm" variant="ghost" onClick={() => setOpen('uncollectible')}>
              <XCircle className="h-3.5 w-3.5" aria-hidden />
              {t('collection.uncollectible')}
            </Button>
          )}
          {closed && (
            <Button size="sm" variant="secondary" onClick={() => setOpen('reopen')}>
              <RotateCcw className="h-3.5 w-3.5" aria-hidden />
              {t('collection.reopen')}
            </Button>
          )}
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-4">
          <Section
            title={t('collection.invoices')}
            action={
              !closed && (
                <Button size="sm" variant="ghost" onClick={() => setOpen('invoice')}>
                  <Plus className="h-3.5 w-3.5" aria-hidden />
                  {t('collection.addInvoice')}
                </Button>
              )
            }
          >
            <ul className="divide-y divide-border text-[13px]">
              {invoices.map((i) => (
                <li key={i.id} className="flex items-center gap-2 py-1.5">
                  <span className="min-w-0 flex-1 font-medium">{i.invoice_number}</span>
                  {i.due_date && (
                    <span className={cn('text-[12px] tabular', i.due_date < today ? 'text-late' : 'text-muted')}>
                      {t('collection.dueOn', { date: formatDate(i.due_date, 'short') })}
                    </span>
                  )}
                  <span className="w-28 text-right tabular">{chf(i.amount)}</span>
                  {!closed && invoices.length > 1 && (
                    <Button size="icon" variant="ghost" aria-label={t('common.delete')} disabled={pending} onClick={() => run(() => removeInvoice(row.id, i.id))}>
                      <Trash2 className="h-3.5 w-3.5" aria-hidden />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </Section>
          <Section title={t('collection.payments')}>
            {payments.length === 0 ? (
              <p className="text-[12.5px] text-muted">{t('collection.noPayments')}</p>
            ) : (
              <ul className="divide-y divide-border text-[13px]">
                {payments.map((p) => (
                  <li key={p.id} className="flex items-center gap-2 py-1.5">
                    <span className="tabular text-muted">{formatDate(p.paid_on, 'short')}</span>
                    <span className="min-w-0 flex-1 truncate text-[12px] text-muted">
                      {p.via_agency && t('collection.viaAgency')}
                      {p.note && ` ${p.note}`}
                    </span>
                    <span className="w-28 text-right font-medium tabular text-done">{chf(p.amount)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
          {row.note && (
            <Section title={t('collection.note')}>
              <NoteText text={row.note} className="text-[13px]" />
            </Section>
          )}
        </div>
        <Section title={t('collection.history')}>
          <History events={events} team={team} agencies={agencies} />
        </Section>
      </div>

      {open === 'contact' && <ContactDialog caseId={row.id} today={today} onClose={() => setOpen(null)} />}
      {open === 'promise' && <PromiseDialog caseId={row.id} today={today} onClose={() => setOpen(null)} />}
      {open === 'payment' && <PaymentDialog caseId={row.id} open={row.open} today={today} onClose={() => setOpen(null)} />}
      {open === 'agency' && <AgencyDialog caseId={row.id} agencies={agencies} today={today} onClose={() => setOpen(null)} />}
      {open === 'invoice' && <InvoiceDialog caseId={row.id} onClose={() => setOpen(null)} />}
      {(open === 'uncollectible' || open === 'settled' || open === 'reopen') && (
        <StageDialog caseId={row.id} stage={open === 'uncollectible' ? 'uncollectible' : open === 'settled' ? 'paid' : 'follow_up'} onClose={() => setOpen(null)} />
      )}
    </>
  );
}

function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <Card className="p-3">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <h2 className="text-[11.5px] font-semibold uppercase tracking-wide text-muted">{title}</h2>
        {action}
      </div>
      {children}
    </Card>
  );
}

const EVENT_ICON = { call: Phone, email: Mail, note: MessageSquare, promise: CalendarCheck, payment: Banknote, stage: RotateCcw, agency: Building2, invoice: Plus, responsible: RotateCcw } as const;

function History({ events, team, agencies }: { events: CollectionEvent[]; team: { id: string; name: string }[]; agencies: CollectionAgency[] }) {
  const { t, formatDate } = useI18n();
  const labels = useCollectionLabels();
  if (events.length === 0) return <p className="text-[12.5px] text-muted">—</p>;
  const what = (e: CollectionEvent): string => {
    const d = e.detail as Record<string, string | number | boolean | null | undefined>;
    switch (e.kind) {
      case 'promise': return t('collection.evPromise', { date: formatDate(String(d.promised_on), 'short') });
      case 'payment': return t(d.via_agency ? 'collection.evPaymentAgency' : 'collection.evPayment', { amount: chf(Number(d.amount)) });
      case 'stage': return d.opened ? t('collection.evOpened') : t('collection.evStage', { stage: labels.stage(d.stage as never) });
      case 'agency': return t('collection.evAgency', { name: agencies.find((a) => a.id === d.agency_id)?.name ?? '—' });
      case 'invoice': return d.added ? t('collection.evInvoiceAdded', { number: String(d.added), amount: chf(Number(d.amount)) }) : t('collection.evInvoiceRemoved', { number: String(d.removed) });
      case 'responsible': return t('collection.evResponsible', { name: team.find((p) => p.id === d.responsible_id)?.name ?? '—' });
      default: return t(`collection.ev_${e.kind}` as MessageKey);
    }
  };
  return (
    <ul className="space-y-2.5">
      {events.map((e) => {
        const Icon = EVENT_ICON[e.kind];
        return (
          <li key={e.id} className="flex gap-2.5">
            <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="text-[12px] text-muted">
                <span className="font-medium text-fg">{what(e)}</span> · {formatDate(e.happened_on, 'short')}
                {e.author && ` · ${e.author}`}
              </p>
              {e.body && <NoteText text={e.body} className="text-[13px]" />}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/* --------------------------------- dialogs --------------------------------- */

function useSubmit(onClose: () => void) {
  const router = useRouter();
  const labels = useCollectionLabels();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const submit = (fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) return setError(labels.error(res.error ?? ''));
      onClose();
      router.refresh();
    });
  };
  return { error, pending, submit };
}

function Frame({ title, description, onClose, onSave, pending, ready, error, children }: {
  title: string; description?: string; onClose: () => void; onSave: () => void; pending: boolean; ready: boolean; error: string | null; children: ReactNode;
}) {
  const { t } = useI18n();
  return (
    <Dialog
      open
      onClose={onClose}
      title={title}
      description={description}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>{t('common.cancel')}</Button>
          <Button variant="primary" onClick={onSave} loading={pending} disabled={!ready}>{t('common.save')}</Button>
        </>
      }
    >
      <div className="space-y-3.5">
        {error && <ErrorState message={error} />}
        {children}
      </div>
    </Dialog>
  );
}

function ContactDialog({ caseId, today, onClose }: { caseId: string; today: string; onClose: () => void }) {
  const { t } = useI18n();
  const { error, pending, submit } = useSubmit(onClose);
  const [kind, setKind] = useState<'call' | 'email' | 'note'>('call');
  const [date, setDate] = useState(today);
  const [body, setBody] = useState('');
  const [next, setNext] = useState('');
  return (
    <Frame
      title={t('collection.logContact')}
      description={t('collection.logContactHint')}
      onClose={onClose}
      onSave={() => submit(() => logContact(caseId, { kind, happened_on: date, body, next_follow_up: next || null }))}
      pending={pending}
      ready={!!body.trim()}
      error={error}
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('collection.contactKind')} htmlFor="contact-kind">
          <Select id="contact-kind" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
            <option value="call">{t('collection.ev_call')}</option>
            <option value="email">{t('collection.ev_email')}</option>
            <option value="note">{t('collection.ev_note')}</option>
          </Select>
        </Field>
        <Field label={t('collection.when')} htmlFor="contact-date">
          <Input id="contact-date" type="date" max={today} value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
      </div>
      <Field label={t('collection.whatWasSaid')} required htmlFor="contact-body">
        <NoteTextarea id="contact-body" rows={3} value={body} onChange={(e) => setBody(e.target.value)} autoFocus />
      </Field>
      <Field label={t('collection.nextFollowUp')} hint={t('collection.nextFollowUpHint')} htmlFor="contact-next">
        <Input id="contact-next" type="date" min={today} value={next} onChange={(e) => setNext(e.target.value)} className="w-auto" />
      </Field>
    </Frame>
  );
}

function PromiseDialog({ caseId, today, onClose }: { caseId: string; today: string; onClose: () => void }) {
  const { t } = useI18n();
  const { error, pending, submit } = useSubmit(onClose);
  const [date, setDate] = useState('');
  const [body, setBody] = useState('');
  return (
    <Frame title={t('collection.promise')} description={t('collection.promiseHint')} onClose={onClose} onSave={() => submit(() => setPromise(caseId, date, body))} pending={pending} ready={!!date} error={error}>
      <Field label={t('collection.promiseDate')} required htmlFor="promise-date">
        <Input id="promise-date" type="date" min={today} value={date} onChange={(e) => setDate(e.target.value)} autoFocus />
      </Field>
      <Field label={t('collection.note')} htmlFor="promise-note">
        <NoteTextarea id="promise-note" rows={2} value={body} onChange={(e) => setBody(e.target.value)} />
      </Field>
    </Frame>
  );
}

function PaymentDialog({ caseId, open, today, onClose }: { caseId: string; open: number; today: string; onClose: () => void }) {
  const { t } = useI18n();
  const { error, pending, submit } = useSubmit(onClose);
  const [date, setDate] = useState(today);
  const [amount, setAmount] = useState(open.toFixed(2));
  const [note, setNote] = useState('');
  const value = Number(amount.replace(/'/g, '').replace(',', '.'));
  return (
    <Frame
      title={t('collection.payment')}
      description={t('collection.paymentHint')}
      onClose={onClose}
      onSave={() => submit(() => addPayment(caseId, { paid_on: date, amount: value, note }))}
      pending={pending}
      ready={value > 0 && !!date}
      error={error}
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('collection.amount')} required htmlFor="payment-amount">
          <Input id="payment-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
        </Field>
        <Field label={t('collection.paidOn')} required htmlFor="payment-date">
          <Input id="payment-date" type="date" max={today} value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
      </div>
      <Field label={t('collection.note')} htmlFor="payment-note">
        <Input id="payment-note" value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
    </Frame>
  );
}

function AgencyDialog({ caseId, agencies, today, onClose }: { caseId: string; agencies: CollectionAgency[]; today: string; onClose: () => void }) {
  const { t } = useI18n();
  const { error, pending, submit } = useSubmit(onClose);
  const [agencyId, setAgencyId] = useState(agencies[0]?.id ?? '');
  const [date, setDate] = useState(today);
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  return (
    <Frame
      title={t('collection.toAgency')}
      description={agencies.length ? t('collection.toAgencyHint') : t('collection.noAgencies')}
      onClose={onClose}
      onSave={() => submit(() => sendToAgency(caseId, { agency_id: agencyId, sent_on: date, reference, note }))}
      pending={pending}
      ready={!!agencyId && !!date}
      error={error}
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('collection.agency')} required htmlFor="agency-id">
          <Select id="agency-id" value={agencyId} onChange={(e) => setAgencyId(e.target.value)}>
            {agencies.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </Select>
        </Field>
        <Field label={t('collection.sentOn')} required htmlFor="agency-date">
          <Input id="agency-date" type="date" max={today} value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
      </div>
      <Field label={t('collection.agencyReference')} htmlFor="agency-ref">
        <Input id="agency-ref" value={reference} onChange={(e) => setReference(e.target.value)} />
      </Field>
      <Field label={t('collection.note')} htmlFor="agency-note">
        <NoteTextarea id="agency-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
    </Frame>
  );
}

function StageDialog({ caseId, stage, onClose }: { caseId: string; stage: 'uncollectible' | 'paid' | 'follow_up'; onClose: () => void }) {
  const { t } = useI18n();
  const { error, pending, submit } = useSubmit(onClose);
  const [reason, setReason] = useState('');
  const title = stage === 'uncollectible' ? t('collection.uncollectible') : stage === 'paid' ? t('collection.settled') : t('collection.reopen');
  return (
    <Frame
      title={title}
      description={stage === 'paid' ? t('collection.settledHint') : undefined}
      onClose={onClose}
      onSave={() => submit(() => setStage(caseId, stage, reason))}
      pending={pending}
      ready={stage === 'paid' || !!reason.trim()}
      error={error}
    >
      <Field label={t('collection.reason')} required={stage !== 'paid'} htmlFor="stage-reason">
        <NoteTextarea id="stage-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
      </Field>
    </Frame>
  );
}

function InvoiceDialog({ caseId, onClose }: { caseId: string; onClose: () => void }) {
  const { t } = useI18n();
  const { error, pending, submit } = useSubmit(onClose);
  const [number, setNumber] = useState('');
  const [due, setDue] = useState('');
  const [amount, setAmount] = useState('');
  const value = Number(amount.replace(/'/g, '').replace(',', '.'));
  return (
    <Frame
      title={t('collection.addInvoice')}
      onClose={onClose}
      onSave={() => submit(() => addInvoice(caseId, { invoice_number: number, due_date: due || null, amount: value }))}
      pending={pending}
      ready={!!number.trim() && value > 0}
      error={error}
    >
      <Field label={t('collection.invoiceNumber')} required htmlFor="inv-number">
        <Input id="inv-number" value={number} onChange={(e) => setNumber(e.target.value)} autoFocus />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('collection.dueDate')} htmlFor="inv-due">
          <Input id="inv-due" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
        </Field>
        <Field label={t('collection.amount')} required htmlFor="inv-amount">
          <Input id="inv-amount" inputMode="decimal" placeholder="CHF" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
      </div>
    </Frame>
  );
}
