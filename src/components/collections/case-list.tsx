'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Plus, Trash2 } from 'lucide-react';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Card, EmptyState, ErrorState, Field, Input, Select } from '@/components/ui/primitives';
import { Combobox } from '@/components/ui/combobox';
import { NoteTextarea } from '@/components/ui/note-textarea';
import { PageHeader } from '@/components/shell/app-shell';
import { createCase } from '@/server/collection-actions';
import type { CollectionCaseRow } from '@/types/collections';
import { StageBadge, chf, useCollectionLabels } from './collection-parts';

/** Collection cases: those still open (by next follow-up), and closed ones. */
export function CaseList({
  tab,
  cases,
  today,
  viewerId,
  team,
  customers,
}: {
  tab: 'open' | 'closed';
  cases: CollectionCaseRow[];
  today: string;
  viewerId: string;
  team: { id: string; name: string }[];
  customers: { id: string; name: string }[];
}) {
  const { t, formatDate } = useI18n();
  const [creating, setCreating] = useState(false);
  const [onlyMine, setOnlyMine] = useState(false);
  const shown = onlyMine ? cases.filter((c) => c.responsible_id === viewerId) : cases;
  const openTotal = shown.reduce((s, c) => s + c.open, 0);

  return (
    <>
      <PageHeader
        title={t('collection.navLabel')}
        subtitle={t('collection.subtitle')}
        action={
          <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
            <Plus className="h-3.5 w-3.5" aria-hidden />
            {t('collection.new')}
          </Button>
        }
      />
      <div className="-mt-2 mb-3 flex flex-wrap items-center gap-1 border-b border-border">
        {(['open', 'closed'] as const).map((key) => (
          <Link
            key={key}
            href={`/collections?tab=${key}`}
            scroll={false}
            className={cn(
              '-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-[13px] font-medium transition-colors',
              tab === key ? 'border-accent text-fg' : 'border-transparent text-muted hover:text-fg',
            )}
          >
            {key === 'open' ? t('collection.tabOpen') : t('collection.tabClosed')}
          </Link>
        ))}
        <label className="ml-auto flex items-center gap-1.5 pb-1 text-[12.5px]">
          <input type="checkbox" className="h-4 w-4 accent-accent" checked={onlyMine} onChange={(e) => setOnlyMine(e.target.checked)} />
          {t('collection.onlyMine')}
        </label>
      </div>

      {tab === 'open' && shown.length > 0 && (
        <p className="mb-2 text-[13px]">
          {t('collection.openTotal')} <span className="font-semibold tabular">{chf(openTotal)}</span>
          <span className="text-muted"> · {t('collection.cases', { count: shown.length })}</span>
        </p>
      )}

      {shown.length === 0 ? (
        <EmptyState title={tab === 'open' ? t('collection.noneOpen') : t('collection.noneClosed')} />
      ) : (
        <Card className="divide-y divide-border">
          {shown.map((c) => {
            const due = c.next_follow_up;
            const late = tab === 'open' && !!due && due < today;
            return (
              <Link key={c.id} href={`/collections/${c.id}`} className="flex items-start gap-3 px-3.5 py-2.5 hover:bg-surface-2">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[13.5px] font-medium">{c.customer_name}</span>
                    <StageBadge stage={c.stage} />
                  </div>
                  <p className="text-[12px] text-muted">
                    {c.responsible_name ?? '—'}
                    {c.oldest_due && ` · ${t('collection.oldestDue', { date: formatDate(c.oldest_due, 'short') })}`}
                    {c.agency_name && ` · ${c.agency_name}`}
                  </p>
                  {tab === 'open' && due && (
                    <p className={cn('text-[12px]', late ? 'font-semibold text-late' : due === today ? 'font-medium text-accent' : 'text-muted')}>
                      {c.stage === 'promise' ? t('collection.checkPromise', { date: formatDate(due, 'short') }) : t('collection.nextOn', { date: formatDate(due, 'short') })}
                    </p>
                  )}
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-[13.5px] font-semibold tabular">{chf(tab === 'open' ? c.open : c.total)}</p>
                  {c.paid > 0 && tab === 'open' && <p className="text-[11.5px] tabular text-muted">{t('collection.ofTotal', { total: chf(c.total) })}</p>}
                </div>
              </Link>
            );
          })}
        </Card>
      )}

      {creating && <NewCaseDialog team={team} customers={customers} viewerId={viewerId} today={today} onClose={() => setCreating(false)} />}
    </>
  );
}

type DraftInvoice = { invoice_number: string; due_date: string; amount: string };

function NewCaseDialog({
  team,
  customers,
  viewerId,
  today,
  onClose,
}: {
  team: { id: string; name: string }[];
  customers: { id: string; name: string }[];
  viewerId: string;
  today: string;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const labels = useCollectionLabels();
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [responsible, setResponsible] = useState(team.some((p) => p.id === viewerId) ? viewerId : team[0]?.id ?? '');
  const [invoices, setInvoices] = useState<DraftInvoice[]>([{ invoice_number: '', due_date: '', amount: '' }]);
  const [next, setNext] = useState(today);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const amount = (v: string) => Number(v.replace(/'/g, '').replace(',', '.'));
  const filled = invoices.filter((i) => i.invoice_number.trim());
  const ready = !!customerId && !!responsible && filled.length > 0 && filled.every((i) => amount(i.amount) > 0);
  const set = (k: number, patch: Partial<DraftInvoice>) => setInvoices(invoices.map((i, j) => (j === k ? { ...i, ...patch } : i)));

  function submit() {
    if (!ready || !customerId) return;
    setError(null);
    startTransition(async () => {
      const res = await createCase({
        customer_id: customerId,
        responsible_id: responsible,
        invoices: filled.map((i) => ({ invoice_number: i.invoice_number, due_date: i.due_date || null, amount: amount(i.amount) })),
        next_follow_up: next || null,
        note,
      });
      if (!res.ok) return setError(labels.error(res.error));
      onClose();
      router.push(`/collections/${res.data.id}`);
    });
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('collection.new')}
      description={t('collection.newHint')}
      className="max-w-xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>{t('common.cancel')}</Button>
          <Button variant="primary" onClick={submit} loading={pending} disabled={!ready}>{t('common.save')}</Button>
        </>
      }
    >
      <div className="space-y-3.5">
        {error && <ErrorState message={error} />}
        <Field label={t('collection.customer')} required htmlFor="collection-customer">
          <Combobox
            id="collection-customer"
            items={customers}
            value={customerId}
            onChange={setCustomerId}
            getKey={(c) => c.id}
            getLabel={(c) => c.name}
            getSearchText={(c) => c.name}
          />
        </Field>
        <Field label={t('collection.invoices')} required>
          <div className="space-y-2">
            {invoices.map((inv, k) => (
              <div key={k} className="grid grid-cols-[1fr_8rem_7rem_auto] items-center gap-2">
                <Input aria-label={t('collection.invoiceNumber')} placeholder={t('collection.invoiceNumber')} value={inv.invoice_number} onChange={(e) => set(k, { invoice_number: e.target.value })} />
                <Input aria-label={t('collection.dueDate')} type="date" value={inv.due_date} onChange={(e) => set(k, { due_date: e.target.value })} />
                <Input aria-label={t('collection.amount')} placeholder="CHF" inputMode="decimal" value={inv.amount} onChange={(e) => set(k, { amount: e.target.value })} />
                <Button size="icon" variant="ghost" aria-label={t('common.delete')} disabled={invoices.length === 1} onClick={() => setInvoices(invoices.filter((_, j) => j !== k))}>
                  <Trash2 className="h-3.5 w-3.5" aria-hidden />
                </Button>
              </div>
            ))}
            <Button size="sm" variant="ghost" onClick={() => setInvoices([...invoices, { invoice_number: '', due_date: '', amount: '' }])}>
              <Plus className="h-3.5 w-3.5" aria-hidden />
              {t('collection.addInvoice')}
            </Button>
          </div>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('collection.responsible')} required htmlFor="collection-responsible">
            <Select id="collection-responsible" value={responsible} onChange={(e) => setResponsible(e.target.value)}>
              {team.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          </Field>
          <Field label={t('collection.nextFollowUp')} htmlFor="collection-next">
            <Input id="collection-next" type="date" value={next} onChange={(e) => setNext(e.target.value)} />
          </Field>
        </div>
        <Field label={t('collection.note')} htmlFor="collection-note">
          <NoteTextarea id="collection-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
}
